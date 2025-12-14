// src/lib/sessionService.ts
import { supabase } from './supabase';
import { format } from 'date-fns';
import {
  DailySessionData,
  ManagementUser,
  Worker,
  LogsheetSession,
  SessionStats,
  MasterBooking,
} from '../types';

class SessionService {
  private static instance: SessionService;
  private constructor() {}
  public static getInstance(): SessionService {
    if (!SessionService.instance)
      SessionService.instance = new SessionService();
    return SessionService.instance;
  }

  // --- 1. SESSION MANAGEMENT (Cloud) ---

  // Helper to get today's date string
  private getTodayStr(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  // Fetch the active session date from the DB
  public async getDailySessionDate(): Promise<string | null> {
    const { data } = await supabase
      .from('daily_sessions')
      .select('date')
      .eq('is_active', true)
      .maybeSingle(); // FIX: Use .maybeSingle() to prevent 406 errors if DB is empty
    return data ? data.date : null;
  }

  // Get the full daily session object (for Admin/RM views)
  public async getDailySession(): Promise<DailySessionData | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

    // Fetch all related data in parallel
    const [managersRes, workersRes, routesRes, bookingsRes] = await Promise.all(
      [
        supabase.from('users').select('*').eq('role', 'RouteManager'),
        supabase.from('users').select('*').eq('role', 'Worker'),
        supabase.from('routes').select('*').eq('session_date', date),
        supabase
          .from('bookings')
          .select('*')
          .eq('session_date', date)
          .eq('status', 'pending'),
      ]
    );

    const managers = (managersRes.data || []).map((m) => ({
      userId: m.user_id,
      name: m.name,
      username: m.username,
      password: m.password,
      role: 'RouteManager' as const,
    }));

    const workers = (workersRes.data || []).map((w) => ({
      contractorId: w.user_id,
      firstName: w.name.split(' ')[0],
      lastName: w.name.split(' ').slice(1).join(' '),
      cellPhone: w.metadata?.phone,
      status: 'Return' as const,
      alumniRate: w.metadata?.alumniRate,
      silverRate: w.metadata?.silverRate,
      assignedManagerId: w.metadata?.assignedManagerId,
    }));

    const routes = (routesRes.data || []).map((r) => ({
      routeCode: r.route_code,
      managerId: r.manager_id,
      assignedWorkerId: r.assigned_worker_id,
      streets: r.streets,
    }));

    const pendingBookings = (bookingsRes.data || []).map((b) => ({
      ...b.customer_details, // Spread stored details
      'Booking ID': b.booking_id,
      'Route Number': b.route_number,
      Price: b.price?.toString(),
      'Log Sheet Notes': b.log_notes,
      Status: b.status,
      Prepaid: b.is_prepaid ? 'x' : undefined,
      ...b.data, // Spread any extra raw data
    }));

    return {
      date,
      managers,
      workers,
      routes,
      pendingBookings,
    };
  }

  // REPLACES initializeDailySession -> Now performs Cloud Ingestion
  public async uploadDailySession(data: DailySessionData): Promise<void> {
    // 1. Create Daily Session
    const { error: sessError } = await supabase
      .from('daily_sessions')
      .insert({ date: data.date, is_active: true });
    if (sessError) throw sessError;

    // 2. Upsert Users (Managers & Workers)
    const allUsers = [
      ...data.managers.map((m) => ({
        user_id: m.userId,
        name: m.name,
        username: m.username,
        password: m.password, // Ideally hash this in production
        role: 'RouteManager',
      })),
      ...data.workers.map((w) => ({
        user_id: w.contractorId,
        name: `${w.firstName} ${w.lastName}`,
        role: 'Worker',
        password: w.firstName,
        metadata: {
          phone: w.cellPhone,
          alumniRate: w.alumniRate,
          silverRate: w.silverRate,
          assignedManagerId: w.assignedManagerId,
        },
      })),
    ];

    const { error: userError } = await supabase
      .from('users')
      .upsert(allUsers, { onConflict: 'user_id' });
    if (userError) throw userError;

    // 3. Insert Routes
    const routeRows = data.routes.map((r) => ({
      route_code: r.routeCode,
      manager_id: r.managerId,
      streets: r.streets,
      session_date: data.date,
    }));
    const { error: routeError } = await supabase
      .from('routes')
      .insert(routeRows);
    if (routeError) throw routeError;

    // 4. Insert Bookings
    const bookingRows = data.pendingBookings.map((b) => ({
      booking_id: b['Booking ID'],
      route_number: b['Route Number'],
      status: 'pending',
      // FIX: Force String() before replace to handle Excel Numbers safely
      price: parseFloat(String(b.Price || '0').replace(/[^0-9.]/g, '')) || 0,
      customer_details: {
        'First Name': b['First Name'],
        'Last Name': b['Last Name'],
        'Full Address': b['Full Address'],
        'Home Phone': b['Home Phone'],
        'Cell Phone': b['Cell Phone'],
        'Email Address': b['Email Address'],
        'FO/BO/FP': b['FO/BO/FP'],
      },
      log_notes: b['Log Sheet Notes'],
      is_prepaid: b.Prepaid === 'x',
      session_date: data.date,
      data: b, // Store raw data for full compatibility
    }));

    const { error: bookingError } = await supabase
      .from('bookings')
      .insert(bookingRows);
    if (bookingError) throw bookingError;

    // 5. Initialize Empty Logsheets
    const logsheetRows = data.workers.map((w) => ({
      id: `sess_${w.contractorId}_${Date.now()}`,
      worker_id: w.contractorId,
      date: data.date,
      status: 'OPEN',
      stats: this.getEmptyStats(),
    }));
    const { error: lsError } = await supabase
      .from('logsheet_sessions')
      .insert(logsheetRows);
    if (lsError) throw lsError;
  }

