// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { sessionService } from './sessionService';

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
      supabase.from('transactions').select('*'), // Filter by date if needed, but usually handled by downstream logic
      supabase.from('bookings').select('*').eq('session_date', date),
      supabase.from('users').select('*'),
    ]);

  const logsheets = logsheetsReq.data || [];
  const transactions = transactionsReq.data || [];
  const bookings = bookingsReq.data || [];
  const users = usersReq.data || [];

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
      "prodCash": actualProdCash, // Resolved
      "prodCheque": actualProdCheque, // Resolved
      "prodCreditCard": stats.prodCreditCard,
      "prodETransfer": stats.prodETransfer,
      "ProdFlats": stats.prodFlats,
      "prodPrepaid": stats.prodPrepaid,
      
      // RESTORED MISSING COLUMNS
      "prodPrepaidSplit": stats.prodPrepaidSplit, 

      "ProdGross": stats.prodGross,
      "ProdPayable": stats.prodPayable,
      "totalEQ": actualTotalEQ, // Resolved

      "upsellCount": stats.upsellCount,
      "upsellCash": stats.upsellCash,
      "upsellCheque": stats.upsellCheque,
      "upsellCreditCard": stats.upsellCreditCard,
      "upsellETransfer": stats.upsellETransfer,
      
      // RESTORED MISSING COLUMNS
      "upsellPrepaid": stats.upsellPrepaid, 

      "upsellGross": stats.upsellGross,
      "upsellPayable": stats.upsellPayable,

      "Payout rate": payoutRate,
      "Production Comm.": prodComm,
      "Upsell Commission": upsellComm,
      "IOS Commission": iosComm,
      "Machine Rental": val.machineRental ? -10 : 0,
      "Deductions": 0, // Placeholder matching old format
      "Bonuses": bonusTotal,
      "Final Pay": finalPay,
    };
  });

  // --- TAB 2: BOOKINGS (Restored Headers) ---
  const bookingRows = bookings.map((b) => ({
    "Route #": b.route_number,
    "First Name": b.customer_details['First Name'],
    "Last Name": b.customer_details['Last Name'],
    "House #": (b.customer_details['Full Address'] || '').split(' ')[0], // Best guess extraction
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
      "Phone Number": tx.customer_phone || '', // Mapped from DB column
      "Email Address": tx.customer_email || '', // Mapped from DB column
      "Client Type": tx.type,
      "Property Type": tx.customer_snapshot?.serviceType || '',
      "Notes": tx.item_description,
      "Price": tx.price,
      "Payment Type": tx.payment_method,
      "Contractor Name": worker?.name
    };
  });

  // --- TAB 4: ACCOUNTS (Restored Logic) ---
  const accountsRows = transactions
    .filter(tx => ['Credit Card', 'Cheque', 'Billed', 'E-Transfer'].includes(tx.payment_method))
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
        if (tx.payment_method === 'Cheque') details = `Chk: ${tx.cheque_number || ''}`;

        return {
           "Route #": tx.customer_snapshot?.routeCode,
           "First Name": tx.customer_snapshot?.firstName,
           "Last Name": tx.customer_snapshot?.lastName,
           "Street #": streetNum,
           "Street Name": streetName,
           "Phone Number": tx.customer_phone || '', 
           "Email Address": tx.customer_email || '',
           "Client Type": tx.type,
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
  
  const wsStats = XLSX.utils.json_to_sheet(statsRows);
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  const wsBookings = XLSX.utils.json_to_sheet(bookingRows);
  XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');

  const wsLogsheets = XLSX.utils.json_to_sheet(logsheetRows);
  XLSX.utils.book_append_sheet(wb, wsLogsheets, 'Logsheets');

  const wsAccounts = XLSX.utils.json_to_sheet(accountsRows);
  XLSX.utils.book_append_sheet(wb, wsAccounts, 'Accounts');

  // WRITE FILE
  XLSX.writeFile(wb, `Data Out - ${date}.xlsx`);
};