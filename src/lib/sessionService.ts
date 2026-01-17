// src/lib/sessionService.ts
import { supabase } from './supabase';
import {
  DailySessionData,
  ManagementUser,
  Worker,
  LogsheetSession,
  SessionStats,
  MasterBooking,
  SessionTransaction
} from '../types';

// Import metadata type - re-export for other modules
import { ImportMeta } from './googleSheetsService';
export type { ImportMeta };

class SessionService {
  private static instance: SessionService;
  private constructor() {}
  public static getInstance(): SessionService {
    if (!SessionService.instance)
      SessionService.instance = new SessionService();
    return SessionService.instance;
  }

  // --- 1. HELPERS ---

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

  /**
   * Recalculates a worker's stats from their transactions and saves to the DB.
   * Called after any transaction modification to keep stats in sync.
   */
  private async recalculateAndSaveWorkerStats(workerId: string): Promise<void> {
    try {
      const date = await this.getDailySessionDate();
      if (!date) return;

      // 1. Fetch all transactions for this worker
      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .eq('worker_id', workerId);

      // 2. Map to SessionTransaction format
      const cleanFinancials = (transactions || []).map(tx => this.mapDbTransaction(tx));

      // 3. Recalculate stats
      const newStats = this.recalculateStats(cleanFinancials, 5);

      // 4. Save to logsheet_sessions
      const { error } = await supabase
        .from('logsheet_sessions')
        .update({ stats: newStats })
        .eq('worker_id', workerId)
        .eq('date', date);

      if (error) {
        console.error('Failed to save recalculated stats:', error);
      }
    } catch (err) {
      console.error('recalculateAndSaveWorkerStats error:', err);
    }
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
      phone: m.metadata?.phone || '',
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
      upsellsEnabled: w.metadata?.upsellsEnabled !== false, // Default to true
    }));

    const routes = (routesRes.data || []).map((r) => ({
      routeCode: r.route_code,
      managerId: r.manager_id,
      assignedWorkerIds: r.assigned_worker_ids || [], // Changed from assignedWorkerId
      streets: r.streets,
    }));

    const pendingBookings = (bookingsRes.data || []).map((b) => ({
      ...b.customer_details,
      'Booking ID': b.booking_id,
      'Route Number': b.route_number,
      'Contractor Number': b.contractor_id,
      Price: String(b.price || ''), 
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

  /**
   * Fetches a manager by their userId
   */
  public async getManagerById(managerId: string): Promise<ManagementUser | null> {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', managerId)
      .eq('role', 'RouteManager')
      .maybeSingle();
    
    if (!data) return null;
    
    return {
      userId: data.user_id,
      name: data.name,
      username: data.username,
      password: data.password,
      phone: data.metadata?.phone || '',
      role: 'RouteManager' as const,
    };
  }

  // --- 2b. IMPORT METADATA ---

  /**
   * Get import metadata for the current session
   */
  public async getSessionImportMeta(): Promise<ImportMeta | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

    const { data, error } = await supabase
      .from('daily_sessions')
      .select('import_meta')
      .eq('date', date)
      .single();

    if (error || !data) return null;
    return data.import_meta as ImportMeta | null;
  }

  /**
   * Update import metadata for the current session
   */
  public async updateSessionImportMeta(meta: ImportMeta): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const { error } = await supabase
      .from('daily_sessions')
      .update({ import_meta: meta })
      .eq('date', date);

    if (error) throw error;
  }

  // --- 2c. UPSELL CONTROL ---

  /**
   * Gets the upsellsEnabled status for a worker
   * Returns true by default if not set
   */
  public async getWorkerUpsellsEnabled(workerId: string): Promise<boolean> {
    const { data } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', workerId)
      .single();
    
    if (!data || !data.metadata) return true; // Default to enabled
    return data.metadata.upsellsEnabled !== false;
  }

  /**
   * Toggles upsells for a worker
   */
  public async toggleWorkerUpsells(workerId: string, enabled: boolean): Promise<void> {
    // 1. Fetch current metadata
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', workerId)
      .single();
    
    if (fetchError || !user) throw new Error("Worker not found");

    // 2. Update metadata with new upsellsEnabled value
    const newMetadata = { ...user.metadata, upsellsEnabled: enabled };
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: newMetadata })
      .eq('user_id', workerId);

    if (updateError) throw updateError;
  }

  // --- 2d. WORKER SESSION STATUS (LOCKOUT) ---

  /**
   * Gets the current session status for a worker
   * Returns 'OPEN', 'PAID', or null if no session exists
   */
  public async getWorkerSessionStatus(workerId: string): Promise<string | null> {
    const date = await this.getDailySessionDate();
    if (!date) return null;

    const { data } = await supabase
      .from('logsheet_sessions')
      .select('status')
      .eq('worker_id', workerId)
      .eq('date', date)
      .maybeSingle();

    return data?.status || null;
  }

  /**
   * Checks if a worker is locked out (session has been paid/finalized)
   * Returns true if locked out, false if still active
   */
  public async isWorkerLockedOut(workerId: string): Promise<boolean> {
    const status = await this.getWorkerSessionStatus(workerId);
    return status === 'PAID';
  }

  // --- 2e. TEAM LOCK MANAGEMENT (Route Manager) ---

  /**
   * Gets all worker IDs assigned to a specific manager
   */
  private async getTeamWorkerIds(managerId: string): Promise<string[]> {
    const { data: workers } = await supabase
      .from('users')
      .select('user_id, metadata')
      .eq('role', 'Worker');
    
    if (!workers) return [];
    
    return workers
      .filter(w => w.metadata?.assignedManagerId === managerId)
      .map(w => w.user_id);
  }

  /**
   * Locks all team members' sessions (sets status to 'PAID')
   * This prevents workers from logging in and forces active workers out
   */
  public async lockTeamSessions(managerId: string): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return;

    const { error } = await supabase
      .from('logsheet_sessions')
      .update({ status: 'PAID' })
      .eq('date', date)
      .in('worker_id', teamWorkerIds);

    if (error) {
      console.error('Failed to lock team sessions:', error);
      throw error;
    }
  }

  /**
   * Unlocks all team members' sessions (sets status to 'OPEN')
   * This allows workers to log back in
   */
  public async unlockTeamSessions(managerId: string): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return;

    const { error } = await supabase
      .from('logsheet_sessions')
      .update({ status: 'OPEN' })
      .eq('date', date)
      .in('worker_id', teamWorkerIds);

    if (error) {
      console.error('Failed to unlock team sessions:', error);
      throw error;
    }
  }

  /**
   * Checks if all team members are locked (status = 'PAID')
   * Returns true if ALL team members are locked, false otherwise
   */
  public async getTeamLockStatus(managerId: string): Promise<boolean> {
    const date = await this.getDailySessionDate();
    if (!date) return false;

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return false;

    const { data: sessions } = await supabase
      .from('logsheet_sessions')
      .select('status')
      .eq('date', date)
      .in('worker_id', teamWorkerIds);

    if (!sessions || sessions.length === 0) return false;

    // All team members must be locked for this to return true
    return sessions.every(s => s.status === 'PAID');
  }

  // --- 3. SESSION MANAGEMENT ---

  public async uploadDailySession(
    data: DailySessionData, 
    emailEnabled: boolean = true,
    importMeta?: ImportMeta
  ): Promise<void> {
    // Extract import meta from data if passed via _importMeta property, or use provided param
    const meta = importMeta || (data as any)._importMeta || { source: 'file', sheetsExported: false };

    const { error: sessError } = await supabase
      .from('daily_sessions')
      .insert({ 
        date: data.date, 
        is_active: true,
        import_meta: meta
      });
    if (sessError) throw sessError;

    const allUsers = [
      ...data.managers.map((m) => ({
        user_id: m.userId,
        name: m.name,
        username: m.username,
        password: m.password,
        role: 'RouteManager',
        metadata: {
          phone: m.phone,
        },
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
          upsellsEnabled: true, // Default to enabled for new workers
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
      assigned_worker_ids: r.assignedWorkerIds || [], // Changed from assigned_worker_id
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
      email_enabled: emailEnabled, // Use the provided parameter
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
    window.location.href = '/login';
  }

  /**
   * Safely removes a worker by clearing their dependencies first.
   * This prevents Foreign Key constraint errors.
   */
  public async deleteWorker(workerId: string): Promise<void> {
    const date = await this.getDailySessionDate();
    
    // 1. Remove worker from all route assignments
    if (date) {
      const { data: routes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date);
      
      if (routes) {
        for (const route of routes) {
          if (route.assigned_worker_ids && route.assigned_worker_ids.includes(workerId)) {
            const updatedIds = route.assigned_worker_ids.filter((id: string) => id !== workerId);
            await supabase
              .from('routes')
              .update({ assigned_worker_ids: updatedIds })
              .eq('route_code', route.route_code)
              .eq('session_date', date);
          }
        }
      }
    }

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

    // 3. Update any active routes where this worker is assigned to belong to the new manager
    if (date) {
      const { data: routes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date);
      
      if (routes) {
        for (const route of routes) {
          if (route.assigned_worker_ids && route.assigned_worker_ids.includes(workerId)) {
            await supabase
              .from('routes')
              .update({ manager_id: newManagerId })
              .eq('route_code', route.route_code)
              .eq('session_date', date);
          }
        }
      }
    }
  }

  /**
   * Transfer route ownership to another manager
   * Updates the manager_id for the route while keeping worker assignments intact
   */
  public async transferRouteToManager(
    routeCode: string, 
    newManagerId: string
  ): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;
    
    const { error } = await supabase
      .from('routes')
      .update({ manager_id: newManagerId })
      .eq('route_code', routeCode)
      .eq('session_date', date);
    
    if (error) {
      console.error("Error transferring route to manager:", error);
      throw error;
    }
  }

  /**
   * Transfer a single booking to another manager
   * Creates a route entry for the new manager if it doesn't exist
   * Booking will automatically appear since it matches route_number
   */
  public async transferBookingToManager(
    bookingId: string,
    routeNumber: string,
    newManagerId: string
  ): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;

    // 1. Check if the new manager already has this route
    const { data: existingRoute } = await supabase
      .from('routes')
      .select('*')
      .eq('route_code', routeNumber)
      .eq('manager_id', newManagerId)
      .eq('session_date', date)
      .maybeSingle();

    // 2. If route doesn't exist, create it
    if (!existingRoute) {
      // Get the source route to copy streets
      const { data: sourceRoute } = await supabase
        .from('routes')
        .select('streets')
        .eq('route_code', routeNumber)
        .eq('session_date', date)
        .maybeSingle();

      const streets = sourceRoute?.streets || [];

      // Create new route for target manager
      const { error: createError } = await supabase
        .from('routes')
        .insert({
          route_code: routeNumber,
          manager_id: newManagerId,
          assigned_worker_ids: [], // Empty array for new route
          streets: streets,
          session_date: date
        });

      if (createError) {
        console.error("Error creating route for new manager:", createError);
        throw createError;
      }
    }

    // 3. Booking automatically appears in new manager's view
    // since it has route_number that now matches a route owned by new manager
    // No additional update needed to the booking itself
  }

  // --- 4. AUTHENTICATION ---

  public async authenticateRM(username: string, password: string): Promise<ManagementUser | null> {
    if (username === 'admin' && password === 'admin') {
      return { userId: 'admin', name: 'Administrator', username: 'admin', role: 'Admin' };
    }
    const { data } = await supabase.from('users').select('*').ilike('username', username).eq('password', password).eq('role', 'RouteManager').single();
    if (!data) return null;
    return { userId: data.user_id, name: data.name, username: data.username, phone: data.metadata?.phone || '', role: 'RouteManager' };
  }

  public async authenticateWorker(contractorId: string, password: string): Promise<Worker | null> {
    const { data } = await supabase.from('users').select('*').eq('user_id', contractorId).eq('password', password).eq('role', 'Worker').single();
    if (!data) return null;
    
    // --- LOCKOUT CHECK: Verify worker's session is not finalized ---
    const isLockedOut = await this.isWorkerLockedOut(contractorId);
    if (isLockedOut) {
      throw new Error('SESSION_FINALIZED');
    }
    
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
      upsellsEnabled: data.metadata?.upsellsEnabled !== false, // Default to true
    };
  }

  // --- 5. LOGSHEETS & TRANSACTIONS ---

  public async getWorkerAssignments(workerId: string): Promise<MasterBooking[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];

    // Get routes where this worker is in the assignedWorkerIds array
    const { data: allRoutes } = await supabase
      .from('routes')
      .select('route_code, assigned_worker_ids')
      .eq('session_date', date);
    
    const myRouteCodes = (allRoutes || [])
      .filter(r => r.assigned_worker_ids && r.assigned_worker_ids.includes(workerId))
      .map(r => r.route_code);

    const { data: allBookings } = await supabase.from('bookings').select('*').eq('session_date', date).neq('status', 'completed');

    const myPending = (allBookings || []).filter((b) => {
      const isMyRoute = myRouteCodes.includes(b.route_number);
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

  public async getStreetsForRoute(routeCode: string): Promise<string[]> {
    const res = await supabase.from('routes').select('streets').eq('route_code', routeCode).single();
    return res.data?.streets || [];
  }

  /**
   * Gets all logsheet sessions for the current day with their transactions populated.
   * Fetches all transactions in a single query for performance.
   */
  public async getLogsheetSessions(): Promise<LogsheetSession[]> {
    const date = await this.getDailySessionDate();
    if (!date) return [];
    
    // Fetch sessions and all transactions in parallel
    const [sessionsRes, transactionsRes] = await Promise.all([
      supabase.from('logsheet_sessions').select('*').eq('date', date),
      supabase.from('transactions').select('*')
    ]);
    
    const sessions = sessionsRes.data || [];
    const allTransactions = (transactionsRes.data || []).map(tx => this.mapDbTransaction(tx));
    
    // Group transactions by worker_id
    const transactionsByWorker: Record<string, SessionTransaction[]> = {};
    allTransactions.forEach(tx => {
      if (!transactionsByWorker[tx.workerId]) {
        transactionsByWorker[tx.workerId] = [];
      }
      transactionsByWorker[tx.workerId].push(tx);
    });
    
    return sessions.map((d) => ({
      id: d.id,
      workerId: d.worker_id,
      date: d.date,
      status: d.status,
      stats: d.stats,
      validation: d.validation,
      bonuses: d.bonuses,
      dailyRouteStore: [],
      financialStore: transactionsByWorker[d.worker_id] || [],
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
      email_enabled: true,
    };
    const { error } = await supabase.from('logsheet_sessions').insert(newSession);
    if (error) throw error;
    return this.getActiveLogsheetSession(workerId) as Promise<LogsheetSession>;
  }

  public async updateLogsheetSession(sessionId: string, updates: Partial<LogsheetSession>): Promise<void> {
    const safeUpdates: any = {};
    if (updates.stats) safeUpdates.stats = updates.stats;
    if (updates.validation) safeUpdates.validation = updates.validation;
    if (updates.bonuses !== undefined) safeUpdates.bonuses = updates.bonuses;
    if (updates.status) safeUpdates.status = updates.status;
    await supabase.from('logsheet_sessions').update(safeUpdates).eq('id', sessionId);
  }

  /**
   * Assigns a booking to a worker.
   * Also adds the worker to the route's assignedWorkerIds if not already there.
   * When unassigning (workerId = null), removes worker from route if they have no other bookings.
   */
  public async assignBookingToWorker(bookingId: string, workerId: string | null): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;

    // Get the booking's current state
    const { data: booking } = await supabase
      .from('bookings')
      .select('route_number, contractor_id')
      .eq('booking_id', bookingId)
      .single();

    if (!booking || !booking.route_number) {
      // Just update the booking if we can't find route info
      await supabase
        .from('bookings')
        .update({ contractor_id: workerId })
        .eq('booking_id', bookingId);
      return;
    }

    const routeNumber = booking.route_number;
    const oldWorkerId = booking.contractor_id;

    // Update the booking
    const { error } = await supabase
      .from('bookings')
      .update({ contractor_id: workerId })
      .eq('booking_id', bookingId);
    
    if (error) {
      console.error("Error assigning booking:", error);
      return;
    }

    // Get the route's current assignedWorkerIds
    const { data: route } = await supabase
      .from('routes')
      .select('assigned_worker_ids')
      .eq('route_code', routeNumber)
      .eq('session_date', date)
      .single();

    if (!route) return;

    let assignedWorkerIds: string[] = route.assigned_worker_ids || [];

    // If assigning to a new worker, add them to the route
    if (workerId && !assignedWorkerIds.includes(workerId)) {
      assignedWorkerIds = [...assignedWorkerIds, workerId];
      await supabase
        .from('routes')
        .update({ assigned_worker_ids: assignedWorkerIds })
        .eq('route_code', routeNumber)
        .eq('session_date', date);
    }

    // If unassigning (or reassigning), check if old worker should be removed
    if (oldWorkerId && oldWorkerId !== workerId) {
      // Check if old worker has any other bookings on this route
      const { data: otherBookings } = await supabase
        .from('bookings')
        .select('booking_id')
        .eq('route_number', routeNumber)
        .eq('contractor_id', oldWorkerId)
        .eq('session_date', date)
        .neq('booking_id', bookingId);

      if (!otherBookings || otherBookings.length === 0) {
        // Remove old worker from route's assignedWorkerIds
        assignedWorkerIds = assignedWorkerIds.filter(id => id !== oldWorkerId);
        await supabase
          .from('routes')
          .update({ assigned_worker_ids: assignedWorkerIds })
          .eq('route_code', routeNumber)
          .eq('session_date', date);
      }
    }
  }

  /**
   * Assigns an entire route to a worker.
   * If workerId is null, clears the entire assignedWorkerIds array.
   * If workerId is provided, sets assignedWorkerIds to just that worker.
   */
  public async assignRouteToWorker(routeCode: string, workerId: string | null): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;
    
    const newAssignedWorkerIds = workerId ? [workerId] : [];
    
    const { error } = await supabase
      .from('routes')
      .update({ assigned_worker_ids: newAssignedWorkerIds })
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

  public async revertTransaction(transactionId: string, jobId?: string): Promise<void> {
    // First, get the worker_id before deleting
    const { data: txData } = await supabase
      .from('transactions')
      .select('worker_id')
      .eq('id', transactionId)
      .maybeSingle();
    
    const workerId = txData?.worker_id;

    const { error: txError } = await supabase.from('transactions').delete().eq('id', transactionId);
    if (txError) throw txError;
    
    if (jobId && !jobId.startsWith('NEW-')) {
        const { error: bkError } = await supabase.from('bookings').update({ status: 'pending' }).eq('booking_id', jobId);
        if (bkError) throw bkError;
    }

    // Recalculate and save stats for this worker
    if (workerId) {
      await this.recalculateAndSaveWorkerStats(workerId);
    }
  }

  /**
   * Updates a transaction with partial data.
   * FIXED: Now properly maps all fields and MERGES customer_snapshot instead of overwriting.
   */
  public async updateTransaction(transactionId: string, updates: Partial<SessionTransaction>): Promise<void> {
      // 1. Fetch existing transaction to get current customer_snapshot
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();

      const existingSnapshot = existingTx?.customer_snapshot || {};

      // 2. Build the database payload with ALL supported fields
      const dbPayload: any = {};
      
      // Direct column mappings
      if (updates.price !== undefined) dbPayload.price = updates.price;
      if (updates.displayPrice !== undefined) dbPayload.display_price = updates.displayPrice;
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.paymentBreakdown !== undefined) dbPayload.payment_breakdown = updates.paymentBreakdown;
      if (updates.type !== undefined) dbPayload.type = updates.type;
      
      // --- ADDED: Missing direct column mappings ---
      if (updates.customerPhone !== undefined) dbPayload.customer_phone = updates.customerPhone;
      if (updates.customerEmail !== undefined) dbPayload.customer_email = updates.customerEmail;
      if (updates.itemDescription !== undefined) dbPayload.item_description = updates.itemDescription;
      if (updates.items !== undefined) dbPayload.items = updates.items;
      if (updates.etransferEmail !== undefined) dbPayload.etransfer_email = updates.etransferEmail;
      if (updates.chequeNumber !== undefined) dbPayload.cheque_number = updates.chequeNumber;
      if (updates.invoiceNumber !== undefined) dbPayload.invoice_number = updates.invoiceNumber;
      if (updates.isWestSplit !== undefined) dbPayload.is_west_split = updates.isWestSplit;
      
      // --- FIXED: customer_snapshot - MERGE with existing instead of overwrite ---
      // Only update if any relevant fields are provided
      if (updates.customerName !== undefined || 
          updates.address !== undefined || 
          updates.routeCode !== undefined ||
          updates.serviceType !== undefined ||
          updates.serviceName !== undefined) {
          
          // Start with existing snapshot values
          const mergedSnapshot = {
              firstName: existingSnapshot.firstName || '',
              lastName: existingSnapshot.lastName || '',
              address: existingSnapshot.address || '',
              routeCode: existingSnapshot.routeCode || '',
              serviceType: existingSnapshot.serviceType || 'FP',
              serviceName: existingSnapshot.serviceName || ''
          };
          
          // Only override fields that are explicitly provided in updates
          if (updates.customerName !== undefined) {
              mergedSnapshot.firstName = updates.customerName.split(' ')[0] || '';
              mergedSnapshot.lastName = updates.customerName.split(' ').slice(1).join(' ') || '';
          }
          if (updates.address !== undefined) {
              mergedSnapshot.address = updates.address;
          }
          if (updates.routeCode !== undefined) {
              mergedSnapshot.routeCode = updates.routeCode;
          }
          if (updates.serviceType !== undefined) {
              mergedSnapshot.serviceType = updates.serviceType;
          }
          if (updates.serviceName !== undefined) {
              mergedSnapshot.serviceName = updates.serviceName;
          }
          
          dbPayload.customer_snapshot = mergedSnapshot;
      }

      // 3. Update the transaction
      const { error } = await supabase.from('transactions').update(dbPayload).eq('id', transactionId);
      if (error) throw error;

      // 4. Recalculate stats for the worker
      const workerId = existingTx?.worker_id;
      if (workerId) {
        await this.recalculateAndSaveWorkerStats(workerId);
      }
  }

  public async completeJob(transaction: SessionTransaction, jobId: string, workerId: string): Promise<void> {
    const payload = {
      job_id: jobId, 
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
    
    if (jobId) {
       const { data } = await supabase.from('transactions').select('id').eq('job_id', jobId).maybeSingle();
       if (data) existingId = data.id;
    }

    if (existingId) {
        const { error } = await supabase.from('transactions').update(payload).eq('id', existingId);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('transactions').insert({ ...payload, id: transaction.id });
        if (error) throw error;
    }

    if (jobId && !jobId.startsWith('NEW-')) {
      await supabase.from('bookings').update({
          status: 'completed',
          contractor_id: workerId,
        }).eq('booking_id', jobId);
    }

    // Recalculate and save stats for this worker
    await this.recalculateAndSaveWorkerStats(workerId);

    // --- SEND EMAIL RECEIPT (Non-blocking) ---
    if (transaction.customerEmail && transaction.customerEmail.trim() !== '') {
      this.sendReceiptEmail({
        customerEmail: transaction.customerEmail,
        customerName: transaction.customerName,
        customerAddress: transaction.address || '',
        date: new Date(transaction.timestamp).toLocaleDateString(),
        serviceName: transaction.items?.[0]?.name || transaction.serviceName || 'Service',
        amount: transaction.displayPrice || `$${transaction.price.toFixed(2)}`,
        paymentMethod: transaction.paymentMethod,
        workerName: transaction.workerName,
        transactionId: transaction.jobId
      }).catch(err => {
        console.error('📧 Email send failed (non-blocking):', err);
      });
    }
  }

  // --- 7. EMAIL RECEIPTS ---

  /**
   * Sends an email receipt via Supabase Edge Function
   * @param transactionData - The transaction details for the receipt
   * @returns Promise<boolean> - Success status (non-blocking)
   */
  public async sendReceiptEmail(transactionData: {
    customerEmail: string;
    customerName: string;
    customerAddress: string;
    date: string;
    serviceName: string;
    amount: string;
    paymentMethod: string;
    workerName: string;
    transactionId: string;
  }): Promise<boolean> {
    // Check if email is enabled for this session
    try {
      const date = await this.getDailySessionDate();
      if (!date) return false;

      const { data: sessionData } = await supabase
        .from('logsheet_sessions')
        .select('email_enabled')
        .eq('date', date)
        .limit(1)
        .maybeSingle();

      // If email_enabled is false, skip sending
      if (sessionData && sessionData.email_enabled === false) {
        console.log('📧 Email sending disabled for this session');
        return false;
      }

      // Call the Edge Function (non-blocking)
      const { data, error } = await supabase.functions.invoke('bright-processor', {
        body: transactionData
      });

      if (error) {
        console.error('📧 Email send error:', error);
        return false;
      }

      console.log('📧 Email sent successfully:', data);
      return true;
    } catch (err) {
      console.error('📧 Email send failed:', err);
      return false;
    }
  }

  /**
   * Gets email status for a transaction
   */
  public async getEmailStatus(transactionId: string): Promise<{
    sent: boolean;
    bounced: boolean;
    reason?: string;
  } | null> {
    try {
      const { data } = await supabase
        .from('email_logs')
        .select('status, bounce_reason')
        .eq('transaction_id', transactionId)
        .maybeSingle();

      if (!data) return null;

      return {
        sent: data.status === 'sent',
        bounced: data.status === 'bounced',
        reason: data.bounce_reason
      };
    } catch (err) {
      console.error('Error fetching email status:', err);
      return null;
    }
  }

  /**
   * Toggles email sending for the current session
   */
  public async toggleSessionEmail(enabled: boolean): Promise<void> {
    const date = await this.getDailySessionDate();
    if (!date) return;

    await supabase
      .from('logsheet_sessions')
      .update({ email_enabled: enabled })
      .eq('date', date);
  }

  // --- 8. UTILS ---

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