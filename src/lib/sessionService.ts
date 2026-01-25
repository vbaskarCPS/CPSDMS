// src/lib/sessionService.ts
import { supabase } from './supabase';
import { 
  commandCenterService, 
  getSeasonConfig, 
  getPrepaidWeight, 
  getBilledWeight,
  getPayoutRate,
  isOfficeFlat,
  seasonHasTeams,
  createEqualSplit,
  EQ_DIVISOR
} from './commandCenterService';
import {
  DailySessionData,
  ManagementUser,
  Worker,
  LogsheetSession,
  SessionStats,
  MasterBooking,
  SessionTransaction,
  SeasonType,
  TeamCart,
  TeamSplitConfig,
  WorkerPayoutBreakdown,
  ServiceFlags,
  SEASON_CONFIGS
} from '../types';

// Import metadata type - re-export for other modules
import { ImportMeta } from './googleSheetsService';
export type { ImportMeta };

// --- HELPER: Check if array has items ---
function hasItems(arr: any[] | null | undefined): arr is any[] {
  return Array.isArray(arr) && arr.length > 0;
}

class SessionService {
  private static instance: SessionService;
  private constructor() {}
  public static getInstance(): SessionService {
    if (!SessionService.instance)
      SessionService.instance = new SessionService();
    return SessionService.instance;
  }

  // --- HELPER: Get current command center ID ---
  private getCCId(): string {
    const ccId = commandCenterService.getCurrentCommandCenterId();
    if (!ccId) {
      throw new Error('No command center context. Please log in first.');
    }
    return ccId;
  }

  // --- HELPER: Get current tax rate based on region ---
  private getCurrentTaxRate(): number {
    return commandCenterService.getCurrentTaxRate();
  }

  // --- HELPER: Get current session's season type ---
  public async getSessionSeasonType(): Promise<SeasonType> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return 'aeration';

    const { data } = await supabase
      .from('daily_sessions')
      .select('season_type')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .single();

