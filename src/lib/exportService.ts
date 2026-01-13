// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { sessionService } from './sessionService';
import { googleSheetsService } from './googleSheetsService';

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

// Helper: Extract street number and name from address
const parseAddress = (addr: string): { streetNum: string; streetName: string } => {
  const addrParts = (addr || '').split(' ');
  const streetNum = /^\d+$/.test(addrParts[0]) ? addrParts[0] : '';
  const streetName = /^\d+$/.test(addrParts[0]) ? addrParts.slice(1).join(' ') : addr;
  return { streetNum, streetName };
};

// Shared data fetching function
const fetchExportData = async () => {
  // 1. Get Date
  const date = await sessionService.getDailySessionDate();
  if (!date) {
    throw new Error('No active session found.');
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

  return { date, logsheets, transactions, bookings, users, managerMap };
};

// Generate stats rows (shared between both export methods)
const generateStatsRows = (logsheets: any[], users: any[], managerMap: Map<string, string>) => {
  return logsheets.map((session) => {
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

    return {
      contractorId: session.worker_id,
      firstName: worker?.name.split(' ')[0] || '',
      lastName: worker?.name.split(' ').slice(1).join(' ') || '',
      manager: managerName,
      stepCount: stats.stepCount || 0,
      iosCount: stats.iosCount || 0,
      prodBilled: stats.prodBilled || 0,
      prodCash: actualProdCash || 0,
      prodCheque: actualProdCheque || 0,
      prodCreditCard: stats.prodCreditCard || 0,
      prodETransfer: stats.prodETransfer || 0,
      prodFlats: stats.prodFlats || 0,
      prodPrepaid: stats.prodPrepaid || 0,
      prodPrepaidSplit: stats.prodPrepaidSplit || 0,
      prodGross: stats.prodGross || 0,
      prodPayable: stats.prodPayable || 0,
      totalEQ: actualTotalEQ || 0,
      upsellCount: stats.upsellCount || 0,
      upsellCash: stats.upsellCash || 0,
      upsellCheque: stats.upsellCheque || 0,
      upsellCreditCard: stats.upsellCreditCard || 0,
      upsellETransfer: stats.upsellETransfer || 0,
      upsellPrepaid: stats.upsellPrepaid || 0,
      upsellGross: stats.upsellGross || 0,
      upsellPayable: stats.upsellPayable || 0,
      payoutRate,
      productionComm: prodComm,
      upsellComm,
      iosComm,
      machineRental: val.machineRental ? -10 : 0,
      deductions: 0,
      bonuses: bonusTotal,
      finalPay,
    };
  });
};

// --- EXCEL EXPORT (Original) ---
export const generateSessionExport = async () => {
  const { date, logsheets, transactions, bookings, users, managerMap } = await fetchExportData();

  // --- TAB 1: STATS ---
  const statsData = generateStatsRows(logsheets, users, managerMap);
  const statsRows = statsData.map(s => ({
    "Contractor ID": s.contractorId,
    "First Name": s.firstName,
    "Last Name": s.lastName,
    "Manager": s.manager,
    "Step Count": s.stepCount,
    "IOSCount": s.iosCount,
    "prodBilled": s.prodBilled,
    "prodCash": s.prodCash,
    "prodCheque": s.prodCheque,
    "prodCreditCard": s.prodCreditCard,
    "prodETransfer": s.prodETransfer,
    "ProdFlats": s.prodFlats,
    "prodPrepaid": s.prodPrepaid,
    "prodPrepaidSplit": s.prodPrepaidSplit,
    "ProdGross": s.prodGross,
    "ProdPayable": s.prodPayable,
    "totalEQ": s.totalEQ,
    "upsellCount": s.upsellCount,
    "upsellCash": s.upsellCash,
    "upsellCheque": s.upsellCheque,
    "upsellCreditCard": s.upsellCreditCard,
    "upsellETransfer": s.upsellETransfer,
    "upsellPrepaid": s.upsellPrepaid,
    "upsellGross": s.upsellGross,
    "upsellPayable": s.upsellPayable,
    "Payout rate": s.payoutRate,
    "Production Comm.": s.productionComm,
    "Upsell Commission": s.upsellComm,
    "IOS Commission": s.iosComm,
    "Machine Rental": s.machineRental,
    "Deductions": s.deductions,
    "Bonuses": s.bonuses,
    "Final Pay": s.finalPay,
  }));

  // --- TAB 2: BOOKINGS ---
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

  // --- TAB 3: LOGSHEETS ---
  const logsheetRows = transactions.map((tx) => {
    const worker = users.find((u) => u.user_id === tx.worker_id);
    const { streetNum, streetName } = parseAddress(tx.customer_snapshot?.address);

    return {
      "Route #": tx.customer_snapshot?.routeCode,
      "First Name": tx.customer_snapshot?.firstName,
      "Last Name": tx.customer_snapshot?.lastName,
      "Street #": streetNum,
      "Street Name": streetName,
      "Phone Number": tx.customer_phone || '',
      "Email Address": tx.customer_email || '',
      "Client Type": getClientTypeBadge(tx),
      "Property Type": tx.customer_snapshot?.serviceType || '',
      "Notes": tx.item_description,
      "Price": tx.price,
      "Payment Type": tx.payment_method,
      "Contractor Name": worker?.name
    };
  });

  // --- TAB 4: ACCOUNTS ---
  const accountsRows = transactions
    .filter(tx => ['Credit Card', 'Billed', 'E-Transfer'].includes(tx.payment_method))
    .map(tx => {
        const worker = users.find(u => u.user_id === tx.worker_id);
        const { streetNum, streetName } = parseAddress(tx.customer_snapshot?.address);

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
           "Client Type": getClientTypeBadge(tx),
           "Property Type": tx.customer_snapshot?.serviceType || '',
           "Notes": tx.item_description,
           "Price": tx.price,
           "Payment Type": tx.payment_method,
           "Contractor Name": worker?.name,
           "Payment Type Details": details,
           "Expiry": tx.cc_expiry || '',
           "CVC": tx.cc_cvc || ''
        };
    });

  // --- BUILD WORKBOOK ---
  const wb = XLSX.utils.book_new();
  
  // TAB 1: Stats
  const wsStats = XLSX.utils.json_to_sheet(statsRows);
  setColumnWidths(wsStats, [14, 12, 12, 15, 10, 10, 10, 10, 10, 12, 12, 10, 10, 14, 10, 10, 10, 10, 10, 12, 14, 14, 12, 10, 12, 10, 14, 14, 12, 12, 10, 10, 10]);
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  // TAB 2: Bookings
  const wsBookings = XLSX.utils.json_to_sheet(bookingRows);
  setColumnWidths(wsBookings, [8, 12, 12, 8, 25, 20, 14, 25, 10, 4, 10, 18, 15]);
  XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');

  // TAB 3: Logsheets
  const wsLogsheets = XLSX.utils.json_to_sheet(logsheetRows);
  setColumnWidths(wsLogsheets, [8, 12, 12, 8, 25, 14, 25, 10, 10, 30, 10, 12, 18]);
  XLSX.utils.book_append_sheet(wb, wsLogsheets, 'Logsheets');

  // TAB 4: Accounts
  const wsAccounts = XLSX.utils.json_to_sheet(accountsRows);
  setColumnWidths(wsAccounts, [8, 12, 12, 8, 25, 14, 25, 10, 10, 30, 10, 12, 18, 25, 10, 6]);
  XLSX.utils.book_append_sheet(wb, wsAccounts, 'Accounts');

  // WRITE FILE
  XLSX.writeFile(wb, `Data Out - ${date}.xlsx`);
};

