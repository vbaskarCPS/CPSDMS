// src/types/index.ts

// --- COMMAND CENTER (Multi-tenant) ---
export type Region = 'West' | 'Central' | 'East';

// --- SEASON TYPES ---
// West: aeration | lawn_rejuv
// East: aeration | sealing
// Central: aeration (today) | cleaning (FUTURE — see TODO markers across codebase)
// TODO: Add 'cleaning' season type for Central region when ready.
//       Search the codebase for "TODO.*cleaning" to find every spot that needs updating.
export type SeasonType = 'aeration' | 'lawn_rejuv' | 'sealing';

// --- SERVICE FLAGS (Lawn Rejuvenation) ---
export interface ServiceFlags {
  aeration?: boolean;    // A
  dethatch?: boolean;    // D
  fertilizer?: boolean;  // F
  seed?: boolean;        // S
  lime?: boolean;        // L
}

// Service flag keys for iteration
export const SERVICE_FLAG_KEYS: (keyof ServiceFlags)[] = [
  'aeration', 'dethatch', 'fertilizer', 'seed', 'lime'
];

// Service flag display labels
export const SERVICE_FLAG_LABELS: Record<keyof ServiceFlags, { short: string; full: string }> = {
  aeration: { short: 'A', full: 'Aeration' },
  dethatch: { short: 'D', full: 'Dethatch' },
  fertilizer: { short: 'F', full: 'Fertilizer' },
  seed: { short: 'S', full: 'Seed' },
  lime: { short: 'L', full: 'Lime' },
};

// --- EQ CALCULATION CONSTANT ---
// EQ (Equivalent) is ALWAYS calculated as: prodPayable / 25
// This divisor NEVER changes regardless of season
export const EQ_DIVISOR = 25;

// --- CRACKFILLER (Sealing season only) ---
// Crackfiller is charged back at $4 per pound. The dollar cost is converted to
// EQ via the standard EQ_DIVISOR and removed from the team pool before splitting.
export const CRACKFILLER_RATE_PER_LB = 4;

export interface CommandCenter {
  id: string;
  username: string;
  displayName: string;
  region: Region;
  workerbookSheetId: string;
  masterbookingsSheetId: string;
  replyToEmail?: string;
  createdAt?: string;
  // Job Fairs
  jobFairsEnabled?: boolean;
  jobFairsSlug?: string;
  // Digital Mapping (enables logsheet purple dots + PCL cache + digital master bookings)
  digitalMappingEnabled?: boolean;
}

// --- JOB FAIR TYPES ---
export type JobFairSessionStatus = 'active' | 'closed';
export type ApplicantIdType = 'SIN' | 'DL' | 'HEALTH_CARD' | 'PASSPORT';

export interface JobFairSession {
  id: string;
  commandCenterId: string;
  sessionDate: string;
  status: JobFairSessionStatus;
  createdAt?: string;
  closedAt?: string;
}

export interface JobFairApplicant {
  id: string;
  sessionId: string;
  commandCenterId: string;
  
  // Personal Info
  firstName: string;
  lastName: string;
  cellPhone: string;
  alternatePhone?: string;
  email?: string;
  
  // Address
  address: string;
  city?: string;
  postalCode?: string;
  
  // Additional Info
  age: number;
  
  // ID Information
  idType: ApplicantIdType;
  idValue: string;
  
  // Interview Data
  rating?: number;
  isBc: boolean;
  isManagement: boolean;
  isInterviewed: boolean;
  notes?: string; // Manager notes (exported to Workerbook)
  
  // Timestamps
  createdAt?: string;
  updatedAt?: string;
}

// For the public form submission
export interface ApplicantFormData {
  firstName: string;
  lastName: string;
  cellPhone: string;
  alternatePhone?: string;
  email?: string;
  address: string;
  city?: string;
  postalCode?: string;
  age: number;
  idType: ApplicantIdType;
  idValue: string;
}

// --- USER & AUTH ---

export interface ManagementUser {
  userId: string;
  username: string; // e.g. "basvi"
  password?: string; // e.g. "cps4life" (now from Managers tab)
  name: string; // "Vijay Baskaran"
  phone?: string; // Manager's phone number
  role: 'Admin' | 'RouteManager'; 
  commandCenterId?: string; // Links to CommandCenter.id
  // --- FLOATER (Digital mapping CCs only) ---
  // List of OTHER managers' userIds this manager is floating for. A floater
  // sees all routes/bookings/workers/locations for everyone in this list, plus
  // their own. Stored in users.metadata.floatingFor. Absent/empty = not floating.
  floatingFor?: string[];
}

// --- BONUS STRUCTURE ---
export type BonusType = 'Performance EQ' | 'Total Upsell' | 'Rookie' | 'Other';

