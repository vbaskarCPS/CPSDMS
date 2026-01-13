// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { sessionService } from './sessionService';

// Badge mapping (matches ContractorJobs & PayoutContractor)
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC'
};

// Helper: Get badge label for a transaction (mirrors UI logic)
const getClientTypeBadge = (tx: any): string => {
  const itemName = tx.items?.[0]?.name || '';
  const type = tx.type || '';

  // 1. Check item name against BADGE_MAP first
  if (BADGE_MAP[itemName]) {
    return BADGE_MAP[itemName];
  }

  // 2. Fall back to type-based labels
  if (type === 'Upgrade') return 'UPGRADE';
  if (type === 'Add-On') return 'ADD-ON';
  if (type === 'Sale') return 'SALE';
  
  // Default (Production)
  return 'DONE';
};

// Helper: Set column widths on a worksheet
const setColumnWidths = (ws: XLSX.WorkSheet, widths: number[]) => {
  ws['!cols'] = widths.map(w => ({ wch: w }));
};

export const generateSessionExport = async () => {
  // 1. Get Date
  const date = await sessionService.getDailySessionDate();
  if (!date) {
    alert('No active session found.');
    return;
  }

  // 2. Fetch ALL Data from Supabase (Parallel)
  const [logsheetsReq, transactionsReq, bookingsReq, usersReq] =
    await Promise.all([
      supabase.from('logsheet_sessions').select('*').eq('date', date),
      supabase.from('transactions').select('*'),
      supabase.from('bookings').select('*').eq('session_date', date),
      supabase.from('users').select('*'),
    ]);

  const logsheets = logsheetsReq.data || [];
  const transactions = transactionsReq.data || [];
  const users = usersReq.data || [];

  // FIXED: Sort bookings by original Excel order (sort_order stored in data column)
  const bookings = (bookingsReq.data || []).sort((a, b) => {
    const orderA = a.data?.sort_order ?? Infinity;
    const orderB = b.data?.sort_order ?? Infinity;
    return orderA - orderB;
  });

  // Create a Map of Managers for quick lookup
  const managerMap = new Map();
  users
    .filter((u) => u.role === 'RouteManager')
    .forEach((m) => managerMap.set(m.user_id, m.name));

  // --- TAB 1: STATS (Restored Old Columns) ---
  const statsRows = logsheets.map((session) => {
    const worker = users.find((u) => u.user_id === session.worker_id);
    const stats = session.stats || {};
    const val = session.validation || {};

    // Manager Name Lookup
    let managerName = session.managerName || '';
    if (!managerName && worker?.metadata?.assignedManagerId) {
      managerName = managerMap.get(worker.metadata.assignedManagerId) || '';
    }

    // Determine Resolved Amounts (Actual vs System)
    const actualProdCash = val.isValidated
      ? val.actualProdCash
      : stats.prodCash + stats.upsellCash;
    
    const actualProdCheque = val.isValidated
      ? val.actualProdCheque
      : stats.prodCheque + stats.upsellCheque;
      
    const actualTotalEQ = val.isValidated ? val.actualTotalEQ : stats.totalEQ;

    const finalPay = val.finalCommission || 0;

    // Rates
    const baseRate = 8.0;
    const alumniRate = worker?.metadata?.alumniRate || 0;
    const silverRate = worker?.metadata?.silverRate || 0;
    const payoutRate = baseRate + alumniRate + silverRate;
    
    // Commissions
    const prodComm = actualTotalEQ * payoutRate;
    const upsellComm = (stats.upsellPayable || 0) * 0.1;
    const iosComm = (stats.iosCount || 0) * 5.0;
    
    const bonusTotal = (session.bonuses || []).reduce(
      (a: any, b: any) => a + b.amount,
      0
    );

    // --- EXACT MAPPING FROM OLD CODE ---
    return {
      "Contractor ID": session.worker_id,
      "First Name": worker?.name.split(' ')[0] || '',
      "Last Name": worker?.name.split(' ').slice(1).join(' ') || '',
      "Manager": managerName,
      "Step Count": stats.stepCount,
      "IOSCount": stats.iosCount,

      "prodBilled": stats.prodBilled,
      "prodCash": actualProdCash,
      "prodCheque": actualProdCheque,
      "prodCreditCard": stats.prodCreditCard,
      "prodETransfer": stats.prodETransfer,
      "ProdFlats": stats.prodFlats,
      "prodPrepaid": stats.prodPrepaid,
      "prodPrepaidSplit": stats.prodPrepaidSplit, 

      "ProdGross": stats.prodGross,
      "ProdPayable": stats.prodPayable,
      "totalEQ": actualTotalEQ,

      "upsellCount": stats.upsellCount,
      "upsellCash": stats.upsellCash,
      "upsellCheque": stats.upsellCheque,
      "upsellCreditCard": stats.upsellCreditCard,
      "upsellETransfer": stats.upsellETransfer,
      "upsellPrepaid": stats.upsellPrepaid, 

      "upsellGross": stats.upsellGross,
      "upsellPayable": stats.upsellPayable,

      "Payout rate": payoutRate,
      "Production Comm.": prodComm,
      "Upsell Commission": upsellComm,
      "IOS Commission": iosComm,
      "Machine Rental": val.machineRental ? -10 : 0,
      "Deductions": 0,
      "Bonuses": bonusTotal,
      "Final Pay": finalPay,
    };
  });

  // --- TAB 2: BOOKINGS (Restored Headers) - Now sorted by original order ---
  const bookingRows = bookings.map((b) => ({
    "Route #": b.route_number,
    "First Name": b.customer_details['First Name'],
    "Last Name": b.customer_details['Last Name'],
    "House #": (b.customer_details['Full Address'] || '').split(' ')[0],
    "Street Name": (b.customer_details['Full Address'] || '').split(' ').slice(1).join(' '),
    "Call 1st": b.log_notes,
    "Phone #": b.customer_details['Home Phone'] || b.customer_details['Cell Phone'],
    "E-Mail": b.customer_details['Email Address'],
    "Service Type": b.customer_details['FO/BO/FP'],
    "PP": b.is_prepaid ? 'x' : '',
    "AER. AMT": b.price,
    "Completed/Cancelled": b.status === 'completed' ? date : (b.status === 'cancelled' ? 'Cancelled' : ''),
    "Worker": b.contractor_id || ''
  }));

  // --- TAB 3: LOGSHEETS (All Transactions) ---
  const logsheetRows = transactions.map((tx) => {
    const worker = users.find((u) => u.user_id === tx.worker_id);
    
    // Helper to extract street # (Matches old logic)
    const addr = tx.customer_snapshot?.address || '';
    const addrParts = addr.split(' ');
    const streetNum = /^\d+$/.test(addrParts[0]) ? addrParts[0] : '';
    const streetName = /^\d+$/.test(addrParts[0]) ? addrParts.slice(1).join(' ') : addr;

    return {
      "Route #": tx.customer_snapshot?.routeCode,
      "First Name": tx.customer_snapshot?.firstName,
      "Last Name": tx.customer_snapshot?.lastName,
      "Street #": streetNum,
      "Street Name": streetName,
      "Phone Number": tx.customer_phone || '',
      "Email Address": tx.customer_email || '',
      "Client Type": getClientTypeBadge(tx), // UPDATED: Use badge logic
      "Property Type": tx.customer_snapshot?.serviceType || '',
      "Notes": tx.item_description,
      "Price": tx.price,
      "Payment Type": tx.payment_method,
      "Contractor Name": worker?.name
    };
  });

  // --- TAB 4: ACCOUNTS (Credit Card, E-Transfer, Billed ONLY - No Cheque) ---
  const accountsRows = transactions
    .filter(tx => ['Credit Card', 'Billed', 'E-Transfer'].includes(tx.payment_method)) // UPDATED: Removed 'Cheque'
    .map(tx => {
        const worker = users.find(u => u.user_id === tx.worker_id);
        
        const addr = tx.customer_snapshot?.address || '';
        const addrParts = addr.split(' ');
        const streetNum = /^\d+$/.test(addrParts[0]) ? addrParts[0] : '';
        const streetName = /^\d+$/.test(addrParts[0]) ? addrParts.slice(1).join(' ') : addr;

        // Restore "Payment Type Details" formatting
        let details = '';
        if (tx.payment_method === 'Credit Card') details = `CCD: ${tx.cc_full_number || '***'}`;
        if (tx.payment_method === 'Billed') details = `INV: ${tx.invoice_number || ''}`;
        if (tx.payment_method === 'E-Transfer') details = `Email: ${tx.etransfer_email || ''}`;

        return {
           "Route #": tx.customer_snapshot?.routeCode,
           "First Name": tx.customer_snapshot?.firstName,
           "Last Name": tx.customer_snapshot?.lastName,
           "Street #": streetNum,
           "Street Name": streetName,
           "Phone Number": tx.customer_phone || '', 
           "Email Address": tx.customer_email || '',
           "Client Type": getClientTypeBadge(tx), // UPDATED: Use badge logic
           "Property Type": tx.customer_snapshot?.serviceType || '',
           "Notes": tx.item_description,
           "Price": tx.price,
           "Payment Type": tx.payment_method,
           "Contractor Name": worker?.name,
           "Payment Type Details": details,
           
           // Sensitive Columns
           "Expiry": tx.cc_expiry || '',
           "CVC": tx.cc_cvc || ''
        };
    });

  // --- BUILD WORKBOOK ---
  const wb = XLSX.utils.book_new();
  
  // TAB 1: Stats
  const wsStats = XLSX.utils.json_to_sheet(statsRows);
  setColumnWidths(wsStats, [
    14, // Contractor ID
    12, // First Name
    12, // Last Name
    15, // Manager
    10, // Step Count
    10, // IOSCount
    10, // prodBilled
    10, // prodCash
    10, // prodCheque
    12, // prodCreditCard
    12, // prodETransfer
    10, // ProdFlats
    10, // prodPrepaid
    14, // prodPrepaidSplit
    10, // ProdGross
    10, // ProdPayable
    10, // totalEQ
    10, // upsellCount
    10, // upsellCash
    12, // upsellCheque
    14, // upsellCreditCard
    14, // upsellETransfer
    12, // upsellPrepaid
    10, // upsellGross
    12, // upsellPayable
    10, // Payout rate
    14, // Production Comm.
    14, // Upsell Commission
    12, // IOS Commission
    12, // Machine Rental
    10, // Deductions
    10, // Bonuses
    10, // Final Pay
  ]);
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  // TAB 2: Bookings
  const wsBookings = XLSX.utils.json_to_sheet(bookingRows);
  setColumnWidths(wsBookings, [
    8,  // Route #
    12, // First Name
    12, // Last Name
    8,  // House #
    25, // Street Name
    20, // Call 1st
    14, // Phone #
    25, // E-Mail
    10, // Service Type
    4,  // PP
    10, // AER. AMT
    18, // Completed/Cancelled
    15, // Worker
  ]);
  XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');

  // TAB 3: Logsheets
  const wsLogsheets = XLSX.utils.json_to_sheet(logsheetRows);
  setColumnWidths(wsLogsheets, [
    8,  // Route #
    12, // First Name
    12, // Last Name
    8,  // Street #
    25, // Street Name
    14, // Phone Number
    25, // Email Address
    10, // Client Type
    10, // Property Type
    30, // Notes
    10, // Price
    12, // Payment Type
    18, // Contractor Name
  ]);
  XLSX.utils.book_append_sheet(wb, wsLogsheets, 'Logsheets');

  // TAB 4: Accounts
  const wsAccounts = XLSX.utils.json_to_sheet(accountsRows);
  setColumnWidths(wsAccounts, [
    8,  // Route #
    12, // First Name
    12, // Last Name
    8,  // Street #
    25, // Street Name
    14, // Phone Number
    25, // Email Address
    10, // Client Type
    10, // Property Type
    30, // Notes
    10, // Price
    12, // Payment Type
    18, // Contractor Name
    25, // Payment Type Details
    10, // Expiry
    6,  // CVC
  ]);
  XLSX.utils.book_append_sheet(wb, wsAccounts, 'Accounts');

  // WRITE FILE
  XLSX.writeFile(wb, `Data Out - ${date}.xlsx`);
};