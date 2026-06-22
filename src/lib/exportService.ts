// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { commandCenterService, seasonHasTeams, getSeasonConfig, getPayoutRate, createEqualSplit, EQ_DIVISOR } from './commandCenterService';
import { sessionService } from './sessionService';
import { googleSheetsService } from './googleSheetsService';
import { LogsheetSession, Worker, ManagementUser, SeasonType, ServiceFlags, SessionTransaction, CRACKFILLER_RATE_PER_LB } from '../types';

// Helper to get CC ID with error handling
const getCCId = (): string => {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) {
    throw new Error('No command center context. Please log in first.');
  }
  return ccId;
};

/**
 * Badge map for upgrade/add-on item names to short display codes.
 * Used by getClientType() as a fallback when refId doesn't match the new Rejuv overrides.
 * NOTE: The three new Rejuv add-ons (star_plan_pro_rejuv, chafer_beetle, star_plan_protection_plus)
 * are handled BEFORE this map is consulted — via refId lookup. See getClientType().
 */
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC',
  'Window Washing': 'WW',
  'Driveway Sealing': 'DWS',
  'Hot Asphalt': 'RAMP'
};

/**
 * refId-based badge map for the new Lawn Rejuv add-ons.
 * Takes priority over BADGE_MAP to resolve name collisions between seasons.
 * (Aeration "Star Plan Pro" Upgrade shares a display name with Rejuv "Star Plan Pro" Add-On,
 * but they're different products that should export with different badges.)
 */
const REJUV_REFID_BADGE_MAP: Record<string, string> = {
  'star_plan_pro_rejuv': 'AC',
  'chafer_beetle': 'GRUB',
  'star_plan_protection_plus': 'SPPP',
};

/**
 * Get client type from transaction, using badge abbreviations for upgrades/add-ons.
 *
 * Priority order:
 * 1. Production → "Existing"
 * 2. Sale → "New"
 * 3. Upgrade/Add-On:
 *    a. Check REJUV_REFID_BADGE_MAP first (new Lawn Rejuv add-ons by refId) — PRIORITY
 *    b. Fall back to BADGE_MAP by item name
 *    c. Fall back to tx.type ("Upgrade" or "Add-On")
 * 4. Default → "Existing"
 */
function getClientType(tx: any): string {
  if (tx.type === 'Production') return 'Existing';
  if (tx.type === 'Sale') return 'New';
  if (tx.type === 'Upgrade' || tx.type === 'Add-On') {
    // PRIORITY 1: Check new Rejuv add-ons by refId (resolves season collisions)
    if (tx.ref_id && REJUV_REFID_BADGE_MAP[tx.ref_id]) {
      return REJUV_REFID_BADGE_MAP[tx.ref_id];
    }
    // PRIORITY 2: Fall back to name-based BADGE_MAP
    if (tx.items && Array.isArray(tx.items) && tx.items.length > 0) {
      const itemName = tx.items[0]?.name;
      if (itemName && BADGE_MAP[itemName]) {
        return BADGE_MAP[itemName];
      }
    }
    // PRIORITY 3: Fall back to transaction type
    return tx.type;
  }
  return 'Existing';
}

/**
 * Convert ServiceFlags to display string like "(ADFS)"
 */
function serviceFlagsToString(services?: ServiceFlags): string {
  if (!services) return '';
  let result = '';
  if (services.aeration) result += 'A';
  if (services.dethatch) result += 'D';
  if (services.fertilizer) result += 'F';
  if (services.seed) result += 'S';
  if (services.lime) result += 'L';
  return result ? `(${result})` : '';
}

/**
 * Format payment breakdown into a readable string.
 * Used for non-asphalt transactions where the breakdown reflects the whole job.
 */
function formatPaymentType(tx: any): string {
  const breakdown = tx.payment_breakdown;
  if (breakdown && typeof breakdown === 'object') {
    const entries = Object.entries(breakdown).filter(([, amount]) => {
      const val = Number(amount) || 0;
      return val > 0;
    });
    if (entries.length > 1) {
      return entries
        .map(([method, amount]) => `${method}: $${(Number(amount) || 0).toFixed(2)}`).join(' / ');
    }
    if (entries.length === 1) {
      return entries[0][0];
    }
  }
  return tx.payment_method || '';
}

/**
 * Format a payment breakdown record into a readable string, matching formatPaymentType's
 * output style. Used by the asphalt two-row export to render proportional slices.
 *
 * - Multi-method: "Cash: $200.00 / Cheque: $50.00"
 * - Single method with non-trivial amount: just "Cash" (matches existing convention)
 * - Empty/zero: empty string
 */
function formatBreakdownString(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).filter(([, amount]) => {
    const val = Number(amount) || 0;
    return val > 0;
  });
  if (entries.length > 1) {
    return entries
      .map(([method, amount]) => `${method}: $${(Number(amount) || 0).toFixed(2)}`)
      .join(' / ');
  }
  if (entries.length === 1) {
    return entries[0][0];
  }
  return '';
}

/**
 * Helper to get all team worker names for a transaction
 */
function getTeamWorkerNames(
  tx: any, 
  workersMap: Map<string, any>,
  sessionsMap?: Map<string, any>
): string {
  if (tx.completed_by_worker_ids && tx.completed_by_worker_ids.length > 0) {
    return tx.completed_by_worker_ids
      .map((id: string) => workersMap.get(id)?.name || id)
      .join(', ');
  }
  if (sessionsMap) {
    for (const session of sessionsMap.values()) {
      const teamWorkerIds = session.team_worker_ids || [];
      if (teamWorkerIds.includes(tx.worker_id)) {
        return teamWorkerIds
          .map((id: string) => workersMap.get(id)?.name || id)
          .join(', ');
      }
    }
  }
  return workersMap.get(tx.worker_id)?.name || tx.worker_id;
}

/**
 * Helper to get all team worker IDs for a transaction
 */
function getTeamWorkerIds(
  tx: any,
  sessionsMap?: Map<string, any>
): string {
  if (tx.completed_by_worker_ids && tx.completed_by_worker_ids.length > 0) {
    return tx.completed_by_worker_ids.join(', ');
  }
  if (sessionsMap) {
    for (const session of sessionsMap.values()) {
      const teamWorkerIds = session.team_worker_ids || [];
      if (teamWorkerIds.includes(tx.worker_id)) {
        return teamWorkerIds.join(', ');
      }
    }
  }
  return tx.worker_id;
}