// --- GOOGLE SHEETS EXPORT ---
export const exportToGoogleSheets = async (): Promise<{
  bookingsUpdated: number;
  accountsAppended: number;
  logsheetsAppended: number;
  statsAppended: number;
}> => {
  // Ensure authenticated
  if (!googleSheetsService.isAuthenticated()) {
    const authenticated = await googleSheetsService.authenticate();
    if (!authenticated) {
      throw new Error('Google authentication failed. Please try again.');
    }
  }

  const { date, logsheets, transactions, bookings, users, managerMap } = await fetchExportData();

  // --- 1. UPDATE COMPLETED BOOKINGS in Feed Placeholder ---
  const completedBookings = bookings
    .filter(b => b.status === 'completed')
    .map(b => ({
      routeNumber: b.route_number,
      firstName: b.customer_details['First Name'] || '',
      lastName: b.customer_details['Last Name'] || '',
      dateCompleted: date,
      contractorId: b.contractor_id || '',
    }));

  const bookingsUpdated = await googleSheetsService.updateCompletedBookings(completedBookings);

  // --- 2. APPEND ACCOUNTS (Credit Card, E-Transfer, Billed only) ---
  const accountsData = transactions
    .filter(tx => ['Credit Card', 'Billed', 'E-Transfer'].includes(tx.payment_method))
    .map(tx => {
      const worker = users.find(u => u.user_id === tx.worker_id);
      const { streetNum, streetName } = parseAddress(tx.customer_snapshot?.address);

      let details = '';
      if (tx.payment_method === 'Credit Card') details = `CCD: ${tx.cc_full_number || '***'}`;
      if (tx.payment_method === 'Billed') details = `INV: ${tx.invoice_number || ''}`;
      if (tx.payment_method === 'E-Transfer') details = `Email: ${tx.etransfer_email || ''}`;

      return {
        routeNumber: tx.customer_snapshot?.routeCode || '',
        firstName: tx.customer_snapshot?.firstName || '',
        lastName: tx.customer_snapshot?.lastName || '',
        streetNum,
        streetName,
        phone: tx.customer_phone || '',
        email: tx.customer_email || '',
        clientType: getClientTypeBadge(tx),
        propertyType: tx.customer_snapshot?.serviceType || '',
        notes: tx.item_description || '',
        price: tx.price || 0,
        paymentType: tx.payment_method || '',
        contractorName: worker?.name || '',
        paymentDetails: details,
        expiry: tx.cc_expiry || '',
        cvc: tx.cc_cvc || '',
      };
    });

  await googleSheetsService.appendAccounts(accountsData);

  // --- 3. APPEND LOGSHEETS (All transactions) ---
  const logsheetsData = transactions.map(tx => {
    const worker = users.find(u => u.user_id === tx.worker_id);
    const { streetNum, streetName } = parseAddress(tx.customer_snapshot?.address);

    return {
      routeNumber: tx.customer_snapshot?.routeCode || '',
      firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '',
      streetNum,
      streetName,
      phone: tx.customer_phone || '',
      email: tx.customer_email || '',
      clientType: getClientTypeBadge(tx),
      propertyType: tx.customer_snapshot?.serviceType || '',
      notes: tx.item_description || '',
      price: tx.price || 0,
      paymentType: tx.payment_method || '',
      contractorName: worker?.name || '',
    };
  });

  await googleSheetsService.appendLogsheets(logsheetsData);

  // --- 4. APPEND PAYOUT STATS ---
  const statsData = generateStatsRows(logsheets, users, managerMap);

  await googleSheetsService.appendPayoutStats(statsData);

  return {
    bookingsUpdated,
    accountsAppended: accountsData.length,
    logsheetsAppended: logsheetsData.length,
    statsAppended: statsData.length,
  };
};