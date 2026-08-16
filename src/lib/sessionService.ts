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
  seasonHasAsphalt,
  isRampCrewTeamId,
  calculateAsphaltSplit,
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
  HistoricalProperty,
  SEASON_CONFIGS,
  PendingSale,
  PendingSaleInput,
  PendingSaleUpdate,
  AsphaltMeta,
  AsphaltRole,
  RouteSplit,
  RouteSplitBucket,
  RouteSplitRectangle,
  ManagerLocation,
  ManagerMappingConfig,
} from '../types';

// Import metadata type - re-export for other modules
import { ImportMeta } from './googleSheetsService';
export type { ImportMeta };

// --- ASPHALT COMPLETION CONTEXT (4-mode discriminated union) ---
//
// Passed to completeJob when the job has an asphalt component. completeJob
// branches on ctx.mode and routes to completeAsphaltJob, which writes the
// appropriate transactions (1 or 2 real, optionally a phantom partner) and
// reconciles pending_sales rows.
//
// Mode selection guide for UI callers:
//   QuickPendingModal → completion flow with both pending rows existing:
//     - Cart != RC, partner is RC                       → completer-with-phantom
//     - Solo RC handling everything                     → self-both
//     - Cart-completing-driveway, RC-completing-asphalt → completer-with-phantom
//                                                          (whichever fires runs both)
//
//   JobDetail (office booking completion) / NewJob walk-up, asphalt toggled on:
//     - Non-RC cart                                     → driveway-deferred
//     - RC cart (self-handles everything)               → self-both
//
//   NewJob with ?pendingSaleId= (resuming an asphalt child):
//     - RC picking up a deferred asphalt child          → asphalt-executor-only
//     - Solo RC resuming an asphalt-only standalone     → self-both
//     - Cart-with-RC parent+child completion            → completer-with-phantom

// Mode 1 (existing): writes completer's tx + phantom partner tx.
// Used when both pending rows existed (QuickPending → completion flow) and the
// completer's cart ≠ partner's cart. Whichever cart fires completion writes both
// transactions atomically; the other side's tx is a cashless phantom for accounting.
export interface AsphaltCompleterWithPhantomContext {
  mode: 'completer-with-phantom';
  completerRole: 'driveway-seller' | 'asphalt-executor';
  parentSaleId: string | null;   // null when the job is asphalt-only
  childSaleId: string;           // always present in this mode
  drivewayAmount: number;        // 0 when there is no parent (asphalt-only)
  asphaltAmount: number;
  upsoldAmount: number;
  // Partner cart info — the OTHER cart that participates via phantom row.
  partner: {
    sessionId: string;
    workerId: string;            // first worker on partner cart (drives tx.worker_id)
    teamWorkerIds: string[];     // populates completed_by_worker_ids on the phantom
    workerName: string;          // for display
  };
}

// Mode 2 (existing): single transaction, no partner.
// Used by a solo RC who sold AND executed everything (Scenario 2 or 3, or
// RC-at-JobDetail/NewJob handling both portions themselves).
export interface AsphaltSelfBothContext {
  mode: 'self-both';
  completerRole: 'self-both';
  // Optional — present when resuming from a pending row (QuickPending flow).
  // Omitted/null when called from a walk-up NewJob with no prior pending row.
  parentSaleId?: string | null;
  childSaleId?: string | null;
  drivewayAmount: number;
  asphaltAmount: number;
  upsoldAmount: number;
}

// Mode 3 (NEW — Path 3): cart writes the driveway-seller tx + creates a
// deferred asphalt child pending_sale. No phantom. RC will pick up the child
// later via mode='asphalt-executor-only'.
//
// Used by JobDetail (office booking) and NewJob (walk-up) when a non-RC cart
// adds asphalt and clicks the green completion button. The cart collects all
// the cash (driveway + asphalt) and its tx records the full breakdown; the
// payoutShare on the cart's tx is (driveway $ + 30% × asphalt $) which leaves a
// negative asphalt-adjustment delta in their session (cash held > earned). RC's
// eventual asphalt-executor-only tx will balance it with a matching positive delta.
export interface AsphaltDrivewayDeferredContext {
  mode: 'driveway-deferred';
  completerRole: 'driveway-seller';
  drivewayAmount: number;
  asphaltAmount: number;        // must be > 0 (validated)
  upsoldAmount: number;         // typically 0 for non-RC (cart doesn't know upsold yet)
  // Info for the asphalt child pending_sale row to be created atomically.
  // sessionId/workerId here are the CART's (selling side) — not the RC's.
  childPending: {
    sessionId: string;
    workerId: string;
    routeCode?: string;
    houseNumber?: string;
    streetName?: string;
    propertyType?: string;
    notes?: string;
    // For an RC voluntarily deferring to themselves (rare): auto-assign the
    // child to a specific RC session id. For typical non-RC use: leave
    // undefined → child stays unassigned for the RM modal queue.
    autoAssignToRcSessionId?: string;
  };
}

// Mode 4 (NEW — Path 3): RC writes the asphalt-executor tx referencing an
// already-existing driveway-seller tx via sharedJobKey. No phantom — the cart's
// tx already exists (written by mode='driveway-deferred' earlier).
//
// Used when RC picks up a deferred asphalt child from their pending list. The
// child's row carries the sharedJobKey set at cart's completion time; the UI
// reads it and passes it through here so RC's tx links to the cart's.
//
// On completion: RC's tx is written with payoutShare = 70% × asphalt + 100% × upsold,
// the child pending_sale row is deleted, and only RC's stats are recalculated
// (cart's stats are correctly locked from their earlier completion).
export interface AsphaltExecutorOnlyContext {
  mode: 'asphalt-executor-only';
  completerRole: 'asphalt-executor';
  childSaleId: string;                  // the asphalt child pending_sale id to delete
  existingParentSharedJobKey: string;   // copied from child.sharedJobKey
  drivewayAmount: number;               // copied through for asphalt_meta consistency
  asphaltAmount: number;
  upsoldAmount: number;
}