/**
 * Minimal mapping of raw DB transaction to the fields recalculateStats needs.
 * Full mapDbTransaction is private to sessionService, so we use this subset.
 *
 * Includes payoutShare and asphaltMeta so the asphalt-aware step counting and
 * payout-adjustment branches in recalculateStats work correctly when this is
 * the path used to build a stats snapshot (e.g. inside the export builders).
 */
function mapTxForRecalc(tx: any): SessionTransaction {
  return {
    id: tx.id,
    jobId: tx.job_id,
    workerId: tx.worker_id,
    timestamp: tx.timestamp,
    type: tx.type,
    price: tx.price,
    paymentMethod: tx.payment_method,
    paymentBreakdown: tx.payment_breakdown,
    displayPrice: tx.display_price,
    items: tx.items || [],
    isPaid: true,
    customerId: tx.job_id,
    customerName: '',
    address: '',
    routeCode: tx.customer_snapshot?.routeCode || '',
    workerName: '',
    services: tx.services,
    payoutShare: tx.payout_share != null ? Number(tx.payout_share) : undefined,
    asphaltMeta: tx.asphalt_meta || undefined,
  } as SessionTransaction;
}

/**
 * Get the transactions for a specific session, using session_id for team seasons
 * (lawn_rejuv + sealing) or worker_id grouping for solo seasons.
 *
 * For sealing in particular, asphalt phantom rows live on the partner cart's
 * session_id but their worker_id is the partner cart's primary — so session_id
 * routing is essential to pick them up on the correct cart's stats.
 */
function getSessionTransactions(
  session: any,
  isTeamSeason: boolean,
  txBySession: Map<string, any[]>,
  txByWorker: Map<string, any[]>
): any[] {
  if (isTeamSeason && txBySession.has(session.id)) {
    return txBySession.get(session.id)!;
  }
  const teamWorkerIds = session.team_worker_ids && session.team_worker_ids.length > 0
    ? session.team_worker_ids
    : [session.worker_id];
  const result: any[] = [];
  teamWorkerIds.forEach((wid: string) => {
    if (txByWorker.has(wid)) {
      result.push(...txByWorker.get(wid)!);
    }
  });
  return result;
}

/**
 * Build the Logsheets-tab rows for asphalt transactions.
 *
 * Input: asphalt-bearing transactions (have tx.asphalt_meta), filtered to logsheet-
 *        eligible types upstream.
 * Output: an array of row-shaped objects ready to hand to googleSheetsService.appendLogsheets.
 *
 * Group composition by mode:
 *   - completer-with-phantom: 2 txs in group — the completer (real payment_breakdown)
 *     and the phantom partner (empty payment_breakdown {}).
 *   - self-both: 1 tx in group with role='self-both'.
 *   - Path 3 same-day (driveway-deferred today + asphalt-executor-only today):
 *     2 txs in group, BOTH with real payment_breakdowns.
 *   - Path 3 cross-day: 1 tx per daily export — driveway-seller alone today,
 *     asphalt-executor-only alone on a later day. The group on any given day
 *     contains only one of the two roles.
 *
 * Algorithm:
 *   1. Group transactions by asphalt_meta.sharedJobKey.
 *   2. Identify role-owning txs up front, BEFORE any amount math:
 *        drivewaySellerTx  = tx with role 'driveway-seller' or 'self-both'
 *        asphaltExecutorTx = tx with role 'asphalt-executor' or 'self-both'
 *      In self-both both variables point to the same tx. Either may be undefined
 *      in cross-day Path 3.
 *   3. Source line-item amounts from each role's OWN meta (final-wins):
 *        driveway_amount         from drivewaySellerTx.asphalt_meta
 *        asphalt_amount + upsold from asphaltExecutorTx.asphalt_meta
 *      This resolves the documented executor-only meta divergence — if cart entered
 *      asphalt=$300 and RC corrected to $250 at completion, the asphalt row reflects
 *      RC's $250.
 *   4. Pick breakdown sourcing per row by counting txs with non-empty breakdowns:
 *        ≥ 2 non-empty (Path 3 same-day dual): each row uses its own role-tx's
 *          payment_breakdown directly. No proportional split.
 *        exactly 1 (completer-with-phantom OR self-both): existing Option B
 *          proportional cash split — each row's paymentType string reflects its
 *          share of the sole completer's collected breakdown.
 *        0 (defensive): rows still emit; paymentType strings come out empty.
 *   5. Emit rows conditionally:
 *        Driveway row IF driveway_amount > 0 AND drivewaySellerTx is present.
 *        Asphalt row  IF (asphalt_amount + upsold) > 0 AND asphaltExecutorTx is present.
 *
 * Row marking (per locked design):
 *   - Driveway row: PropertyType = original snapshot.serviceType (SS or SSP for sealing).
 *   - Asphalt row:  PropertyType = "Ramp" (hard override).
 *
 * Path 3 dual-breakdown worked example (driveway $200, asphalt $300, upsold $150):
 *   - Cart's tx: role 'driveway-seller', payoutShare $290, breakdown {Cash: $500}
 *   - RC's tx:   role 'asphalt-executor', payoutShare $360, breakdown {Cash: $150}
 *   - Driveway row emitted: price $200, paymentType from {Cash: $500} → "Cash"
 *   - Asphalt row  emitted: price $450 ($300 + $150), paymentType from {Cash: $150} → "Cash"
 *   - Row prices sum $200 + $450 = $650. Row breakdowns sum $500 + $150 = $650. Reconciles.
 *
 * Defensive behaviour:
 *   - Groups with no sharedJobKey are skipped (warned).
 *   - Groups where neither tx has a non-empty breakdown still emit rows; paymentType
 *     strings come out empty (better to surface the work than silently drop it).
 */
