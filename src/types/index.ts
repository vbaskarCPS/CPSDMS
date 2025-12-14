// src/types/index.ts

// --- USER & AUTH ---

export interface ManagementUser {
  userId: string;
  username: string; // e.g. "basvi"
  password?: string; // e.g. "Vijay"
  name: string; // "Vijay Baskaran"
  role: 'Admin' | 'RouteManager'; 
}

// --- NEW INTERFACE: Bonus ---
export interface Bonus {
    id: number;
    type: string;   // e.g., "Performance", "Rookie of Day"
    amount: number;
}

export interface Worker {
  contractorId: string;
  firstName: string;
  lastName: string;
  cellPhone?: string;
  email?: string;
  status: 'Rookie' | 'Return' | 'Alumni';

  // --- NEW FIELDS FOR PAYOUT REFACTOR ---
  isAlumni?: boolean;       // Triggers Alumni Increment (e.g. +$1.00)
  isSilver?: boolean;       // Triggers Silver Increment (e.g. +$1.00)
  
  // NEW: Flexible Rate Imports from Excel
  alumniRate?: number;      // e.g., 0.50 or 1.00
  silverRate?: number;      // e.g., 0.50 or 1.00

  customBaseRate?: number;  // Optional override for base rate
  
  // New Session Linkage
  assignedManagerId?: string; // Links to ManagementUser.userId
  
  // Transient Session Data (Calculated at runtime)
  stats?: any; // Will be defined in payout service
}

// --- CORE DATA FEED (THE NEW SESSION STORE) ---

export interface RouteData {
  routeCode: string;
  managerId: string; // The "Manager Assignment" from CSV
  assignedWorkerId: string | null; // Assigned via RM Tool
  streets?: string[]; // Added to ensure feedParser compatibility
}

export interface DailySessionData {
  date: string; // YYYY-MM-DD
  managers: ManagementUser[]; // Derived from Routes CSV
  workers: Worker[]; // Derived from Workers CSV
  routes: RouteData[]; // Derived from Routes CSV
  
  // The "Pending Queue" (Aeration Jobs)
  pendingBookings: MasterBooking[]; // Derived from Bookings CSV
}

// --- NEW INTERFACE: SessionValidation ---
export interface SessionValidation {
    isValidated: boolean;
    
    // Inputs
    verifiedCash: number;
    verifiedCheque: number;
    
    // Diffs
    cashDiff: number;       // Difference (Actual - Expected)
    chequeDiff: number;     // Difference (Actual - Expected)
    
    // Resolved "Actual" Stats (Written by PayoutContractor)
    actualProdCash: number;
    actualProdCheque: number;
    actualTotalEQ: number;

    machineRental: boolean; // True = Deduct $10
    finalCommission: number;// The frozen final payout amount
    managerName?: string;
    timestamp?: string;
}

// --- LOGSHEET SESSION ---

export interface LogsheetSession {
  id: string;
  workerId: string;
  
  // NEW: Snapshot of the manager at creation time
  managerName?: string; 
  
  date: string;
  status: 'OPEN' | 'COMPLETE' | 'CLOSED'; // Updated to include 'COMPLETE'
  
  // Operational List (Jobs on the device)
  dailyRouteStore: MasterBooking[];   
  
  // Financial Store (Completed jobs)
  financialStore: SessionTransaction[]; 
  
  // Stats
  stats: SessionStats;

  // *** NEW FIELDS FOR PAYOUT REFACTOR ***
  validation?: SessionValidation;
  bonuses?: Bonus[]; 
  payoutStatus?: 'PENDING' | 'VALIDATED' | 'PAID';
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
  'Master Map'?: string;
  
  // Status
  'Completed'?: string; 
  'Status'?: string;    
  'Date Completed'?: string;
  
  // Display Info
  'Price'?: string;
  'Log Sheet Notes'?: string;
  
  // Logic
  'Prepaid'?: string;
  isContract?: boolean;
  isPrebooked?: boolean;
  
  // Upsell linkage
  upsellMenuId?: string; 
  
  // Legacy Flags
  'Call First'?: string;
  'Gate'?: string;
  'Must be home'?: string;
  'Sprinkler'?: string;
  'Second Run'?: string;
  'FO/BO/FP'?: 'FO' | 'BO' | 'FP' | 'SS' | 'SSP' | 'Ramp';
  
  // New: Assignment
  'Contractor Number'?: string;
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
  
  workerId: string;
  workerName: string;
  routeManagerName: string;
  
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
  
  // Logic
  isWestSplit?: boolean;   
  refId?: string;
  itemDescription?: string;
}

// --- RM SESSION ---

export interface RMSession {
  id: string;
  managerId: string;
  date: string;
}