  // REPLACES clearSession -> Deletes from Cloud (Dangerous!)
  public async adminResetDailySession(date: string): Promise<void> {
    // Cascade delete should handle children, but deleting explicit for safety
    await supabase.from('daily_sessions').delete().eq('date', date);
    localStorage.clear();
    window.location.reload();
  }

  // --- 2. AUTHENTICATION (Cloud) ---

  public async authenticateRM(
    username: string,
    password: string
  ): Promise<ManagementUser | null> {
    if (username === 'admin' && password === 'admin') {
      return {
        userId: 'admin',
        name: 'Administrator',
        username: 'admin',
        role: 'Admin',
      };
    }
    const { data } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username) // Case insensitive
      .eq('password', password)
      .eq('role', 'RouteManager')
      .single();

    if (!data) return null;
    return {
      userId: data.user_id,
      name: data.name,
      username: data.username,
      role: 'RouteManager',
    };
  }

  public async authenticateWorker(
    contractorId: string,
    password: string
  ): Promise<Worker | null> {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', contractorId)
      .eq('password', password)
      .eq('role', 'Worker')
      .single();

    if (!data) return null;

    // Map DB User to Worker type
    const names = data.name.split(' ');
    return {
      contractorId: data.user_id,
      firstName: names[0],
      lastName: names.slice(1).join(' '),
      cellPhone: data.metadata?.phone,
      status: 'Return',
      alumniRate: data.metadata?.alumniRate,
      silverRate: data.metadata?.silverRate,
      assignedManagerId: data.metadata?.assignedManagerId,
    };
  }

  // --- 3. DATA FETCHING (Cloud) ---

  // Get Assignments: Merges Bookings + Transactions
  public async getWorkerAssignments(
    workerId: string
  ): Promise<MasterBooking[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];

    // 1. Get Routes assigned to me
    const { data: myRoutes } = await supabase
      .from('routes')
      .select('route_code')
      .eq('assigned_worker_id', workerId)
      .eq('session_date', date);

    const routeCodes = myRoutes?.map((r) => r.route_code) || [];

    // 2. Fetch Pending Bookings
    // Logic: (In My Route AND Not Assigned to Other) OR (Assigned To Me)
    const { data: allBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('session_date', date)
      .neq('status', 'completed');

    // Filter in JS for accurate ownership logic
    const myPending = (allBookings || []).filter((b) => {
      const isMyRoute = routeCodes.includes(b.route_number);
      const isAssignedToMe = b.contractor_id === workerId;
      const isAssignedToOther = b.contractor_id && b.contractor_id !== workerId;
      return (isMyRoute && !isAssignedToOther) || isAssignedToMe;
    });

    // 3. Fetch Completed Transactions (My History)
    // Filter by date if you only want today's history
    const { data: myTransactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('worker_id', workerId);

    // 4. Map DB objects to MasterBooking interface
    const pendingMapped = myPending.map((b) => ({
      ...b.data, // Spread original raw data
      ...b.customer_details, // Spread details
      'Booking ID': b.booking_id,
      'Route Number': b.route_number,
      'Contractor Number': b.contractor_id,
      Status: b.status,
      Price: b.price?.toString(),
      'Log Sheet Notes': b.log_notes,
      Prepaid: b.is_prepaid ? 'x' : undefined,
    }));

    const completedMapped = (myTransactions || []).map((tx) => ({
      'Booking ID': tx.job_id,
      'First Name': tx.customer_snapshot?.firstName || 'Unknown',
      'Last Name': tx.customer_snapshot?.lastName || '',
      'Full Address': tx.customer_snapshot?.address || '',
      Completed: 'x',
      Status: 'completed',
      Price: tx.display_price,
      'Route Number': tx.customer_snapshot?.routeCode || '',
      'Log Sheet Notes': tx.item_description,
      'Payment Method': tx.payment_method,
      paymentBreakdown: tx.payment_breakdown,
      'FO/BO/FP': tx.customer_snapshot?.serviceType,
      isContract: ['Upgrade', 'Add-On'].includes(tx.type),
      isNewSale: tx.type === 'Sale',
    }));

    return [...pendingMapped, ...completedMapped];
  }

  public getStreetsForRoute(routeCode: string): Promise<string[]> {
    // Since this needs to be sync in React sometimes, this might break things.
    // But we will make it async.
    return supabase
      .from('routes')
      .select('streets')
      .eq('route_code', routeCode)
      .single()
      .then((res) => res.data?.streets || []);
  }

  // --- 4. LOGSHEET SESSIONS (State) ---

  public async getLogsheetSessions(): Promise<LogsheetSession[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];
    const { data } = await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('date', date);
    return (data || []).map((d) => ({
      id: d.id,
      workerId: d.worker_id,
      date: d.date,
      status: d.status,
      stats: d.stats,
      validation: d.validation,
      bonuses: d.bonuses,
      dailyRouteStore: [],
      financialStore: [],
    }));
  }

  public async getActiveLogsheetSession(
    workerId: string
  ): Promise<LogsheetSession | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

    const { data } = await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('worker_id', workerId)
      .eq('date', date)
      .single();

    if (!data) return null;

    // Fetch financials separately
    const { data: financials } = await supabase
      .from('transactions')
      .select('*')
      .eq('worker_id', workerId);

    return {
      id: data.id,
      workerId: data.worker_id,
      date: data.date,
      status: data.status,
      stats: data.stats,
      validation: data.validation,
      bonuses: data.bonuses,
      dailyRouteStore: [],
      financialStore: (financials || []).map((tx) => ({
        id: tx.id,
        jobId: tx.job_id,
        workerId: tx.worker_id,
        workerName: '',
        timestamp: tx.timestamp,
        type: tx.type,
        price: tx.price,
        paymentMethod: tx.payment_method,
        isPaid: true, // simplified
        customerId: tx.job_id,
        customerName: `${tx.customer_snapshot?.firstName} ${tx.customer_snapshot?.lastName}`,
        address: tx.customer_snapshot?.address,
        routeCode: tx.customer_snapshot?.routeCode,
        routeManagerName: '',
        items: [],
        paymentBreakdown: tx.payment_breakdown,
        displayPrice: tx.display_price,
        itemDescription: tx.item_description,
      })) as any,
    };
  }

  public async startLogsheetSession(
    workerId: string
  ): Promise<LogsheetSession> {
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session day found');

    // Check existing
    const existing = await this.getActiveLogsheetSession(workerId);
    if (existing) return existing;

    // Create new
    const newSession = {
      id: `sess_${workerId}_${Date.now()}`,
      worker_id: workerId,
      date: date,
      status: 'OPEN',
      stats: this.getEmptyStats(),
    };

    const { error } = await supabase
      .from('logsheet_sessions')
      .insert(newSession);
    if (error) throw error;

    return this.getActiveLogsheetSession(workerId) as Promise<LogsheetSession>;
  }

  // REPLACES updateLogsheetSession -> Updates DB Stats & Validation
  public async updateLogsheetSession(
    sessionId: string,
    updates: Partial<LogsheetSession>
  ): Promise<void> {
    const safeUpdates: any = {};
    if (updates.stats) safeUpdates.stats = updates.stats;
    if (updates.validation) safeUpdates.validation = updates.validation;
    if (updates.bonuses) safeUpdates.bonuses = updates.bonuses;
    if (updates.status) safeUpdates.status = updates.status;

    await supabase
      .from('logsheet_sessions')
      .update(safeUpdates)
      .eq('id', sessionId);
  }

  // --- 5. TRANSACTIONS (Completing Jobs) ---

  // New method to handle "Save & Complete" safely
  public async completeJob(
    transaction: any,
    bookingId: string,
    workerId: string
  ): Promise<void> {
    // 1. Insert Transaction
    const { error: txError } = await supabase.from('transactions').insert({
      id: transaction.id,
      job_id: bookingId,
      worker_id: workerId,
      timestamp: transaction.timestamp,
      type: transaction.type,
      price: transaction.price,
      payment_method: transaction.paymentMethod,
      payment_breakdown: transaction.paymentBreakdown,
      is_west_split: transaction.isWestSplit,
      display_price: transaction.displayPrice,
      item_description: transaction.itemDescription,
      customer_snapshot: {
        firstName: transaction.customerName.split(' ')[0],
        lastName: transaction.customerName.split(' ').slice(1).join(' '),
        address: transaction.address,
        routeCode: transaction.routeCode,
        serviceType: transaction.serviceType,
      },
    });
    if (txError) throw txError;

    // 2. Update Booking Status
    if (!bookingId.startsWith('NEW-')) {
      await supabase
        .from('bookings')
        .update({
          status: 'completed',
          contractor_id: workerId,
        })
        .eq('booking_id', bookingId);
    }
  }

  // --- 6. UTILS ---

  public getEmptyStats(): SessionStats {
    return {
      prodPrepaid: 0,
      prodBilled: 0,
      prodCash: 0,
      prodCheque: 0,
      prodETransfer: 0,
      prodCreditCard: 0,
      prodFlats: 0,
      prodPrepaidSplit: 0,
      prodGross: 0,
      prodPayable: 0,
      totalEQ: 0,
      upsellCash: 0,
      upsellCheque: 0,
      upsellETransfer: 0,
      upsellCreditCard: 0,
      upsellBilled: 0,
      upsellPrepaid: 0,
      upsellGross: 0,
      upsellPayable: 0,
      stepCount: 0,
      upsellCount: 0,
      iosCount: 0,
    };
  }

  public recalculateStats(
    financials: any[],
    taxRate: number = 5
  ): SessionStats {
    const stats = this.getEmptyStats();
    const taxDivisor = 1 + taxRate / 100;

    financials.forEach((tx) => {
      if (['Production', 'Sale', 'Upgrade'].includes(tx.type))
        stats.stepCount++;
      if (['Upgrade', 'Add-On'].includes(tx.type)) stats.upsellCount++;

      if (tx.paymentMethod === 'IOS') {
        stats.iosCount++;
      }

      const paymentMap: Record<string, number> = (tx as any)
        .paymentBreakdown || { [tx.paymentMethod]: tx.price };

      Object.entries(paymentMap).forEach(([method, amount]) => {
        const val = Number(amount) || 0;

        const addToBucket = (val: number, isProd: boolean) => {
          if (isProd) {
            if (
              tx.type === 'Production' &&
              (tx.displayPrice?.startsWith('RJ') ||
                tx.displayPrice?.startsWith('SP'))
            ) {
              stats.prodFlats += val;
            } else if (method.includes('Prepaid')) stats.prodPrepaid += val;
            else if (method.includes('Billed') || method === 'IOS')
              stats.prodBilled += val;
            else if (method.includes('Cash')) stats.prodCash += val;
            else if (method.includes('Cheque')) stats.prodCheque += val;
            else if (method.includes('E-Transfer')) stats.prodETransfer += val;
            else if (method.includes('Credit Card'))
              stats.prodCreditCard += val;
          } else {
            if (method.includes('Prepaid')) stats.upsellPrepaid += val;
            else if (method.includes('Billed') || method === 'IOS')
              stats.upsellBilled += val;
            else if (method.includes('Cash')) stats.upsellCash += val;
            else if (method.includes('Cheque')) stats.upsellCheque += val;
            else if (method.includes('E-Transfer'))
              stats.upsellETransfer += val;
            else if (method.includes('Credit Card'))
              stats.upsellCreditCard += val;
          }
        };

        if (tx.type === 'Production' || tx.type === 'Sale') {
          addToBucket(val, true);
        } else if (tx.type === 'Add-On') {
          addToBucket(val, false);
        } else if (tx.type === 'Upgrade') {
          if (tx.isWestSplit) {
            addToBucket(val * 0.2, true);
            addToBucket(val * 0.8, false);
            if (method.includes('Prepaid')) stats.prodPrepaidSplit += val * 0.2;
          } else {
            addToBucket(val, false);
          }
        }
      });
    });

    stats.prodGross =
      stats.prodPrepaid +
      stats.prodBilled +
      stats.prodCash +
      stats.prodCheque +
      stats.prodETransfer +
      stats.prodCreditCard +
      stats.prodFlats;
    const weightedProd =
      stats.prodPrepaid * 0.5 +
      stats.prodBilled * 0.5 +
      stats.prodCash +
      stats.prodCheque +
      stats.prodETransfer +
      stats.prodCreditCard +
      stats.prodFlats;

    stats.prodPayable = weightedProd / taxDivisor;
    stats.totalEQ = stats.prodPayable / 25;
    stats.upsellGross =
      stats.upsellBilled +
      stats.upsellCash +
      stats.upsellCheque +
      stats.upsellETransfer +
      stats.upsellCreditCard +
      stats.upsellPrepaid;
    stats.upsellPayable = stats.upsellGross / taxDivisor;

    return stats;
  }
}

export const sessionService = SessionService.getInstance();