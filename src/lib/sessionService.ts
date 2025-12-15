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
  SessionTransaction
} from '../types';

class SessionService {
  private static instance: SessionService;
  private constructor() {}
  public static getInstance(): SessionService {
    if (!SessionService.instance)
      SessionService.instance = new SessionService();
    return SessionService.instance;
  }

  // --- 1. SESSION MANAGEMENT ---

  private getTodayStr(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  public async getDailySessionDate(): Promise<string | null> {
    const { data } = await supabase
      .from('daily_sessions')
      .select('date')
      .eq('is_active', true)
      .single();
    return data ? data.date : null;
  }

  public async getDailySession(): Promise<DailySessionData | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

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
      ...b.customer_details,
      'Booking ID': b.booking_id,
      'Route Number': b.route_number,
      Price: b.price?.toString(),
      'Log Sheet Notes': b.log_notes,
      Status: b.status,
      Prepaid: b.is_prepaid ? 'x' : undefined,
      ...b.data,
    }));

    return {
      date,
      managers,
      workers,
      routes,
      pendingBookings,
    };
  }

  public async uploadDailySession(data: DailySessionData): Promise<void> {
    const { error: sessError } = await supabase
      .from('daily_sessions')
      .insert({ date: data.date, is_active: true });
    if (sessError) throw sessError;

    const allUsers = [
      ...data.managers.map((m) => ({
        user_id: m.userId,
        name: m.name,
        username: m.username,
        password: m.password,
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

    const bookingRows = data.pendingBookings.map((b) => ({
      booking_id: b['Booking ID'],
      route_number: b['Route Number'],
      status: 'pending',
      price: String(b.Price || ''),
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
      data: b,
    }));

    const { error: bookingError } = await supabase
      .from('bookings')
      .insert(bookingRows);
    if (bookingError) throw bookingError;

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

  public async adminResetDailySession(date: string): Promise<void> {
    await supabase.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000'); 
    await supabase.from('logsheet_sessions').delete().eq('date', date);
    await supabase.from('routes').delete().eq('session_date', date);
    await supabase.from('bookings').delete().eq('session_date', date);
    await supabase.from('daily_sessions').delete().eq('date', date);
    await supabase.from('users').delete().in('role', ['Worker', 'RouteManager']);
    localStorage.clear();
    window.location.reload();
  }

  // --- 2. AUTHENTICATION ---

  public async authenticateRM(username: string, password: string): Promise<ManagementUser | null> {
    if (username === 'admin' && password === 'admin') {
      return { userId: 'admin', name: 'Administrator', username: 'admin', role: 'Admin' };
    }
    const { data } = await supabase.from('users').select('*').ilike('username', username).eq('password', password).eq('role', 'RouteManager').single();
    if (!data) return null;
    return { userId: data.user_id, name: data.name, username: data.username, role: 'RouteManager' };
  }

  public async authenticateWorker(contractorId: string, password: string): Promise<Worker | null> {
    const { data } = await supabase.from('users').select('*').eq('user_id', contractorId).eq('password', password).eq('role', 'Worker').single();
    if (!data) return null;
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

  // --- 3. DATA FETCHING (CRITICAL FIXES HERE) ---

  public async getWorkerAssignments(workerId: string): Promise<MasterBooking[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];

    const { data: myRoutes } = await supabase.from('routes').select('route_code').eq('assigned_worker_id', workerId).eq('session_date', date);
    const routeCodes = myRoutes?.map((r) => r.route_code) || [];

    const { data: allBookings } = await supabase.from('bookings').select('*').eq('session_date', date).neq('status', 'completed');

    const myPending = (allBookings || []).filter((b) => {
      const isMyRoute = routeCodes.includes(b.route_number);
      const isAssignedToMe = b.contractor_id === workerId;
      const isAssignedToOther = b.contractor_id && b.contractor_id !== workerId;
      return (isMyRoute && !isAssignedToOther) || isAssignedToMe;
    });

    // FETCH TRANSACTIONS WITH CONTACT INFO
    const { data: myTransactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('worker_id', workerId);

    const pendingMapped = myPending.map((b) => ({
      ...b.data,
      ...b.customer_details,
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
      'Completed': 'x',
      'Status': 'completed',
      'Price': tx.display_price,
      'Route Number': tx.customer_snapshot?.routeCode || '',
      'Log Sheet Notes': tx.item_description,
      
      // FIX 1: Map Phone & Email so the card shows them
      'Home Phone': tx.customer_phone,
      'Email Address': tx.customer_email,

      'Payment Method': tx.payment_method,
      'paymentBreakdown': tx.payment_breakdown,
      'FO/BO/FP': tx.customer_snapshot?.serviceType || 'FP',
      
      'Contract Title': (tx.items && tx.items.length > 0) ? tx.items[0].name : (tx.customer_snapshot?.serviceName || tx.display_price),

      'invoiceNumber': tx.invoice_number,
      'chequeNumber': tx.cheque_number,
      'etransferEmail': tx.etransfer_email,
      
      // FIX 2: Explicitly set boolean flags for coloring
      isContract: ['Upgrade', 'Add-On'].includes(tx.type),
      isUpgrade: tx.type === 'Upgrade',
      isAddOn: tx.type === 'Add-On',
      isNewSale: tx.type === 'Sale',
      
      // FIX 3: Restore PP Badge Logic
      Prepaid: (tx.payment_breakdown && tx.payment_breakdown['Prepaid']) ? 'x' : undefined,
    }));

    return [...pendingMapped, ...completedMapped];
  }

  public getStreetsForRoute(routeCode: string): Promise<string[]> {
    return supabase.from('routes').select('streets').eq('route_code', routeCode).single().then((res) => res.data?.streets || []);
  }

  // --- 4. LOGSHEET SESSIONS ---

  public async getLogsheetSessions(): Promise<LogsheetSession[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];
    const { data } = await supabase.from('logsheet_sessions').select('*').eq('date', date);
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

  public async getActiveLogsheetSession(workerId: string): Promise<LogsheetSession | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

    const { data } = await supabase.from('logsheet_sessions').select('*').eq('worker_id', workerId).eq('date', date).single();
    if (!data) return null;

    const { data: financials } = await supabase.from('transactions').select('*').eq('worker_id', workerId);

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
        timestamp: tx.timestamp,
        type: tx.type,
        price: tx.price,
        paymentMethod: tx.payment_method,
        isPaid: true,
        customerId: tx.job_id,
        customerName: `${tx.customer_snapshot?.firstName} ${tx.customer_snapshot?.lastName}`,
        address: tx.customer_snapshot?.address,
        routeCode: tx.customer_snapshot?.routeCode,
        items: tx.items || [], 
        paymentBreakdown: tx.payment_breakdown,
        displayPrice: tx.display_price,
        itemDescription: tx.item_description,
        invoiceNumber: tx.invoice_number,
        chequeNumber: tx.cheque_number,
        etransferEmail: tx.etransfer_email,
        serviceType: tx.customer_snapshot?.serviceType,
        serviceName: tx.customer_snapshot?.serviceName,
        customerPhone: tx.customer_phone, // Map for modals
        customerEmail: tx.customer_email,  // Map for modals
        
        // CRITICAL FIX: Ensure West Split boolean survives the DB round trip
        // Database column is snake_case (is_west_split), JS is camelCase (isWestSplit)
        isWestSplit: tx.is_west_split 
      })) as any,
    };
  }

  public async startLogsheetSession(workerId: string): Promise<LogsheetSession> {
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session day found');
    const existing = await this.getActiveLogsheetSession(workerId);
    if (existing) return existing;
    const newSession = {
      id: `sess_${workerId}_${Date.now()}`,
      worker_id: workerId,
      date: date,
      status: 'OPEN',
      stats: this.getEmptyStats(),
    };
    const { error } = await supabase.from('logsheet_sessions').insert(newSession);
    if (error) throw error;
    return this.getActiveLogsheetSession(workerId) as Promise<LogsheetSession>;
  }

  public async updateLogsheetSession(sessionId: string, updates: Partial<LogsheetSession>): Promise<void> {
    const safeUpdates: any = {};
    if (updates.stats) safeUpdates.stats = updates.stats;
    if (updates.validation) safeUpdates.validation = updates.validation;
    if (updates.bonuses) safeUpdates.bonuses = updates.bonuses;
    if (updates.status) safeUpdates.status = updates.status;
    await supabase.from('logsheet_sessions').update(safeUpdates).eq('id', sessionId);
  }

  // --- 5. ASSIGNMENTS & UPDATES ---

  public async assignBookingToWorker(bookingId: string, workerId: string | null): Promise<void> {
    const { error } = await supabase
      .from('bookings')
      .update({ contractor_id: workerId })
      .eq('booking_id', bookingId);
    if (error) console.error("Error assigning booking:", error);
  }

  public async assignRouteToWorker(routeCode: string, workerId: string | null): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;
    
    const { error } = await supabase
      .from('routes')
      .update({ assigned_worker_id: workerId })
      .eq('route_code', routeCode)
      .eq('session_date', date);
      
    if (error) console.error("Error assigning route:", error);
  }

  // --- 6. TRANSACTIONS ---

  public async deleteTransactionByJobId(jobId: string): Promise<void> {
      await supabase.from('transactions').delete().eq('job_id', jobId);
  }

  public async completeJob(transaction: SessionTransaction, bookingId: string, workerId: string): Promise<void> {
    const { error: txError } = await supabase.from('transactions').insert({
      id: transaction.id,
      job_id: bookingId,
      worker_id: workerId,
      timestamp: transaction.timestamp,
      type: transaction.type,
      price: transaction.price,
      payment_method: transaction.paymentMethod,
      payment_breakdown: transaction.paymentBreakdown,
      
      // IMPORTANT: Save West Split flag to DB
      is_west_split: transaction.isWestSplit, 
      
      display_price: transaction.displayPrice,
      item_description: transaction.itemDescription,
      invoice_number: transaction.invoiceNumber,
      cheque_number: transaction.chequeNumber,
      etransfer_email: transaction.etransferEmail,
      
      // IMPORTANT: Save Contact Info to DB columns
      customer_phone: transaction.customerPhone,
      customer_email: transaction.customerEmail,
      
      items: transaction.items, 

      customer_snapshot: {
        firstName: transaction.customerName.split(' ')[0],
        lastName: transaction.customerName.split(' ').slice(1).join(' '),
        address: transaction.address,
        routeCode: transaction.routeCode,
        serviceType: transaction.serviceType,
        serviceName: transaction.serviceName 
      },
    });
    if (txError) throw txError;

    if (!bookingId.startsWith('NEW-')) {
      await supabase.from('bookings').update({
          status: 'completed',
          contractor_id: workerId,
        }).eq('booking_id', bookingId);
    }
  }

  // --- 7. UTILS ---

  public getEmptyStats(): SessionStats {
    return {
      prodPrepaid: 0, prodBilled: 0, prodCash: 0, prodCheque: 0, prodETransfer: 0, prodCreditCard: 0, prodFlats: 0, prodPrepaidSplit: 0,
      prodGross: 0, prodPayable: 0, totalEQ: 0,
      upsellCash: 0, upsellCheque: 0, upsellETransfer: 0, upsellCreditCard: 0, upsellBilled: 0, upsellPrepaid: 0,
      upsellGross: 0, upsellPayable: 0,
      stepCount: 0, upsellCount: 0, iosCount: 0,
    };
  }

  public recalculateStats(financials: any[], taxRate: number = 5): SessionStats {
    const stats = this.getEmptyStats();
    const taxDivisor = 1 + taxRate / 100;

    financials.forEach((tx) => {
      if (['Production', 'Sale', 'Upgrade'].includes(tx.type)) stats.stepCount++;
      if (['Upgrade', 'Add-On'].includes(tx.type)) stats.upsellCount++;
      if (tx.paymentMethod === 'IOS') stats.iosCount++;

      const paymentMap: Record<string, number> = (tx as any).paymentBreakdown || { [tx.paymentMethod]: tx.price };

      Object.entries(paymentMap).forEach(([method, amount]) => {
        const val = Number(amount) || 0;
        const addToBucket = (val: number, isProd: boolean) => {
          if (isProd) {
            if (tx.type === 'Production' && (tx.displayPrice?.startsWith('RJ') || tx.displayPrice?.startsWith('SP'))) {
              stats.prodFlats += val;
            } else if (method.includes('Prepaid')) stats.prodPrepaid += val;
            else if (method.includes('Billed') || method === 'IOS') stats.prodBilled += val;
            else if (method.includes('Cash')) stats.prodCash += val;
            else if (method.includes('Cheque')) stats.prodCheque += val;
            else if (method.includes('E-Transfer')) stats.prodETransfer += val;
            else if (method.includes('Credit Card')) stats.prodCreditCard += val;
          } else {
            if (method.includes('Prepaid')) stats.upsellPrepaid += val;
            else if (method.includes('Billed') || method === 'IOS') stats.upsellBilled += val;
            else if (method.includes('Cash')) stats.upsellCash += val;
            else if (method.includes('Cheque')) stats.upsellCheque += val;
            else if (method.includes('E-Transfer')) stats.upsellETransfer += val;
            else if (method.includes('Credit Card')) stats.upsellCreditCard += val;
          }
        };

        if (tx.type === 'Production' || tx.type === 'Sale') {
          addToBucket(val, true);
        } else if (tx.type === 'Add-On') {
          addToBucket(val, false);
        } else if (tx.type === 'Upgrade') {
          // CHECKING BOTH CASE TYPES FOR SAFETY
          if (tx.isWestSplit || tx.is_west_split) {
            addToBucket(val * 0.2, true);
            addToBucket(val * 0.8, false);
            if (method.includes('Prepaid')) stats.prodPrepaidSplit += val * 0.2;
          } else {
            addToBucket(val, false);
          }
        }
      });
    });

    stats.prodGross = stats.prodPrepaid + stats.prodBilled + stats.prodCash + stats.prodCheque + stats.prodETransfer + stats.prodCreditCard + stats.prodFlats;
    const weightedProd = stats.prodPrepaid * 0.5 + stats.prodBilled * 0.5 + stats.prodCash + stats.prodCheque + stats.prodETransfer + stats.prodCreditCard + stats.prodFlats;

    stats.prodPayable = weightedProd / taxDivisor;
    stats.totalEQ = stats.prodPayable / 25;
    stats.upsellGross = stats.upsellBilled + stats.upsellCash + stats.upsellCheque + stats.upsellETransfer + stats.upsellCreditCard + stats.upsellPrepaid;
    stats.upsellPayable = stats.upsellGross / taxDivisor;

    return stats;
  }
}

export const sessionService = SessionService.getInstance();