export interface Bonus {
    id: number;
    type: BonusType;
    amount: number;
    placing?: number | 'other';      // 1-10 or 'other' (for Performance EQ, Total Upsell, Rookie)
    customDescription?: string;       // For 'Other' type OR when placing is 'other'
    // For team seasons: how to split this bonus among team members
    splitPercentages?: Record<string, number>; // workerId -> percentage (0-100)
    // Manual sort order (used by "Other" column in bonus screenshot — lower number = higher on list)
    sortOrder?: number;
}

export interface Worker {
  contractorId: string;
  firstName: string;
  lastName: string;
  cellPhone?: string;
  email?: string;
  status: 'Rookie' | 'Return' | 'Alumni';

  // --- RATES & METADATA ---
  // NOTE: alumniRate and silverRate are DOLLAR AMOUNTS per EQ (not percentages)
  // Example: alumniRate = 0.50 means +$0.50 per EQ
  // Total payout rate = baseRate + alumniRate + silverRate
  alumniRate?: number;      // e.g., 0.50 = +$0.50/EQ
  silverRate?: number;      // e.g., 0.50 = +$0.50/EQ
  customBaseRate?: number;  // Optional override
  
  assignedManagerId?: string; // Links to ManagementUser.userId
  commandCenterId?: string;   // Links to CommandCenter.id
  
  // --- UPSELL CONTROL ---
  upsellsEnabled?: boolean; // Defaults to true if not set
  
  // --- TEAM SUPPORT (Lawn Rejuv + Sealing seasons) ---
  teamId?: string; // e.g., "v1", "v2", "1", "2" - workers with same teamId share a cart
}

// --- TEAM/CART STRUCTURE (Lawn Rejuv + Sealing) ---
export interface TeamCart {
  teamId: string;
  workerIds: string[];
  workers: Worker[];
  logsheetSessionId?: string;
}

// --- HISTORICAL PROPERTY (Purple dots on RMMap — previously-serviced addresses) ---
export interface HistoricalProperty {
  routeCode: string;
  address: string;          // "Street# StreetName" assembled at import time
  customerName?: string;
  phone?: string;
  email?: string;
  clientType?: string;      // 'New' | 'Existing' | 'DWS'
  propertyType?: string;    // 'FP' | 'BO' | 'FO' | 'SS' | 'SSP'
  notes?: string;
  price?: string;
  paymentType?: string;
  contractorName?: string;
}

// --- MANAGER LIVE LOCATION (Floater feature — digital-mapping CCs only) ---
// One row per manager in the manager_locations table, overwritten on each GPS
// update (no history — mirrors worker_locations). A manager's own device writes
// its position while RMMapTab is open; floaters read every manager's row to draw
// coloured directional arrows with staleness bubbles. Single source of truth for
// this shape so the arrow/staleness consumers (later phases) can't drift.
export interface ManagerLocation {
  managerId: string;
  lat: number;
  lng: number;
  heading: number | null;   // bearing in degrees; null = no compass fix → north-pointing arrow
  updatedAt: string;        // ISO timestamp; staleness bubbles (green/yellow/red) key off this
  commandCenterId?: string;
}

// --- DATA FEED STRUCTURE ---

export interface RouteData {
  routeCode: string;
  managerId: string; 
  assignedWorkerIds: string[]; // For aeration: individual workers. For lawn_rejuv/sealing: can include team representatives
  streets?: string[];
  commandCenterId?: string; // Links to CommandCenter.id
}

export interface DailySessionData {
  date: string; // YYYY-MM-DD
  managers: ManagementUser[]; 
  workers: Worker[]; 
  routes: RouteData[]; 
  pendingBookings: MasterBooking[];
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- SEASON SUPPORT ---
  seasonType?: SeasonType; // 'aeration' | 'lawn_rejuv' | 'sealing'
  
  // --- TEAM CARTS (Lawn Rejuv + Sealing) ---
  teamCarts?: TeamCart[]; // Grouped workers by teamId
  
  // --- HISTORICAL PROPERTIES (digital mapping enabled CCs only) ---
  historicalProperties?: HistoricalProperty[]; // Read from Logsheets tab at upload time
}

// --- PAYOUT VALIDATION ---
export interface SessionValidation {
    isValidated: boolean;
    
    // Inputs (TEAM TOTALS - split per worker during calculation)
    verifiedCash: number;
    verifiedCheque: number;
    
    // Diffs (TEAM TOTALS - split per worker during calculation)
    cashDiff: number;       
    chequeDiff: number;     
    
    // Resolved "Actual" Stats (TEAM TOTALS)
    actualProdCash: number;
    actualProdCheque: number;
    actualTotalEQ: number;

