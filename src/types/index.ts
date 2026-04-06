// src/types/index.ts

// --- COMMAND CENTER (Multi-tenant) ---
export type Region = 'West' | 'Central' | 'East';

// --- SEASON TYPES (West Region Only) ---
export type SeasonType = 'aeration' | 'lawn_rejuv';

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
  
  // --- TEAM SUPPORT (Lawn Rejuv Season) ---
  teamId?: string; // e.g., "v1", "v2", "1", "2" - workers with same teamId share a cart
}

// --- TEAM/CART STRUCTURE (Lawn Rejuv) ---
export interface TeamCart {
  teamId: string;
  workerIds: string[];
  workers: Worker[];
  logsheetSessionId?: string;
}

// --- DATA FEED STRUCTURE ---

export interface RouteData {
  routeCode: string;
  managerId: string; 
  assignedWorkerIds: string[]; // For aeration: individual workers. For lawn_rejuv: can include team representatives
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
  seasonType?: SeasonType; // 'aeration' | 'lawn_rejuv' (West only, defaults to 'aeration')
  
  // --- TEAM CARTS (Lawn Rejuv only) ---
  teamCarts?: TeamCart[]; // Grouped workers by teamId
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
  
  // --- TEAM SUPPORT (Lawn Rejuv Season) ---
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
  
  'FO/BO/FP'?: 'FO' | 'BO' | 'FP' | 'SS' | 'SSP' | 'Ramp';
  'Contractor Number'?: string;
  
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- SESSION ASSIGNMENT (Lawn Rejuv) ---
  sessionId?: string; // Links to LogsheetSession.id for team-based assignment
  
  // --- SERVICE FLAGS (Lawn Rejuv Season) ---
  services?: ServiceFlags; // Which services are included (A/D/F/S/L)
  
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
  serviceType?: 'FO' | 'BO' | 'FP' | 'SS' | 'SSP' | 'Ramp';
  serviceName?: string;
  isPrepaid?: boolean;
  
  // Logic
  isWestSplit?: boolean;   
  refId?: string;
  itemDescription?: string;
  paymentBreakdown?: Record<string, number>;
  
  commandCenterId?: string; // Links to CommandCenter.id
  
  // --- SERVICE FLAGS (Lawn Rejuv Season) ---
  services?: ServiceFlags; // Which services were performed (A/D/F/S/L)
  
  // --- TEAM SUPPORT ---
  completedByWorkerIds?: string[]; // All workers who contributed (for team export)
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
  prepaidWeight: number;      // 0.5 for aeration, 0.6 for lawn_rejuv
  billedWeight: number;       // 0.5 for both
  
  // PAYOUT RATES ($/EQ for commission calculation)
  // NOTE: These are BASE rates. Final rate = base + alumniRate + silverRate
  // alumniRate and silverRate are also $/EQ amounts (not percentages)
  payoutRateSolo: number;     // $8 for aeration, $7 for lawn_rejuv solo
  payoutRateTeam: number;     // $8 for aeration, $9 for lawn_rejuv team (2+)
  
  // Product Cost Deduction (percentage, 0-100)
  // Applied after tax removal: prodPayable = (weightedProd / taxDivisor) * (1 - productCost/100)
  defaultProductCostPercent: number; // 0 for aeration, 25 for lawn_rejuv
  
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
    prepaidWeight: 0.6,   // CHANGED: was 0.7
    billedWeight: 0.5,
    // Payout rates for lawn rejuv: $7/EQ solo, $9/EQ for teams of 2+
    // Final rate = base + alumniRate + silverRate
    payoutRateSolo: 7,    // CHANGED: was 6
    payoutRateTeam: 9,    // CHANGED: was 8
    // 25% product cost deduction for lawn rejuv
    defaultProductCostPercent: 25,
    officeFlats: [
      { code: 'FSL', value: 157.5 },
    ],
    hasUpgrades: false,
    availableAddOns: ['grub', 'rejuv_after_care'], // Only these two in lawn_rejuv
  },
};