// The union exported for consumers (UI files, etc).
export type AsphaltCompletionContext =
  | AsphaltCompleterWithPhantomContext
  | AsphaltSelfBothContext
  | AsphaltDrivewayDeferredContext
  | AsphaltExecutorOnlyContext;

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

  // --- HELPER: Normalize an address into a stable cache key ---
  private normalizeAddressKey(addr: string): string {
    return (addr || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // --- HELPER: Generate a shared job key for grouping asphalt transactions ---
  // Falls back to a timestamped pseudo-random string if crypto.randomUUID is
  // unavailable (some older Safari WebViews don't have it).
  private generateSharedJobKey(): string {
    try {
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
      }
    } catch {
      // fall through
    }
    return `asphalt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    const seasonType = await this.getSessionSeasonType();
    return SEASON_CONFIGS[seasonType].defaultProductCostPercent;
  }

  // --- 1. HELPERS ---

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
        sessionId: tx.session_id,
        // --- ASPHALT FIELDS ---
        payoutShare: tx.payout_share != null ? Number(tx.payout_share) : undefined,
        asphaltMeta: tx.asphalt_meta || undefined,
    } as SessionTransaction & { sessionId?: string };
  }

  // --- HELPER: Map DB row → RouteSplit. Trivial column-rename mapper kept
  // alongside the other mapDbXxx helpers so this file's "shape of DB rows"
  // logic stays in one neighborhood.
  private mapDbRouteSplit(row: any): RouteSplit {
    // The new v2 schema stores a buckets jsonb array. Each element should
    // already match the RouteSplitBucket interface. Defensive normalisation
    // here in case the row was hand-written or has missing fields.
    //
    // BACK-COMPAT: an earlier iteration of RouteSplitRectangle stored axis-
    // aligned bounds {west, east, south, north} instead of explicit corners.
    // We convert old-shape rectangles to corners-shape on read so existing
    // splits keep working without a data migration. New writes are always
    // corners-shape. A single bucket can contain a mix of old + new
    // rectangles and it will still render correctly.
    const normalizeRect = (r: any): RouteSplitRectangle | null => {
      if (!r || typeof r !== 'object') return null;
      // New shape: { corners: [...] }
      if (Array.isArray(r.corners) && r.corners.length === 4) {
        return {
          corners: r.corners.map((c: any) => ({
            lng: Number(c.lng),
            lat: Number(c.lat),
          })),
        };
      }
      // Old shape: { west, east, south, north } — build a north-up corners list.
      if (typeof r.west === 'number' && typeof r.east === 'number'
        && typeof r.south === 'number' && typeof r.north === 'number') {
        return {
          corners: [
            { lng: r.west, lat: r.north }, // TL
            { lng: r.east, lat: r.north }, // TR
            { lng: r.east, lat: r.south }, // BR
            { lng: r.west, lat: r.south }, // BL
          ],
        };
      }
      return null;
    };
    const rawBuckets = Array.isArray(row.buckets) ? row.buckets : [];
    const buckets: RouteSplitBucket[] = rawBuckets.map((b: any) => ({
      letter: typeof b.letter === 'string' ? b.letter : 'a',
      sourceLetter: typeof b.sourceLetter === 'string' ? b.sourceLetter : null,
      rectangles: Array.isArray(b.rectangles)
        ? b.rectangles.map(normalizeRect).filter((r: RouteSplitRectangle | null): r is RouteSplitRectangle => r !== null)
        : [],
      bookingIds: Array.isArray(b.bookingIds) ? b.bookingIds : [],
      assignedWorkers: Array.isArray(b.assignedWorkers) ? b.assignedWorkers : [],
      managerId: typeof b.managerId === 'string' ? b.managerId : undefined,
    }));
    return {
      id: row.id,
      commandCenterId: row.command_center_id,
      sessionDate: row.session_date,
      routeCode: row.route_code,
      buckets,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Recalculates a worker's stats from their transactions and saves to the DB.
   * TEAM-AWARE for both aeration and lawn_rejuv and sealing.
   */
  private async recalculateAndSaveWorkerStats(workerId: string): Promise<void> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return;

      const seasonType = await this.getSessionSeasonType();
      const productCostPercent = await this.getProductCostPercent();
      const noTaxOnCash = await this.getSessionNoTaxOnCash();

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

      let transactions: any[] | null = null;

      if (seasonHasTeams(seasonType) && sessionData.id) {
        const { data: sessionTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('session_id', sessionData.id)
          .eq('command_center_id', ccId);

        if (sessionTx && sessionTx.length > 0) {
          transactions = sessionTx;
        }
      }

      if (!transactions || transactions.length === 0) {
        const teamWorkerIds = hasItems(sessionData.team_worker_ids) 
          ? sessionData.team_worker_ids 
          : [sessionData.worker_id];

        const { data: workerTx } = await supabase
          .from('transactions')
          .select('*')
          .in('worker_id', teamWorkerIds)
          .eq('command_center_id', ccId);

        transactions = workerTx;
      }

      const cleanFinancials = (transactions || []).map(tx => this.mapDbTransaction(tx));

      const taxRate = this.getCurrentTaxRate();
      const newStats = this.recalculateStats(cleanFinancials, taxRate, seasonType, productCostPercent, noTaxOnCash);

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

  private async recalculateTeamStats(teamWorkerIds: string[]): Promise<void> {
    if (!hasItems(teamWorkerIds)) return;
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
      // Round-trip the floater config so the RM logbook can read who-floats-for-whom.
      floatingFor: Array.isArray(m.metadata?.floatingFor) ? m.metadata.floatingFor : [],
      // Round-trip the per-manager digital mapping config (Sealing, non-mapping CCs).
      digitalMapping: m.metadata?.digitalMapping || undefined,
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

    // Split-aware route assignment (READ MODEL ONLY).
    // For a carved route, worker assignment lives at the bucket level in
    // route_splits — routes.assigned_worker_ids is deliberately left empty to
    // avoid the "both halves" write bleed. So when assembling DailySessionData,
    // fold each split's bucket assignedWorkers back up into the route's
    // assignedWorkerIds, ONLY in memory. This lets on-route detection (worker
    // dashboard's hasAssignedRoutes, WorkerMapTab's route drawing, PCL route
    // codes) recognise a split-route worker, WITHOUT writing the union back to
    // the DB (which is what caused the bleed). The per-booking job list stays
    // correctly scoped to a single bucket via getWorkerAssignments' own
    // bucket-aware filter, so this union never causes a worker to see the other
    // half's jobs.
    const splitsForRoutes = await this.getRouteSplits();
    const bucketWorkersByRoute = new Map<string, string[]>();
    for (const s of splitsForRoutes) {
      const u = new Set<string>();
      for (const b of s.buckets) for (const w of (b.assignedWorkers || [])) u.add(w);
      if (u.size > 0) bucketWorkersByRoute.set(s.routeCode, Array.from(u));
    }

    const routes = (routesRes.data || []).map((r) => {
      const baseWorkers: string[] = r.assigned_worker_ids || [];
      const splitWorkers = bucketWorkersByRoute.get(r.route_code);
      return {
        routeCode: r.route_code,
        managerId: r.manager_id,
        assignedWorkerIds: splitWorkers
          ? Array.from(new Set([...baseWorkers, ...splitWorkers]))
          : baseWorkers,
        streets: r.streets,
        commandCenterId: r.command_center_id,
      };
    });

    const pendingBookings = (bookingsRes.data || []).map((b) => ({
      ...b.data,
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
      // Per-manager digital mapping (Sealing, non-mapping CCs). The worker
      // dashboard reads this to decide whether its manager grants the mapped
      // experience even though the CC-level flag is off.
      digitalMapping: data.metadata?.digitalMapping || undefined,
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

  public async getSessionLiveCardEnabled(): Promise<boolean> {
    try {
      const meta = await this.getSessionImportMeta();
      return meta?.liveCardProcessingEnabled ?? false;
    } catch {
      return false;
    }
  }

  public async getSessionNoTaxOnCash(): Promise<boolean> {
    try {
      const meta = await this.getSessionImportMeta();
      return meta?.noTaxOnCash ?? false;
    } catch {
      return false;
    }
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

  // --- FLOATER: update a single manager's floatingFor list (live-edit path).
  // Reads existing metadata, merges in the new floatingFor array, writes back.
  // Preserves phone and any other metadata keys. Pass [] to clear (un-float).
  public async updateManagerFloatingFor(managerId: string, floatingFor: string[]): Promise<void> {
    const ccId = this.getCCId();

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', managerId)
      .eq('role', 'RouteManager')
      .eq('command_center_id', ccId)
      .single();

    if (fetchError || !user) throw new Error('Manager not found');

    const newMetadata = { ...(user.metadata || {}), floatingFor: floatingFor || [] };

    const { error: updateError } = await supabase
      .from('users')
      .update({ metadata: newMetadata })
      .eq('user_id', managerId)
      .eq('command_center_id', ccId);

    if (updateError) throw updateError;
  }

  // --- PER-MANAGER DIGITAL MAPPING: LIVE-SESSION APPLY ---
  // Writes the mapped routes into the live session and persists the config to
  // users.metadata.digitalMapping. Caller (SCC) handles the bookings pull and
  // the PCL prefix load. Refuses if any chosen route code already exists in
  // the session — live mappings are add-only; editing is preview/next-session.
  public async applyManagerMappingLive(
    managerId: string,
    config: ManagerMappingConfig,
    mappedRoutes: { routeCode: string; streets: string[] }[]
  ): Promise<void> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const { data: existing } = await supabase
      .from('routes')
      .select('route_code')
      .eq('session_date', date)
      .eq('command_center_id', ccId)
      .in('route_code', config.routeCodes);
    if (existing && existing.length > 0) {
      throw new Error(`Route(s) already in this session: ${existing.map(r => r.route_code).join(', ')}`);
    }

    const routeRows = mappedRoutes.map(r => ({
      route_code: r.routeCode,
      manager_id: managerId,
      assigned_worker_ids: [],
      streets: r.streets,
      session_date: date,
      command_center_id: ccId,
    }));
    const { error: routeError } = await supabase.from('routes').insert(routeRows);
    if (routeError) throw routeError;

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('metadata')
      .eq('user_id', managerId)
      .eq('role', 'RouteManager')
      .eq('command_center_id', ccId)
      .single();
    if (fetchError || !user) throw new Error('Manager not found');

    const newMeta = { ...(user.metadata || {}), digitalMapping: config };
    const { error: metaError } = await supabase
      .from('users')
      .update({ metadata: newMeta })
      .eq('user_id', managerId)
      .eq('command_center_id', ccId);
    if (metaError) throw metaError;
  }

  // --- 2d. WORKER SESSION STATUS (LOCKOUT) ---

  public async getWorkerSessionStatus(workerId: string): Promise<string | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

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

  public async getWorkerTeamCart(workerId: string): Promise<TeamCart | null> {
    const dailySession = await this.getDailySession();
    if (!dailySession || !dailySession.teamCarts) return null;

    return dailySession.teamCarts.find(cart => 
      cart.workerIds.includes(workerId)
    ) || null;
  }

  public async getTeamMembers(workerId: string): Promise<Worker[]> {
    const cart = await this.getWorkerTeamCart(workerId);
    return cart?.workers || [];
  }

  public async getWorkerLogsheetSession(workerId: string): Promise<LogsheetSession | null> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) return null;

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

  // --- 2g. GEOCODE CACHE (session-scoped) ---

  public async getAllGeocodeCache(): Promise<Map<string, { lat: number; lng: number }>> {
    const result = new Map<string, { lat: number; lng: number }>();
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return result;

      const { data, error } = await supabase
        .from('geocode_cache')
        .select('address_key, lat, lng')
        .eq('command_center_id', ccId)
        .eq('session_date', date);

      if (error) {
        console.warn('[Geocode] Failed to fetch cache:', error);
        return result;
      }

      (data || []).forEach((row: any) => {
        result.set(row.address_key, { lat: row.lat, lng: row.lng });
      });

      // PERMANENT PCL GEOCODES. The table above is empty again on every new
      // session date; pcl_geocode_cache is not. Merging it in here is what lets
      // a preload run weeks ahead pay off on the day — the map's PCL phase finds
      // its coordinates already resolved instead of grinding through several
      // thousand lookups one at a time. Session rows win where both exist,
      // since those were resolved against today's data.
      try {
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data: permData, error: permErr } = await supabase
            .from('pcl_geocode_cache')
            .select('address_key, lat, lng')
            .eq('command_center_id', ccId)
            .range(from, from + BATCH - 1);
          if (permErr) {
            console.warn('[Geocode] Permanent PCL cache read failed:', permErr.message);
            break;
          }
          if (!permData || permData.length === 0) break;
          permData.forEach((row: any) => {
            if (!result.has(row.address_key)) {
              result.set(row.address_key, { lat: row.lat, lng: row.lng });
            }
          });
          if (permData.length < BATCH) break;
          from += BATCH;
        }
      } catch (permCatch) {
        console.warn('[Geocode] Permanent PCL cache merge skipped:', permCatch);
      }

      return result;
    } catch (err) {
      console.warn('[Geocode] getAllGeocodeCache error:', err);
      return result;
    }
  }

  public async saveGeocode(address: string, lat: number, lng: number): Promise<void> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return;

      const address_key = this.normalizeAddressKey(address);
      if (!address_key) return;

      const { error } = await supabase
        .from('geocode_cache')
        .upsert({
          address_key,
          command_center_id: ccId,
          session_date: date,
          lat,
          lng,
        }, {
          onConflict: 'address_key,command_center_id,session_date'
        });

      if (error) {
        console.warn('[Geocode] Failed to save cache entry:', error);
      }
    } catch (err) {
      console.warn('[Geocode] saveGeocode error:', err);
    }
  }

  // --- 2g-loc. MANAGER LIVE LOCATIONS (Floater feature, digital-mapping CCs) ---
  //
  // Mirrors the worker_locations pattern: one row per manager_id, OVERWRITTEN on
  // each update (no history). A manager's own device writes its position via
  // upsertManagerLocation while RMMapTab is open with GPS active; floaters read
  // every manager's row via getManagerLocations to draw the coloured arrows.
  //
  // heading is nullable: if the device has no compass/bearing fix yet, we store
  // null and the map renders a north-pointing arrow. No background reporting —
  // a manager who never opens the map simply has no row (invisible).

  /**
   * Write THIS manager's own live location. Self-resolves the manager from the
   * logged-in `current_user` in localStorage — never takes a managerId argument,
   * so a device can only ever report its OWN position (can't spoof another's).
   *
   * Safely no-ops (with a warning) if there's no current_user, if the user isn't
   * a RouteManager, or if there's no CC context — so a worker's device or a
   * half-populated session won't write a junk row.
   *
   * heading: pass the compass bearing in degrees if available; omit/undefined
   * when there's no fix (stored as null → north-pointing arrow downstream).
   */
  public async upsertManagerLocation(lat: number, lng: number, heading?: number): Promise<void> {
    try {
      const ccId = this.getCCId();

      // Self-resolve the manager from the logged-in user. Read lazily to avoid a
      // top-of-file import cycle (localStorage helper is tiny and sync).
      const { getStorageItem } = await import('./localStorage');
      const currentUser = getStorageItem<ManagementUser | null>('current_user', null);

      if (!currentUser || currentUser.role !== 'RouteManager' || !currentUser.userId) {
        console.warn('[ManagerLoc] upsert skipped — no RouteManager current_user to self-resolve.');
        return;
      }

      const row = {
        manager_id: currentUser.userId,
        command_center_id: ccId,
        lat,
        lng,
        heading: heading ?? null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('manager_locations')
        .upsert(row, { onConflict: 'manager_id' });

      if (error) {
        console.warn('[ManagerLoc] upsertManagerLocation failed:', error);
      }
    } catch (err) {
      console.warn('[ManagerLoc] upsertManagerLocation error:', err);
    }
  }

  /**
   * Read EVERY manager's live location for the current CC. No manager filter —
   * a floater needs all of them, and the map layer decides which to actually
   * render based on the floated set (later phase). Returns the typed
   * ManagerLocation shape so downstream arrow/staleness code can't drift.
   */
  public async getManagerLocations(): Promise<ManagerLocation[]> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('manager_locations')
        .select('*')
        .eq('command_center_id', ccId);

      if (error) {
        console.warn('[ManagerLoc] getManagerLocations failed:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        managerId: row.manager_id,
        lat: Number(row.lat),
        lng: Number(row.lng),
        heading: row.heading != null ? Number(row.heading) : null,
        updatedAt: row.updated_at,
        commandCenterId: row.command_center_id,
      }));
    } catch (err) {
      console.warn('[ManagerLoc] getManagerLocations error:', err);
      return [];
    }
  }

  // --- 2h. HISTORICAL PROPERTIES (purple dots) ---

  public async getHistoricalPropertiesForRoutes(routeCodes: string[]): Promise<HistoricalProperty[]> {
    if (!routeCodes.length) return [];
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('route_historical_properties')
        .select('*')
        .eq('command_center_id', ccId)
        .in('route_code', routeCodes);

      if (error) {
        console.warn('[HistoricalProps] Failed to fetch:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        routeCode: row.route_code,
        address: row.address,
        customerName: row.customer_name || undefined,
        phone: row.phone || undefined,
        email: row.email || undefined,
        clientType: row.client_type || undefined,
        propertyType: row.property_type || undefined,
        notes: row.notes || undefined,
        price: row.price || undefined,
        paymentType: row.payment_type || undefined,
        contractorName: row.contractor_name || undefined,
      }));
    } catch (err) {
      console.warn('[HistoricalProps] error:', err);
      return [];
    }
  }

  // --- 2i. ROUTE SPLITS (Digital mapping CCs only) ---
  //
  // V2 schema: recursive splits with stored rectangles. See the RouteSplit
  // interface in types.ts for full semantics.
  //
  // Eligibility (enforced in calling UI, not here):
  //   - splitBucket can only be called on buckets with zero assignedWorkers.
  //   - The first call on a route auto-creates the row with a single 'a'
  //     bucket containing all bookings, then carves the new letter.
  //
  // Lifecycle: split row is wiped automatically when adminResetDailySession runs.

  /**
   * Fetch all route splits for the current session. Returns an empty array if
   * no splits exist or the session is missing.
   */
  public async getRouteSplits(): Promise<RouteSplit[]> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];

      const { data, error } = await supabase
        .from('route_splits')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('session_date', date);

        if (error) {
          console.warn('[RouteSplit] getRouteSplits failed:', error);
          return [];
        }
        return (data || []).map(r => this.mapDbRouteSplit(r));
      } catch (err) {
        console.warn('[RouteSplit] getRouteSplits error:', err);
        return [];
      }
    }
  
    /**
     * Fetch a single route's split (if any). Returns null when the route isn't split.
     */
    public async getRouteSplitForRoute(routeCode: string): Promise<RouteSplit | null> {
      try {
        const ccId = this.getCCId();
        const date = await this.getDailySessionDate();
        if (!date) return null;
  
        const { data, error } = await supabase
          .from('route_splits')
          .select('*')
          .eq('command_center_id', ccId)
          .eq('session_date', date)
          .eq('route_code', routeCode)
          .maybeSingle();
  
        if (error || !data) return null;
        return this.mapDbRouteSplit(data);
      } catch (err) {
        console.warn('[RouteSplit] getRouteSplitForRoute error:', err);
        return null;
      }
    }
  
    /**
     * Compute the next available letter for a route, given its current buckets.
     * Pure function — exported on the service for use by the UI (the split
     * modal needs to know which letter it's previewing as the new bucket).
     *
     * Sequence is a, b, c, ..., z. We assume routes never need >26 buckets;
     * if a 27th split is requested, throws.
     */
    public nextAvailableLetter(buckets: RouteSplitBucket[]): string {
      const used = new Set(buckets.map(b => b.letter));
      const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
      for (const ch of ALPHA) {
        if (!used.has(ch)) return ch;
      }
      throw new Error('Route already has 26 buckets — refusing to split further');
    }
  
    /**
     * Split an existing bucket. Atomically:
     *   1. If no split row exists yet, create one with bucket 'a' containing
     *      input.allBookingIds (the full list of pending bookings on this route).
     *   2. Compute the next available letter (b, c, d, ...).
     *   3. Append a new bucket entry: { letter, sourceLetter, rectangles,
     *      bookingIds: input.bookingsMovingToNew, assignedWorkers: [] }.
     *   4. Update the source bucket: remove input.bookingsMovingToNew from its
     *      bookingIds.
     *   5. Save the row.
     *
     * Returns the updated RouteSplit so the caller can read which letter was
     * assigned. Note: routes.assigned_worker_ids is NOT touched here — assigning
     * workers to the new bucket happens via updateRouteSplitAssignment, which
     * does the union math.
     *
     * The caller (RouteSplitModal at confirm time) is responsible for computing
     * input.bookingsMovingToNew correctly based on which prebookings in the source
     * bucket fall inside the new rectangles.
     */
    public async splitBucket(input: {
      routeCode: string;
      sourceLetter: string;
      rectangles: RouteSplitRectangle[];
      bookingsMovingToNew: string[];
      // Used only when no split row exists yet. The first split has to
      // initialize 'a' with all bookings; from that point on we ignore this.
      allBookingIdsOnRoute: string[];
    }): Promise<RouteSplit> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) throw new Error('No active session');
  
      // Read existing row (if any).
      let existing = await this.getRouteSplitForRoute(input.routeCode);
  
      // If no row exists, initialize with bucket 'a' containing all bookings.
      let buckets: RouteSplitBucket[];
      if (!existing) {
        if (input.sourceLetter !== 'a') {
          throw new Error(`Cannot split bucket '${input.sourceLetter}' — no split exists yet for ${input.routeCode}; the first split must source from 'a'`);
        }
        buckets = [{
          letter: 'a',
          sourceLetter: null,
          rectangles: [],
          bookingIds: [...input.allBookingIdsOnRoute],
          assignedWorkers: [],
        }];
      } else {
        buckets = existing.buckets.map(b => ({ ...b, rectangles: [...b.rectangles], bookingIds: [...b.bookingIds], assignedWorkers: [...b.assignedWorkers] }));
      }
  
      // Find the source bucket. If missing, the caller has a stale view.
      const source = buckets.find(b => b.letter === input.sourceLetter);
      if (!source) {
        throw new Error(`Cannot split bucket '${input.sourceLetter}' — bucket not found on route ${input.routeCode}`);
      }
      if (source.assignedWorkers.length > 0) {
        throw new Error(`Cannot split bucket '${input.sourceLetter}' — it has assigned workers`);
      }
  
      // Compute the new letter.
      const newLetter = this.nextAvailableLetter(buckets);
  
      // Move bookings from source → new bucket.
      const movingSet = new Set(input.bookingsMovingToNew);
      const newBucketBookingIds = source.bookingIds.filter(id => movingSet.has(id));
      source.bookingIds = source.bookingIds.filter(id => !movingSet.has(id));
  
      buckets.push({
        letter: newLetter,
        sourceLetter: input.sourceLetter,
        rectangles: input.rectangles,
        bookingIds: newBucketBookingIds,
        assignedWorkers: [],
        // Inherit the source bucket's owner so a carve doesn't re-home geometry.
        managerId: source.managerId,
      });
  
      // Upsert: if existing, update; else insert.
      if (existing) {
        const { data, error } = await supabase
          .from('route_splits')
          .update({ buckets, updated_at: new Date().toISOString() })
          .eq('command_center_id', ccId)
          .eq('session_date', date)
          .eq('route_code', input.routeCode)
          .select()
          .single();
        if (error) {
          console.error('[RouteSplit] splitBucket update failed:', error);
          throw error;
        }
        return this.mapDbRouteSplit(data);
      } else {
        const { data, error } = await supabase
          .from('route_splits')
          .insert({
            command_center_id: ccId,
            session_date: date,
            route_code: input.routeCode,
            buckets,
          })
          .select()
          .single();
        if (error) {
          console.error('[RouteSplit] splitBucket insert failed:', error);
          throw error;
        }
        return this.mapDbRouteSplit(data);
      }
    }
  
    /**
     * Delete the entire split row for a route. Removes all bucket info.
     * Does NOT touch routes.assigned_worker_ids or bookings — caller is
     * responsible for any cleanup. Primarily called from adminResetDailySession
     * (which wipes the whole table) but exposed in case admin tooling wants
     * per-route control.
     */
    public async deleteRouteSplit(routeCode: string): Promise<void> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return;
  
      const { error } = await supabase
        .from('route_splits')
        .delete()
        .eq('command_center_id', ccId)
        .eq('session_date', date)
        .eq('route_code', routeCode);
  
      if (error) {
        console.error('[RouteSplit] deleteRouteSplit failed:', error);
        throw error;
      }
    }
  
    /**
     * Assign workers to a specific bucket of a split route.
     *
     * Effects:
     *   1. Updates the target bucket's assignedWorkers field within the row's
     *      buckets array.
     *   2. Updates routes.assigned_worker_ids to the UNION across ALL buckets so
     *      that the existing booking-assignment code (assignBookingToWorker)
     *      continues to know "these workers are on this route".
     *   3. For each booking in this bucket (from bucket.bookingIds), writes
     *      contractor_id so the worker's logsheet only sees their bucket's
     *      prebooks. (Team seasons use session_id instead — the calling UI
     *      should use assignBookingsToSession for that flow.)
     *
     * Pass workerIds=[] to unassign that bucket.
     */
    public async updateRouteSplitAssignment(
      routeCode: string,
      letter: string,
      workerIds: string[],
      managerId?: string
    ): Promise<void> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) throw new Error('No active session');
  
      const existing = await this.getRouteSplitForRoute(routeCode);
      if (!existing) {
        throw new Error(`Cannot update split assignment: no split exists for route ${routeCode}`);
      }
  
      // Build new buckets array with this bucket's assignedWorkers updated.
      // When managerId is provided (floater cross-assignment), stamp bucket
      // ownership too so this bucket can belong to a different manager than
      // the rest of the route.
      const newBuckets = existing.buckets.map(b =>
        b.letter === letter
          ? { ...b, assignedWorkers: [...workerIds], ...(managerId !== undefined ? { managerId } : {}) }
          : b
      );
  
      // Verify the target bucket actually exists.
      if (!newBuckets.some(b => b.letter === letter)) {
        throw new Error(`Cannot update split assignment: bucket '${letter}' not found on route ${routeCode}`);
      }
  
      // 1) Save the row.
      const { error: splitErr } = await supabase
        .from('route_splits')
        .update({ buckets: newBuckets, updated_at: new Date().toISOString() })
        .eq('command_center_id', ccId)
        .eq('session_date', date)
        .eq('route_code', routeCode);
  
      if (splitErr) {
        console.error('[RouteSplit] updateRouteSplitAssignment (splits) failed:', splitErr);
        throw splitErr;
      }
  
      // 2) Compute UNION of all buckets' assignedWorkers, dedup, push to routes.
      const unionSet = new Set<string>();
      for (const b of newBuckets) for (const w of b.assignedWorkers) unionSet.add(w);
      const unionWorkers = Array.from(unionSet);
  
      // The union is still deliberately NOT written back — that was the "both
      // halves" write bleed. But we now CLEAR the route-level list explicitly
      // rather than merely leaving it alone. A split route is supposed to carry
      // an empty list (getDailySession folds the buckets back up in memory for
      // on-route detection), and the map's number-label click bug could stamp a
      // whole-route assignment onto one. Clearing here quietly repairs any route
      // already carrying that bad stamp, the next time a bucket is assigned.
      void unionWorkers;
      const { error: routeErr } = await supabase
        .from('routes')
        .update({ assigned_worker_ids: [] })
        .eq('route_code', routeCode)
        .eq('session_date', date)
        .eq('command_center_id', ccId);
  
      if (routeErr) {
        console.error('[RouteSplit] updateRouteSplitAssignment (routes union) failed:', routeErr);
        throw routeErr;
      }
  
      // 3) Per-booking reassignment for this bucket's bookings (aeration pattern).
      // The bucket.bookingIds is our cached membership list.
      const target = newBuckets.find(b => b.letter === letter)!;
      if (target.bookingIds.length > 0) {
        const newContractorId = workerIds.length > 0 ? workerIds[0] : null;
        const { error: bkErr } = await supabase
          .from('bookings')
          .update({ contractor_id: newContractorId })
          .in('booking_id', target.bookingIds)
          .eq('command_center_id', ccId);
  
        if (bkErr) {
          console.error('[RouteSplit] updateRouteSplitAssignment (bookings) failed:', bkErr);
          throw bkErr;
        }
      }
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
      
      const defaultProductCost = SEASON_CONFIGS[seasonType].defaultProductCostPercent;
      
      const meta = importMeta || (data as any)._importMeta || { 
        source: 'file', 
        sheetsExported: false,
        seasonType,
        productCostPercent: defaultProductCost
      };
      
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
            // Persist preview-staged floater config on Initialize Session.
            floatingFor: m.floatingFor || [],
            // Persist preview-staged per-manager digital mapping (if any).
            digitalMapping: m.digitalMapping || undefined,
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
            teamId: w.teamId,
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
        services: b.services,
      }));
  
      const { error: bookingError } = await supabase
        .from('bookings')
        .insert(bookingRows);
      if (bookingError) throw bookingError;
  
      if (isTeamSeason && data.teamCarts) {
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
  
      if (hasItems(data.historicalProperties)) {
        const rows = data.historicalProperties!.map((h) => ({
          command_center_id: ccId,
          session_date: data.date,
          route_code: h.routeCode,
          address: h.address,
          customer_name: h.customerName || null,
          phone: h.phone || null,
          email: h.email || null,
          client_type: h.clientType || null,
          property_type: h.propertyType || null,
          notes: h.notes || null,
          price: h.price || null,
          payment_type: h.paymentType || null,
          contractor_name: h.contractorName || null,
        }));
  
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error } = await supabase.from('route_historical_properties').insert(slice);
          if (error) {
            console.error('[HistoricalProps] Failed to insert chunk:', error);
            break;
          }
        }
        console.log(`[HistoricalProps] Inserted ${rows.length} historical properties`);
      }
  
      const cc = commandCenterService.getCurrentCommandCenter();
      // Sealing reads PCL from the MASTER BOOKINGS sheet (tabs ending "Callbooks").
      // Every other season reads from the dedicated callbook sheet (all tabs
      // except ccd/managers). Both paths require digital mapping to be on.
      const isSealing = seasonType === 'sealing';
      const pclSheetId = isSealing ? cc?.masterbookingsSheetId : cc?.callbookSheetId;
      if (cc?.digitalMappingEnabled && pclSheetId) {
        const sheetId = pclSheetId;
        const routeCodes = data.routes.map(r => r.routeCode);
        Promise.all([
          import('./googleSheetsService'),
          import('./pclCacheService'),
        ]).then(([{ googleSheetsService }, { loadAndCachePCL }]) => {
          const accessToken = googleSheetsService.getAccessToken();
          if (!accessToken) return;
          loadAndCachePCL(sheetId, routeCodes, accessToken, ccId, isSealing).catch(err =>
            console.warn('[PCL Cache] Non-blocking load failed:', err)
          );
        }).catch(err => console.warn('[PCL Cache] Module import failed:', err));
      }

      // --- PER-MANAGER DIGITAL MAPPING PCL (Sealing sessions on NON-mapping CCs) ---
      // Managers carrying users.metadata.digitalMapping get their PCLs loaded
      // via the prefix flow: read the masterbookings "…Callbooks" tabs, keep
      // rows whose route code equals the manager's BARE prefix (e.g. "WASA"),
      // geocode each address (bbox-constrained to the manager's routes), and
      // bucket into the numbered routes by nearest map segment. Non-blocking,
      // mirroring the CC-level block above. Skipped on CC-level mapping CCs —
      // the block above already covers those routes with numbered PCL codes.
      const mappedConfigs = data.managers.flatMap(m =>
        (m.digitalMapping && m.digitalMapping.routeCodes.length > 0) ? [m.digitalMapping] : []
      );
      if (!cc?.digitalMappingEnabled && isSealing && cc?.masterbookingsSheetId && mappedConfigs.length > 0) {
        const mbSheetId = cc.masterbookingsSheetId;
        Promise.all([
          import('./googleSheetsService'),
          import('./pclCacheService'),
        ]).then(([{ googleSheetsService }, { loadAndCachePCLByPrefix }]) => {
          const accessToken = googleSheetsService.getAccessToken();
          if (!accessToken) {
            console.warn('[PCL Prefix] No Google access token — per-manager PCL load skipped.');
            return;
          }
          mappedConfigs.forEach(cfg => {
            loadAndCachePCLByPrefix(mbSheetId, cfg, accessToken, ccId, data.date).catch(err =>
              console.warn(`[PCL Prefix] Non-blocking load failed for ${cfg.prefix}:`, err)
            );
          });
        }).catch(err => console.warn('[PCL Prefix] Module import failed:', err));
      }
    }
  
    public async adminResetDailySession(date: string): Promise<void> {
      const ccId = this.getCCId();
      
      await supabase.from('geocode_cache').delete().eq('command_center_id', ccId);
      await supabase.from('route_historical_properties').delete().eq('command_center_id', ccId);
      await supabase.from('pending_sales').delete().eq('command_center_id', ccId);
      // Wipe route splits — RM-side visual overlays only live for the day.
      await supabase.from('route_splits').delete().eq('command_center_id', ccId);
      
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
  
    // --- 3b. REASSIGN WORKER ---
  
    // Resolve the teamId a cart is keyed by, given any one of its members.
    // Workers imported without a teamId are keyed by their own contractor id —
    // the same fallback getDailySession uses when it assembles teamCarts.
    private async resolveTeamKey(anyMemberWorkerId: string): Promise<string> {
      const ccId = this.getCCId();
      const { data } = await supabase
        .from('users')
        .select('metadata')
        .eq('user_id', anyMemberWorkerId)
        .eq('command_center_id', ccId)
        .maybeSingle();
      return data?.metadata?.teamId || anyMemberWorkerId;
    }

    // Stamp a worker's teamId so teamCarts agrees with the session they
    // actually sit in. Without this, reassigning a pair into two solos left
    // both still keyed to the same teamId — so the app kept treating them as
    // one cart, and assigning a route to either one stamped BOTH onto it.
    private async setWorkerTeamKey(workerId: string, teamKey: string): Promise<void> {
      const ccId = this.getCCId();
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('metadata')
        .eq('user_id', workerId)
        .eq('command_center_id', ccId)
        .single();
      if (fetchError || !data) throw new Error('Worker not found');
      const { error } = await supabase
        .from('users')
        .update({ metadata: { ...data.metadata, teamId: teamKey } })
        .eq('user_id', workerId)
        .eq('command_center_id', ccId);
      if (error) throw error;
    }

    // Rewrite every route — and every split bucket — that belonged to a cart so
    // its worker list matches that cart's membership after a reassignment.
    // These lists are the ONLY source for the labels drawn on route cards and
    // on the map, which is why they went stale when a worker moved.
    //
    // `formerMembers` is the cart's membership BEFORE the move: a route whose
    // worker list touches any of them is one of that cart's routes.
    // `newOwners` is what the list becomes.
    // `newManagerId`, when set, re-homes the route to another manager — the
    // same thing transferWorker already does when a worker changes hands.
    private async rewriteCartRouteOwnership(
      date: string,
      formerMembers: string[],
      newOwners: string[],
      newManagerId: string | null,
    ): Promise<void> {
      const ccId = this.getCCId();
      const formerSet = new Set(formerMembers);

      const { data: routes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date)
        .eq('command_center_id', ccId);

      for (const route of routes || []) {
        const ids: string[] = route.assigned_worker_ids || [];
        if (!ids.some((id: string) => formerSet.has(id))) continue;
        const patch: Record<string, any> = { assigned_worker_ids: newOwners };
        if (newManagerId) patch.manager_id = newManagerId;
        const { error } = await supabase
          .from('routes')
          .update(patch)
          .eq('route_code', route.route_code)
          .eq('session_date', date)
          .eq('command_center_id', ccId);
        if (error) console.error('[Reassign] Failed to rewrite route ownership:', route.route_code, error);
      }

      // Carved routes hold their assignment at the BUCKET level, so the route
      // row above is deliberately empty for them and the buckets are the real
      // record. Miss these and a split route keeps a departed worker's name.
      const splits = await this.getRouteSplits();
      for (const split of splits) {
        let changed = false;
        const newBuckets = split.buckets.map(b => {
          const assigned = b.assignedWorkers || [];
          if (!assigned.some((id: string) => formerSet.has(id))) return b;
          changed = true;
          return { ...b, assignedWorkers: [...newOwners] };
        });
        if (!changed) continue;
        const { error } = await supabase
          .from('route_splits')
          .update({ buckets: newBuckets, updated_at: new Date().toISOString() })
          .eq('command_center_id', ccId)
          .eq('session_date', date)
          .eq('route_code', split.routeCode);
        if (error) console.error('[Reassign] Failed to rewrite split bucket ownership:', split.routeCode, error);
      }
    }

    public async reassignWorker(
      workerId: string,
      destination:
        | { type: 'existing_cart'; targetSessionId: string }
        | { type: 'new_solo' }
        | { type: 'different_manager'; targetManagerId: string }
    ): Promise<void> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) throw new Error('No active session');
  
      const currentSession = await this.getWorkerLogsheetSession(workerId);
      if (!currentSession) throw new Error('Worker has no active session');
  
      const currentTeamIds: string[] = hasItems(currentSession.teamWorkerIds)
        ? [...currentSession.teamWorkerIds]
        : [currentSession.workerId];
  
        const updatedCurrentTeam = currentTeamIds.filter(id => id !== workerId);
        // A solo departure empties the old cart — its session row is deleted
        // below, so its routes and its jobs have nowhere left to live and must
        // travel across with the worker.
        const oldCartEmptied = updatedCurrentTeam.length === 0;
  
      if (updatedCurrentTeam.length === 0) {
        await supabase
          .from('logsheet_sessions')
          .delete()
          .eq('id', currentSession.id)
          .eq('command_center_id', ccId);
      } else {
        const newEqualSplit = createEqualSplit(updatedCurrentTeam);
        await supabase
          .from('logsheet_sessions')
          .update({
            team_worker_ids: updatedCurrentTeam,
            worker_id: updatedCurrentTeam[0],
            equiv_split: newEqualSplit,
            upsell_split: newEqualSplit,
          })
          .eq('id', currentSession.id)
          .eq('command_center_id', ccId);
      }
  
      if (destination.type === 'existing_cart') {
        const { data: targetSessionData, error } = await supabase
          .from('logsheet_sessions')
          .select('*')
          .eq('id', destination.targetSessionId)
          .eq('command_center_id', ccId)
          .single();
  
        if (error || !targetSessionData) throw new Error('Target session not found');
  
        const existingTargetIds: string[] = hasItems(targetSessionData.team_worker_ids)
          ? targetSessionData.team_worker_ids
          : [targetSessionData.worker_id];
  
        if (!existingTargetIds.includes(workerId)) {
          const newTargetTeam = [...existingTargetIds, workerId];
          const newTargetSplit = createEqualSplit(newTargetTeam);
  
          await supabase
            .from('logsheet_sessions')
            .update({
              team_worker_ids: newTargetTeam,
              equiv_split: newTargetSplit,
              upsell_split: newTargetSplit,
            })
            .eq('id', destination.targetSessionId)
            .eq('command_center_id', ccId);
        }
  
      } else if (destination.type === 'new_solo') {
        const { error } = await supabase.from('logsheet_sessions').insert({
          id: `sess_${workerId}_${Date.now()}`,
          worker_id: workerId,
          team_worker_ids: [workerId],
          date,
          status: 'OPEN',
          stats: this.getEmptyStats(),
          email_enabled: true,
          command_center_id: ccId,
          equiv_split: { [workerId]: 100 },
          upsell_split: { [workerId]: 100 },
        });
        if (error) throw error;
  
      } else if (destination.type === 'different_manager') {
        const { data: user, error: fetchError } = await supabase
          .from('users')
          .select('metadata')
          .eq('user_id', workerId)
          .eq('command_center_id', ccId)
          .single();
  
        if (fetchError || !user) throw new Error('Worker not found');
  
        const { error: updateError } = await supabase
          .from('users')
          .update({ metadata: { ...user.metadata, assignedManagerId: destination.targetManagerId } })
          .eq('user_id', workerId)
          .eq('command_center_id', ccId);
        if (updateError) throw updateError;
  
        const { error: sessError } = await supabase.from('logsheet_sessions').insert({
          id: `sess_${workerId}_${Date.now()}`,
          worker_id: workerId,
          team_worker_ids: [workerId],
          date,
          status: 'OPEN',
          stats: this.getEmptyStats(),
          email_enabled: true,
          command_center_id: ccId,
          equiv_split: { [workerId]: 100 },
          upsell_split: { [workerId]: 100 },
        });
        if (sessError) throw sessError;
      }

      // --- KEEP THE THREE MIRRORS HONEST ---
      // Cart membership is now correct in logsheet_sessions, but three other
      // places still describe the old arrangement. Re-read the worker's session
      // so we're working from what actually landed in the database rather than
      // from what we think we just wrote, then repair each mirror in turn.
      const newSession = await this.getWorkerLogsheetSession(workerId);
      const destSessionId = newSession?.id || null;
      const destTeamIds: string[] = hasItems(newSession?.teamWorkerIds)
        ? [...newSession!.teamWorkerIds!]
        : [workerId];

      // MIRROR 1 — users.metadata.teamId. getDailySession turns this into
      // teamCarts, which feeds the contractor's "Your Team" list and the RM's
      // cart expansion at route-assignment time. Key the worker to whatever
      // their new cart-mates are keyed by; a solo is keyed to itself.
      const otherMember = destTeamIds.find(id => id !== workerId);
      const destTeamKey = otherMember ? await this.resolveTeamKey(otherMember) : workerId;
      await this.setWorkerTeamKey(workerId, destTeamKey);

      // MIRROR 2 — route and split-bucket worker lists, the source of every
      // route label. A route belongs to the CART, not the worker: whoever
      // remains keeps it. If the cart emptied out, the work travels with them.
      await this.rewriteCartRouteOwnership(
        date,
        currentTeamIds,
        oldCartEmptied ? destTeamIds : updatedCurrentTeam,
        oldCartEmptied && destination.type === 'different_manager'
          ? destination.targetManagerId
          : null,
      );

      // MIRROR 3 — bookings.session_id. Only a problem when the old session was
      // deleted: every job stamped with it now points at a row that no longer
      // exists, and the moved worker would open their dashboard to nothing.
      if (oldCartEmptied && destSessionId) {
        const { error: bkErr } = await supabase
          .from('bookings')
          .update({ session_id: destSessionId })
          .eq('session_id', currentSession.id)
          .eq('command_center_id', ccId);
        if (bkErr) console.error('[Reassign] Failed to repoint bookings to the new session:', bkErr);
      }
    }
  
    // --- 4. AUTHENTICATION ---
  
    public async authenticateRM(username: string, password: string): Promise<ManagementUser | null> {
      const { data } = await supabase
        .from('users')
        .select('*')
        .ilike('username', username)
        .ilike('password', password)
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
        // FLOATER: carry the floater config onto the logged-in user so the RM
        // logbook/map (floatedManagerIds, shouldWriteLocation) and the asphalt
        // modal's floater self-detect can read current_user.floatingFor. Without
        // this, a floater logs in with no floatingFor and sees only their own
        // staff/routes. Mirrors getDailySession's defensive Array.isArray mapping.
        floatingFor: Array.isArray(data.metadata?.floatingFor) ? data.metadata.floatingFor : [],
        // Per-manager digital mapping (Sealing, non-mapping CCs): stamped onto
        // current_user so the RM logbook check becomes "CC has mapping OR I do".
        digitalMapping: data.metadata?.digitalMapping || undefined,
      };
    }
  
    public async authenticateWorker(contractorId: string, password: string): Promise<Worker | null> {
      const { data } = await supabase
        .from('users')
        .select('*')
        .ilike('user_id', contractorId)
        .ilike('password', password)
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
  
    public async getWorkerAssignments(workerId: string): Promise<MasterBooking[]> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];
  
      const seasonType = await this.getSessionSeasonType();
      const isTeamSeason = seasonHasTeams(seasonType);
  
      let sessionId: string | null = null;
      if (isTeamSeason) {
        const session = await this.getWorkerLogsheetSession(workerId);
        sessionId = session?.id || null;
      }
  
      const { data: allRoutes } = await supabase
        .from('routes')
        .select('route_code, assigned_worker_ids')
        .eq('session_date', date)
        .eq('command_center_id', ccId);
      
        const myRouteCodes = (allRoutes || [])
        .filter(r => r.assigned_worker_ids && r.assigned_worker_ids.includes(workerId))
        .map(r => r.route_code);

      // Split-aware membership. For carved routes the worker's jobs are NOT
      // found via routes.assigned_worker_ids (left empty by design) — they're
      // the booking ids inside whichever bucket carries this worker. Build the
      // set of this worker's bucket booking ids, and the set of route codes that
      // are split at all, so the filters below route split bookings through
      // bucket membership ONLY (never the whole-route fallback, which would leak
      // the other half's bookings — the "both halves" bug, worker-side).
      const splitsForAssign = await this.getRouteSplits();
      const myBucketBookingIds = new Set<string>();
      const splitRouteCodes = new Set<string>();
      for (const s of splitsForAssign) {
        splitRouteCodes.add(s.routeCode);
        for (const b of s.buckets) {
          if ((b.assignedWorkers || []).includes(workerId)) {
            for (const bid of b.bookingIds) myBucketBookingIds.add(bid);
          }
        }
      }
  
      const { data: allBookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('session_date', date)
        .eq('command_center_id', ccId)
        .neq('status', 'completed');
  
      let myPending: any[];
      
      if (isTeamSeason && sessionId) {
        myPending = (allBookings || []).filter((b) => {
          // Split route → bucket membership is the ONLY truth for this worker.
          if (splitRouteCodes.has(b.route_number)) {
            return myBucketBookingIds.has(b.booking_id);
          }
          if (b.session_id === sessionId) return true;
          const isMyRoute = myRouteCodes.includes(b.route_number);
          const isUnassigned = !b.session_id && !b.contractor_id;
          return isMyRoute && isUnassigned;
        });
      } else {
        myPending = (allBookings || []).filter((b) => {
          // Split route → bucket membership is the ONLY truth for this worker.
          if (splitRouteCodes.has(b.route_number)) {
            return myBucketBookingIds.has(b.booking_id);
          }
          const isMyRoute = myRouteCodes.includes(b.route_number);
          const isAssignedToMe = b.contractor_id === workerId;
          const isAssignedToOther = b.contractor_id && b.contractor_id !== workerId;
          return (isMyRoute && !isAssignedToOther) || isAssignedToMe;
        });
      }
  
      let myTransactionsData: any[] | null = null;
  
      if (isTeamSeason && sessionId) {
        const { data: sessionTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('session_id', sessionId)
          .eq('command_center_id', ccId);
  
        if (sessionTx && sessionTx.length > 0) {
          myTransactionsData = sessionTx;
        } else {
          const session = await this.getWorkerLogsheetSession(workerId);
          const teamWorkerIds = hasItems(session?.teamWorkerIds) ? session!.teamWorkerIds! : [workerId];
          const { data: workerTx } = await supabase
            .from('transactions')
            .select('*')
            .in('worker_id', teamWorkerIds)
            .eq('command_center_id', ccId);
          myTransactionsData = workerTx;
        }
      } else {
        const { data: workerTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('worker_id', workerId)
          .eq('command_center_id', ccId);
        myTransactionsData = workerTx;
      }
  
      const myTransactions = myTransactionsData || [];
  
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
  
    public async getSessionAssignments(sessionId: string): Promise<MasterBooking[]> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];
  
      const { data: pendingBookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('session_date', date)
        .eq('command_center_id', ccId)
        .eq('session_id', sessionId)
        .neq('status', 'completed');
  
      const { data: sessionData } = await supabase
        .from('logsheet_sessions')
        .select('team_worker_ids, worker_id')
        .eq('id', sessionId)
        .eq('command_center_id', ccId)
        .maybeSingle();
  
      const teamWorkerIds = hasItems(sessionData?.team_worker_ids) 
        ? sessionData.team_worker_ids 
        : [sessionData?.worker_id].filter(Boolean);
  
      let transactions: any[] | null = null;
      const { data: sessionTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('session_id', sessionId)
        .eq('command_center_id', ccId);
  
      if (sessionTx && sessionTx.length > 0) {
        transactions = sessionTx;
      } else {
        const { data: workerTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('command_center_id', ccId)
          .in('worker_id', teamWorkerIds);
        transactions = workerTx;
      }
  
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
  
    public async getLogsheetSessions(): Promise<LogsheetSession[]> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];
      
      const seasonType = await this.getSessionSeasonType();
      const productCostPercent = await this.getProductCostPercent();
      const noTaxOnCash = await this.getSessionNoTaxOnCash();
      const taxRate = this.getCurrentTaxRate();
      const isTeamSeason = seasonHasTeams(seasonType);
      
      const [sessionsRes, transactionsRes] = await Promise.all([
        supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
        supabase.from('transactions').select('*').eq('command_center_id', ccId)
      ]);
      
      const sessions = sessionsRes.data || [];
      const allTransactions = (transactionsRes.data || []).map(tx => this.mapDbTransaction(tx));
      
      const transactionsBySessionId: Record<string, SessionTransaction[]> = {};
      const transactionsByWorker: Record<string, SessionTransaction[]> = {};
  
      allTransactions.forEach(tx => {
        const sid = (tx as any).sessionId;
        if (sid) {
          if (!transactionsBySessionId[sid]) transactionsBySessionId[sid] = [];
          transactionsBySessionId[sid].push(tx);
        }
        if (!transactionsByWorker[tx.workerId]) transactionsByWorker[tx.workerId] = [];
        transactionsByWorker[tx.workerId].push(tx);
      });
      
      return sessions.map((d) => {
        const sessionTx = isTeamSeason
          ? (transactionsBySessionId[d.id] || [])
          : [];
  
        let teamTransactions: SessionTransaction[];
        if (sessionTx.length > 0) {
          teamTransactions = sessionTx;
        } else {
          const teamWorkerIds = hasItems(d.team_worker_ids) ? d.team_worker_ids : [d.worker_id];
          teamTransactions = [];
          teamWorkerIds.forEach((wid: string) => {
            if (transactionsByWorker[wid]) {
              teamTransactions.push(...transactionsByWorker[wid]);
            }
          });
        }
  
        const liveStats = this.recalculateStats(teamTransactions, taxRate, seasonType, productCostPercent, noTaxOnCash);
  
        return {
          id: d.id,
          workerId: d.worker_id,
          date: d.date,
          status: d.status,
          stats: liveStats,
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
  
      const seasonType = await this.getSessionSeasonType();
      const noTaxOnCash = await this.getSessionNoTaxOnCash();
  
      let financialData: any[] | null = null;
  
      if (seasonHasTeams(seasonType) && sessionData.id) {
        const { data: sessionTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('session_id', sessionData.id)
          .eq('command_center_id', ccId);
  
        if (sessionTx && sessionTx.length > 0) {
          financialData = sessionTx;
        }
      }
  
      if (!financialData || financialData.length === 0) {
        const workerIds = hasItems(sessionData.team_worker_ids) 
          ? sessionData.team_worker_ids 
          : [sessionData.worker_id];
        
        const { data: workerTx } = await supabase
          .from('transactions')
          .select('*')
          .in('worker_id', workerIds)
          .eq('command_center_id', ccId);
        
        financialData = workerTx;
      }
      
      const cleanFinancials = (financialData || []).map(tx => this.mapDbTransaction(tx));
      
      const taxRate = this.getCurrentTaxRate();
      const productCostPercent = await this.getProductCostPercent();
      const liveStats = this.recalculateStats(cleanFinancials, taxRate, seasonType, productCostPercent, noTaxOnCash);
  
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
  
    public async addAdditionalSessionData(
      newData: DailySessionData
    ): Promise<{ managersAdded: number; workersAdded: number; routesAdded: number; bookingsAdded: number }> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) throw new Error('No active session found');
  
      const seasonType = await this.getSessionSeasonType();
      const isTeamSeason = seasonHasTeams(seasonType);
  
      const [existingUsersRes, existingRoutesRes, existingBookingsRes] = await Promise.all([
        supabase.from('users').select('user_id').eq('command_center_id', ccId),
        supabase.from('routes').select('route_code').eq('session_date', date).eq('command_center_id', ccId),
        supabase.from('bookings').select('route_number, customer_details').eq('session_date', date).eq('command_center_id', ccId),
      ]);
  
      const existingUserIds = new Set((existingUsersRes.data || []).map(u => u.user_id));
      const existingRouteCodes = new Set((existingRoutesRes.data || []).map(r => r.route_code));
      const existingBookingKeys = new Set(
        (existingBookingsRes.data || []).map(b => {
          const addr = (b.customer_details?.['Full Address'] || '').toLowerCase().trim();
          return `${b.route_number}::${addr}`;
        })
      );
  
      const newManagers = newData.managers.filter(m => !existingUserIds.has(m.userId));
      const newWorkers  = newData.workers.filter(w => !existingUserIds.has(w.contractorId));
      const newRoutes   = newData.routes.filter(r => !existingRouteCodes.has(r.routeCode));
      const newBookings = newData.pendingBookings.filter(b => {
        const addr = (b['Full Address'] || '').toLowerCase().trim();
        const key  = `${b['Route Number']}::${addr}`;
        return !existingBookingKeys.has(key);
      });
  
      if (newManagers.length > 0) {
        const managerRows = newManagers.map(m => ({
          user_id: m.userId,
          name: m.name,
          username: m.username,
          password: m.password,
          role: 'RouteManager',
          metadata: { phone: m.phone },
          command_center_id: ccId,
        }));
        const { error } = await supabase.from('users').upsert(managerRows, { onConflict: 'user_id' });
        if (error) throw error;
      }
  
      if (newWorkers.length > 0) {
        const workerRows = newWorkers.map(w => ({
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
            teamId: w.teamId,
          },
          command_center_id: ccId,
        }));
        const { error } = await supabase.from('users').upsert(workerRows, { onConflict: 'user_id' });
        if (error) throw error;
  
        if (isTeamSeason && newData.teamCarts) {
          const newWorkerIdSet = new Set(newWorkers.map(w => w.contractorId));
          const newCarts = newData.teamCarts.filter(cart =>
            cart.workerIds.some(id => newWorkerIdSet.has(id))
          );
          if (newCarts.length > 0) {
            const logsheetRows = newCarts.map(cart => {
              const primaryWorker = cart.workers[0];
              const equalSplit = createEqualSplit(cart.workerIds);
              return {
                id: `sess_${cart.teamId}_${Date.now()}`,
                worker_id: primaryWorker.contractorId,
                team_worker_ids: cart.workerIds,
                date,
                status: 'OPEN',
                stats: this.getEmptyStats(),
                email_enabled: true,
                command_center_id: ccId,
                equiv_split: equalSplit,
                upsell_split: equalSplit,
              };
            });
            const { error } = await supabase.from('logsheet_sessions').insert(logsheetRows);
            if (error) throw error;
          }
        } else {
          const logsheetRows = newWorkers.map(w => ({
            id: `sess_${w.contractorId}_${Date.now()}`,
            worker_id: w.contractorId,
            date,
            status: 'OPEN',
            stats: this.getEmptyStats(),
            email_enabled: true,
            command_center_id: ccId,
          }));
          const { error } = await supabase.from('logsheet_sessions').insert(logsheetRows);
          if (error) throw error;
        }
      }
  
      if (newRoutes.length > 0) {
        const routeRows = newRoutes.map(r => ({
          route_code: r.routeCode,
          manager_id: r.managerId,
          assigned_worker_ids: r.assignedWorkerIds || [],
          streets: r.streets,
          session_date: date,
          command_center_id: ccId,
        }));
        const { error } = await supabase.from('routes').insert(routeRows);
        if (error) throw error;
      }
  
      if (newBookings.length > 0) {
        const bookingRows = newBookings.map(b => ({
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
          session_date: date,
          data: b,
          command_center_id: ccId,
          services: b.services,
        }));
        const { error } = await supabase.from('bookings').insert(bookingRows);
        if (error) throw error;
      }
  
      return {
        managersAdded: newManagers.length,
        workersAdded:  newWorkers.length,
        routesAdded:   newRoutes.length,
        bookingsAdded: newBookings.length,
      };
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
  
    public async assignRouteToWorker(routeCode: string, workerId: string | null): Promise<void> {
      const newAssignedWorkerIds = workerId ? [workerId] : [];
      await this.assignRouteToWorkers(routeCode, newAssignedWorkerIds);
    }
  
    // --- DROPPED MAP PINS ---
    // Shared across the command centre for the current session date. Failures
    // are logged and swallowed on read (an unreachable pin table should never
    // take the map down) but thrown on write, so the UI can tell the RM their
    // pin didn't save rather than pretending it did.

    private mapDbMapPin(row: any): MapPin {
      return {
        id: row.id,
        label: row.label,
        lat: Number(row.lat),
        lng: Number(row.lng),
        createdBy: row.created_by ?? null,
        createdAt: row.created_at,
      };
    }

    public async getMapPins(): Promise<MapPin[]> {
      try {
        const ccId = this.getCCId();
        const date = await this.getDailySessionDate();
        if (!date) return [];

        const { data, error } = await supabase
          .from('map_pins')
          .select('*')
          .eq('command_center_id', ccId)
          .eq('session_date', date)
          .order('created_at', { ascending: true });

        if (error) {
          console.warn('[MapPins] getMapPins failed:', error);
          return [];
        }
        return (data || []).map((r: any) => this.mapDbMapPin(r));
      } catch (err) {
        console.warn('[MapPins] getMapPins error:', err);
        return [];
      }
    }

    public async createMapPin(
      label: string,
      lat: number,
      lng: number,
      createdBy: string,
    ): Promise<MapPin | null> {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) throw new Error('No active session');

      const row = {
        id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        command_center_id: ccId,
        session_date: date,
        label,
        lat,
        lng,
        created_by: createdBy,
      };

      const { data, error } = await supabase
        .from('map_pins')
        .insert(row)
        .select()
        .single();

      if (error) {
        console.error('[MapPins] createMapPin failed:', error);
        throw error;
      }
      return data ? this.mapDbMapPin(data) : null;
    }

    public async deleteMapPin(pinId: string): Promise<void> {
      const ccId = this.getCCId();
      const { error } = await supabase
        .from('map_pins')
        .delete()
        .eq('id', pinId)
        .eq('command_center_id', ccId);

      if (error) {
        console.error('[MapPins] deleteMapPin failed:', error);
        throw error;
      }
    }

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
  
    public async updateBookingNotes(bookingId: string, notes: string): Promise<void> {
      const ccId = this.getCCId();
      const { error } = await supabase
        .from('bookings')
        .update({ log_notes: notes })
        .eq('booking_id', bookingId)
        .eq('command_center_id', ccId);
      
      if (error) {
        console.error("Error updating booking notes:", error);
        throw error;
      }
    }
  
    public async updateBookingRoute(bookingId: string, newRouteCode: string): Promise<void> {
      const ccId = this.getCCId();
      const { error } = await supabase
        .from('bookings')
        .update({ route_number: newRouteCode })
        .eq('booking_id', bookingId)
        .eq('command_center_id', ccId);
  
      if (error) {
        console.error("Error updating booking route:", error);
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
  
    /**
     * Complete a job — writes a transaction row and (if applicable) cleans up the
     * source pending sale.
     *
     * `asphaltContext`:
     *   When set, the job has an asphalt component. completeJob branches into
     *   completeAsphaltJob, which switches on ctx.mode and handles 1 or 2
     *   transactions plus any pending_sales bookkeeping. See the
     *   AsphaltCompletionContext discriminated union at the top of this file for
     *   the four modes (completer-with-phantom, self-both, driveway-deferred,
     *   asphalt-executor-only).
     *
     *   When omitted (the normal case), behaviour is unchanged from pre-asphalt code.
     */
    public async completeJob(
      transaction: SessionTransaction, 
      jobId: string, 
      workerId: string,
      teamWorkerIds?: string[],
      pendingSaleId?: string,
      asphaltContext?: AsphaltCompletionContext
    ): Promise<void> {
      // Asphalt completion is a different flow — branch immediately.
      if (asphaltContext) {
        return this.completeAsphaltJob(transaction, jobId, workerId, teamWorkerIds, asphaltContext);
      }
  
      const ccId = this.getCCId();
  
      let currentSessionId: string | undefined;
      try {
        const workerSession = await this.getWorkerLogsheetSession(workerId);
        currentSessionId = workerSession?.id;
      } catch (e) {
        console.warn('Could not fetch session_id for transaction stamp:', e);
      }
      
      const payload = {
        job_id: jobId, 
        worker_id: workerId,
        session_id: currentSessionId,
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
  
      if (pendingSaleId) {
        this.deletePendingSale(pendingSaleId).catch(err => {
          console.warn('[PendingSale] cleanup after completeJob failed:', err);
        });
      }
  
      await this.recalculateAndSaveWorkerStats(workerId);
  
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
          commandCenterId: ccId,
          type: transaction.type,
          refId: transaction.refId,
          isPrepaid: transaction.isPrepaid,
        }).catch(err => {
          console.error('Email send failed (non-blocking):', err);
        });
      }
    }
  
    // --- 6b. ASPHALT COMPLETION (Sealing season only) ---
    //
    // Dispatcher for the four AsphaltCompletionContext modes. Each branch writes
    // the right transactions, reconciles pending_sales rows, and recalcs stats.
    //
    // Shared steps (all modes):
    //   - Resolve completer's session for transaction stamping.
    //   - Calculate split via calculateAsphaltSplit(driveway, asphalt, upsold).
    //   - Build completer's customer_snapshot from transaction fields.
    //   - Upsert completer's transaction (insert new or update existing by id).
    //   - Mark booking completed (if jobId is a real booking, not 'NEW-').
    //   - Send receipt email (from completer's tx — has the cash and the customer email).
    //
    // Mode-specific:
    //   completer-with-phantom → also writes the partner's phantom tx; deletes BOTH
    //     pending rows; recalcs BOTH carts.
    //   self-both              → no phantom; deletes any provided pending rows;
    //     recalcs only completer.
    //   driveway-deferred      → no phantom; CREATES an asphalt child pending_sale
    //     atomically; no pending rows to delete; recalcs only completer.
    //   asphalt-executor-only  → no phantom; deletes the asphalt child pending_sale;
    //     recalcs only completer (cart's stats are correctly locked from earlier).
    private async completeAsphaltJob(
      transaction: SessionTransaction,
      jobId: string,
      workerId: string,
      teamWorkerIds: string[] | undefined,
      ctx: AsphaltCompletionContext
    ): Promise<void> {
      const ccId = this.getCCId();
  
      // Resolve completer's session for transaction stamping. All four modes need this.
      let completerSessionId: string | undefined;
      try {
        const completerSession = await this.getWorkerLogsheetSession(workerId);
        completerSessionId = completerSession?.id;
      } catch (e) {
        console.warn('[AsphaltComplete] Could not fetch completer session_id:', e);
      }
      if (!completerSessionId) {
        throw new Error('Asphalt completion requires an active completer session');
      }
  
      // --- COMMON: split calculation ---
      const split = calculateAsphaltSplit(ctx.drivewayAmount, ctx.asphaltAmount, ctx.upsoldAmount);
      const didUpsell = (ctx.upsoldAmount || 0) > 0;
  
      // --- MODE-DRIVEN: completer's payout share, partner role/share, sharedJobKey, partner_session_id ---
      // partnerRole !== null implies a phantom tx will be written (completer-with-phantom only).
      let completerShare: number;
      let partnerShare: number;
      let partnerRole: AsphaltRole | null;
      let sharedJobKey: string;
      let partnerSessionIdForMeta: string | null;
  
      if (ctx.mode === 'completer-with-phantom') {
        if (ctx.completerRole === 'driveway-seller') {
          completerShare = split.cartShare;
          partnerShare = split.rcShare;
          partnerRole = 'asphalt-executor';
        } else {
          // completerRole === 'asphalt-executor'
          completerShare = split.rcShare;
          partnerShare = split.cartShare;
          partnerRole = 'driveway-seller';
        }
        sharedJobKey = this.generateSharedJobKey();
        partnerSessionIdForMeta = ctx.partner.sessionId;
      } else if (ctx.mode === 'self-both') {
        completerShare = split.total;
        partnerShare = 0;
        partnerRole = null;
        sharedJobKey = this.generateSharedJobKey();
        partnerSessionIdForMeta = null;
      } else if (ctx.mode === 'driveway-deferred') {
        // Defensive: must have a positive asphalt amount, or this mode is meaningless.
        if (!(ctx.asphaltAmount > 0)) {
          throw new Error('driveway-deferred mode requires asphaltAmount > 0');
        }
        completerShare = split.cartShare;
        partnerShare = 0;
        partnerRole = null;
        sharedJobKey = this.generateSharedJobKey();
        // RC isn't assigned yet (or only auto-assigned to self for an RC voluntarily
        // deferring). partner_session_id on meta stays null — export pairs via sharedJobKey,
        // not session id, so this is fine.
        partnerSessionIdForMeta = null;
      } else if (ctx.mode === 'asphalt-executor-only') {
        completerShare = split.rcShare;
        partnerShare = 0;
        partnerRole = null;
        // Inherit the key from the cart's already-written tx (was stamped on the
        // asphalt child pending_sale at cart's completion time).
        sharedJobKey = ctx.existingParentSharedJobKey;
        // Look up the asphalt child's session_id (the cart's session) for the meta.
        // Best-effort — if the row is gone (e.g., already completed), proceed with null.
        try {
          const childRow = await this.getPendingSaleById(ctx.childSaleId);
          partnerSessionIdForMeta = childRow?.sessionId || null;
        } catch (e) {
          console.warn('[AsphaltComplete] Could not look up asphalt child for partner_session_id:', e);
          partnerSessionIdForMeta = null;
        }
      } else {
        // Exhaustiveness check — TypeScript should catch unhandled modes at compile time.
        const _exhaustive: never = ctx;
        throw new Error('Unhandled asphalt completion mode');
      }
  
      // --- COMMON: build completer's asphalt_meta ---
      const completerMeta: AsphaltMeta = {
        sharedJobKey,
        role: ctx.completerRole,
        driveway_amount: ctx.drivewayAmount,
        asphalt_amount: ctx.asphaltAmount,
        upsold_asphalt_amount: ctx.upsoldAmount,
        is_partner_phantom: false,
        partner_session_id: partnerSessionIdForMeta,
        did_upsell: didUpsell,
      };
  
      const completerPayload: any = {
        job_id: jobId,
        worker_id: workerId,
        session_id: completerSessionId,
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
          serviceName: transaction.serviceName,
        },
        command_center_id: ccId,
        payout_share: completerShare,
        asphalt_meta: completerMeta,
      };
  
      // Upsert completer's transaction. Match by id (the form-provided one) so
      // re-completions update rather than duplicate.
      const { data: existingCompleter } = await supabase
        .from('transactions')
        .select('id')
        .eq('id', transaction.id)
        .eq('command_center_id', ccId)
        .maybeSingle();
  
      if (existingCompleter) {
        const { error } = await supabase
          .from('transactions')
          .update(completerPayload)
          .eq('id', transaction.id)
          .eq('command_center_id', ccId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('transactions')
          .insert({ ...completerPayload, id: transaction.id });
        if (error) throw error;
      }
  
      // --- MODE: completer-with-phantom — write partner's phantom transaction ---
      if (ctx.mode === 'completer-with-phantom' && partnerRole) {
        const partnerMeta: AsphaltMeta = {
          sharedJobKey,
          role: partnerRole,
          driveway_amount: ctx.drivewayAmount,
          asphalt_amount: ctx.asphaltAmount,
          upsold_asphalt_amount: ctx.upsoldAmount,
          is_partner_phantom: true,
          partner_session_id: completerSessionId,
          did_upsell: didUpsell,
        };
  
        // Phantom uses a stable derived id so re-completions update rather than dupe.
        const phantomTxId = `${transaction.id}_partner`;
        const phantomJobId = `${jobId}__asphalt_partner_${partnerRole === 'asphalt-executor' ? 'rc' : 'cart'}`;
  
        const partnerPayload: any = {
          job_id: phantomJobId,
          worker_id: ctx.partner.workerId,
          session_id: ctx.partner.sessionId,
          timestamp: transaction.timestamp,
          type: transaction.type,
          // tx.price set to share so the phantom shows a meaningful number on the
          // partner's logsheet; cash bucket math reads from payment_breakdown ({})
          // so this contributes $0 to actual cash counts.
          price: partnerShare,
          payment_method: 'Asphalt Share',
          payment_breakdown: {},
          is_west_split: false,
          display_price: `$${partnerShare.toFixed(2)}`,
          item_description: partnerRole === 'driveway-seller' ? 'Driveway (asphalt share)' : 'Asphalt (share)',
          invoice_number: null,
          cheque_number: null,
          etransfer_email: null,
          customer_phone: transaction.customerPhone,
          customer_email: null,
          items: transaction.items,
          services: transaction.services,
          completed_by_worker_ids: ctx.partner.teamWorkerIds,
          ref_id: transaction.refId,
          cc_full_number: null,
          cc_expiry: null,
          cc_cvc: null,
          customer_snapshot: {
            firstName: transaction.customerName ? transaction.customerName.split(' ')[0] : 'Unknown',
            lastName: transaction.customerName ? transaction.customerName.split(' ').slice(1).join(' ') : '',
            address: transaction.address,
            routeCode: transaction.routeCode,
            serviceType: transaction.serviceType,
            serviceName: partnerRole === 'driveway-seller' ? 'Driveway' : 'Asphalt',
          },
          command_center_id: ccId,
          payout_share: partnerShare,
          asphalt_meta: partnerMeta,
        };
  
        const { data: existingPhantom } = await supabase
          .from('transactions')
          .select('id')
          .eq('id', phantomTxId)
          .eq('command_center_id', ccId)
          .maybeSingle();
  
        if (existingPhantom) {
          const { error } = await supabase
            .from('transactions')
            .update(partnerPayload)
            .eq('id', phantomTxId)
            .eq('command_center_id', ccId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('transactions')
            .insert({ ...partnerPayload, id: phantomTxId });
          if (error) throw error;
        }
      }
  
      // --- MODE: driveway-deferred — create the asphalt child pending_sale row ---
      // sharedJobKey on the child is what RC's later asphalt-executor-only completion
      // will pass back as ctx.existingParentSharedJobKey to link the two real txs.
      if (ctx.mode === 'driveway-deferred') {
        try {
          await this.createDeferredAsphaltChild({
            sharedJobKey,
            sessionId: ctx.childPending.sessionId,
            workerId: ctx.childPending.workerId,
            routeCode: ctx.childPending.routeCode,
            houseNumber: ctx.childPending.houseNumber,
            streetName: ctx.childPending.streetName,
            propertyType: ctx.childPending.propertyType,
            notes: ctx.childPending.notes,
            asphaltAmount: ctx.asphaltAmount,
            upsoldAsphaltAmount: ctx.upsoldAmount > 0 ? ctx.upsoldAmount : undefined,
            assignedRcSessionId: ctx.childPending.autoAssignToRcSessionId,
          });
        } catch (err) {
          // The cart's tx is already written at this point. Rolling it back is
          // complex (would need to delete the just-inserted tx and re-throw). Instead,
          // log loudly so the RM can see the orphan and create the asphalt child
          // manually via QuickPending if needed.
          console.error(
            '[AsphaltComplete] CRITICAL: driveway-deferred tx written but child pending creation FAILED.',
            'Cart tx id:', transaction.id, 'sharedJobKey:', sharedJobKey, 'Error:', err
          );
          throw err;
        }
      }
  
      // --- COMMON: Mark booking completed (real bookings only) ---
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
  
      // --- MODE-DRIVEN: pending_sales cleanup ---
      // completer-with-phantom + self-both: delete parent and child rows when present.
      // asphalt-executor-only: delete the child row (cart's tx already consumed any parent).
      // driveway-deferred: nothing to delete (we just CREATED a child instead).
      const pendingIdsToDelete: string[] = [];
      if (ctx.mode === 'completer-with-phantom') {
        if (ctx.parentSaleId) pendingIdsToDelete.push(ctx.parentSaleId);
        if (ctx.childSaleId) pendingIdsToDelete.push(ctx.childSaleId);
      } else if (ctx.mode === 'self-both') {
        if (ctx.parentSaleId) pendingIdsToDelete.push(ctx.parentSaleId);
        if (ctx.childSaleId) pendingIdsToDelete.push(ctx.childSaleId);
      } else if (ctx.mode === 'asphalt-executor-only') {
        pendingIdsToDelete.push(ctx.childSaleId);
      }
      // driveway-deferred: no cleanup needed.
  
      if (pendingIdsToDelete.length > 0) {
        const { error } = await supabase
          .from('pending_sales')
          .delete()
          .in('id', pendingIdsToDelete)
          .eq('command_center_id', ccId);
        if (error) {
          console.warn('[AsphaltComplete] pending_sales cleanup failed:', error);
        }
      }
  
      // --- MODE-DRIVEN: recalculate stats ---
      // Always recalc the completer. Only recalc partner in completer-with-phantom.
      //   self-both              → no partner to recalc.
      //   driveway-deferred      → RC's tx doesn't exist yet; nothing to recalc on partner side.
      //   asphalt-executor-only  → cart's tx already exists and its payoutShare-vs-cash
      //                            delta was locked at the cart's earlier completion.
      //                            Cart's stats are still correct without re-running.
      await this.recalculateAndSaveWorkerStats(workerId);
      if (ctx.mode === 'completer-with-phantom') {
        await this.recalculateAndSaveWorkerStats(ctx.partner.workerId);
      }
  
      // --- COMMON: Receipt email (only from collecting cart, since the partner's row is phantom) ---
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
          commandCenterId: ccId,
          type: transaction.type,
          refId: transaction.refId,
          isPrepaid: transaction.isPrepaid,
        }).catch(err => {
          console.error('Email send failed (non-blocking):', err);
        });
      }
    }
  
  /**
   * Create an asphalt child pending_sale row as part of a driveway-deferred
   * completion. Distinct from createPendingSale's 3-way orchestrator because:
   *   - parent_id is null (parent is a completed tx, not a pending row)
   *   - shared_job_key is set (links to the cart's just-written driveway tx)
   *   - no auto-RC-detection (the caller specifies assignedRcSessionId explicitly,
   *     or leaves it null/undefined for RM assignment)
   *
   * Called only from inside completeAsphaltJob's driveway-deferred branch.
   * The row is visible to:
   *   - The selling cart (via session_id match in their pending list)
   *   - The RM (via getUnassignedAsphaltForManager filter)
   *   - The assigned RC (via getAsphaltAssignmentsForSession) once assigned.
   */
  private async createDeferredAsphaltChild(input: {
    sharedJobKey: string;
    sessionId: string;            // the SELLING cart's session id (origin of the sale)
    workerId: string;             // the cart worker who completed the driveway
    routeCode?: string;
    houseNumber?: string;
    streetName?: string;
    propertyType?: string;
    notes?: string;
    asphaltAmount: number;
    upsoldAsphaltAmount?: number;
    assignedRcSessionId?: string;
  }): Promise<PendingSale> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const id = `pend_${input.workerId}_asphalt_deferred_${Date.now()}`;
    const row = {
      id,
      session_id: input.sessionId,
      worker_id: input.workerId,
      command_center_id: ccId,
      session_date: date,
      route_code: input.routeCode || null,
      house_number: input.houseNumber || null,
      street_name: input.streetName || null,
      // Mirror the asphalt amount into price for display consistency on lists
      // that sort/filter by price.
      price: String(input.asphaltAmount),
      property_type: input.propertyType || null,
      services: null,             // service flags don't apply to the asphalt portion
      notes: input.notes || null,
      sale_type: 'asphalt',
      parent_id: null,            // No pending parent — parent is a completed transaction
      assigned_rc_session_id: input.assignedRcSessionId || null,
      asphalt_amount: input.asphaltAmount,
      upsold_asphalt_amount: input.upsoldAsphaltAmount ?? null,
      shared_job_key: input.sharedJobKey,
    };

    const { data, error } = await supabase
      .from('pending_sales')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('[Asphalt] createDeferredAsphaltChild failed:', error);
      throw error;
    }
    return this.mapDbPendingSale(data);
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
        console.log('Email sending disabled for this session');
        return false;
      }

      const { data, error } = await supabase.functions.invoke('bright-processor', {
        body: transactionData
      });

      if (error) {
        console.error('Email send error:', error);
        return false;
      }

      console.log('Email sent successfully:', data);
      return true;
    } catch (err) {
      console.error('Email send failed:', err);
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
   * Recompute aggregate stats from the transaction list.
   *
   * ASPHALT BEHAVIOUR (when any tx has tx.asphaltMeta set):
   *   1. Cash buckets (prodCash, prodCheque, ...) are filled from tx.paymentBreakdown
   *      as usual. The collecting cart sees the full collected $ for RM validation;
   *      the phantom row has an empty breakdown so contributes $0 to buckets.
   *   2. Step counting branches on tx.asphaltMeta.role + .did_upsell rather than
   *      using the default tx.type rule.
   *   3. After the normal prodGross/taxableWeighted formulas, an ASPHALT ADJUSTMENT
   *      is applied: per asphalt tx, (payoutShare − sum(payment_breakdown)) is added
   *      to BOTH prodGross and taxableWeighted at 1.0 weight (pre-tax-divisor).
   *      For the collecting cart this is a negative number (their share < cash held).
   *      For the phantom this is a positive number (share > $0 collected).
   *      Net across both carts is 0 — the split moves dollars between cards, not
   *      out of the day's books.
   *
   *      For Path 3 (driveway-deferred + asphalt-executor-only): the same adjustment
   *      logic applies — cart's tx has negative delta (cash collected > earned share),
   *      RC's tx (later) has positive delta. Net across both sessions stays 0 once
   *      both txs exist. In the window between cart's completion and RC's, cart's
   *      stats correctly reflect cart's earned $; the +0.70Y "due to RC" is captured
   *      on RC's books at their completion time.
   *
   * LIMITATION: the adjustment is applied PRE-divisor at 1.0 weight regardless of
   * noTaxOnCash. In practice asphalt is always cash and Sealing defaults noTaxOnCash
   * to false, so this is correct. If noTaxOnCash is turned ON for a sealing session
   * AND asphalt jobs are present, the EQ math will be off by ~taxRate% on the asphalt
   * portion. Documented here so it's not a surprise in production.
   */
  public recalculateStats(
    financials: SessionTransaction[], 
    taxRate: number = 5,
    seasonType: SeasonType = 'aeration',
    productCostPercent: number = 0,
    noTaxOnCash: boolean = false
  ): SessionStats {
    const stats = this.getEmptyStats();
    const taxDivisor = 1 + taxRate / 100;
    const config = getSeasonConfig(seasonType);
    
    const flatCodes = config.officeFlats.map(f => f.code);

    financials.forEach((tx) => {
      // --- STEP COUNTING (asphalt-aware) ---
      if (tx.asphaltMeta) {
        const meta = tx.asphaltMeta;
        if (meta.role === 'driveway-seller') {
          stats.stepCount += 1;
        } else if (meta.role === 'asphalt-executor') {
          if (meta.did_upsell) stats.stepCount += 1;
        } else if (meta.role === 'self-both') {
          if ((meta.driveway_amount || 0) > 0) stats.stepCount += 1;
          if ((meta.asphalt_amount || 0) > 0) stats.stepCount += 1;
        }
      } else if (['Production', 'Sale', 'Upgrade'].includes(tx.type)) {
        stats.stepCount++;
      }

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
    
    const prepaidWeight = config.prepaidWeight;
    const billedWeight = config.billedWeight;
    
    let taxableWeighted = 
        (stats.prodPrepaid * prepaidWeight) + 
        (stats.prodBilled * billedWeight) + 
        (noTaxOnCash ? 0 : stats.prodCash) +
        stats.prodCheque + 
        stats.prodETransfer + 
        stats.prodCreditCard + 
        stats.prodFlats + 
        stats.prodPrepaidSplit;

    // --- ASPHALT ADJUSTMENT ---
    let asphaltAdjustment = 0;
    financials.forEach((tx) => {
      if (tx.payoutShare == null) return;
      const breakdown = tx.paymentBreakdown || { [tx.paymentMethod]: tx.price };
      let breakdownTotal = 0;
      Object.entries(breakdown).forEach(([method, amount]) => {
        if (method === 'IOS') return;
        breakdownTotal += Number(amount) || 0;
      });
      asphaltAdjustment += (tx.payoutShare - breakdownTotal);
    });

    if (asphaltAdjustment !== 0) {
      stats.prodGross += asphaltAdjustment;
      taxableWeighted += asphaltAdjustment;
    }

    const afterTax = taxableWeighted / taxDivisor;
    const totalAfterTax = noTaxOnCash ? afterTax + stats.prodCash : afterTax;

    const flatsAfterTax = stats.prodFlats / taxDivisor;
    const nonFlatsAfterTax = totalAfterTax - flatsAfterTax;
    const productCostMultiplier = 1 - (productCostPercent / 100);
    stats.prodPayable = (nonFlatsAfterTax * productCostMultiplier) + flatsAfterTax;
    
    stats.totalEQ = stats.prodPayable / EQ_DIVISOR;
    
    stats.upsellGross = stats.upsellBilled + stats.upsellCash + stats.upsellCheque + 
                        stats.upsellETransfer + stats.upsellCreditCard + stats.upsellPrepaid;

    if (noTaxOnCash && stats.upsellCash > 0) {
      const upsellNonCash = stats.upsellGross - stats.upsellCash;
      stats.upsellPayable = (upsellNonCash / taxDivisor) + stats.upsellCash;
    } else {
      stats.upsellPayable = stats.upsellGross / taxDivisor;
    }

    return stats;
  }

  // --- 9. TEAM PAYOUT CALCULATIONS ---

  public calculateTeamPayouts(
    session: LogsheetSession,
    workers: Worker[],
    seasonType: SeasonType
  ): WorkerPayoutBreakdown[] {
    const stats = session.stats;
    const validation = session.validation;
    const teamWorkerIds = session.teamWorkerIds || [session.workerId];
    const teamSize = teamWorkerIds.length;
    
    const equivSplit = session.equivSplit || createEqualSplit(teamWorkerIds);
    const upsellSplit = session.upsellSplit || equivSplit;
    
    const basePayoutRate = getPayoutRate(seasonType, teamSize);
    
    const teamTotalEQ = (validation?.isValidated && typeof validation.actualTotalEQ === 'number')
      ? validation.actualTotalEQ
      : stats.totalEQ;
    
    const breakdowns: WorkerPayoutBreakdown[] = [];
    
    const workerMap = new Map(workers.map(w => [w.contractorId, w]));
    
    for (const workerId of teamWorkerIds) {
      const worker = workerMap.get(workerId);
      if (!worker) continue;
      
      const equivPercent = (equivSplit[workerId] || 0) / 100;
      const upsellPercent = (upsellSplit[workerId] || 0) / 100;
      
      const assignedEQ = teamTotalEQ * equivPercent;
      
      const alumniRate = worker.alumniRate || 0;
      const silverRate = worker.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      
      const baseCommission = assignedEQ * basePayoutRate;
      const alumniBonus = assignedEQ * alumniRate;
      const silverBonus = assignedEQ * silverRate;
      const productionCommission = baseCommission + alumniBonus + silverBonus;
      
      const upsellCommission = (stats.upsellPayable || 0) * upsellPercent * 0.10;
      
      const iosCommission = (stats.iosCount || 0) * 5 * upsellPercent;
      
      let bonusAmount = 0;
      if (session.bonuses) {
        for (const bonus of session.bonuses) {
          const bonusSplit = bonus.splitPercentages?.[workerId] ?? (equivPercent * 100);
          bonusAmount += bonus.amount * (bonusSplit / 100);
        }
      }
      
      const cashChequeDiff = validation 
        ? (Math.abs(validation.cashDiff || 0) + Math.abs(validation.chequeDiff || 0)) * equivPercent
        : 0;
      
      let hasMachineRental: boolean;
      if (validation?.workerMachineRentals?.[workerId] !== undefined) {
        hasMachineRental = validation.workerMachineRentals[workerId];
      } else if (validation?.machineRental !== undefined) {
        hasMachineRental = validation.machineRental;
      } else {
        hasMachineRental = true;
      }
      const machineRentalDeduction = hasMachineRental ? 10 : 0;
      
      const otherDeductions = validation?.workerDeductions?.[workerId] || 0;
      
      const deductions = otherDeductions;
      
      const finalCommission = productionCommission + upsellCommission + iosCommission + 
                             bonusAmount - machineRentalDeduction - deductions;
      
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

  // --- 10. PENDING SALES (Team seasons only — Rejuv + Sealing) ---
  // Pending sales are worker-initiated, half-collected sales parked in the
  // pending_sales table. They live and die inside the app — NEVER exported.
  // Visibility is session-scoped: every worker in the same cart sees them,
  // and the RM sees the ones for carts under their management.
  //
  // ASPHALT EXTENSIONS (Sealing only):
  //   - createPendingSale orchestrates parent+child writes when input.asphaltAmount > 0.
  //   - assignAsphaltToRcSession / unassignAsphalt mutate child rows from the RM modal.
  //   - getUnassignedAsphaltForManager drives the RMLogbook asphalt button + modal.
  //   - getAsphaltChildrenForParent / getAsphaltAssignmentsForSession power merged-card
  //     displays on the worker dashboard and the RC's logsheet.
  //   - shared_job_key (Path 3): set on deferred children created by completeAsphaltJob's
  //     driveway-deferred branch. Linked to the cart's already-completed driveway tx
  //     via asphalt_meta.sharedJobKey on that tx.

  private mapDbPendingSale(row: any): PendingSale {
    return {
      id: row.id,
      sessionId: row.session_id,
      workerId: row.worker_id,
      commandCenterId: row.command_center_id,
      sessionDate: row.session_date,
      routeCode: row.route_code || undefined,
      houseNumber: row.house_number || undefined,
      streetName: row.street_name || undefined,
      price: row.price || undefined,
      propertyType: row.property_type || undefined,
      services: row.services || undefined,
      notes: row.notes || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // --- ASPHALT FIELDS ---
      saleType: row.sale_type || undefined,
      parentId: row.parent_id || undefined,
      assignedRcSessionId: row.assigned_rc_session_id || undefined,
      asphaltAmount: row.asphalt_amount != null ? Number(row.asphalt_amount) : undefined,
      upsoldAsphaltAmount: row.upsold_asphalt_amount != null ? Number(row.upsold_asphalt_amount) : undefined,
      // --- PATH 3 ADDITION ---
      sharedJobKey: row.shared_job_key || undefined,
    };
  }

  public async getPendingSalesForSession(sessionId: string): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('session_id', sessionId)
        .eq('command_center_id', ccId)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[PendingSale] getPendingSalesForSession failed:', error);
        return [];
      }
      return (data || []).map(row => this.mapDbPendingSale(row));
    } catch (err) {
      console.warn('[PendingSale] getPendingSalesForSession error:', err);
      return [];
    }
  }

  public async getPendingSalesForManager(managerId: string): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];

      const { data: workers } = await supabase
        .from('users')
        .select('user_id, metadata')
        .eq('role', 'Worker')
        .eq('command_center_id', ccId);

      const myWorkerIds = (workers || [])
        .filter(w => w.metadata?.assignedManagerId === managerId)
        .map(w => w.user_id);

      if (myWorkerIds.length === 0) return [];

      const { data: sessions } = await supabase
        .from('logsheet_sessions')
        .select('id, worker_id, team_worker_ids')
        .eq('date', date)
        .eq('command_center_id', ccId);

      const myWorkerSet = new Set(myWorkerIds);
      const mySessionIds = (sessions || [])
        .filter(s => {
          const ids = hasItems(s.team_worker_ids) ? s.team_worker_ids : [s.worker_id];
          return ids.some((id: string) => myWorkerSet.has(id));
        })
        .map(s => s.id);

      if (mySessionIds.length === 0) return [];

      const { data: pendingRows, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .in('session_id', mySessionIds);

      if (error) {
        console.warn('[PendingSale] getPendingSalesForManager failed:', error);
        return [];
      }
      return (pendingRows || []).map(row => this.mapDbPendingSale(row));
    } catch (err) {
      console.warn('[PendingSale] getPendingSalesForManager error:', err);
      return [];
    }
  }

  /**
   * CC-WIDE pending sales for today's session — one cheap query, no ownership
   * chain. Powers the RM Logbook's competitive team cards, which need EVERY
   * manager's parked sales, not just the logged-in manager's own/floated set.
   */
  public async getAllPendingSalesForToday(): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];

      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('session_date', date);

      if (error) {
        console.warn('[PendingSale] getAllPendingSalesForToday failed:', error);
        return [];
      }
      return (data || []).map(row => this.mapDbPendingSale(row));
    } catch (err) {
      console.warn('[PendingSale] getAllPendingSalesForToday error:', err);
      return [];
    }
  }

  public async getPendingSaleById(id: string): Promise<PendingSale | null> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('id', id)
        .eq('command_center_id', ccId)
        .maybeSingle();

      if (error || !data) return null;
      return this.mapDbPendingSale(data);
    } catch (err) {
      console.warn('[PendingSale] getPendingSaleById error:', err);
      return null;
    }
  }

  /**
   * Create a new pending sale.
   *
   * ASPHALT ORCHESTRATION:
   *   - If input.saleType === 'asphalt' AND no input.parentId is provided, this
   *     creates a single asphalt-only row (Scenario 3: RC sells asphalt standalone).
   *     The row is auto-assigned to the calling RC's session.
   *   - If input.asphaltAmount > 0 AND saleType is NOT 'asphalt', this is the
   *     two-step driveway+asphalt flow. The method writes:
   *       1. A parent row (driveway, sale_type=null)
   *       2. A child row (sale_type='asphalt', parent_id=parent.id, asphalt_amount set)
   *     For RC sellers, the child is auto-assigned to the calling session (skips
   *     the RM modal). For regular carts, the child is left unassigned and shows
   *     up in the RM asphalt modal.
   *   - Otherwise: normal driveway-only behaviour, single row written.
   *
   * input.sharedJobKey is honoured if passed (defensive — only the internal
   * createDeferredAsphaltChild path actually sets it in current code).
   *
   * Return value: the "primary" PendingSale. For parent+child flows, returns the
   * PARENT row. UI fetches the child via getAsphaltChildrenForParent when needed.
   * For asphalt-only, returns the child row itself.
   */
  public async createPendingSale(input: PendingSaleInput): Promise<PendingSale> {
    const ccId = this.getCCId();
    const date = await this.getDailySessionDate();
    if (!date) throw new Error('No active session');

    const hasAsphaltAmount = (input.asphaltAmount != null && input.asphaltAmount > 0)
      || (input.upsoldAsphaltAmount != null && input.upsoldAsphaltAmount > 0);
    const isAsphaltOnly = input.saleType === 'asphalt' && !input.parentId;
    const isParentWithAsphaltChild = !input.saleType && hasAsphaltAmount;

    // Resolve whether the calling session is an RC (drives auto-assignment).
    let callerIsRC = false;
    if (isAsphaltOnly || isParentWithAsphaltChild) {
      try {
        const { data: sessionRow } = await supabase
          .from('logsheet_sessions')
          .select('worker_id, team_worker_ids')
          .eq('id', input.sessionId)
          .eq('command_center_id', ccId)
          .maybeSingle();
        if (sessionRow) {
          const wid = (hasItems(sessionRow.team_worker_ids) ? sessionRow.team_worker_ids[0] : sessionRow.worker_id);
          if (wid) {
            const { data: userRow } = await supabase
              .from('users')
              .select('metadata')
              .eq('user_id', wid)
              .eq('command_center_id', ccId)
              .maybeSingle();
            callerIsRC = isRampCrewTeamId(userRow?.metadata?.teamId);
          }
        }
      } catch (e) {
        console.warn('[PendingSale] RC detection failed, treating as regular cart:', e);
      }
    }

    // --- Asphalt-only path (Scenario 3) ---
    if (isAsphaltOnly) {
      const id = `pend_${input.workerId}_asphalt_${Date.now()}`;
      const row = {
        id,
        session_id: input.sessionId,
        worker_id: input.workerId,
        command_center_id: ccId,
        session_date: date,
        route_code: input.routeCode || null,
        house_number: input.houseNumber || null,
        street_name: input.streetName || null,
        price: input.price || (input.asphaltAmount != null ? String(input.asphaltAmount) : null),
        property_type: input.propertyType || null,
        services: input.services || null,
        notes: input.notes || null,
        sale_type: 'asphalt',
        parent_id: null,
        assigned_rc_session_id: input.assignedRcSessionId || (callerIsRC ? input.sessionId : null),
        asphalt_amount: input.asphaltAmount ?? 0,
        upsold_asphalt_amount: input.upsoldAsphaltAmount ?? null,
        shared_job_key: input.sharedJobKey || null,
      };

      const { data, error } = await supabase
        .from('pending_sales')
        .insert(row)
        .select()
        .single();

      if (error) {
        console.error('[PendingSale] createPendingSale (asphalt-only) failed:', error);
        throw error;
      }
      return this.mapDbPendingSale(data);
    }

    // --- Parent + asphalt-child path (Scenario 1/2) ---
    if (isParentWithAsphaltChild) {
      const parentId = `pend_${input.workerId}_${Date.now()}`;
      const childId = `pend_${input.workerId}_asphalt_${Date.now() + 1}`;

      const parentRow = {
        id: parentId,
        session_id: input.sessionId,
        worker_id: input.workerId,
        command_center_id: ccId,
        session_date: date,
        route_code: input.routeCode || null,
        house_number: input.houseNumber || null,
        street_name: input.streetName || null,
        price: input.price || null,
        property_type: input.propertyType || null,
        services: input.services || null,
        notes: input.notes || null,
        sale_type: null,
        parent_id: null,
        assigned_rc_session_id: null,
        asphalt_amount: null,
        upsold_asphalt_amount: null,
        shared_job_key: null,
      };

      const childRow = {
        id: childId,
        session_id: input.sessionId,
        worker_id: input.workerId,
        command_center_id: ccId,
        session_date: date,
        route_code: input.routeCode || null,
        house_number: input.houseNumber || null,
        street_name: input.streetName || null,
        // Mirror asphalt_amount into price for sort/display consistency on the
        // worker logsheet (the child row shows up as "Asphalt $300" in some lists).
        price: input.asphaltAmount != null ? String(input.asphaltAmount) : null,
        property_type: input.propertyType || null,
        services: null,  // service flags don't apply to the asphalt portion
        notes: null,
        sale_type: 'asphalt',
        parent_id: parentId,
        // RC sellers auto-assign to themselves; regular carts leave it null for RM assignment.
        assigned_rc_session_id: input.assignedRcSessionId || (callerIsRC ? input.sessionId : null),
        asphalt_amount: input.asphaltAmount ?? 0,
        upsold_asphalt_amount: input.upsoldAsphaltAmount ?? null,
        shared_job_key: null,
      };

      const { data: parentData, error: parentError } = await supabase
        .from('pending_sales')
        .insert(parentRow)
        .select()
        .single();

      if (parentError) {
        console.error('[PendingSale] createPendingSale (parent) failed:', parentError);
        throw parentError;
      }

      const { error: childError } = await supabase
        .from('pending_sales')
        .insert(childRow);

      if (childError) {
        console.error('[PendingSale] createPendingSale (child) failed, rolling back parent:', childError);
        await supabase
          .from('pending_sales')
          .delete()
          .eq('id', parentId)
          .eq('command_center_id', ccId)
          .then(({ error }) => {
            if (error) console.warn('[PendingSale] parent rollback failed:', error);
          });
        throw childError;
      }

      return this.mapDbPendingSale(parentData);
    }

    // --- Default path (driveway-only, no asphalt) ---
    const id = `pend_${input.workerId}_${Date.now()}`;
    const row = {
      id,
      session_id: input.sessionId,
      worker_id: input.workerId,
      command_center_id: ccId,
      session_date: date,
      route_code: input.routeCode || null,
      house_number: input.houseNumber || null,
      street_name: input.streetName || null,
      price: input.price || null,
      property_type: input.propertyType || null,
      services: input.services || null,
      notes: input.notes || null,
    };

    const { data, error } = await supabase
      .from('pending_sales')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('[PendingSale] createPendingSale failed:', error);
      throw error;
    }

    return this.mapDbPendingSale(data);
  }

  /**
   * Partial update. Any field omitted from `updates` is left alone in the DB.
   *
   * Asphalt extensions:
   *   - assignedRcSessionId: string to assign, null to unassign. Dedicated wrappers
   *     (assignAsphaltToRcSession / unassignAsphalt) below are cleaner for that purpose.
   *   - asphaltAmount / upsoldAsphaltAmount: numeric updates. undefined = leave alone;
   *     a number = set; 0 = zero out.
   *   - sharedJobKey: string to set, null to clear (rare — typically only used in rollback).
   */
  public async updatePendingSale(id: string, updates: PendingSaleUpdate): Promise<void> {
    const ccId = this.getCCId();

    const dbPayload: any = { updated_at: new Date().toISOString() };
    if (updates.routeCode !== undefined) dbPayload.route_code = updates.routeCode || null;
    if (updates.houseNumber !== undefined) dbPayload.house_number = updates.houseNumber || null;
    if (updates.streetName !== undefined) dbPayload.street_name = updates.streetName || null;
    if (updates.price !== undefined) dbPayload.price = updates.price || null;
    if (updates.propertyType !== undefined) dbPayload.property_type = updates.propertyType || null;
    if (updates.services !== undefined) dbPayload.services = updates.services || null;
    if (updates.notes !== undefined) dbPayload.notes = updates.notes || null;
    // Asphalt fields. `null` is meaningful for assignedRcSessionId (= unassign).
    if (updates.assignedRcSessionId !== undefined) {
      dbPayload.assigned_rc_session_id = updates.assignedRcSessionId;
    }
    if (updates.asphaltAmount !== undefined) {
      dbPayload.asphalt_amount = updates.asphaltAmount;
    }
    if (updates.upsoldAsphaltAmount !== undefined) {
      dbPayload.upsold_asphalt_amount = updates.upsoldAsphaltAmount;
    }
    // Path 3: sharedJobKey can be set or cleared.
    if (updates.sharedJobKey !== undefined) {
      dbPayload.shared_job_key = updates.sharedJobKey;
    }

    const { error } = await supabase
      .from('pending_sales')
      .update(dbPayload)
      .eq('id', id)
      .eq('command_center_id', ccId);

    if (error) {
      console.error('[PendingSale] updatePendingSale failed:', error);
      throw error;
    }
  }

  /**
   * Delete a pending sale row. Called when:
   *   - the RM manually deletes one via PendingJobModal, OR
   *   - completeJob() finishes converting one into a real transaction.
   *
   * NOTE: does NOT cascade to asphalt children. If you delete a driveway parent
   * that has an asphalt child, the child is orphaned (parent_id points at a
   * nonexistent row). completeAsphaltJob deletes both rows atomically; for manual
   * RM deletions we trust the UI to call this for both rows when needed.
   */
  public async deletePendingSale(id: string): Promise<void> {
    const ccId = this.getCCId();
    const { error } = await supabase
      .from('pending_sales')
      .delete()
      .eq('id', id)
      .eq('command_center_id', ccId);

    if (error) {
      console.error('[PendingSale] deletePendingSale failed:', error);
      throw error;
    }
  }

  // --- 11. ASPHALT-SPECIFIC PENDING-SALE QUERIES & MUTATIONS (Sealing only) ---

  /**
   * Fetch every UNASSIGNED asphalt child for carts under this manager's authority.
   * "Unassigned" = sale_type='asphalt' AND assigned_rc_session_id IS NULL.
   *
   * Drives:
   *   - The count badge on the RMLogbook asphalt header button.
   *   - The list in the RMAsphaltModal.
   *
   * Implementation note: filter chain matches getPendingSalesForManager —
   * workers → sessions → pending_sales. Adds the asphalt filters at the DB level
   * so the partial index does the heavy lifting on a busy day.
   */
  public async getUnassignedAsphaltForManager(managerId: string): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];

      const { data: workers } = await supabase
        .from('users')
        .select('user_id, metadata')
        .eq('role', 'Worker')
        .eq('command_center_id', ccId);

      const myWorkerIds = (workers || [])
        .filter(w => w.metadata?.assignedManagerId === managerId)
        .map(w => w.user_id);
      if (myWorkerIds.length === 0) return [];

      const { data: sessions } = await supabase
        .from('logsheet_sessions')
        .select('id, worker_id, team_worker_ids')
        .eq('date', date)
        .eq('command_center_id', ccId);

      const myWorkerSet = new Set(myWorkerIds);
      const mySessionIds = (sessions || [])
        .filter(s => {
          const ids = hasItems(s.team_worker_ids) ? s.team_worker_ids : [s.worker_id];
          return ids.some((id: string) => myWorkerSet.has(id));
        })
        .map(s => s.id);

      if (mySessionIds.length === 0) return [];

      const { data: rows, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('sale_type', 'asphalt')
        .is('assigned_rc_session_id', null)
        .in('session_id', mySessionIds)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[Asphalt] getUnassignedAsphaltForManager failed:', error);
        return [];
      }
      return (rows || []).map(r => this.mapDbPendingSale(r));
    } catch (err) {
      console.warn('[Asphalt] getUnassignedAsphaltForManager error:', err);
      return [];
    }
  }

  /**
   * CC-WIDE unassigned asphalt — the floater's version of
   * getUnassignedAsphaltForManager with the ownership chain dropped.
   *
   * A floater gets cross-manager asphalt-assignment power, and pending_sales has
   * no manager column (ownership is only inferable via
   * session → logsheet_session → team_worker_ids → worker → assignedManagerId).
   * Rather than walk that chain for every manager the floater covers, we simply
   * return EVERY unassigned asphalt row in the CC for today: sale_type='asphalt'
   * AND assigned_rc_session_id IS NULL. This is both simpler and exactly the
   * "assign asphalt regardless of which manager's contractor sold it" behaviour
   * the floater design calls for.
   *
   * Note: this is intentionally CC-wide, not floated-set-scoped. Per the locked
   * design, a floater's asphalt authority spans the whole command center.
   */
  public async getUnassignedAsphaltForFloater(): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const date = await this.getDailySessionDate();
      if (!date) return [];

      const { data: rows, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('session_date', date)
        .eq('sale_type', 'asphalt')
        .is('assigned_rc_session_id', null)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[Asphalt] getUnassignedAsphaltForFloater failed:', error);
        return [];
      }
      return (rows || []).map(r => this.mapDbPendingSale(r));
    } catch (err) {
      console.warn('[Asphalt] getUnassignedAsphaltForFloater error:', err);
      return [];
    }
  }

  /**
   * Assign an asphalt child to an RC session. Used by the RMAsphaltModal.
   * Updates assigned_rc_session_id only — caller is responsible for any
   * notifications or UI refreshes.
   */
  public async assignAsphaltToRcSession(asphaltPendingSaleId: string, rcSessionId: string): Promise<void> {
    const ccId = this.getCCId();
    const { error } = await supabase
      .from('pending_sales')
      .update({
        assigned_rc_session_id: rcSessionId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asphaltPendingSaleId)
      .eq('command_center_id', ccId)
      .eq('sale_type', 'asphalt');

    if (error) {
      console.error('[Asphalt] assignAsphaltToRcSession failed:', error);
      throw error;
    }
  }

  /**
   * Unassign an asphalt child (set assigned_rc_session_id back to null).
   * Per the design, RCs cannot skip/cancel an assigned asphalt themselves —
   * only the RM can unassign via this method.
   */
  public async unassignAsphalt(asphaltPendingSaleId: string): Promise<void> {
    const ccId = this.getCCId();
    const { error } = await supabase
      .from('pending_sales')
      .update({
        assigned_rc_session_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', asphaltPendingSaleId)
      .eq('command_center_id', ccId)
      .eq('sale_type', 'asphalt');

    if (error) {
      console.error('[Asphalt] unassignAsphalt failed:', error);
      throw error;
    }
  }

  /**
   * Fetch all asphalt children for a given parent pending_sale id. Almost always
   * returns 0 or 1 row (one child per parent), but the method returns an array
   * to keep the contract robust if we ever support multi-child parents.
   * Used by LogsheetJobCard and Dashboard to render merged "Driveway + Asphalt"
   * cards without duplicate queries.
   */
  public async getAsphaltChildrenForParent(parentId: string): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('parent_id', parentId)
        .eq('sale_type', 'asphalt');

      if (error) {
        console.warn('[Asphalt] getAsphaltChildrenForParent failed:', error);
        return [];
      }
      return (data || []).map(r => this.mapDbPendingSale(r));
    } catch (err) {
      console.warn('[Asphalt] getAsphaltChildrenForParent error:', err);
      return [];
    }
  }

  /**
   * Fetch all asphalt assignments for an RC session. Returns asphalt children
   * where assigned_rc_session_id matches. Used by the RC's logsheet to surface
   * "your asphalt queue".
   */
  public async getAsphaltAssignmentsForSession(rcSessionId: string): Promise<PendingSale[]> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('sale_type', 'asphalt')
        .eq('assigned_rc_session_id', rcSessionId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[Asphalt] getAsphaltAssignmentsForSession failed:', error);
        return [];
      }
      return (data || []).map(r => this.mapDbPendingSale(r));
    } catch (err) {
      console.warn('[Asphalt] getAsphaltAssignmentsForSession error:', err);
      return [];
    }
  }

  /**
   * Path 3 lookup: fetch an asphalt pending_sale by its shared_job_key. Used for
   * diagnostics and rare cross-referencing (e.g., reconciliation tools that walk
   * from a cart's tx to find its deferred asphalt child). Returns null if no
   * matching child exists.
   *
   * Note: regular Path 3 usage doesn't need this — the UI reads sharedJobKey
   * directly from the PendingSale object when displaying/completing it.
   */
  public async getAsphaltChildBySharedJobKey(sharedJobKey: string): Promise<PendingSale | null> {
    try {
      const ccId = this.getCCId();
      const { data, error } = await supabase
        .from('pending_sales')
        .select('*')
        .eq('command_center_id', ccId)
        .eq('sale_type', 'asphalt')
        .eq('shared_job_key', sharedJobKey)
        .maybeSingle();

      if (error || !data) return null;
      return this.mapDbPendingSale(data);
    } catch (err) {
      console.warn('[Asphalt] getAsphaltChildBySharedJobKey error:', err);
      return null;
    }
  }
}

// A pin an RM has dropped on the map: a coordinate, a name, and nothing else.
// Scoped to the command centre and the session date, so every manager and
// floater on that centre sees the same set and each new day starts clean.
export interface MapPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  createdBy: string | null;
  createdAt: string;
}

export const sessionService = SessionService.getInstance();