    machineRental: boolean; // LEGACY: True = Deduct $10 PER WORKER (used if workerMachineRentals not set)
    finalCommission: number; // Total team commission (sum of all workers)
    managerName?: string;
    timestamp?: string;
    
    // NEW: Per-worker overrides (lawn_rejuv teams)
    workerMachineRentals?: Record<string, boolean>;  // workerId -> has rental ($10 each)
    workerDeductions?: Record<string, number>;       // workerId -> custom deduction amount

    // Crackfiller (Sealing only) — pounds used on the job. Cost = pounds × $4,
    // converted to EQ and removed from the team pool before splitting. Persisted
    // so reopening a finalised payout restores it (and payslips can itemize it).
    crackfillerPounds?: number;
}

// --- TEAM SPLIT CONFIGURATION ---
export interface TeamSplitConfig {
  // workerId -> percentage (0-100, should sum to 100)
  [workerId: string]: number;
}

// --- LOGSHEET SESSION ---

export interface LogsheetSession {
  id: string;
  workerId: string; // Primary worker (or first team member)
  managerName?: string; 
  date: string;
  status: 'OPEN' | 'COMPLETE' | 'CLOSED' | 'PAID'; // Added 'PAID' for payout lockout
  
  // Note: These arrays are populated by the service after fetching
  dailyRouteStore: MasterBooking[];   
  financialStore: SessionTransaction[]; 
  
  stats: SessionStats;

  // Payout Data
  validation?: SessionValidation;
  bonuses?: Bonus[];
  
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- TEAM SUPPORT (Lawn Rejuv + Sealing) ---
  teamWorkerIds?: string[]; // All worker IDs in this team/cart (includes primary workerId)
  equivSplit?: TeamSplitConfig; // How to split EQ among team members
  upsellSplit?: TeamSplitConfig; // How to split upsell commission among team members
}

export interface SessionStats {
    prodPrepaid: number;
    prodBilled: number;
    prodCash: number;
    prodCheque: number;
    prodETransfer: number;
    prodCreditCard: number;
    prodFlats: number;
    prodPrepaidSplit: number;

    prodGross: number;
    prodPayable: number;
    totalEQ: number;

    upsellCash: number;
    upsellCheque: number;
    upsellETransfer: number;
    upsellCreditCard: number;
    upsellBilled: number;
    upsellPrepaid: number;
    
    upsellGross: number;
    upsellPayable: number;
    
    stepCount: number;
    upsellCount: number;
    iosCount: number;
}

// --- PER-WORKER PAYOUT (for team seasons) ---
/**
 * WorkerPayoutBreakdown represents the calculated payout for a single worker.
 * 
 * IMPORTANT: Cash/cheque differences are handled via EQ adjustment (deltaEQ), NOT as deductions.
 * The cashChequeDiff field is for DISPLAY PURPOSES ONLY to show managers the variance.
 * It is NOT included in the deductions calculation.
 */
export interface WorkerPayoutBreakdown {
  workerId: string;
  workerName: string;
  
  // Split percentages applied
  equivSplitPercent: number;
  upsellSplitPercent: number;
  
  // EQ Values
  teamTotalEQ: number;              // Team total EQ (for DISPLAY to all workers)
  assignedEQ: number;               // teamTotalEQ * equivSplitPercent (for CALCULATION)
  
  // Payout Rate Breakdown (all in $/EQ)
  basePayoutRate: number;           // $9 for teams, $7 for solo
  alumniRate: number;               // Additional $/EQ for alumni
  silverRate: number;               // Additional $/EQ for silver
  totalPayoutRate: number;          // basePayoutRate + alumniRate + silverRate
  
  // Commission Breakdown
  baseCommission: number;           // assignedEQ * basePayoutRate
  alumniBonus: number;              // assignedEQ * alumniRate
  silverBonus: number;              // assignedEQ * silverRate
  productionCommission: number;     // baseCommission + alumniBonus + silverBonus
  
  upsellCommission: number;         // upsellPayable * upsellSplitPercent * 0.10
  iosCommission: number;            // iosCount * $5 * upsellSplitPercent
  
  bonusAmount: number;              // Sum of bonuses with splits applied
  
  // Deductions
  // NOTE: cashChequeDiff is DISPLAY ONLY - it is NOT included in deductions
  // Cash/cheque variances are already reflected in EQ via the deltaEQ adjustment
  cashChequeDiff: number;           // DISPLAY ONLY: (|cashDiff| + |chequeDiff|) * equivSplitPercent
  machineRentalDeduction: number;   // $10 per worker (NOT split)
  deductions: number;               // machineRentalDeduction + otherDeductions (EXCLUDES cashChequeDiff)
  
  finalCommission: number;          // Total payout for this worker
}

// --- BOOKINGS & TRANSACTIONS ---