    return (data?.season_type as SeasonType) || 'aeration';
  }

  // --- HELPER: Get product cost percent from import meta ---
  public async getProductCostPercent(): Promise<number> {
    const meta = await this.getSessionImportMeta();
    if (meta?.productCostPercent !== undefined) {
      return meta.productCostPercent;
    }
    // Fall back to season default
    const seasonType = await this.getSessionSeasonType();
    return SEASON_CONFIGS[seasonType].defaultProductCostPercent;
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
        
        ccFullNumber: tx.cc_full_number,
        ccExpiry: tx.cc_expiry,
        ccCVC: tx.cc_cvc,
        
        serviceType: tx.customer_snapshot?.serviceType,
        serviceName: tx.customer_snapshot?.serviceName,
        customerPhone: tx.customer_phone, 
        customerEmail: tx.customer_email,
        isWestSplit: tx.is_west_split,
        isPrepaid: tx.payment_method === 'Prepaid' || (tx.payment_breakdown && tx.payment_breakdown['Prepaid']) ? true : false,
        commandCenterId: tx.command_center_id,
        services: tx.services,
        completedByWorkerIds: tx.completed_by_worker_ids,
        refId: tx.ref_id,
    } as SessionTransaction;
  }

  /**
   * Recalculates a worker's stats from their transactions and saves to the DB.
   * Called after any transaction modification to keep stats in sync.
   * 
   * TEAM-AWARE: Automatically detects if worker is part of a team session
   * and aggregates transactions from ALL team members.
   */
  private async recalculateAndSaveWorkerStats(workerId: string): Promise<void> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return;

      // Get season type and product cost percent for this session
      const seasonType = await this.getSessionSeasonType();
      const productCostPercent = await this.getProductCostPercent();

      // 1. Find the session for this worker (handles both solo and team sessions)
      // First check for team session where worker is a member
      let sessionData: any = null;
      
      const { data: teamSession } = await supabase
        .from('logsheet_sessions')
        .select('*')
        .eq('date', date)
        .eq('command_center_id', ccId)
        .contains('team_worker_ids', [workerId])
        .maybeSingle();

      if (teamSession) {
        sessionData = teamSession;
      } else {
        // Fall back to direct worker_id match (solo session or primary worker)
        const { data: soloSession } = await supabase
          .from('logsheet_sessions')
          .select('*')
          .eq('worker_id', workerId)
          .eq('date', date)
          .eq('command_center_id', ccId)
          .maybeSingle();
        
        sessionData = soloSession;
      }

      if (!sessionData) {
        console.warn(`No session found for worker ${workerId} on ${date}`);
        return;
      }

      // 2. Determine all worker IDs to query transactions for
      const teamWorkerIds = hasItems(sessionData.team_worker_ids) 
        ? sessionData.team_worker_ids 
        : [sessionData.worker_id];

      // 3. Fetch ALL transactions for ALL team members
      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .in('worker_id', teamWorkerIds)
        .eq('command_center_id', ccId);

      // 4. Map to SessionTransaction format
      const cleanFinancials = (transactions || []).map(tx => this.mapDbTransaction(tx));

      // 5. Recalculate stats with region-appropriate tax rate, season config, and product cost
      const taxRate = this.getCurrentTaxRate();
      const newStats = this.recalculateStats(cleanFinancials, taxRate, seasonType, productCostPercent);

      // 6. Save to logsheet_sessions by SESSION ID (not worker_id)
      const { error } = await supabase
        .from('logsheet_sessions')
        .update({ stats: newStats })
        .eq('id', sessionData.id)
        .eq('command_center_id', ccId);

      if (error) {
        console.error('Failed to save recalculated stats:', error);
      }
    } catch (err) {
      console.error('recalculateAndSaveWorkerStats error:', err);
    }
  }

  /**
   * For team sessions, recalculate stats for the shared session.
   * Since recalculateAndSaveWorkerStats is now team-aware, we only need to call it once.
   */
  private async recalculateTeamStats(teamWorkerIds: string[]): Promise<void> {
    if (!hasItems(teamWorkerIds)) return;
    
    // Just call once with any team member - the method will find the shared session
    // and aggregate all team transactions
    await this.recalculateAndSaveWorkerStats(teamWorkerIds[0]);
  }

  // --- 2. FETCHING ---

  public async getTransactionByJobId(jobId: string): Promise<SessionTransaction | null> {
    const ccId = this.getCCId();
    const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('job_id', jobId)
        .eq('command_center_id', ccId)
        .maybeSingle(); 
    
    if (!data) return null;
    return this.mapDbTransaction(data);
  }

  public async getDailySessionDate(): Promise<string | null> {
    const ccId = this.getCCId();
    const { data } = await supabase
      .from('daily_sessions')
      .select('date')
      .eq('is_active', true)
      .eq('command_center_id', ccId)
      .single();
    return data ? data.date : null;
  }

  public async getDailySession(): Promise<DailySessionData | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

    // Get season type
    const { data: sessionData } = await supabase
      .from('daily_sessions')
      .select('season_type')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .single();
    
    const seasonType = (sessionData?.season_type as SeasonType) || 'aeration';

    const [managersRes, workersRes, routesRes, bookingsRes] = await Promise.all(
      [
        supabase.from('users').select('*').eq('role', 'RouteManager').eq('command_center_id', ccId),
        supabase.from('users').select('*').eq('role', 'Worker').eq('command_center_id', ccId),
        supabase.from('routes').select('*').eq('session_date', date).eq('command_center_id', ccId),
        supabase
          .from('bookings')
          .select('*')
          .eq('session_date', date)
          .eq('status', 'pending')
          .eq('command_center_id', ccId),
      ]
    );

    const managers = (managersRes.data || []).map((m) => ({
      userId: m.user_id,
      name: m.name,
      username: m.username,
      password: m.password,
      phone: m.metadata?.phone || '',
      role: 'RouteManager' as const,
      commandCenterId: m.command_center_id,
    }));

    const workers: Worker[] = (workersRes.data || []).map((w) => ({
      contractorId: w.user_id,
      firstName: w.name.split(' ')[0],
      lastName: w.name.split(' ').slice(1).join(' '),
      cellPhone: w.metadata?.phone,
      status: 'Return' as const,
      alumniRate: w.metadata?.alumniRate,
      silverRate: w.metadata?.silverRate,
      assignedManagerId: w.metadata?.assignedManagerId,
      upsellsEnabled: w.metadata?.upsellsEnabled !== false,
      commandCenterId: w.command_center_id,
      teamId: w.metadata?.teamId,
    }));

    // Build team carts if this is a team season
    let teamCarts: TeamCart[] | undefined;
    if (seasonHasTeams(seasonType)) {
      const teamMap = new Map<string, Worker[]>();
      workers.forEach(w => {
        const tid = w.teamId || w.contractorId;
        if (!teamMap.has(tid)) {
          teamMap.set(tid, []);
        }
        teamMap.get(tid)!.push(w);
      });
      
      teamCarts = Array.from(teamMap.entries()).map(([teamId, teamWorkers]) => ({
        teamId,
        workerIds: teamWorkers.map(w => w.contractorId),
        workers: teamWorkers,
      }));
    }

    const routes = (routesRes.data || []).map((r) => ({
      routeCode: r.route_code,
      managerId: r.manager_id,
      assignedWorkerIds: r.assigned_worker_ids || [],
      streets: r.streets,
      commandCenterId: r.command_center_id,
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
      commandCenterId: b.command_center_id,
      services: b.services,
      sessionId: b.session_id,
      ...b.data,
    }));

    return {
      date,
      managers,
      workers,
      routes,
      pendingBookings,
      commandCenterId: ccId,
      seasonType,
      teamCarts,
    };
  }

  /**
   * Fetches a manager by their userId
   */
  public async getManagerById(managerId: string): Promise<ManagementUser | null> {
    const ccId = this.getCCId();
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', managerId)
      .eq('role', 'RouteManager')
      .eq('command_center_id', ccId)
      .maybeSingle();
    
    if (!data) return null;
    
    return {
      userId: data.user_id,
      name: data.name,
      username: data.username,
      password: data.password,
      phone: data.metadata?.phone || '',
      role: 'RouteManager' as const,
      commandCenterId: data.command_center_id,
    };
  }

  // --- 2b. IMPORT METADATA ---

  public async getSessionImportMeta(): Promise<ImportMeta | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

    const { data, error } = await supabase
      .from('daily_sessions')
      .select('import_meta')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .single();

    if (error || !data) return null;
    return data.import_meta as ImportMeta | null;
  }

  public async updateSessionImportMeta(meta: ImportMeta): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const { error } = await supabase
      .from('daily_sessions')
      .update({ import_meta: meta })
      .eq('date', date)
      .eq('command_center_id', ccId);

    if (error) throw error;
  }

  // --- 2c. UPSELL CONTROL ---

  public async getWorkerUpsellsEnabled(workerId: string): Promise<boolean> {
    const ccId = this.getCCId();
    const { data } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', workerId)
      .eq('command_center_id', ccId)
      .single();
    
    if (!data || !data.metadata) return true;
    return data.metadata.upsellsEnabled !== false;
  }

  public async toggleWorkerUpsells(workerId: string, enabled: boolean): Promise<void> {
    const ccId = this.getCCId();
    
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', workerId)
      .eq('command_center_id', ccId)
      .single();
    
    if (fetchError || !user) throw new Error("Worker not found");

    const newMetadata = { ...user.metadata, upsellsEnabled: enabled };
    
    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: newMetadata })
      .eq('user_id', workerId)
      .eq('command_center_id', ccId);

    if (updateError) throw updateError;
  }

  // --- 2d. WORKER SESSION STATUS (LOCKOUT) ---

  public async getWorkerSessionStatus(workerId: string): Promise<string | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

    // Check if worker is part of a team session
    const { data: teamSession } = await supabase
      .from('logsheet_sessions')
      .select('status')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .contains('team_worker_ids', [workerId])
      .maybeSingle();

    if (teamSession) {
      return teamSession.status;
    }

    // Check individual session
    const { data } = await supabase
      .from('logsheet_sessions')
      .select('status')
      .eq('worker_id', workerId)
      .eq('date', date)
      .eq('command_center_id', ccId)
      .maybeSingle();

    return data?.status || null;
  }

  public async isWorkerLockedOut(workerId: string): Promise<boolean> {
    const status = await this.getWorkerSessionStatus(workerId);
    return status === 'PAID';
  }

  // --- 2e. TEAM LOCK MANAGEMENT ---

  private async getTeamWorkerIds(managerId: string): Promise<string[]> {
    const ccId = this.getCCId();
    const { data: workers } = await supabase
      .from('users')
      .select('user_id, metadata')
      .eq('role', 'Worker')
      .eq('command_center_id', ccId);
    
    if (!workers) return [];
    
    return workers
      .filter(w => w.metadata?.assignedManagerId === managerId)
      .map(w => w.user_id);
  }

  public async lockTeamSessions(managerId: string): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return;

    const { error } = await supabase
      .from('logsheet_sessions')
      .update({ status: 'PAID' })
      .eq('date', date)
      .eq('command_center_id', ccId)
      .in('worker_id', teamWorkerIds);

    if (error) {
      console.error('Failed to lock team sessions:', error);
      throw error;
    }
  }

  public async unlockTeamSessions(managerId: string): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return;

    const { error } = await supabase
      .from('logsheet_sessions')
      .update({ status: 'OPEN' })
      .eq('date', date)
      .eq('command_center_id', ccId)
      .in('worker_id', teamWorkerIds);

    if (error) {
      console.error('Failed to unlock team sessions:', error);
      throw error;
    }
  }

  public async getTeamLockStatus(managerId: string): Promise<boolean> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return false;

    const teamWorkerIds = await this.getTeamWorkerIds(managerId);
    if (teamWorkerIds.length === 0) return false;

    const { data: sessions } = await supabase
      .from('logsheet_sessions')
      .select('status')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .in('worker_id', teamWorkerIds);

    if (!sessions || sessions.length === 0) return false;

    return sessions.every(s => s.status === 'PAID');
  }

  // --- 2f. TEAM CART HELPERS ---

  /**
   * Get the team cart for a worker (if in a team season)
   */
  public async getWorkerTeamCart(workerId: string): Promise<TeamCart | null> {
    const dailySession = await this.getDailySession();
    if (!dailySession || !dailySession.teamCarts) return null;

    return dailySession.teamCarts.find(cart => 
      cart.workerIds.includes(workerId)
    ) || null;
  }

  /**
   * Get all team members for a worker
   */
  public async getTeamMembers(workerId: string): Promise<Worker[]> {
    const cart = await this.getWorkerTeamCart(workerId);
    return cart?.workers || [];
  }

  /**
   * Get the logsheet session for a worker (handles team sessions)
   */
  public async getWorkerLogsheetSession(workerId: string): Promise<LogsheetSession | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

    // Check for team session first
    const { data: teamSession } = await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .contains('team_worker_ids', [workerId])
      .maybeSingle();

    if (teamSession) {
      return {
        id: teamSession.id,
        workerId: teamSession.worker_id,
        date: teamSession.date,
        status: teamSession.status,
        stats: teamSession.stats,
        validation: teamSession.validation,
        bonuses: teamSession.bonuses,
        dailyRouteStore: [],
        financialStore: [],
        commandCenterId: teamSession.command_center_id,
        teamWorkerIds: teamSession.team_worker_ids,
        equivSplit: teamSession.equiv_split,
        upsellSplit: teamSession.upsell_split,
      };
    }

    // Check individual session
    const { data } = await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('worker_id', workerId)
      .eq('date', date)
      .eq('command_center_id', ccId)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      workerId: data.worker_id,
      date: data.date,
      status: data.status,
      stats: data.stats,
      validation: data.validation,
      bonuses: data.bonuses,
      dailyRouteStore: [],
      financialStore: [],
      commandCenterId: data.command_center_id,
      teamWorkerIds: data.team_worker_ids,
      equivSplit: data.equiv_split,
      upsellSplit: data.upsell_split,
    };
  }

  // --- 3. SESSION MANAGEMENT ---

  public async uploadDailySession(
    data: DailySessionData, 
    emailEnabled: boolean = true,
    importMeta?: ImportMeta
  ): Promise<void> {
    const ccId = this.getCCId();
    const seasonType = data.seasonType || 'aeration';
    const isTeamSeason = seasonHasTeams(seasonType);
    
    // Get default product cost percent if not provided in meta
    const defaultProductCost = SEASON_CONFIGS[seasonType].defaultProductCostPercent;
    
    const meta = importMeta || (data as any)._importMeta || { 
      source: 'file', 
      sheetsExported: false,
      seasonType,
      productCostPercent: defaultProductCost
    };
    
    // Ensure productCostPercent is set
    if (meta.productCostPercent === undefined) {
      meta.productCostPercent = defaultProductCost;
    }

    const { error: sessError } = await supabase
      .from('daily_sessions')
      .insert({ 
        date: data.date, 
        is_active: true,
        import_meta: meta,
        command_center_id: ccId,
        season_type: seasonType,
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
        command_center_id: ccId,
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
          upsellsEnabled: true,
          teamId: w.teamId, // Store team ID in metadata
        },
        command_center_id: ccId,
      })),
    ];

    const { error: userError } = await supabase
      .from('users')
      .upsert(allUsers, { onConflict: 'user_id' });
    if (userError) throw userError;

    const routeRows = data.routes.map((r) => ({
      route_code: r.routeCode,
      manager_id: r.managerId,
      assigned_worker_ids: r.assignedWorkerIds || [],
      streets: r.streets,
      session_date: data.date,
      command_center_id: ccId,
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
      command_center_id: ccId,
      services: b.services, // Store service flags
    }));

    const { error: bookingError } = await supabase
      .from('bookings')
      .insert(bookingRows);
    if (bookingError) throw bookingError;

    // Create logsheet sessions
    if (isTeamSeason && data.teamCarts) {
      // Team season: one session per cart
      const logsheetRows = data.teamCarts.map((cart) => {
        const primaryWorker = cart.workers[0];
        const equalSplit = createEqualSplit(cart.workerIds);
        
        return {
          id: `sess_${cart.teamId}_${Date.now()}`,
          worker_id: primaryWorker.contractorId,
          team_worker_ids: cart.workerIds,
          date: data.date,
          status: 'OPEN',
          stats: this.getEmptyStats(),
          email_enabled: emailEnabled,
          command_center_id: ccId,
          equiv_split: equalSplit,
          upsell_split: equalSplit,
        };
      });
      
      const { error: lsError } = await supabase
        .from('logsheet_sessions')
        .insert(logsheetRows);
      if (lsError) throw lsError;
    } else {
      // Aeration season: one session per worker
      const logsheetRows = data.workers.map((w) => ({
        id: `sess_${w.contractorId}_${Date.now()}`,
        worker_id: w.contractorId,
        date: data.date,
        status: 'OPEN',
        stats: this.getEmptyStats(),
        email_enabled: emailEnabled,
        command_center_id: ccId,
      }));
      
      const { error: lsError } = await supabase
        .from('logsheet_sessions')
        .insert(logsheetRows);
      if (lsError) throw lsError;
    }
  }

  public async adminResetDailySession(date: string): Promise<void> {
    const ccId = this.getCCId();
    
    await supabase.from('transactions').delete().eq('command_center_id', ccId); 
    await supabase.from('logsheet_sessions').delete().eq('date', date).eq('command_center_id', ccId);
    await supabase.from('routes').delete().eq('session_date', date).eq('command_center_id', ccId);
    await supabase.from('bookings').delete().eq('session_date', date).eq('command_center_id', ccId);
    await supabase.from('daily_sessions').delete().eq('date', date).eq('command_center_id', ccId);
    await supabase.from('users').delete().in('role', ['Worker', 'RouteManager']).eq('command_center_id', ccId);
    
    const isSuperAdmin = commandCenterService.isSuperAdminMode();
    const currentCC = commandCenterService.getCurrentCommandCenter();
    
    localStorage.clear();
    
    if (isSuperAdmin && currentCC) {
      commandCenterService.setSuperAdminMode(true);
      commandCenterService.setCurrentCommandCenter(currentCC);
    }
    
    window.location.href = '/login';
  }

  public async deleteWorker(workerId: string): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    
    if (date) {
      const { data: routes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date)
        .eq('command_center_id', ccId);
      
      if (routes) {
        for (const route of routes) {
          if (route.assigned_worker_ids && route.assigned_worker_ids.includes(workerId)) {
            const updatedIds = route.assigned_worker_ids.filter((id: string) => id !== workerId);
            await supabase
              .from('routes')
              .update({ assigned_worker_ids: updatedIds })
              .eq('route_code', route.route_code)
              .eq('session_date', date)
              .eq('command_center_id', ccId);
          }
        }
      }
    }

    await supabase.from('bookings').update({ contractor_id: null }).eq('contractor_id', workerId).eq('command_center_id', ccId);
    await supabase.from('logsheet_sessions').delete().eq('worker_id', workerId).eq('command_center_id', ccId);
    await supabase.from('transactions').delete().eq('worker_id', workerId).eq('command_center_id', ccId);

    const { error } = await supabase.from('users').delete().eq('user_id', workerId).eq('command_center_id', ccId);
    
    if (error) {
        console.error("Failed to delete user:", error);
        throw error;
    }
  }

  public async transferWorker(workerId: string, newManagerId: string): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();

    const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('metadata')
        .eq('user_id', workerId)
        .eq('command_center_id', ccId)
        .single();
    
    if (fetchError || !user) throw new Error("Worker not found");

    const newMetadata = { ...user.metadata, assignedManagerId: newManagerId };
    
    const { error: updateError } = await supabase
        .from('users')
        .update({ metadata: newMetadata })
        .eq('user_id', workerId)
        .eq('command_center_id', ccId);

    if (updateError) throw updateError;

    if (date) {
      const { data: routes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date)
        .eq('command_center_id', ccId);
      
      if (routes) {
        for (const route of routes) {
          if (route.assigned_worker_ids && route.assigned_worker_ids.includes(workerId)) {
            await supabase
              .from('routes')
              .update({ manager_id: newManagerId })
              .eq('route_code', route.route_code)
              .eq('session_date', date)
              .eq('command_center_id', ccId);
          }
        }
      }
    }
  }

  public async transferRouteToManager(routeCode: string, newManagerId: string): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return;
    
    const { error } = await supabase
      .from('routes')
      .update({ manager_id: newManagerId })
      .eq('route_code', routeCode)
      .eq('session_date', date)
      .eq('command_center_id', ccId);
    
    if (error) {
      console.error("Error transferring route to manager:", error);
      throw error;
    }
  }

  public async transferBookingToManager(
    bookingId: string,
    routeNumber: string,
    newManagerId: string
  ): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return;

    const { data: existingRoute } = await supabase
      .from('routes')
      .select('*')
      .eq('route_code', routeNumber)
      .eq('manager_id', newManagerId)
      .eq('session_date', date)
      .eq('command_center_id', ccId)
      .maybeSingle();

    if (!existingRoute) {
      const { data: sourceRoute } = await supabase
        .from('routes')
        .select('streets')
        .eq('route_code', routeNumber)
        .eq('session_date', date)
        .eq('command_center_id', ccId)
        .maybeSingle();

      const streets = sourceRoute?.streets || [];

      const { error: createError } = await supabase
        .from('routes')
        .insert({
          route_code: routeNumber,
          manager_id: newManagerId,
          assigned_worker_ids: [],
          streets: streets,
          session_date: date,
          command_center_id: ccId,
        });

      if (createError) {
        console.error("Error creating route for new manager:", createError);
        throw createError;
      }
    }
  }

  // --- 4. AUTHENTICATION ---

  public async authenticateRM(username: string, password: string): Promise<ManagementUser | null> {
    const { data } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .eq('password', password)
      .eq('role', 'RouteManager')
      .maybeSingle();
    
    if (!data) return null;
    
    if (data.command_center_id) {
      const cc = await commandCenterService.getCommandCenterById(data.command_center_id);
      if (cc) {
        commandCenterService.setCurrentCommandCenter(cc);
      }
    }
    
    return { 
      userId: data.user_id, 
      name: data.name, 
      username: data.username, 
      phone: data.metadata?.phone || '', 
      role: 'RouteManager',
      commandCenterId: data.command_center_id,
    };
  }

  /**
   * Authenticate worker - supports team-based authentication
   * In team seasons, any team member's login accesses the shared cart
   */
  public async authenticateWorker(contractorId: string, password: string): Promise<Worker | null> {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', contractorId)
      .eq('password', password)
      .eq('role', 'Worker')
      .maybeSingle();
    
    if (!data) return null;
    
    if (data.command_center_id) {
      const cc = await commandCenterService.getCommandCenterById(data.command_center_id);
      if (cc) {
        commandCenterService.setCurrentCommandCenter(cc);
      }
    }
    
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
      upsellsEnabled: data.metadata?.upsellsEnabled !== false,
      commandCenterId: data.command_center_id,
      teamId: data.metadata?.teamId,
    };
  }

  // --- 5. LOGSHEETS & TRANSACTIONS ---

  /**
   * Get assignments for a worker - season-aware
   * Aeration: uses contractor_id
   * Lawn Rejuv: uses session_id for team-based assignments
   */
  public async getWorkerAssignments(workerId: string): Promise<MasterBooking[]> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return [];

    const seasonType = await this.getSessionSeasonType();
    const isLawnRejuv = seasonType === 'lawn_rejuv';

    // For Lawn Rejuv, get the worker's session first
    let sessionId: string | null = null;
    if (isLawnRejuv) {
      const session = await this.getWorkerLogsheetSession(workerId);
      sessionId = session?.id || null;
    }

    // Get routes assigned to this worker
    const { data: allRoutes } = await supabase
      .from('routes')
      .select('route_code, assigned_worker_ids')
      .eq('session_date', date)
      .eq('command_center_id', ccId);
    
    const myRouteCodes = (allRoutes || [])
      .filter(r => r.assigned_worker_ids && r.assigned_worker_ids.includes(workerId))
      .map(r => r.route_code);

    // Get all non-completed bookings
    const { data: allBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('session_date', date)
      .eq('command_center_id', ccId)
      .neq('status', 'completed');

    // Filter bookings based on season type
    let myPending: any[];
    
    if (isLawnRejuv && sessionId) {
      // Lawn Rejuv: match by session_id OR route assignment (for unassigned jobs)
      myPending = (allBookings || []).filter((b) => {
        // If booking is assigned to this session, include it
        if (b.session_id === sessionId) return true;
        
        // If booking is on my route and not assigned to another session, include it
        const isMyRoute = myRouteCodes.includes(b.route_number);
        const isUnassigned = !b.session_id && !b.contractor_id;
        return isMyRoute && isUnassigned;
      });
    } else {
      // Aeration: match by contractor_id OR route assignment
      myPending = (allBookings || []).filter((b) => {
        const isMyRoute = myRouteCodes.includes(b.route_number);
        const isAssignedToMe = b.contractor_id === workerId;
        const isAssignedToOther = b.contractor_id && b.contractor_id !== workerId;
        return (isMyRoute && !isAssignedToOther) || isAssignedToMe;
      });
    }

    // Get transactions for this worker (or all team members in Lawn Rejuv)
    let transactionQuery = supabase
      .from('transactions')
      .select('*')
      .eq('command_center_id', ccId);

    if (isLawnRejuv) {
      // Get session to find all team workers
      const session = await this.getWorkerLogsheetSession(workerId);
      const teamWorkerIds = hasItems(session?.teamWorkerIds) ? session.teamWorkerIds : [workerId];
      transactionQuery = transactionQuery.in('worker_id', teamWorkerIds);
    } else {
      transactionQuery = transactionQuery.eq('worker_id', workerId);
    }

    const { data: myTransactions } = await transactionQuery;

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
      commandCenterId: b.command_center_id,
      services: b.services,
      sessionId: b.session_id,
    }));

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
            commandCenterId: mapped.commandCenterId,
            services: mapped.services,
        };
    });

    return [...pendingMapped, ...completedMapped];
  }

  /**
   * Get bookings assigned to a specific session (for Lawn Rejuv team display)
   */
  public async getSessionAssignments(sessionId: string): Promise<MasterBooking[]> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return [];

    // Get pending bookings assigned to this session
    const { data: pendingBookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('session_date', date)
      .eq('command_center_id', ccId)
      .eq('session_id', sessionId)
      .neq('status', 'completed');

    // Get the session to find team workers
    const { data: sessionData } = await supabase
      .from('logsheet_sessions')
      .select('team_worker_ids, worker_id')
      .eq('id', sessionId)
      .eq('command_center_id', ccId)
      .maybeSingle();

    // FIX: Check if team_worker_ids has items, otherwise use worker_id
    const teamWorkerIds = hasItems(sessionData?.team_worker_ids) 
      ? sessionData.team_worker_ids 
      : [sessionData?.worker_id].filter(Boolean);

    // Get transactions for all team members
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('command_center_id', ccId)
      .in('worker_id', teamWorkerIds);

    const pendingMapped = (pendingBookings || []).map((b) => ({
      ...b.data,
      ...b.customer_details,
      'Booking ID': b.booking_id,
      'Route Number': b.route_number,
      'Contractor Number': b.contractor_id,
      Status: b.status,
      Price: b.price?.toString(),
      'Log Sheet Notes': b.log_notes,
      Prepaid: b.is_prepaid ? 'x' : undefined,
      commandCenterId: b.command_center_id,
      services: b.services,
      sessionId: b.session_id,
    }));

    const completedMapped = (transactions || []).map(tx => {
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
            commandCenterId: mapped.commandCenterId,
            services: mapped.services,
        };
    });

    return [...pendingMapped, ...completedMapped];
  }

  public async getStreetsForRoute(routeCode: string): Promise<string[]> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    
    const res = await supabase
      .from('routes')
      .select('streets')
      .eq('route_code', routeCode)
      .eq('command_center_id', ccId)
      .eq('session_date', date)
      .maybeSingle();
      
    return res.data?.streets || [];
  }

  /**
   * FIXED: getLogsheetSessions now recalculates stats live to match getActiveLogsheetSession
   * This ensures PayoutToday shows the same EQ values as PayoutContractor
   */
  public async getLogsheetSessions(): Promise<LogsheetSession[]> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return [];
    
    // Get season config for live recalculation
    const seasonType = await this.getSessionSeasonType();
    const productCostPercent = await this.getProductCostPercent();
    const taxRate = this.getCurrentTaxRate();
    
    const [sessionsRes, transactionsRes] = await Promise.all([
      supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
      supabase.from('transactions').select('*').eq('command_center_id', ccId)
    ]);
    
    const sessions = sessionsRes.data || [];
    const allTransactions = (transactionsRes.data || []).map(tx => this.mapDbTransaction(tx));
    
    const transactionsByWorker: Record<string, SessionTransaction[]> = {};
    allTransactions.forEach(tx => {
      if (!transactionsByWorker[tx.workerId]) {
        transactionsByWorker[tx.workerId] = [];
      }
      transactionsByWorker[tx.workerId].push(tx);
    });
    
    return sessions.map((d) => {
      // For team sessions, collect transactions from all team members
      // Check if team_worker_ids has items, otherwise use worker_id
      const teamWorkerIds = hasItems(d.team_worker_ids) ? d.team_worker_ids : [d.worker_id];
      const teamTransactions: SessionTransaction[] = [];
      teamWorkerIds.forEach((wid: string) => {
        if (transactionsByWorker[wid]) {
          teamTransactions.push(...transactionsByWorker[wid]);
        }
      });

      // FIXED: Recalculate stats live instead of using stored d.stats
      // This ensures consistency with getActiveLogsheetSession
      const liveStats = this.recalculateStats(teamTransactions, taxRate, seasonType, productCostPercent);

      return {
        id: d.id,
        workerId: d.worker_id,
        date: d.date,
        status: d.status,
        stats: liveStats,  // <-- FIXED: Use live recalculated stats
        validation: d.validation,
        bonuses: d.bonuses,
        dailyRouteStore: [],
        financialStore: teamTransactions,
        commandCenterId: d.command_center_id,
        teamWorkerIds: d.team_worker_ids,
        equivSplit: d.equiv_split,
        upsellSplit: d.upsell_split,
      };
    });
  }

  public async getActiveLogsheetSession(workerId: string): Promise<LogsheetSession | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

    // Check for team session first
    const { data: teamSession } = await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('date', date)
      .eq('command_center_id', ccId)
      .contains('team_worker_ids', [workerId])
      .maybeSingle();

    const sessionData = teamSession || (await supabase
      .from('logsheet_sessions')
      .select('*')
      .eq('worker_id', workerId)
      .eq('date', date)
      .eq('command_center_id', ccId)
      .single()).data;

    if (!sessionData) return null;

    // FIX: Get all transactions for workers in this session
    // Check if team_worker_ids has items, otherwise use worker_id
    const workerIds = hasItems(sessionData.team_worker_ids) 
      ? sessionData.team_worker_ids 
      : [sessionData.worker_id];
    
    const { data: financials } = await supabase
      .from('transactions')
      .select('*')
      .in('worker_id', workerIds)
      .eq('command_center_id', ccId);
    
    const cleanFinancials = (financials || []).map(tx => this.mapDbTransaction(tx));
    
    const taxRate = this.getCurrentTaxRate();
    const seasonType = await this.getSessionSeasonType();
    const productCostPercent = await this.getProductCostPercent();
    const liveStats = this.recalculateStats(cleanFinancials, taxRate, seasonType, productCostPercent);

    return {
      id: sessionData.id,
      workerId: sessionData.worker_id,
      date: sessionData.date,
      status: sessionData.status,
      stats: liveStats,
      validation: sessionData.validation,
      bonuses: sessionData.bonuses,
      dailyRouteStore: [],
      financialStore: cleanFinancials,
      commandCenterId: sessionData.command_center_id,
      teamWorkerIds: sessionData.team_worker_ids,
      equivSplit: sessionData.equiv_split,
      upsellSplit: sessionData.upsell_split,
    };
  }

  public async startLogsheetSession(workerId: string): Promise<LogsheetSession> {
    const ccId = this.getCCId();
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
      command_center_id: ccId,
    };
    
    const { error } = await supabase.from('logsheet_sessions').insert(newSession);
    if (error) throw error;
    
    return this.getActiveLogsheetSession(workerId) as Promise<LogsheetSession>;
  }

  public async updateLogsheetSession(sessionId: string, updates: Partial<LogsheetSession>): Promise<void> {
    const ccId = this.getCCId();
    const safeUpdates: any = {};
    
    if (updates.stats) safeUpdates.stats = updates.stats;
    if (updates.validation) safeUpdates.validation = updates.validation;
    if (updates.bonuses !== undefined) safeUpdates.bonuses = updates.bonuses;
    if (updates.status) safeUpdates.status = updates.status;
    if (updates.equivSplit) safeUpdates.equiv_split = updates.equivSplit;
    if (updates.upsellSplit) safeUpdates.upsell_split = updates.upsellSplit;
    
    await supabase
      .from('logsheet_sessions')
      .update(safeUpdates)
      .eq('id', sessionId)
      .eq('command_center_id', ccId);
  }

  /**
   * Update team split percentages
   */
  public async updateTeamSplits(
    sessionId: string, 
    equivSplit: TeamSplitConfig, 
    upsellSplit: TeamSplitConfig
  ): Promise<void> {
    const ccId = this.getCCId();
    
    const { error } = await supabase
      .from('logsheet_sessions')
      .update({ 
        equiv_split: equivSplit, 
        upsell_split: upsellSplit 
      })
      .eq('id', sessionId)
      .eq('command_center_id', ccId);

    if (error) throw error;
  }

  /**
   * Assign a booking to a worker (Aeration mode)
   */
  public async assignBookingToWorker(bookingId: string, workerId: string | null): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return;

    const { data: booking } = await supabase
      .from('bookings')
      .select('route_number, contractor_id')
      .eq('booking_id', bookingId)
      .eq('command_center_id', ccId)
      .single();

    if (!booking || !booking.route_number) {
      await supabase
        .from('bookings')
        .update({ contractor_id: workerId })
        .eq('booking_id', bookingId)
        .eq('command_center_id', ccId);
      return;
    }

    const routeNumber = booking.route_number;
    const oldWorkerId = booking.contractor_id;

    const { error } = await supabase
      .from('bookings')
      .update({ contractor_id: workerId })
      .eq('booking_id', bookingId)
      .eq('command_center_id', ccId);
    
    if (error) {
      console.error("Error assigning booking:", error);
      return;
    }

    const { data: route } = await supabase
      .from('routes')
      .select('assigned_worker_ids')
      .eq('route_code', routeNumber)
      .eq('session_date', date)
      .eq('command_center_id', ccId)
      .maybeSingle();

    if (!route) return;

    let assignedWorkerIds: string[] = route.assigned_worker_ids || [];

    if (workerId && !assignedWorkerIds.includes(workerId)) {
      assignedWorkerIds = [...assignedWorkerIds, workerId];
      await supabase
        .from('routes')
        .update({ assigned_worker_ids: assignedWorkerIds })
        .eq('route_code', routeNumber)
        .eq('session_date', date)
        .eq('command_center_id', ccId);
    }

    if (oldWorkerId && oldWorkerId !== workerId) {
      const { data: otherBookings } = await supabase
        .from('bookings')
        .select('booking_id')
        .eq('route_number', routeNumber)
        .eq('contractor_id', oldWorkerId)
        .eq('session_date', date)
        .eq('command_center_id', ccId)
        .neq('booking_id', bookingId);

      if (!otherBookings || otherBookings.length === 0) {
        assignedWorkerIds = assignedWorkerIds.filter(id => id !== oldWorkerId);
        await supabase
          .from('routes')
          .update({ assigned_worker_ids: assignedWorkerIds })
          .eq('route_code', routeNumber)
          .eq('session_date', date)
          .eq('command_center_id', ccId);
      }
    }
  }

  /**
   * Assign a booking to a session (Lawn Rejuv team mode)
   */
  public async assignBookingToSession(bookingId: string, sessionId: string | null): Promise<void> {
    const ccId = this.getCCId();

    const { error } = await supabase
      .from('bookings')
      .update({ session_id: sessionId })
      .eq('booking_id', bookingId)
      .eq('command_center_id', ccId);
    
    if (error) {
      console.error("Error assigning booking to session:", error);
      throw error;
    }
  }

  /**
   * Assign multiple bookings to a session (batch operation for Lawn Rejuv)
   */
  public async assignBookingsToSession(bookingIds: string[], sessionId: string): Promise<void> {
    const ccId = this.getCCId();

    const { error } = await supabase
      .from('bookings')
      .update({ session_id: sessionId })
      .in('booking_id', bookingIds)
      .eq('command_center_id', ccId);
    
    if (error) {
      console.error("Error batch assigning bookings to session:", error);
      throw error;
    }
  }

  /**
   * Assign a single worker to a route (legacy method, wraps assignRouteToWorkers)
   */
  public async assignRouteToWorker(routeCode: string, workerId: string | null): Promise<void> {
    const newAssignedWorkerIds = workerId ? [workerId] : [];
    await this.assignRouteToWorkers(routeCode, newAssignedWorkerIds);
  }

  /**
   * Assign multiple workers to a route (used for team/cart assignments in Lawn Rejuv)
   */
  public async assignRouteToWorkers(routeCode: string, workerIds: string[]): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return;
    
    const { error } = await supabase
      .from('routes')
      .update({ assigned_worker_ids: workerIds })
      .eq('route_code', routeCode)
      .eq('session_date', date)
      .eq('command_center_id', ccId);
    
    if (error) console.error("Error assigning route to workers:", error);
  }

  // --- 6. BOOKING STATUS UPDATES ---

  public async updateBookingStatus(bookingId: string, status: 'next_time' | 'cancelled'): Promise<void> {
    const ccId = this.getCCId();
    const { error } = await supabase
      .from('bookings')
      .update({ status })
      .eq('booking_id', bookingId)
      .eq('command_center_id', ccId);
    
    if (error) {
      console.error("Error updating booking status:", error);
      throw error;
    }
  }

  public async deleteTransactionByJobId(jobId: string): Promise<void> {
    const ccId = this.getCCId();
    await supabase.from('transactions').delete().eq('job_id', jobId).eq('command_center_id', ccId);
  }

  public async revertTransaction(transactionId: string, jobId?: string): Promise<void> {
    const ccId = this.getCCId();
    
    const { data: txData } = await supabase
      .from('transactions')
      .select('worker_id')
      .eq('id', transactionId)
      .eq('command_center_id', ccId)
      .maybeSingle();
    
    const workerId = txData?.worker_id;

    const { error: txError } = await supabase
      .from('transactions')
      .delete()
      .eq('id', transactionId)
      .eq('command_center_id', ccId);
    if (txError) throw txError;
    
    if (jobId && !jobId.startsWith('NEW-')) {
        const { error: bkError } = await supabase
          .from('bookings')
          .update({ status: 'pending' })
          .eq('booking_id', jobId)
          .eq('command_center_id', ccId);
        if (bkError) throw bkError;
    }

    if (workerId) {
      await this.recalculateAndSaveWorkerStats(workerId);
    }
  }

  public async updateTransaction(transactionId: string, updates: Partial<SessionTransaction>): Promise<void> {
      const ccId = this.getCCId();
      
      const { data: existingTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('command_center_id', ccId)
        .maybeSingle();

      const existingSnapshot = existingTx?.customer_snapshot || {};

      const dbPayload: any = {};
      
      if (updates.price !== undefined) dbPayload.price = updates.price;
      if (updates.displayPrice !== undefined) dbPayload.display_price = updates.displayPrice;
      if (updates.paymentMethod !== undefined) dbPayload.payment_method = updates.paymentMethod;
      if (updates.paymentBreakdown !== undefined) dbPayload.payment_breakdown = updates.paymentBreakdown;
      if (updates.type !== undefined) dbPayload.type = updates.type;
      if (updates.customerPhone !== undefined) dbPayload.customer_phone = updates.customerPhone;
      if (updates.customerEmail !== undefined) dbPayload.customer_email = updates.customerEmail;
      if (updates.itemDescription !== undefined) dbPayload.item_description = updates.itemDescription;
      if (updates.items !== undefined) dbPayload.items = updates.items;
      if (updates.etransferEmail !== undefined) dbPayload.etransfer_email = updates.etransferEmail;
      if (updates.chequeNumber !== undefined) dbPayload.cheque_number = updates.chequeNumber;
      if (updates.invoiceNumber !== undefined) dbPayload.invoice_number = updates.invoiceNumber;
      if (updates.isWestSplit !== undefined) dbPayload.is_west_split = updates.isWestSplit;
      if (updates.services !== undefined) dbPayload.services = updates.services;
      if (updates.refId !== undefined) dbPayload.ref_id = updates.refId;
      
      if (updates.customerName !== undefined || 
          updates.address !== undefined || 
          updates.routeCode !== undefined ||
          updates.serviceType !== undefined ||
          updates.serviceName !== undefined) {
          
          const mergedSnapshot = {
              firstName: existingSnapshot.firstName || '',
              lastName: existingSnapshot.lastName || '',
              address: existingSnapshot.address || '',
              routeCode: existingSnapshot.routeCode || '',
              serviceType: existingSnapshot.serviceType || 'FP',
              serviceName: existingSnapshot.serviceName || ''
          };
          
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

      const { error } = await supabase
        .from('transactions')
        .update(dbPayload)
        .eq('id', transactionId)
        .eq('command_center_id', ccId);
      if (error) throw error;

      const workerId = existingTx?.worker_id;
      if (workerId) {
        await this.recalculateAndSaveWorkerStats(workerId);
      }
  }

  public async completeJob(
    transaction: SessionTransaction, 
    jobId: string, 
    workerId: string,
    teamWorkerIds?: string[] // For team seasons
  ): Promise<void> {
    const ccId = this.getCCId();
    
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
      services: transaction.services,
      completed_by_worker_ids: teamWorkerIds || [workerId],
      ref_id: transaction.refId,
      
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
      command_center_id: ccId,
    };

    let existingId: string | null = null;
    
    if (jobId) {
       const { data } = await supabase
         .from('transactions')
         .select('id')
         .eq('job_id', jobId)
         .eq('command_center_id', ccId)
         .maybeSingle();
       if (data) existingId = data.id;
    }

    if (existingId) {
        const { error } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', existingId)
          .eq('command_center_id', ccId);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('transactions').insert({ ...payload, id: transaction.id });
        if (error) throw error;
    }

    if (jobId && !jobId.startsWith('NEW-')) {
      await supabase
        .from('bookings')
        .update({
          status: 'completed',
          contractor_id: workerId,
        })
        .eq('booking_id', jobId)
        .eq('command_center_id', ccId);
    }

    // Recalculate stats - the method is now team-aware and will handle everything
    await this.recalculateAndSaveWorkerStats(workerId);

    // Send email receipt
    if (transaction.customerEmail && transaction.customerEmail.trim() !== '') {
      this.sendReceiptEmail({
        customerEmail: transaction.customerEmail,
        customerName: transaction.customerName,
        customerAddress: transaction.address || '',
        date: new Date(transaction.timestamp).toLocaleDateString(),
        serviceName: transaction.items?.[0]?.name || transaction.serviceName || 'Service',
        amount: transaction.displayPrice || `$${transaction.price.toFixed(2)}`,
        price: transaction.price,
        paymentMethod: transaction.paymentMethod,
        workerName: transaction.workerName || '',
        transactionId: transaction.id,
        // Template selection fields
        commandCenterId: ccId,
        type: transaction.type,
        refId: transaction.refId,
        isPrepaid: transaction.isPrepaid,
      }).catch(err => {
        console.error('📧 Email send failed (non-blocking):', err);
      });
    }
  }

  // --- 7. EMAIL RECEIPTS ---

  public async sendReceiptEmail(transactionData: {
    customerEmail: string;
    customerName: string;
    customerAddress: string;
    date: string;
    serviceName: string;
    amount: string;
    price: number;
    paymentMethod: string;
    workerName: string;
    transactionId: string;
    // Template selection fields
    commandCenterId: string;
    type: string;
    refId?: string;
    isPrepaid?: boolean;
  }): Promise<boolean> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return false;

      const { data: sessionData } = await supabase
        .from('logsheet_sessions')
        .select('email_enabled')
        .eq('date', date)
        .eq('command_center_id', ccId)
        .limit(1)
        .maybeSingle();

      if (sessionData && sessionData.email_enabled === false) {
        console.log('📧 Email sending disabled for this session');
        return false;
      }

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

  public async toggleSessionEmail(enabled: boolean): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return;

    await supabase
      .from('logsheet_sessions')
      .update({ email_enabled: enabled })
      .eq('date', date)
      .eq('command_center_id', ccId);
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

  /**
   * Season-aware stats recalculation
   * - Handles FSL flat for lawn_rejuv (instead of SP/RJ)
   * - Uses season-specific prepaid/billed weights
   * - Applies product cost deduction (e.g., 25% for lawn_rejuv)
   * - EQ calculation ALWAYS uses EQ_DIVISOR (25) regardless of season
   * 
   * @param financials - Array of transactions to calculate stats from
   * @param taxRate - Tax rate percentage (e.g., 5 for 5%)
   * @param seasonType - 'aeration' or 'lawn_rejuv'
   * @param productCostPercent - Product cost deduction percentage (0-100, e.g., 25 for 25%)
   */
  public recalculateStats(
    financials: SessionTransaction[], 
    taxRate: number = 5,
    seasonType: SeasonType = 'aeration',
    productCostPercent: number = 0
  ): SessionStats {
    const stats = this.getEmptyStats();
    const taxDivisor = 1 + taxRate / 100;
    const config = getSeasonConfig(seasonType);
    
    // Get flat codes for this season
    const flatCodes = config.officeFlats.map(f => f.code);

    financials.forEach((tx) => {
      if (['Production', 'Sale', 'Upgrade'].includes(tx.type)) stats.stepCount++;
      if (['Upgrade', 'Add-On'].includes(tx.type)) stats.upsellCount++;
      if (tx.paymentMethod === 'IOS') stats.iosCount++;

      const paymentMap: Record<string, number> = tx.paymentBreakdown || { [tx.paymentMethod]: tx.price };

      Object.entries(paymentMap).forEach(([method, amount]) => {
        const val = Number(amount) || 0;
        
        if (method === 'IOS') {
          return;
        }
        
        const addToBucket = (val: number, isProd: boolean) => {
          if (isProd) {
            // Check for season-appropriate flats
            const isFlat = tx.type === 'Production' && 
              flatCodes.some(code => tx.displayPrice?.startsWith(code));
            
            if (isFlat) {
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
           addToBucket(val * 0.8, false);
           if (method.includes('Prepaid')) {
               stats.prodPrepaidSplit += (val * 0.2);
           } else {
               addToBucket(val * 0.2, true);
           }
        }
      });
    });

    stats.prodGross = stats.prodPrepaid + stats.prodBilled + stats.prodCash + stats.prodCheque + 
                      stats.prodETransfer + stats.prodCreditCard + stats.prodFlats + stats.prodPrepaidSplit;
    
    // Season-aware weighted production calculation
    const prepaidWeight = config.prepaidWeight;
    const billedWeight = config.billedWeight;
    
    const weightedProd = 
        (stats.prodPrepaid * prepaidWeight) + 
        (stats.prodBilled * billedWeight) + 
        stats.prodCash + 
        stats.prodCheque + 
        stats.prodETransfer + 
        stats.prodCreditCard + 
        stats.prodFlats + 
        stats.prodPrepaidSplit;

    // Apply tax removal first, then product cost deduction
    // Formula: prodPayable = (weightedProd / taxDivisor) * (1 - productCostPercent/100)
    const afterTax = weightedProd / taxDivisor;
    const productCostMultiplier = 1 - (productCostPercent / 100);
    stats.prodPayable = afterTax * productCostMultiplier;
    
    // EQ calculation ALWAYS uses EQ_DIVISOR (25) regardless of season
    // The payout rate ($/EQ) is what changes per season, not the EQ divisor
    stats.totalEQ = stats.prodPayable / EQ_DIVISOR;
    
    stats.upsellGross = stats.upsellBilled + stats.upsellCash + stats.upsellCheque + 
                        stats.upsellETransfer + stats.upsellCreditCard + stats.upsellPrepaid;
    stats.upsellPayable = stats.upsellGross / taxDivisor;

    return stats;
  }

  // --- 9. TEAM PAYOUT CALCULATIONS ---

  /**
   * Calculate individual worker payouts for a team session.
   * 
   * IMPORTANT: This is the CANONICAL payout calculation function.
   * All UI components and exports should use this function to ensure consistency.
   * 
   * Rate Calculation:
   * - basePayoutRate: $8/EQ for teams (2+), $6/EQ for solo (lawn_rejuv); $8/EQ for aeration
   * - alumniRate/silverRate: Additional $/EQ amounts (NOT percentages)
   * - totalPayoutRate = basePayoutRate + alumniRate + silverRate
   * 
   * Production Commission:
   * - teamTotalEQ: Displayed to ALL team members (for visibility)
   * - assignedEQ: teamTotalEQ * equivSplitPercent (for calculation)
   * - productionCommission = assignedEQ * totalPayoutRate
   * 
   * Upsell Commission:
   * - upsellCommission = upsellPayable * upsellSplitPercent * 0.15
   * - iosCommission = iosCount * $5 * upsellSplitPercent
   * 
   * Deductions:
   * - cashChequeDiff: (|cashDiff| + |chequeDiff|) * equivSplitPercent
   * - machineRentalDeduction: $10 PER WORKER (NOT split)
   * - deductions = cashChequeDiff + machineRentalDeduction
   */
  public calculateTeamPayouts(
    session: LogsheetSession,
    workers: Worker[],
    seasonType: SeasonType
  ): WorkerPayoutBreakdown[] {
    const stats = session.stats;
    const validation = session.validation;
    const teamWorkerIds = session.teamWorkerIds || [session.workerId];
    const teamSize = teamWorkerIds.length;
    
    // Get splits (default to equal if not set)
    const equivSplit = session.equivSplit || createEqualSplit(teamWorkerIds);
    const upsellSplit = session.upsellSplit || equivSplit;
    
    // Get the BASE payout rate ($/EQ)
    const basePayoutRate = getPayoutRate(seasonType, teamSize);
    
    // Team total EQ (displayed to all workers, but split for calculation)
    const teamTotalEQ = stats.totalEQ;
    
    const breakdowns: WorkerPayoutBreakdown[] = [];
    
    const workerMap = new Map(workers.map(w => [w.contractorId, w]));
    
    for (const workerId of teamWorkerIds) {
      const worker = workerMap.get(workerId);
      if (!worker) continue;
      
      // Get split percentages
      const equivPercent = (equivSplit[workerId] || 0) / 100;
      const upsellPercent = (upsellSplit[workerId] || 0) / 100;
      
      // Calculate assigned EQ (team total * split %)
      const assignedEQ = teamTotalEQ * equivPercent;
      
      // Get worker's individual rates ($/EQ, NOT percentages)
      const alumniRate = worker.alumniRate || 0;
      const silverRate = worker.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      
      // Production commission breakdown
      const baseCommission = assignedEQ * basePayoutRate;
      const alumniBonus = assignedEQ * alumniRate;
      const silverBonus = assignedEQ * silverRate;
      const productionCommission = baseCommission + alumniBonus + silverBonus;
      // Equivalent to: assignedEQ * totalPayoutRate
      
      // Upsell commission (15% of upsell payable, split by upsell %)
      const upsellCommission = (stats.upsellPayable || 0) * upsellPercent * 0.15;
      
      // IOS commission ($5 per IOS, split by upsell %)
      const iosCommission = (stats.iosCount || 0) * 5 * upsellPercent;
      
      // Bonuses (with their own split percentages)
      let bonusAmount = 0;
      if (session.bonuses) {
        for (const bonus of session.bonuses) {
          // Use bonus-specific split if defined, otherwise use equiv split
          const bonusSplit = bonus.splitPercentages?.[workerId] ?? (equivPercent * 100);
          bonusAmount += bonus.amount * (bonusSplit / 100);
        }
      }
      
      // Deductions calculation
      // Cash/cheque diff is split by equiv percent
      const cashChequeDiff = validation 
        ? (Math.abs(validation.cashDiff || 0) + Math.abs(validation.chequeDiff || 0)) * equivPercent
        : 0;
      
      // Machine rental is $10 PER WORKER (NOT split)
      const machineRentalDeduction = validation?.machineRental ? 10 : 0;
      
      const deductions = cashChequeDiff + machineRentalDeduction;
      
      // Final commission
      const finalCommission = productionCommission + upsellCommission + iosCommission + 
                             bonusAmount - deductions;
      
      breakdowns.push({
        workerId,
        workerName: `${worker.firstName} ${worker.lastName}`,
        equivSplitPercent: equivSplit[workerId] || 0,
        upsellSplitPercent: upsellSplit[workerId] || 0,
        teamTotalEQ,
        assignedEQ,
        basePayoutRate,
        alumniRate,
        silverRate,
        totalPayoutRate,
        baseCommission,
        alumniBonus,
        silverBonus,
        productionCommission,
        upsellCommission,
        iosCommission,
        bonusAmount,
        cashChequeDiff,
        machineRentalDeduction,
        deductions,
        finalCommission,
      });
    }
    
    return breakdowns;
  }
}

export const sessionService = SessionService.getInstance();