// src/types/index.ts

// --- USER & AUTH ---

export interface ManagementUser {
  userId: string;
  username: string; // e.g. "basvi"
  password?: string; // e.g. "Vijay"
  name: string; // "Vijay Baskaran"
  role: 'Admin' | 'RouteManager'; 
}

// --- BONUS STRUCTURE ---
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

  // --- RATES & METADATA ---
  alumniRate?: number;      // e.g., 0.50
  silverRate?: number;      // e.g., 0.50
  customBaseRate?: number;  // Optional override
  
  assignedManagerId?: string; // Links to ManagementUser.userId
}

// --- DATA FEED STRUCTURE ---

export interface RouteData {
  routeCode: string;
  managerId: string; 
  assignedWorkerId: string | null; 
  streets?: string[];
}

export interface DailySessionData {
  date: string; // YYYY-MM-DD
  managers: ManagementUser[]; 
  workers: Worker[]; 
  routes: RouteData[]; 
  pendingBookings: MasterBooking[]; 
}

// --- PAYOUT VALIDATION ---
export interface SessionValidation {
    isValidated: boolean;
    
    // Inputs
    verifiedCash: number;
    verifiedCheque: number;
    
    // Diffs
    cashDiff: number;       
    chequeDiff: number;     
    
    // Resolved "Actual" Stats
    actualProdCash: number;
    actualProdCheque: number;
    actualTotalEQ: number;

    machineRental: boolean; // True = Deduct $10
    finalCommission: number;
    managerName?: string;
    timestamp?: string;
}

// --- LOGSHEET SESSION ---

export interface LogsheetSession {
  id: string;
  workerId: string;
  managerName?: string; 
  date: string;
  status: 'OPEN' | 'COMPLETE' | 'CLOSED'; 
  
  // Note: These arrays are populated by the service after fetching
  dailyRouteStore: MasterBooking[];   
  financialStore: SessionTransaction[]; 
  
  stats: SessionStats;

  // Payout Data
  validation?: SessionValidation;
  bonuses?: Bonus[]; 
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
  
  // Logic
  isWestSplit?: boolean;   
  refId?: string;
  itemDescription?: string;
  paymentBreakdown?: Record<string, number>;
}

export type SortOption = 'alpha' | 'steps' | 'gross' | 'equiv' | 'upsell' | 'commission';