export interface MasterBooking {
  'Booking ID': string;
  'First Name': string;
  'Last Name': string;
  'Full Address': string;
  'Home Phone'?: string;
  'Cell Phone'?: string;
  'Email Address'?: string;
  'Route Number'?: string;
  
  // Status
  'Completed'?: string; 
  'Status'?: string;    
  
  // Display Info
  'Price'?: string;
  'Log Sheet Notes'?: string;
  
  // Logic
  'Prepaid'?: string;
  isContract?: boolean;
  isPrebooked?: boolean;
  
  upsellMenuId?: string; 
  
  // NOTE: 'Ramp' stays in the enum (used by the asphalt add-on workflow for the
  // child row's display propertyType on the Logsheets export).
  'FO/BO/FP'?: 'FO' | 'BO' | 'FP' | 'SS' | 'SSP' | 'Ramp';
  'Contractor Number'?: string;
  
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- SESSION ASSIGNMENT (Lawn Rejuv + Sealing) ---
  sessionId?: string; // Links to LogsheetSession.id for team-based assignment
  
  // --- SERVICE FLAGS (Lawn Rejuv Season only) ---
  services?: ServiceFlags; // Which services are included (A/D/F/S/L)
  
  // --- PENDING SALE FLAG (Team seasons only — set when a pending_sales row is
  // converted into a MasterBooking-shaped object for display in jobs lists)
  // Consumers (LogsheetJobCard, ContractorJobs, PendingJobModal) branch on this
  // to render the SALE-PEND badge and to route clicks to NewJob instead of JobDetail.
  isPendingSale?: boolean;
  pendingSaleId?: string;   // Original pending_sales.id (same as 'Booking ID' for these rows)
  
  // Allow additional dynamic properties (like 'Gate', 'House Number', etc.)
  [key: string]: any;
}

export interface SoldService {
  name: string;
  price: number;
}

export interface SessionTransaction {
  id: string;
  jobId: string;
  timestamp: string;

  customerId: string;
  customerName: string;
  address: string;
  
  // Contact information
  customerPhone?: string;
  customerEmail?: string;
  
  workerId: string;
  workerName: string;
  
  routeCode: string;

  type: 'Production' | 'Sale' | 'Upgrade' | 'Add-On';
  price: number;
  displayPrice?: string;
  
  items: SoldService[];
  
  isPaid: boolean;
  paymentMethod: string;
  
  // Payment Details
  invoiceNumber?: string;
  ccFullNumber?: string;
  ccExpiry?: string;
  ccCVC?: string;
  etransferEmail?: string;
  chequeNumber?: string;
  
  // Service-related properties
  // NOTE: 'Ramp' stays in the enum — used as the propertyType on asphalt child rows
  // emitted by the Logsheets export.
  serviceType?: 'FO' | 'BO' | 'FP' | 'SS' | 'SSP' | 'Ramp';
  serviceName?: string;
  isPrepaid?: boolean;
  
  // Logic
  isWestSplit?: boolean;   
  refId?: string;
  itemDescription?: string;
  paymentBreakdown?: Record<string, number>;
  
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- SERVICE FLAGS (Lawn Rejuv Season only) ---
  services?: ServiceFlags; // Which services were performed (A/D/F/S/L)
  
  // --- TEAM SUPPORT ---
  completedByWorkerIds?: string[]; // All workers who contributed (for team export)

  // --- ASPHALT FIELDS (Sealing season only) ---
  // payoutShare:
  //   The portion of the day's payout this transaction earns for the worker.
  //   Set when the tx participates in an asphalt workflow (any of the four modes:
  //   completer-with-phantom, self-both, driveway-deferred, asphalt-executor-only);
  //   undefined for regular non-asphalt sales.
  //
  //   For a driveway-seller tx:  payoutShare = driveway $ + 0.30 × asphalt $
  //   For an asphalt-executor tx: payoutShare = 0.70 × asphalt $ + 1.00 × upsold $
  //   For a self-both tx:         payoutShare = driveway $ + asphalt $ + upsold $
  //
  //   recalculateStats uses (payoutShare − sum(payment_breakdown)) as the asphalt
  //   adjustment delta — applied at 1.0 weight (pre-tax-divisor) to both
  //   prodGross and taxableWeighted so the cash-vs-earned-dollars difference is
  //   reflected in stats without touching the cash buckets.
  payoutShare?: number;

  // asphaltMeta:
  //   JSONB payload stored alongside the tx. Read by the Logsheets export's
  //   two-row builder (groups by sharedJobKey, identifies driveway/asphalt rows by
  //   role, reads amounts). Absent for non-asphalt txs.
  asphaltMeta?: AsphaltMeta;
}