function buildAsphaltLogsheetRows(
  asphaltTxs: any[],
  workersMap: Map<string, any>,
  sessionsMap: Map<string, any>,
  isTeamSeason: boolean
): any[] {
  // --- Step 1: group by sharedJobKey ---
  const groups = new Map<string, any[]>();
  for (const tx of asphaltTxs) {
    const meta = tx.asphalt_meta;
    if (!meta) continue;
    const key = meta.sharedJobKey;
    if (!key) {
      console.warn('[Asphalt export] tx has asphalt_meta without sharedJobKey, skipping:', tx.id);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const rows: any[] = [];

  groups.forEach((group) => {
    // --- Step 2: identify role-owning txs up front (before any amount math) ---
    const drivewaySellerTx = group.find((tx) => {
      const role = tx.asphalt_meta?.role;
      return role === 'driveway-seller' || role === 'self-both';
    });
    const asphaltExecutorTx = group.find((tx) => {
      const role = tx.asphalt_meta?.role;
      return role === 'asphalt-executor' || role === 'self-both';
    });

    // --- Step 3: per-role amount sourcing (final-wins) ---
    // Each row's amount comes from its own role's tx meta. When a role's tx is
    // absent from this day's data (cross-day Path 3), its amount falls to 0
    // and the corresponding row is skipped at Step 5.
    const drivewayAmount = Number(drivewaySellerTx?.asphalt_meta?.driveway_amount) || 0;
    const asphaltCore = Number(asphaltExecutorTx?.asphalt_meta?.asphalt_amount) || 0;
    const upsold = Number(asphaltExecutorTx?.asphalt_meta?.upsold_asphalt_amount) || 0;
    const asphaltLineAmount = asphaltCore + upsold;
    const totalAmount = drivewayAmount + asphaltLineAmount;

    if (totalAmount <= 0) return;  // nothing to emit

    // --- Step 4: pick breakdown strategy by counting non-empty breakdowns ---
    const txsWithBreakdown = group.filter((tx) => {
      const bd = tx.payment_breakdown;
      return bd && typeof bd === 'object' && Object.keys(bd).length > 0;
    });
    const isPath3DualBreakdown = txsWithBreakdown.length >= 2;

    const splitBreakdown = (
      bd: Record<string, number>,
      share: number
    ): Record<string, number> => {
      const out: Record<string, number> = {};
      Object.entries(bd).forEach(([method, amount]) => {
        const val = Number(amount) || 0;
        if (val <= 0) return;
        out[method] = val * share;
      });
      return out;
    };

    let drivewayBreakdown: Record<string, number>;
    let asphaltBreakdown: Record<string, number>;

    if (isPath3DualBreakdown) {
      // Path 3 same-day: each tx owns its own row's breakdown. No proportional split.
      drivewayBreakdown = (drivewaySellerTx?.payment_breakdown || {}) as Record<string, number>;
      asphaltBreakdown  = (asphaltExecutorTx?.payment_breakdown || {}) as Record<string, number>;
    } else {
      // completer-with-phantom OR self-both single-tx OR defensive (zero breakdowns):
      // Option B proportional split from the sole completer (or first tx as fallback).
      const completer = txsWithBreakdown[0] || group[0];
      const fullBreakdown = (completer.payment_breakdown || {}) as Record<string, number>;
      const drivewayShare = totalAmount > 0 ? drivewayAmount / totalAmount : 0;
      const asphaltShare  = totalAmount > 0 ? asphaltLineAmount / totalAmount : 0;
      drivewayBreakdown = splitBreakdown(fullBreakdown, drivewayShare);
      asphaltBreakdown  = splitBreakdown(fullBreakdown, asphaltShare);
    }

    // --- Customer details ---
    // Identical across the group in practice (same job). Deterministic preference:
    // asphalt-executor (most recently written) first, then driveway-seller, then group[0].
    const detailsTx = asphaltExecutorTx || drivewaySellerTx || group[0];
    const address = detailsTx.customer_snapshot?.address || detailsTx.address || '';
    const streetParts = address.split(' ');
    const streetNum = streetParts[0] || '';
    const streetName = streetParts.slice(1).join(' ') || '';
    const firstName = detailsTx.customer_snapshot?.firstName || '';
    const lastName  = detailsTx.customer_snapshot?.lastName || '';
    const routeNumber = detailsTx.customer_snapshot?.routeCode || '';
    const phone = detailsTx.customer_phone || '';
    const email = detailsTx.customer_email || '';

    // --- Step 5a: Driveway row (skipped when drivewaySellerTx absent or amount 0) ---
    if (drivewayAmount > 0 && drivewaySellerTx) {
      const drivewayContractorName = getTeamWorkerNames(
        drivewaySellerTx,
        workersMap,
        isTeamSeason ? sessionsMap : undefined
      );
      // PropertyType comes from the original booking's serviceType — for sealing
      // this is SS or SSP per the locked config. Defaulting to 'SS' is defensive;
      // in practice the snapshot is always populated by the UI.
      const drivewayPropertyType = drivewaySellerTx.customer_snapshot?.serviceType || 'SS';
      rows.push({
        routeNumber,
        firstName,
        lastName,
        streetNum,
        streetName,
        phone,
        email,
        clientType: getClientType(drivewaySellerTx),
        propertyType: drivewayPropertyType,
        notes: drivewaySellerTx.item_description || '',
        price: drivewayAmount,
        paymentType: formatBreakdownString(drivewayBreakdown),
        contractorName: drivewayContractorName,
        services: drivewaySellerTx.services as ServiceFlags | undefined,
      });
    }

    // --- Step 5b: Asphalt row (skipped when asphaltExecutorTx absent or amount 0) ---
    if (asphaltLineAmount > 0 && asphaltExecutorTx) {
      const asphaltContractorName = getTeamWorkerNames(
        asphaltExecutorTx,
        workersMap,
        isTeamSeason ? sessionsMap : undefined
      );
      rows.push({
        routeNumber,
        firstName,
        lastName,
        streetNum,
        streetName,
        phone,
        email,
        clientType: getClientType(asphaltExecutorTx),
        // Hard override: asphalt rows always mark as "Ramp" regardless of underlying snapshot.
        propertyType: 'Ramp',
        notes: 'Asphalt',
        price: asphaltLineAmount,
        paymentType: formatBreakdownString(asphaltBreakdown),
        contractorName: asphaltContractorName,
        // Asphalt rows carry no service flags — asphalt work is separate from
        // any Rejuv-style service ticks on the driveway side.
        services: undefined,
      });
    }
  });

  return rows;
}

/**
 * Generates and downloads a comprehensive Excel export of all session data.
 * All data is scoped to the current command center.
 * ONLY exports validated payouts for Payout Summary and Team Payouts sheets.
 * Stats are LIVE-RECALCULATED from transactions (not stored session.stats).
 *
 * NOTE: This is the internal/audit Excel export. Asphalt transactions appear here
 * as raw rows (phantom partner rows visible alongside completer rows). The two-row
 * customer-facing treatment is in exportToGoogleSheets → Logsheets only.
 */
export async function generateSessionExport(): Promise<void> {
  const ccId = getCCId();
  const date = await sessionService.getDailySessionDate();
  if (!date) throw new Error('No active session');

  const seasonType = await sessionService.getSessionSeasonType();
  const isTeamSeason = seasonHasTeams(seasonType);
  const productCostPercent = await sessionService.getProductCostPercent();
  const noTaxOnCash = await sessionService.getSessionNoTaxOnCash();
  const taxRate = commandCenterService.getCurrentTaxRate();

  const [sessionsRes, transactionsRes, usersRes, bookingsRes] = await Promise.all([
    supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
    supabase.from('transactions').select('*').eq('command_center_id', ccId),
    supabase.from('users').select('*').eq('command_center_id', ccId),
    supabase.from('bookings').select('*').eq('session_date', date).eq('command_center_id', ccId),
  ]);

  const sessions = sessionsRes.data || [];
  const transactions = transactionsRes.data || [];
  const users = usersRes.data || [];
  const bookings = bookingsRes.data || [];

  const workersMap = new Map<string, any>();
  const managersMap = new Map<string, any>();
  users.forEach(u => {
    if (u.role === 'Worker') workersMap.set(u.user_id, u);
    else if (u.role === 'RouteManager') managersMap.set(u.user_id, u);
  });

  const sessionsMap = new Map<string, any>();
  sessions.forEach(s => sessionsMap.set(s.id, s));

  const txByWorker = new Map<string, any[]>();
  const txBySession = new Map<string, any[]>();
  transactions.forEach(tx => {
    if (!txByWorker.has(tx.worker_id)) txByWorker.set(tx.worker_id, []);
    txByWorker.get(tx.worker_id)!.push(tx);
    if (tx.session_id) {
      if (!txBySession.has(tx.session_id)) txBySession.set(tx.session_id, []);
      txBySession.get(tx.session_id)!.push(tx);
    }
  });

  const validatedSessions = sessions.filter(s => s.validation?.isValidated);

  // === SHEET 1: Payout Summary (VALIDATED ONLY, LIVE RECALC) ===
  const payoutRows: any[] = [];

  if (isTeamSeason) {
    for (const session of validatedSessions) {
      const teamWorkerIds = session.team_worker_ids || [session.worker_id];
      const sessionTx = getSessionTransactions(session, isTeamSeason, txBySession, txByWorker);
      const stats = sessionService.recalculateStats(sessionTx.map(mapTxForRecalc), taxRate, seasonType, productCostPercent, noTaxOnCash);
      const validation = session.validation || {};

      const sessionObj = {
        id: session.id, workerId: session.worker_id, date: session.date, status: session.status,
        stats, validation: session.validation, bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids, equivSplit: session.equiv_split, upsellSplit: session.upsell_split,
        dailyRouteStore: [], financialStore: [],
      };
      const workersArray = Array.from(workersMap.values()).map(u => ({
        contractorId: u.user_id, firstName: u.name.split(' ')[0], lastName: u.name.split(' ').slice(1).join(' '),
        alumniRate: u.metadata?.alumniRate || 0, silverRate: u.metadata?.silverRate || 0,
      }));
      const payouts = sessionService.calculateTeamPayouts(sessionObj as any, workersArray as any, seasonType);
      const payoutMap = new Map(payouts.map(p => [p.workerId, p]));

      for (const workerId of teamWorkerIds) {
        const worker = workersMap.get(workerId);
        if (!worker) continue;
        const payout = payoutMap.get(workerId);
        if (!payout) continue;
        const equivPercent = payout.equivSplitPercent / 100;
        const upsellPercent = payout.upsellSplitPercent / 100;
        const managerId = worker?.metadata?.assignedManagerId;
        const manager = managerId ? managersMap.get(managerId) : null;
        const teamMembers = teamWorkerIds.map((id: string) => workersMap.get(id)?.name || id).join(', ');

        payoutRows.push({
          'Contractor ID': workerId, 'Worker Name': worker?.name || workerId, 'Team Members': teamMembers,
          'Manager': manager?.name || 'Unassigned', 'Status': session.status,
          'Steps': (stats.stepCount || 0) * equivPercent, 'Prod Gross': (stats.prodGross || 0) * equivPercent,
          'Prod Payable': (stats.prodPayable || 0) * equivPercent, 'Total EQ': payout.teamTotalEQ,
          'Assigned EQ': payout.assignedEQ, 'Verified Cash': (validation.verifiedCash || 0) * equivPercent,
          'Verified Cheque': (validation.verifiedCheque || 0) * equivPercent,
          'Cash Diff': (validation.cashDiff || 0) * equivPercent, 'Cheque Diff': (validation.chequeDiff || 0) * equivPercent,
          'Upsells': (stats.upsellCount || 0) * upsellPercent, 'IOS': (stats.iosCount || 0) * upsellPercent,
          'Upsell Gross': (stats.upsellGross || 0) * upsellPercent, 'Upsell Payable': (stats.upsellPayable || 0) * upsellPercent,
          'Base Rate': payout.basePayoutRate, 'Alumni Rate': payout.alumniRate, 'Silver Rate': payout.silverRate,
          'Total Rate': payout.totalPayoutRate, 'Base Commission': payout.baseCommission,
          'Alumni Bonus': payout.alumniBonus, 'Silver Bonus': payout.silverBonus,
          'Production Comm': payout.productionCommission, 'Upsell Comm': payout.upsellCommission,
          'IOS Comm': payout.iosCommission, 'Machine Rental': payout.machineRentalDeduction,
          'Cash/Cheque Diff (Display)': payout.cashChequeDiff, 'Total Deductions': payout.deductions,
          'Bonuses': payout.bonusAmount, 'Final Commission': payout.finalCommission,
          'Validated': 'Yes', 'Validated By': validation.managerName || '',
          'Season Type': seasonType, 'Equiv Split %': payout.equivSplitPercent, 'Upsell Split %': payout.upsellSplitPercent,
        });
      }
    }
  } else {
    for (const session of validatedSessions) {
      const worker = workersMap.get(session.worker_id);
      const managerId = worker?.metadata?.assignedManagerId;
      const manager = managerId ? managersMap.get(managerId) : null;
      const sessionTx = getSessionTransactions(session, isTeamSeason, txBySession, txByWorker);
      const stats = sessionService.recalculateStats(sessionTx.map(mapTxForRecalc), taxRate, seasonType, productCostPercent, noTaxOnCash);
      const validation = session.validation || {};
      const bonuses = session.bonuses || [];
      const totalBonuses = bonuses.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
      const basePayoutRate = getPayoutRate(seasonType, 1);
      const alumniRate = worker?.metadata?.alumniRate || 0;
      const silverRate = worker?.metadata?.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      const actualEQ = validation.actualTotalEQ || stats.totalEQ || 0;
      const productionComm = actualEQ * totalPayoutRate;
      const upsellComm = (stats.upsellPayable || 0) * 0.15;
      const iosComm = (stats.iosCount || 0) * 5;
      const machineRental = validation.machineRental ? 10 : 0;
      const cashChequeDiff = Math.abs(validation.cashDiff || 0) + Math.abs(validation.chequeDiff || 0);

      payoutRows.push({
        'Contractor ID': session.worker_id, 'Worker Name': worker?.name || session.worker_id, 'Team Members': '',
        'Manager': manager?.name || 'Unassigned', 'Status': session.status,
        'Steps': stats.stepCount || 0, 'Prod Gross': stats.prodGross || 0, 'Prod Payable': stats.prodPayable || 0,
        'Total EQ': actualEQ, 'Assigned EQ': actualEQ,
        'Verified Cash': validation.verifiedCash || 0, 'Verified Cheque': validation.verifiedCheque || 0,
        'Cash Diff': validation.cashDiff || 0, 'Cheque Diff': validation.chequeDiff || 0,
        'Upsells': stats.upsellCount || 0, 'IOS': stats.iosCount || 0,
        'Upsell Gross': stats.upsellGross || 0, 'Upsell Payable': stats.upsellPayable || 0,
        'Base Rate': basePayoutRate, 'Alumni Rate': alumniRate, 'Silver Rate': silverRate, 'Total Rate': totalPayoutRate,
        'Base Commission': actualEQ * basePayoutRate, 'Alumni Bonus': actualEQ * alumniRate, 'Silver Bonus': actualEQ * silverRate,
        'Production Comm': productionComm, 'Upsell Comm': upsellComm, 'IOS Comm': iosComm,
        'Machine Rental': machineRental, 'Cash/Cheque Diff (Display)': cashChequeDiff,
        'Total Deductions': machineRental, 'Bonuses': totalBonuses,
        'Final Commission': validation.finalCommission || 0,
        'Validated': 'Yes', 'Validated By': validation.managerName || '',
        'Season Type': seasonType, 'Equiv Split %': 100, 'Upsell Split %': 100,
      });
    }
  }

  // === SHEET 2: Transactions (ALL) ===
  // Raw row-per-tx dump. Asphalt phantom rows show up here as separate rows;
  // the asphalt_meta column isn't surfaced but is in the underlying data if anyone
  // pulls the source for forensics.
  const txRows = transactions.map(tx => {
    const servicesStr = serviceFlagsToString(tx.services);
    const completedBy = getTeamWorkerIds(tx, isTeamSeason ? sessionsMap : undefined);
    return {
      'Transaction ID': tx.id, 'Job ID': tx.job_id, 'Worker ID': tx.worker_id,
      'Worker Name': workersMap.get(tx.worker_id)?.name || tx.worker_id, 'Completed By': completedBy,
      'Timestamp': tx.timestamp, 'Type': tx.type, 'Price': tx.price, 'Display Price': tx.display_price,
      'Payment Method': tx.payment_method,
      'Customer Name': `${tx.customer_snapshot?.firstName || ''} ${tx.customer_snapshot?.lastName || ''}`.trim(),
      'Address': tx.customer_snapshot?.address || tx.address, 'Route': tx.customer_snapshot?.routeCode || tx.route_code,
      'Service Type': tx.customer_snapshot?.serviceType, 'Services': servicesStr,
      'Phone': tx.customer_phone, 'Email': tx.customer_email, 'Invoice #': tx.invoice_number,
      'Cheque #': tx.cheque_number, 'E-Transfer Email': tx.etransfer_email,
    };
  });

  // === SHEET 3: Bookings ===
  const bookingRows = bookings.map(b => ({
    'Booking ID': b.booking_id, 'Route': b.route_number, 'Status': b.status, 'Contractor': b.contractor_id,
    'Price': b.price, 'First Name': b.customer_details?.['First Name'], 'Last Name': b.customer_details?.['Last Name'],
    'Address': b.customer_details?.['Full Address'], 'Phone': b.customer_details?.['Home Phone'],
    'Email': b.customer_details?.['Email Address'], 'Service Type': b.customer_details?.['FO/BO/FP'],
    'Services': serviceFlagsToString(b.services), 'Prepaid': b.is_prepaid ? 'Yes' : 'No', 'Notes': b.log_notes,
  }));

  // === SHEET 4: Bonuses Detail (validated sessions) ===
  const bonusRows: any[] = [];
  validatedSessions.forEach(session => {
    const worker = workersMap.get(session.worker_id);
    (session.bonuses || []).forEach((bonus: any) => {
      bonusRows.push({
        'Contractor ID': session.worker_id, 'Worker Name': worker?.name || session.worker_id,
        'Bonus Type': bonus.type, 'Amount': bonus.amount, 'Placing': bonus.placing || '',
        'Description': bonus.customDescription || '',
        'Split Percentages': bonus.splitPercentages ? JSON.stringify(bonus.splitPercentages) : '',
      });
    });
  });

  // === SHEET 5: Team Payouts (validated teams only, LIVE RECALC) ===
  let teamPayoutRows: any[] = [];
  if (isTeamSeason) {
    const workers = Array.from(workersMap.values()).map(u => ({
      contractorId: u.user_id, firstName: u.name.split(' ')[0], lastName: u.name.split(' ').slice(1).join(' '),
      alumniRate: u.metadata?.alumniRate || 0, silverRate: u.metadata?.silverRate || 0,
    }));
    for (const session of validatedSessions) {
      if (!session.team_worker_ids || session.team_worker_ids.length <= 1) continue;
      const sessionTx = getSessionTransactions(session, isTeamSeason, txBySession, txByWorker);
      const liveStats = sessionService.recalculateStats(sessionTx.map(mapTxForRecalc), taxRate, seasonType, productCostPercent, noTaxOnCash);
      const sessionObj = {
        id: session.id, workerId: session.worker_id, date: session.date, status: session.status,
        stats: liveStats, validation: session.validation, bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids, equivSplit: session.equiv_split, upsellSplit: session.upsell_split,
        dailyRouteStore: [], financialStore: [],
      };
      const payouts = sessionService.calculateTeamPayouts(sessionObj as any, workers as any, seasonType);
      for (const payout of payouts) {
        teamPayoutRows.push({
          'Session ID': session.id, 'Worker ID': payout.workerId, 'Worker Name': payout.workerName,
          'Equiv Split %': payout.equivSplitPercent, 'Upsell Split %': payout.upsellSplitPercent,
          'Team Total EQ': payout.teamTotalEQ.toFixed(2), 'Assigned EQ': payout.assignedEQ.toFixed(2),
          'Base Payout Rate': payout.basePayoutRate.toFixed(2), 'Alumni Rate': payout.alumniRate.toFixed(2),
          'Silver Rate': payout.silverRate.toFixed(2), 'Total Payout Rate': payout.totalPayoutRate.toFixed(2),
          'Base Commission': payout.baseCommission.toFixed(2), 'Alumni Bonus': payout.alumniBonus.toFixed(2),
          'Silver Bonus': payout.silverBonus.toFixed(2), 'Production Commission': payout.productionCommission.toFixed(2),
          'Upsell Commission': payout.upsellCommission.toFixed(2), 'IOS Commission': payout.iosCommission.toFixed(2),
          'Bonus Amount': payout.bonusAmount.toFixed(2), 'Cash/Cheque Diff (Display)': payout.cashChequeDiff.toFixed(2),
          'Machine Rental': payout.machineRentalDeduction.toFixed(2), 'Total Deductions': payout.deductions.toFixed(2),
          'Final Commission': payout.finalCommission.toFixed(2),
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payoutRows), 'Payout Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), 'Transactions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bookingRows), 'Bookings');
  if (bonusRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bonusRows), 'Bonuses');
  if (teamPayoutRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamPayoutRows), 'Team Payouts');

  const cc = commandCenterService.getCurrentCommandCenter();
  const ccName = cc?.displayName?.replace(/\s+/g, '_') || 'Session';
  XLSX.writeFile(wb, `${ccName}_Export_${date}.xlsx`);
}

/**
 * Exports session data to Google Sheets.
 * ONLY exports validated payouts for payout stats.
 * Stats are LIVE-RECALCULATED from transactions.
 *
 * ASPHALT TWO-ROW LOGSHEETS EMIT (Sealing season only):
 *   Transactions with asphalt_meta are routed through buildAsphaltLogsheetRows,
 *   which groups by sharedJobKey and emits a driveway row + asphalt row per group.
 *   Breakdown sourcing branches on how many txs in the group carry a real breakdown:
 *     - completer-with-phantom (1 real, 1 empty): Option B proportional cash split.
 *     - Path 3 same-day dual (2 real): each row uses its own role-tx's breakdown directly.
 *     - self-both (1 tx total): Option B proportional split on the sole tx.
 *   PropertyType is SS/SSP on driveway, "Ramp" on asphalt.
 *   Non-asphalt transactions continue to emit a single row via the existing mapping.
 */
export async function exportToGoogleSheets(dateTab: string): Promise<{
  bookingsUpdated: number;
  accountsAppended: number;
  logsheetsAppended: number;
  statsAppended: number;
}> {
  const ccId = getCCId();
  const date = await sessionService.getDailySessionDate();
  if (!date) throw new Error('No active session');

  if (!googleSheetsService.isAuthenticated()) {
    const connected = await googleSheetsService.authenticate();
    if (!connected) throw new Error('Failed to authenticate with Google');
  }

  const seasonType = await sessionService.getSessionSeasonType();
  const isTeamSeason = seasonHasTeams(seasonType);
  const productCostPercent = await sessionService.getProductCostPercent();
  const noTaxOnCash = await sessionService.getSessionNoTaxOnCash();
  const taxRate = commandCenterService.getCurrentTaxRate();

  const [sessionsRes, transactionsRes, usersRes] = await Promise.all([
    supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
    supabase.from('transactions').select('*').eq('command_center_id', ccId),
    supabase.from('users').select('*').eq('command_center_id', ccId),
  ]);

  const sessions = sessionsRes.data || [];
  const transactions = transactionsRes.data || [];
  const users = usersRes.data || [];

  const workersMap = new Map<string, any>();
  const managersMap = new Map<string, any>();
  users.forEach(u => {
    if (u.role === 'Worker') workersMap.set(u.user_id, u);
    else if (u.role === 'RouteManager') managersMap.set(u.user_id, u);
  });

  const sessionsMap = new Map<string, any>();
  sessions.forEach(s => sessionsMap.set(s.id, s));

  const txByWorker = new Map<string, any[]>();
  const txBySession = new Map<string, any[]>();
  transactions.forEach(tx => {
    if (!txByWorker.has(tx.worker_id)) txByWorker.set(tx.worker_id, []);
    txByWorker.get(tx.worker_id)!.push(tx);
    if (tx.session_id) {
      if (!txBySession.has(tx.session_id)) txBySession.set(tx.session_id, []);
      txBySession.get(tx.session_id)!.push(tx);
    }
  });

  // === 1. Update Completed AND Cancelled Bookings ===
  const bookingsRes = await supabase
    .from('bookings').select('*').eq('command_center_id', ccId).in('status', ['completed', 'cancelled']);
  const bookingsData = bookingsRes.data || [];
  const bookingsMap = new Map<string, any>();
  bookingsData.forEach(b => bookingsMap.set(b.booking_id, b));

  // For asphalt completions we use the COMPLETER's transaction (the one with a real
  // payment_breakdown) to drive the booking update — the phantom partner row carries
  // a synthesised job_id like `...__asphalt_partner_rc` that doesn't exist in bookings.
  const completedFromTransactions = transactions
    .filter(tx => {
      if (!(tx.type === 'Production' || tx.type === 'Upgrade' || tx.type === 'Sale')) return false;
      if (!tx.job_id || tx.job_id.startsWith('NEW-')) return false;
      // Skip phantom partner rows — their job_id is a derived suffix, not a real booking.
      if (tx.asphalt_meta?.is_partner_phantom) return false;
      return true;
    })
    .map(tx => {
      const contractorIds = getTeamWorkerIds(tx, isTeamSeason ? sessionsMap : undefined);
      const booking = bookingsMap.get(tx.job_id);
      return {
        _sourceRow: booking?.data?._sourceRow, routeNumber: booking?.route_number || tx.customer_snapshot?.routeCode || '',
        firstName: booking?.customer_details?.['First Name'] || tx.customer_snapshot?.firstName || '',
        lastName: booking?.customer_details?.['Last Name'] || tx.customer_snapshot?.lastName || '',
        dateCompleted: new Date(tx.timestamp).toLocaleDateString(), contractorId: contractorIds,
        services: tx.services as ServiceFlags | undefined, isCancelled: false,
      };
    }).filter(b => b._sourceRow);

  const cancelledBookings = bookingsData.filter(b => b.status === 'cancelled').map(b => ({
    _sourceRow: b.data?._sourceRow, routeNumber: b.route_number || '',
    firstName: b.customer_details?.['First Name'] || '', lastName: b.customer_details?.['Last Name'] || '',
    dateCompleted: 'Cancelled', contractorId: '', services: b.services as ServiceFlags | undefined, isCancelled: true,
  })).filter(b => b._sourceRow);

  const bookingsUpdated = await googleSheetsService.updateCompletedBookings(
    [...completedFromTransactions, ...cancelledBookings], seasonType
  );

  // === 2. Append Accounts ===
  // Skip phantom partner transactions — their empty payment_breakdown ({}) means
  // they'd never match the payment-method filters below, but we make the intent
  // explicit here so anyone reading sees the asphalt-aware logic.
  const validAccountPaymentMethods = ['Billed', 'E-Transfer', 'Credit Card'];
  const accountTransactions = transactions.filter(tx => {
    if (tx.asphalt_meta?.is_partner_phantom) return false;
    if (tx.payment_breakdown && typeof tx.payment_breakdown === 'object') {
      return Object.keys(tx.payment_breakdown).some(method =>
        validAccountPaymentMethods.some(valid => method.includes(valid))
      );
    }
    return validAccountPaymentMethods.some(valid => (tx.payment_method || '').includes(valid));
  });

  const accountsData = accountTransactions.map(tx => {
    const address = tx.customer_snapshot?.address || tx.address || '';
    const streetParts = address.split(' ');
    const contractorName = getTeamWorkerNames(tx, workersMap, isTeamSeason ? sessionsMap : undefined);
    const clientType = getClientType(tx);
    const isBambora = (tx.cc_full_number || '').startsWith('BAMBORA-');
    const paymentDetails = isBambora
      ? `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${tx.cc_cvc || ''}`
      : (tx.cc_full_number || tx.cheque_number || tx.etransfer_email || tx.invoice_number || '');
    return {
      routeNumber: tx.customer_snapshot?.routeCode || '', firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '', streetNum: streetParts[0] || '',
      streetName: streetParts.slice(1).join(' ') || '', phone: tx.customer_phone || '', email: tx.customer_email || '',
      clientType, propertyType: tx.customer_snapshot?.serviceType || 'FP', notes: tx.item_description || '',
      price: tx.price || 0, paymentType: formatPaymentType(tx), contractorName,
      paymentDetails, expiry: isBambora ? '' : (tx.cc_expiry || ''), cvc: isBambora ? '' : (tx.cc_cvc || ''),
      services: tx.services as ServiceFlags | undefined,
    };
  });
  if (accountsData.length > 0) await googleSheetsService.appendAccounts(accountsData);

  // === 3. Append Logsheets (asphalt two-row treatment) ===
  // Filter to logsheet-eligible types, then split asphalt vs non-asphalt and process
  // independently. Non-asphalt keeps the existing single-row mapping; asphalt routes
  // through buildAsphaltLogsheetRows which emits driveway + asphalt rows per shared job.
  const logsheetTypes = isTeamSeason ? ['Production', 'Sale', 'Add-On'] : ['Production', 'Sale', 'Upgrade', 'Add-On'];
  const eligibleLogsheetTx = transactions.filter(tx => logsheetTypes.includes(tx.type));

  const asphaltLogsheetTx = eligibleLogsheetTx.filter(tx => !!tx.asphalt_meta);
  const nonAsphaltLogsheetTx = eligibleLogsheetTx.filter(tx => !tx.asphalt_meta);

  const nonAsphaltLogsheetsData = nonAsphaltLogsheetTx.map(tx => {
    const address = tx.customer_snapshot?.address || tx.address || '';
    const streetParts = address.split(' ');
    const clientType = getClientType(tx);
    const contractorName = getTeamWorkerNames(tx, workersMap, isTeamSeason ? sessionsMap : undefined);
    return {
      routeNumber: tx.customer_snapshot?.routeCode || '', firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '', streetNum: streetParts[0] || '',
      streetName: streetParts.slice(1).join(' ') || '', phone: tx.customer_phone || '', email: tx.customer_email || '',
      clientType, propertyType: tx.customer_snapshot?.serviceType || 'FP', notes: tx.item_description || '',
      price: tx.price || 0, paymentType: formatPaymentType(tx), contractorName,
      services: tx.services as ServiceFlags | undefined,
    };
  });

  const asphaltLogsheetsData = buildAsphaltLogsheetRows(
    asphaltLogsheetTx,
    workersMap,
    sessionsMap,
    isTeamSeason
  );

  const logsheetsData = [...nonAsphaltLogsheetsData, ...asphaltLogsheetsData];
  if (logsheetsData.length > 0) await googleSheetsService.appendLogsheets(logsheetsData);

  // === 4. Append Payout Stats (VALIDATED ONLY, LIVE RECALC) ===
  const statsData: any[] = [];
  const validatedSessions = sessions.filter(s => s.validation?.isValidated);

  if (isTeamSeason) {
    for (const session of validatedSessions) {
      const teamWorkerIds = session.team_worker_ids || [session.worker_id];
      const sessionTx = getSessionTransactions(session, isTeamSeason, txBySession, txByWorker);
      const stats = sessionService.recalculateStats(sessionTx.map(mapTxForRecalc), taxRate, seasonType, productCostPercent, noTaxOnCash);

      const sessionObj = {
        id: session.id, workerId: session.worker_id, date: session.date, status: session.status,
        stats, validation: session.validation, bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids, equivSplit: session.equiv_split, upsellSplit: session.upsell_split,
        dailyRouteStore: [], financialStore: [],
      };
      const workersArray = Array.from(workersMap.values()).map(u => ({
        contractorId: u.user_id, firstName: u.name.split(' ')[0], lastName: u.name.split(' ').slice(1).join(' '),
        alumniRate: u.metadata?.alumniRate || 0, silverRate: u.metadata?.silverRate || 0,
      }));
      const payouts = sessionService.calculateTeamPayouts(sessionObj as any, workersArray as any, seasonType);
      const payoutMap = new Map(payouts.map(p => [p.workerId, p]));

      for (const workerId of teamWorkerIds) {
        const worker = workersMap.get(workerId);
        if (!worker) continue;
        const payout = payoutMap.get(workerId);
        if (!payout) continue;
        const equivPercent = payout.equivSplitPercent / 100;
        const upsellPercent = payout.upsellSplitPercent / 100;
        const nameParts = (worker?.name || '').split(' ');
        const managerId = worker?.metadata?.assignedManagerId;
        const manager = managerId ? managersMap.get(managerId) : null;

        statsData.push({
          contractorId: workerId, firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '',
          manager: manager?.name || '',
          stepCount: (stats.stepCount || 0) * equivPercent, iosCount: (stats.iosCount || 0) * upsellPercent,
          prodBilled: (stats.prodBilled || 0) * equivPercent, prodCash: (stats.prodCash || 0) * equivPercent,
          prodCheque: (stats.prodCheque || 0) * equivPercent, prodCreditCard: (stats.prodCreditCard || 0) * equivPercent,
          prodETransfer: (stats.prodETransfer || 0) * equivPercent, prodFlats: (stats.prodFlats || 0) * equivPercent,
          prodPrepaid: (stats.prodPrepaid || 0) * equivPercent, prodPrepaidSplit: (stats.prodPrepaidSplit || 0) * equivPercent,
          prodGross: (stats.prodGross || 0) * equivPercent, prodPayable: (stats.prodPayable || 0) * equivPercent,
          assignedEQ: payout.assignedEQ,
          upsellCount: (stats.upsellCount || 0) * upsellPercent, upsellCash: (stats.upsellCash || 0) * upsellPercent,
          upsellCheque: (stats.upsellCheque || 0) * upsellPercent, upsellCreditCard: (stats.upsellCreditCard || 0) * upsellPercent,
          upsellETransfer: (stats.upsellETransfer || 0) * upsellPercent, upsellPrepaid: (stats.upsellPrepaid || 0) * upsellPercent,
          upsellGross: (stats.upsellGross || 0) * upsellPercent, upsellPayable: (stats.upsellPayable || 0) * upsellPercent,
          totalPayoutRate: payout.totalPayoutRate, productionComm: payout.productionCommission,
          upsellComm: payout.upsellCommission, iosComm: payout.iosCommission,
          machineRental: payout.machineRentalDeduction, deductions: payout.deductions,
          bonuses: payout.bonusAmount, finalPay: payout.finalCommission,
          // NEW: Rejuv-specific columns
          teamSize: teamWorkerIds.length, equivSplitPercent: payout.equivSplitPercent,
          upsellSplitPercent: payout.upsellSplitPercent, productCostPercent: productCostPercent,
          // Crackfiller (Sealing only): full job cost sliced by this worker's equiv
          // share, so the column sums to the real cost and each payslip itemizes its part.
          crackfillerCost: (seasonType === 'sealing'
            ? (session.validation?.crackfillerPounds || 0) * CRACKFILLER_RATE_PER_LB
            : 0) * equivPercent,
        });
      }
    }
  } else {
    for (const session of validatedSessions) {
      const worker = workersMap.get(session.worker_id);
      const nameParts = (worker?.name || '').split(' ');
      const managerId = worker?.metadata?.assignedManagerId;
      const manager = managerId ? managersMap.get(managerId) : null;
      const sessionTx = getSessionTransactions(session, isTeamSeason, txBySession, txByWorker);
      const stats = sessionService.recalculateStats(sessionTx.map(mapTxForRecalc), taxRate, seasonType, productCostPercent, noTaxOnCash);
      const validation = session.validation || {};
      const bonuses = session.bonuses || [];
      const totalBonuses = bonuses.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
      const basePayoutRate = getPayoutRate(seasonType, 1);
      const alumniRate = worker?.metadata?.alumniRate || 0;
      const silverRate = worker?.metadata?.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      const actualEQ = validation.actualTotalEQ || stats.totalEQ || 0;
      const productionComm = actualEQ * totalPayoutRate;
      const upsellComm = (stats.upsellPayable || 0) * 0.15;
      const iosComm = (stats.iosCount || 0) * 5;
      const machineRental = validation.machineRental ? 10 : 0;

      statsData.push({
        contractorId: session.worker_id, firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '',
        manager: manager?.name || '',
        stepCount: stats.stepCount || 0, iosCount: stats.iosCount || 0,
        prodBilled: stats.prodBilled || 0, prodCash: stats.prodCash || 0, prodCheque: stats.prodCheque || 0,
        prodCreditCard: stats.prodCreditCard || 0, prodETransfer: stats.prodETransfer || 0,
        prodFlats: stats.prodFlats || 0, prodPrepaid: stats.prodPrepaid || 0, prodPrepaidSplit: stats.prodPrepaidSplit || 0,
        prodGross: stats.prodGross || 0, prodPayable: stats.prodPayable || 0, assignedEQ: actualEQ,
        upsellCount: stats.upsellCount || 0, upsellCash: stats.upsellCash || 0, upsellCheque: stats.upsellCheque || 0,
        upsellCreditCard: stats.upsellCreditCard || 0, upsellETransfer: stats.upsellETransfer || 0,
        upsellPrepaid: stats.upsellPrepaid || 0, upsellGross: stats.upsellGross || 0, upsellPayable: stats.upsellPayable || 0,
        totalPayoutRate, productionComm, upsellComm, iosComm,
        machineRental, deductions: machineRental, bonuses: totalBonuses,
        finalPay: validation.finalCommission || 0,
      });
    }
  }

  if (statsData.length > 0) {
    await googleSheetsService.appendPayoutStats(dateTab, statsData);
  }

  return {
    bookingsUpdated,
    accountsAppended: accountsData.length,
    logsheetsAppended: logsheetsData.length,
    statsAppended: statsData.length,
  };
}