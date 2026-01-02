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

  // --- 1. HELPERS ---

  private getTodayStr(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  // Unified mapper to ensure consistency everywhere
  private mapDbTransaction(tx: any): SessionTransaction {
    return {
        id: tx.id,
        jobId: tx.job_id,
        workerId: tx.worker_id,
        timestamp: tx.timestamp,
        type: tx.type,
        price: tx.price,
        paymentMethod: tx.payment_method,
        isPaid: true,
        customerId: tx.job_id,
        customerName: `${tx.customer_snapshot?.firstName || ''} ${tx.customer_snapshot?.lastName || ''}`.trim(),
        address: tx.customer_snapshot?.address,
        routeCode: tx.customer_snapshot?.routeCode,
        items: tx.items || [], 
        paymentBreakdown: tx.payment_breakdown,
        displayPrice: tx.display_price,
        itemDescription: tx.item_description,
        invoiceNumber: tx.invoice_number,
        chequeNumber: tx.cheque_number,
        etransferEmail: tx.etransfer_email,
        
        // --- ADDED: Retrieve Saved CC Data ---
        ccFullNumber: tx.cc_full_number,
        ccExpiry: tx.cc_expiry,
        ccCVC: tx.cc_cvc,
        
        serviceType: tx.customer_snapshot?.serviceType,
        serviceName: tx.customer_snapshot?.serviceName,
        customerPhone: tx.customer_phone, 
        customerEmail: tx.customer_email,
        isWestSplit: tx.is_west_split,
        isPrepaid: tx.payment_method === 'Prepaid' || (tx.payment_breakdown && tx.payment_breakdown['Prepaid']) ? true : false
    } as SessionTransaction;
  }

  // --- 2. FETCHING ---

  public async getTransactionByJobId(jobId: string): Promise<SessionTransaction | null> {
    const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle(); 
    
    if (!data) return null;
    return this.mapDbTransaction(data);
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
      'Contractor Number': b.contractor_id,
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

  // --- 3. SESSION MANAGEMENT ---

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

  /**
   * Safely removes a worker by clearing their dependencies first.
   * This prevents Foreign Key constraint errors.
   */
  public async deleteWorker(workerId: string): Promise<void> {
    // 1. Unassign Routes 
    await supabase.from('routes').update({ assigned_worker_id: null }).eq('assigned_worker_id', workerId);

    // 2. Unassign Bookings
    await supabase.from('bookings').update({ contractor_id: null }).eq('contractor_id', workerId);

    // 3. Delete Logsheet Session
    await supabase.from('logsheet_sessions').delete().eq('worker_id', workerId);

    // 4. Delete Transactions
    await supabase.from('transactions').delete().eq('worker_id', workerId);

    // 5. Delete User (Using snake_case 'user_id' to avoid 404s)
    const { error } = await supabase.from('users').delete().eq('user_id', workerId);
    
    if (error) {
        console.error("Failed to delete user:", error);
        throw error;
    }
  }

  /**
   * Transfers a worker to a new manager by updating metadata and active routes.
   */
  public async transferWorker(workerId: string, newManagerId: string): Promise<void> {
    const date = await this.getDailySessionDate();

    // 1. Fetch current user metadata
    const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('metadata')
        .eq('user_id', workerId)
        .single();
    
    if (fetchError || !user) throw new Error("Worker not found");

    // 2. Update Metadata with new Manager ID
    const newMetadata = { ...user.metadata, assignedManagerId: newManagerId };
    
    const { error: updateError } = await supabase
        .from('users')
        .update({ metadata: newMetadata })
        .eq('user_id', workerId);

    if (updateError) throw updateError;

    // 3. Update any active routes assigned to this worker to belong to the new manager
    if (date) {
        await supabase
            .from('routes')
            .update({ manager_id: newManagerId })
            .eq('assigned_worker_id', workerId)
            .eq('session_date', date);
    }
  }

  // --- 4. AUTHENTICATION ---

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

  // --- 5. LOGSHEETS & TRANSACTIONS ---

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

    // Use shared mapper for consistency
    const completedMapped = (myTransactions || []).map(tx => {
        const mapped = this.mapDbTransaction(tx);
        return {
            'Booking ID': mapped.jobId,
            'First Name': mapped.customerName.split(' ')[0],
            'Last Name': mapped.customerName.split(' ').slice(1).join(' '),
            'Full Address': mapped.address,
            'Completed': 'x',
            'Status': 'completed',
            'Price': mapped.displayPrice,
            'Route Number': mapped.routeCode,
            'Log Sheet Notes': mapped.itemDescription,
            'Home Phone': mapped.customerPhone,
            'Email Address': mapped.customerEmail,
            'Payment Method': mapped.paymentMethod,
            'paymentBreakdown': mapped.paymentBreakdown,
            'FO/BO/FP': mapped.serviceType,
            'Contract Title': (mapped.items && mapped.items.length > 0) ? mapped.items[0].name : (mapped.serviceName || mapped.displayPrice),
            'invoiceNumber': mapped.invoiceNumber,
            'chequeNumber': mapped.chequeNumber,
            'etransferEmail': mapped.etransferEmail,
            isContract: ['Upgrade', 'Add-On'].includes(mapped.type),
            isUpgrade: mapped.type === 'Upgrade',
            isAddOn: mapped.type === 'Add-On',
            isNewSale: mapped.type === 'Sale',
            Prepaid: mapped.isPrepaid ? 'x' : undefined,
        };
    });

    return [...pendingMapped, ...completedMapped];
  }

  public getStreetsForRoute(routeCode: string): Promise<string[]> {
    return supabase.from('routes').select('streets').eq('route_code', routeCode).single().then((res) => res.data?.streets || []);
  }

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
    const cleanFinancials = (financials || []).map(tx => this.mapDbTransaction(tx));
    const liveStats = this.recalculateStats(cleanFinancials, 5);

    return {
      id: data.id,
      workerId: data.worker_id,
      date: data.date,
      status: data.status,
      stats: liveStats,
      validation: data.validation,
      bonuses: data.bonuses,
      dailyRouteStore: [],
      financialStore: cleanFinancials,
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

  // --- 6. BOOKING STATUS UPDATES ---

  /**
   * Updates a booking's status to 'next_time' or 'cancelled'
   * This removes it from the pending queue without creating a transaction
   */
  public async updateBookingStatus(bookingId: string, status: 'next_time' | 'cancelled'): Promise<void> {
    const { error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('booking_id', bookingId);
    
    if (error) {
      console.error("Error updating booking status:", error);
      throw error;
    }
  }

  public async deleteTransactionByJobId(jobId: string): Promise<void> {
      await supabase.from('transactions').delete().eq('job_id', jobId);
  }

  public async revertTransaction(transactionId: string, bookingId?: string): Promise<void> {
    const { error: txError } = await supabase.from('transactions').delete().eq('id', transactionId);
    if (txError) throw txError;
    if (bookingId && !bookingId.startsWith('NEW-')) {
        const { error: bkError } = await supabase.from('bookings').update({ status: 'pending' }).eq('booking_id', bookingId);
        if (bkError) throw bkError;
    }
  }

  public async updateTransaction(transactionId: string, updates: Partial<SessionTransaction>): Promise<void> {
      const dbPayload: any = {};
      if (updates.price !== undefined) dbPayload.price = updates.price;
      if (updates.displayPrice !== undefined) dbPayload.display_price = updates.displayPrice;
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.paymentBreakdown !== undefined) dbPayload.payment_breakdown = updates.paymentBreakdown;
      if (updates.type !== undefined) dbPayload.type = updates.type;
      if (updates.customerName || updates.address || updates.routeCode) {
          dbPayload.customer_snapshot = {
              firstName: updates.customerName?.split(' ')[0] || '',
              lastName: updates.customerName?.split(' ').slice(1).join(' ') || '',
              address: updates.address || '',
              routeCode: updates.routeCode || '',
              serviceType: updates.serviceType || 'FP',
              serviceName: updates.serviceName || ''
          };
      }
      const { error } = await supabase.from('transactions').update(dbPayload).eq('id', transactionId);
      if (error) throw error;
  }

  public async completeJob(transaction: SessionTransaction, bookingId: string, workerId: string): Promise<void> {
    const payload = {
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
      invoice_number: transaction.invoiceNumber,
      cheque_number: transaction.chequeNumber,
      etransfer_email: transaction.etransferEmail,
      customer_phone: transaction.customerPhone,
      customer_email: transaction.customerEmail,
      items: transaction.items, 
      
      // --- Saving Credit Card Data ---
      cc_full_number: (transaction as any).ccFullNumber,
      cc_expiry: (transaction as any).ccExpiry,
      cc_cvc: (transaction as any).ccCVC,

      customer_snapshot: {
        firstName: transaction.customerName ? transaction.customerName.split(' ')[0] : 'Unknown',
        lastName: transaction.customerName ? transaction.customerName.split(' ').slice(1).join(' ') : '',
        address: transaction.address,
        routeCode: transaction.routeCode,
        serviceType: transaction.serviceType,
        serviceName: transaction.serviceName 
      },
    };

    let existingId: string | null = null;
    
    if (bookingId) {
       const { data } = await supabase.from('transactions').select('id').eq('job_id', bookingId).maybeSingle();
       if (data) existingId = data.id;
    }

    if (existingId) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', existingId);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('transactions').insert({ ...payload, id: transaction.id });
        if (error) throw error;
    }

    if (bookingId && !bookingId.startsWith('NEW-')) {
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

  public recalculateStats(financials: SessionTransaction[], taxRate: number = 5): SessionStats {
    const stats = this.getEmptyStats();
    const taxDivisor = 1 + taxRate / 100;

    financials.forEach((tx) => {
      if (['Production', 'Sale', 'Upgrade'].includes(tx.type)) stats.stepCount++;
      if (['Upgrade', 'Add-On'].includes(tx.type)) stats.upsellCount++;
      if (tx.paymentMethod === 'IOS') stats.iosCount++;

      const paymentMap: Record<string, number> = tx.paymentBreakdown || { [tx.paymentMethod]: tx.price };

      Object.entries(paymentMap).forEach(([method, amount]) => {
        const val = Number(amount) || 0;
        
        // --- IOS FIX: Skip adding IOS payments to any dollar bucket ---
        if (method === 'IOS') {
          return;
        }
        
        const addToBucket = (val: number, isProd: boolean) => {
          if (isProd) {
            if ((tx.type === 'Production') && (tx.displayPrice?.startsWith('RJ') || tx.displayPrice?.startsWith('SP'))) {
              stats.prodFlats += val;
            } else if (method.includes('Prepaid')) stats.prodPrepaid += val;
            else if (method.includes('Billed')) stats.prodBilled += val;
            else if (method.includes('Cash')) stats.prodCash += val;
            else if (method.includes('Cheque')) stats.prodCheque += val;
            else if (method.includes('E-Transfer')) stats.prodETransfer += val;
            else if (method.includes('Credit Card')) stats.prodCreditCard += val;
          } else {
            if (method.includes('Prepaid')) stats.upsellPrepaid += val;
            else if (method.includes('Billed')) stats.upsellBilled += val;
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
           // 80% goes to Upsell (Commission)
           addToBucket(val * 0.8, false);

           // 20% goes to Prod (EQ)
           if (method.includes('Prepaid')) {
               stats.prodPrepaidSplit += (val * 0.2);
           } else {
               addToBucket(val * 0.2, true);
           }
        }
      });
    });

    stats.prodGross = stats.prodPrepaid + stats.prodBilled + stats.prodCash + stats.prodCheque + stats.prodETransfer + stats.prodCreditCard + stats.prodFlats + stats.prodPrepaidSplit;
    
    // Weighted Production for EQ
    const weightedProd = 
        (stats.prodPrepaid * 0.5) + 
        (stats.prodBilled * 0.5) + 
        stats.prodCash + 
        stats.prodCheque + 
        stats.prodETransfer + 
        stats.prodCreditCard + 
        stats.prodFlats + 
        stats.prodPrepaidSplit;

    stats.prodPayable = weightedProd / taxDivisor;
    stats.totalEQ = stats.prodPayable / 25;
    stats.upsellGross = stats.upsellBilled + stats.upsellCash + stats.upsellCheque + stats.upsellETransfer + stats.upsellCreditCard + stats.upsellPrepaid;
    stats.upsellPayable = stats.upsellGross / taxDivisor;

    return stats;
  }
}

export const sessionService = SessionService.getInstance();