// --- PENDING SALES (Team seasons only — Rejuv + Sealing) ---
// Worker-initiated, half-collected sales parked in the pending_sales table.
// Pending sales are NEVER exported with the day's transactions — they live and
// die inside the app. When a worker completes one, the row is deleted and a
// real transaction is written via the normal completeJob flow.
// Visibility: shared across the whole cart (all workers in the same session_id
// see them) and shown to the RM under their team's pending list.
//
// ASPHALT EXTENSIONS (Sealing season only):
//   - saleType='asphalt' marks an asphalt child row.
//   - parentId points to the driveway parent (null for standalone-RC and
//     deferred-asphalt children).
//   - assignedRcSessionId tracks which Ramp Crew (if any) has been assigned
//     to execute the asphalt. Null = unassigned (RM modal queue).
//   - asphaltAmount / upsoldAsphaltAmount carry the dollar amounts.
//   - sharedJobKey (PATH 3): links a deferred-asphalt child to its already-
//     completed driveway-seller transaction via asphalt_meta.sharedJobKey.
//     Set only when the child was created as the "deferred" side of a
//     driveway-deferred completion at JobDetail/NewJob.
export interface PendingSale {
  id: string;                  // e.g. "pend_<workerId>_<timestamp>"
  sessionId: string;           // logsheet_sessions.id — the cart this belongs to
  workerId: string;            // who created the row (display only)
  commandCenterId: string;
  sessionDate: string;         // YYYY-MM-DD
  routeCode?: string;
  houseNumber?: string;
  streetName?: string;
  price?: string;              // string to mirror bookings.price (blank, "0", or "150.00")
  propertyType?: string;       // 'FP' | 'FO' | 'BO' | 'SS' | 'SSP'
  services?: ServiceFlags;     // Rejuv-only (A/D/F/S/L). Sealing leaves this undefined.
  notes?: string;
  createdAt?: string;
  updatedAt?: string;

  // --- ASPHALT FIELDS (Sealing season only) ---
  saleType?: 'asphalt';                // 'asphalt' = child row. Undefined = driveway parent or pre-asphalt row.
  parentId?: string;                   // If saleType='asphalt', points to the driveway parent. Null for standalone RC or deferred children.
  assignedRcSessionId?: string;        // RC's session id when assigned. Undefined/null = unassigned.
  asphaltAmount?: number;              // $ for the asphalt portion.
  upsoldAsphaltAmount?: number;        // $ upsold by RC on-site. Undefined or 0 if none.

  // --- PATH 3 ADDITION ---
  // sharedJobKey: set when this child was created by a driveway-deferred
  // completion. Matches the cart's already-written tx's asphalt_meta.sharedJobKey.
  // When RC completes the asphalt via asphalt-executor-only, this key is stamped
  // on the RC's tx so the export's two-row builder can pair the two real txs.
  sharedJobKey?: string;
}

// Fields accepted by sessionService.createPendingSale().
// id / commandCenterId / sessionDate / timestamps are filled by the service.
//
// ASPHALT ORCHESTRATION (handled inside createPendingSale):
//   - saleType='asphalt' + no parentId  → asphalt-only standalone (RC sells solo asphalt).
//   - asphaltAmount/upsoldAsphaltAmount with no saleType → parent driveway row PLUS
//     an auto-generated asphalt child row are written atomically. The child gets
//     auto-assigned to the calling session if the caller is an RC; otherwise it's
//     left unassigned for the RM to assign via the asphalt modal.
//   - Neither asphalt field set → normal driveway-only row.
//
// sharedJobKey is reserved for callers that need to link a child to an already-
// completed driveway tx (the driveway-deferred completion path in sessionService).
// UI callers (QuickPendingModal, NewJob walk-up) don't pass it.
export interface PendingSaleInput {
  sessionId: string;
  workerId: string;
  routeCode?: string;
  houseNumber?: string;
  streetName?: string;
  price?: string;
  propertyType?: string;
  services?: ServiceFlags;
  notes?: string;

  // --- ASPHALT FIELDS ---
  saleType?: 'asphalt';
  parentId?: string;
  assignedRcSessionId?: string;
  asphaltAmount?: number;
  upsoldAsphaltAmount?: number;

  // --- PATH 3 ADDITION ---
  // sharedJobKey: only set by sessionService internally when creating a deferred
  // asphalt child as part of a driveway-deferred completion. UI callers leave
  // this undefined.
  sharedJobKey?: string;
}

// Fields accepted by sessionService.updatePendingSale(). All optional.
//
// assignedRcSessionId: pass `null` to clear an existing assignment (RM unassign).
// Other asphalt fields can be zeroed by passing 0 explicitly.
// sharedJobKey: `null` clears the link (rare — typically only used in rollback).
export interface PendingSaleUpdate {
  routeCode?: string;
  houseNumber?: string;
  streetName?: string;
  price?: string;
  propertyType?: string;
  services?: ServiceFlags;
  notes?: string;

  // --- ASPHALT FIELDS ---
  assignedRcSessionId?: string | null;
  asphaltAmount?: number;
  upsoldAsphaltAmount?: number;

  // --- PATH 3 ADDITION ---
  sharedJobKey?: string | null;
}

// --- RAMP CREW + ASPHALT (Sealing season only) ---
// Asphalt = the Sealing-only Ramp Crew add-on workflow. A regular cart can sell
// an asphalt component alongside the driveway sale; a Ramp Crew (RC) executes
// the asphalt portion. Cash and payout-share split per ASPHALT_SPLIT below.
//
// Four completion modes exist in sessionService.completeAsphaltJob — see the
// AsphaltCompletionContext discriminated union in sessionService.ts for details:
//   1. completer-with-phantom — both pending rows exist, completer fires both
//      txs at once (real + cashless phantom partner).
//   2. self-both — solo RC sold and executed everything (single tx).
//   3. driveway-deferred — cart writes driveway tx with asphalt_meta; asphalt
//      child pending row is created atomically for an RC to pick up later.
//   4. asphalt-executor-only — RC completes a deferred asphalt child; writes
//      RC's tx with the same sharedJobKey as the cart's already-existing tx.

// Case-sensitive match pattern for Ramp Crew team IDs.
// Matches: 'RC', 'RC1', 'RC2', 'RC10', ...
// Does NOT match: 'rc1', 'RCA', 'RCB', etc.
// Used to detect special RC carts via Worker.teamId.
export const RAMP_CREW_TEAM_ID_PATTERN = /^RC\d*$/;

// Payout-share split constants for the asphalt workflow.
//   Driveway $   → 100% to selling cart  (DRIVEWAY_CART)
//   Asphalt $    → 30% selling cart      (ASPHALT_CART)
//                + 70% RC                 (ASPHALT_RC)
//   Upsold $     → 100% to RC            (UPSOLD_RC)
// Frozen so downstream code can rely on the values.
export const ASPHALT_SPLIT = Object.freeze({
  DRIVEWAY_CART: 1.0,
  ASPHALT_CART: 0.30,
  ASPHALT_RC: 0.70,
  UPSOLD_RC: 1.0,
});

// Cart classification — derived from teamId pattern.
export type CartKind = 'ramp-crew' | 'regular';

// Role of a transaction in the asphalt workflow.
//   driveway-seller  — wrote the driveway portion. payoutShare = driveway $ + 30% asphalt $.
//   asphalt-executor — wrote the asphalt portion. payoutShare = 70% asphalt $ + 100% upsold $.
//   self-both        — single tx covering everything (solo RC). payoutShare = driveway + asphalt + upsold.
export type AsphaltRole = 'driveway-seller' | 'asphalt-executor' | 'self-both';

// AsphaltMeta — JSONB payload stored on each transaction that participates in
// an asphalt sale. The Logsheets export's two-row builder groups txs by
// sharedJobKey, identifies driveway/asphalt rows by role, and reads amounts.
//
// Field naming: a deliberate mix of camelCase (sharedJobKey, role) and snake_case
// (driveway_amount, etc.) — preserved to match what's already written to JSONB.
// Don't rename without a backfill migration.
export interface AsphaltMeta {
  sharedJobKey: string;                  // Links paired txs (driveway-seller + asphalt-executor) across cart/RC sessions.
  role: AsphaltRole;
  driveway_amount: number;               // $ for the driveway portion (0 if asphalt-only).
  asphalt_amount: number;                // $ for the asphalt portion.
  upsold_asphalt_amount?: number;        // $ added by RC on-site (undefined or 0 if none).
  is_partner_phantom: boolean;           // True for the cashless mirror tx in completer-with-phantom mode.
  partner_session_id: string | null;     // The other cart's session_id when known. Null for self-both / driveway-deferred (RC not yet assigned).
  did_upsell: boolean;                   // True if asphalt-executor / self-both added any upsold amount.
}

// Result shape from commandCenterService.calculateAsphaltSplit.
export interface AsphaltSplit {
  cartShare: number;   // Selling cart's payout-share contribution (driveway $ + 30% asphalt $).
  rcShare: number;     // RC's payout-share contribution (70% asphalt $ + 100% upsold $).
  total: number;       // cartShare + rcShare. Equals driveway + asphalt + upsold.
}

// --- ROUTE SPLIT (Digital mapping CCs only — RM-side visual route division) ---
//
// A RouteSplit divides ONE route into MULTIPLE visual buckets (a, b, c, d, ...)
// purely at the RM-tooling layer. The bookings and routes tables keep the same
// route_code — workers continue to see "BIN09" on their logsheet. The RM sees
// "BIN09a", "BIN09b", "BIN09c", ... on the master map, and per-bucket
// assignments restrict which bookings each worker actually receives.
//
// Recursive carving: every split operation carves ONE new bucket out of an
// existing source bucket. So you can split 'a' into a+b, then split a again
// into a+c (a shrinks), then split b into b+d (b shrinks), etc. The bucket
// being carved gets the next available letter globally; the source bucket
// keeps its letter but loses any pieces/bookings that fall inside the new
// rectangles.
//
// Eligibility (enforced in calling UI, not here):
//   - A bucket can only be split if it has zero assigned workers. Other
//     buckets on the same route can be assigned or unassigned — doesn't matter.
//
// Persistence: per (CC, session_date, route_code), wiped on session end.
//
// Bucketing semantics:
//   - rectangles: list of geographic rectangles {west,east,south,north} that
//     define the carved region. The 'a' bucket always has an empty rectangles
//     list (it's the leftover/default).
//   - Line-piece bucketing happens at RENDER TIME: a piece's midpoint is
//     checked against each bucket's rectangles in chronological order. This
//     gives sharp half-segment edges — a long street that's partly inside a
//     rectangle splits along the rectangle boundary instead of going wholly
//     to one bucket based on its midpoint.
//   - Booking bucketing is PRECOMPUTED at split time and cached as bookingIds
//     because booking lat/lng never changes during a session. The carving
//     modal computes which bookings move from source → new and the service
//     updates both buckets' lists atomically.
//
// The route's existing routes.assigned_worker_ids field continues to be the
// UNION of all buckets' assignedWorkers, so existing per-booking assignment
// flows (assignBookingToWorker, assignRouteToWorkers) keep working unchanged.

export interface RouteSplitRectangle {
  west: number;   // min longitude
  east: number;   // max longitude
  south: number;  // min latitude
  north: number;  // max latitude
}

export interface RouteSplitBucket {
  // The letter for this bucket — "a", "b", "c", ...
  // Globally unique per route. "a" is always present (the original).
  letter: string;
  // The bucket this one was carved from. null for "a"; the parent letter
  // for everything else. Used for visualization (e.g. "b shrank into c when
  // RM carved further") and for the render-time bucketing cascade.
  sourceLetter: string | null;
  // Geographic rectangles defining the carved region. Empty array for "a".
  rectangles: RouteSplitRectangle[];
  // Booking IDs currently in this bucket. Precomputed at split time.
  bookingIds: string[];
  // Worker IDs assigned to this bucket. The route's assigned_worker_ids is
  // the UNION across all buckets so existing flows keep working.
  assignedWorkers: string[];
  // FLOATER: the manager who owns THIS bucket. Absent = fall back to
  // routes.manager_id (the unsplit/unstamped default). Stamped when a bucket
  // is cross-assigned to a cart under a different manager, so "half a route"
  // can belong to a different manager than the rest.
  managerId?: string;
}

export interface RouteSplit {
  id?: string;
  commandCenterId: string;
  sessionDate: string;               // YYYY-MM-DD
  routeCode: string;                 // base route code (e.g. "BIN09")
  // Index 0 is always the "a" bucket. Subsequent entries are carved buckets
  // in chronological order (which matters for the render-time bucketing
  // cascade).
  buckets: RouteSplitBucket[];
  createdAt?: string;
  updatedAt?: string;
}

// Changed 'gross' to 'upGross' for clarity - sorts by upsell gross only
// 'bonusEquiv' sorts team carts by EQ ÷ team-size multiplier (fair cross-team comparison)
export type SortOption = 'standard' | 'alpha' | 'steps' | 'upGross' | 'equiv' | 'upsell' | 'commission' | 'bonusEquiv';

// --- EMAIL TEMPLATES ---

export type EmailTemplateType = 
  // General types
  | 'production'
  | 'sale'
  | 'billed'
  | 'prepaid'
  // West Upgrades (Aeration only)
  | 'upgrade_star_plan_pro'
  | 'upgrade_lawn_rejuv'
  | 'upgrade_golf_course'
  // West Add-Ons (Aeration)
  | 'addon_dethatch'
  | 'addon_rejuv_after_care'
  | 'addon_grub'
  // West Add-Ons (Lawn Rejuv) - Grub and After Care only
  // Central Add-Ons
  | 'addon_window_washing'
  // East Add-Ons
  | 'addon_driveway_sealing'
  | 'addon_hot_asphalt';

// --- EMAIL TEMPLATE CONTENT STRUCTURE (for editor) ---
export interface EmailTemplateContentStructure {
  greeting: string;
  mainContent: string;
  showServiceDetails: boolean;
  showPaymentDetails: boolean;
  showEtransferInstructions?: boolean; // Show E-Transfer instructions when payment method includes E-Transfer
  footerText: string;
}

export interface EmailTemplate {
  id: string;
  commandCenterId: string;
  templateType: EmailTemplateType;
  templateName: string;
  subject: string;
  htmlContent: string;
  contentStructure?: EmailTemplateContentStructure;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmailTemplateBlock {
  id: string;
  type: 'header' | 'greeting' | 'content' | 'service_details' | 'payment_details' | 'footer';
  content: string;
  settings?: Record<string, any>;
}

export interface EmailTemplateStructure {
  blocks: EmailTemplateBlock[];
  styles?: {
    primaryColor?: string;
    fontFamily?: string;
  };
}

// Template type metadata for UI
export interface EmailTemplateTypeInfo {
  type: EmailTemplateType;
  name: string;
  category: 'general' | 'upgrade' | 'addon';
  description: string;
  region?: Region;
  seasonType?: SeasonType; // Which season this template applies to
}

// --- SEASON CONFIGURATION CONSTANTS ---
export interface SeasonConfig {
  seasonType: SeasonType;
  displayName: string;
  
  // Pricing
  prepaidWeight: number;      // 0.5 for aeration, 0.6 for lawn_rejuv, 0.5 for sealing
  billedWeight: number;       // 0.5 for all
  
  // PAYOUT RATES ($/EQ for commission calculation)
  // NOTE: These are BASE rates. Final rate = base + alumniRate + silverRate
  // alumniRate and silverRate are also $/EQ amounts (not percentages)
  payoutRateSolo: number;     // $8 aeration, $7 lawn_rejuv, $6 sealing
  payoutRateTeam: number;     // $8 aeration, $9 lawn_rejuv, $8 sealing
  
  // Product Cost Deduction (percentage, 0-100)
  // Applied after tax removal: prodPayable = (weightedProd / taxDivisor) * (1 - productCost/100)
  defaultProductCostPercent: number; // 0 aeration, 25 lawn_rejuv, 20 sealing
  
  // Office Flats
  officeFlats: {
    code: string;
    value: number;
  }[];
  
  // Available add-ons/upgrades
  hasUpgrades: boolean;
  availableAddOns: string[];  // refIds
}

export const SEASON_CONFIGS: Record<SeasonType, SeasonConfig> = {
  aeration: {
    seasonType: 'aeration',
    displayName: 'Aeration Season',
    prepaidWeight: 0.5,
    billedWeight: 0.5,
    // Payout rates for aeration: $8/EQ base for everyone
    // Final rate = $8 + alumniRate + silverRate
    payoutRateSolo: 8,
    payoutRateTeam: 8,
    // No product cost deduction for aeration
    defaultProductCostPercent: 0,
    officeFlats: [
      { code: 'SP', value: 52.5 },
      { code: 'RJ', value: 52.5 },
    ],
    hasUpgrades: true,
    availableAddOns: ['dethatch', 'rejuv_after_care', 'grub'],
  },
  lawn_rejuv: {
    seasonType: 'lawn_rejuv',
    displayName: 'Lawn Rejuvenation Season',
    prepaidWeight: 0.6,
    billedWeight: 0.5,
    // Payout rates for lawn rejuv: $7/EQ solo, $9/EQ for teams of 2+
    // Final rate = base + alumniRate + silverRate
    payoutRateSolo: 7,
    payoutRateTeam: 9,
    // 25% product cost deduction for lawn rejuv
    defaultProductCostPercent: 25,
    officeFlats: [
      { code: 'FSL', value: 157.5 },
    ],
    hasUpgrades: false,
    availableAddOns: ['star_plan_pro_rejuv', 'chafer_beetle', 'star_plan_protection_plus'],
  },
  // --- SEALING SEASON (East region only) ---
  // Same team mechanics as Rejuv. No upgrades, no add-ons, no office flats.
  // No-tax-on-cash toggle is available at session start (same as Rejuv).
  // Property types in UI: SS, SSP. The 'Ramp' value is reserved for the
  // asphalt add-on workflow's child row on the Logsheets export.
  sealing: {
    seasonType: 'sealing',
    displayName: 'Sealing Season',
    prepaidWeight: 0.5,
    billedWeight: 0.5,
    // Payout rates for sealing: $6/EQ solo, $8/EQ for teams of 2+
    // Final rate = base + alumniRate + silverRate
    payoutRateSolo: 6,
    payoutRateTeam: 8,
    // 20% product cost deduction for sealing
    defaultProductCostPercent: 20,
    officeFlats: [],
    hasUpgrades: false,
    availableAddOns: [],
  },
  // TODO: Add 'cleaning' season config for Central region when ready.
  //       Will likely need teams=true, its own pricing, and own property types.
  //       Search "TODO.*cleaning" across the codebase to find every spot to update.
};
