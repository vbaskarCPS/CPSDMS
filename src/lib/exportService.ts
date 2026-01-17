// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { sessionService } from './sessionService';
import { googleSheetsService } from './googleSheetsService';
import { LogsheetSession, Worker, ManagementUser } from '../types';

// Helper to get CC ID with error handling
const getCCId = (): string => {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) {
    throw new Error('No command center context. Please log in first.');
  }
  return ccId;
};

/**
 * Generates and downloads a comprehensive Excel export of all session data.
 * All data is scoped to the current command center.
 */
export async function generateSessionExport(): Promise<void> {
  const ccId = getCCId();
  const date = await sessionService.getDailySessionDate();
  if (!date) throw new Error('No active session');

  // Fetch all data scoped by command center
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

  // Create workers and managers maps
  const workersMap = new Map<string, any>();
  const managersMap = new Map<string, any>();
  
  users.forEach(u => {
    if (u.role === 'Worker') {
      workersMap.set(u.user_id, u);
    } else if (u.role === 'RouteManager') {
      managersMap.set(u.user_id, u);
    }
  });

  // Group transactions by worker
  const txByWorker = new Map<string, any[]>();
  transactions.forEach(tx => {
    if (!txByWorker.has(tx.worker_id)) {
      txByWorker.set(tx.worker_id, []);
    }
    txByWorker.get(tx.worker_id)!.push(tx);
  });

  // === SHEET 1: Payout Summary ===
  const payoutRows = sessions.map(session => {
    const worker = workersMap.get(session.worker_id);
    const workerName = worker?.name || session.worker_id;
    const managerId = worker?.metadata?.assignedManagerId;
    const manager = managerId ? managersMap.get(managerId) : null;
    const managerName = manager?.name || 'Unassigned';
    
    const stats = session.stats || {};
    const validation = session.validation || {};
    const bonuses = session.bonuses || [];
    
    const totalBonuses = bonuses.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
    
    return {
      'Contractor ID': session.worker_id,
      'Worker Name': workerName,
      'Manager': managerName,
      'Status': session.status,
      'Steps': stats.stepCount || 0,
      'Upsells': stats.upsellCount || 0,
      'IOS': stats.iosCount || 0,
      'Prod Gross': stats.prodGross || 0,
      'Prod Payable': stats.prodPayable || 0,
      'Total EQ': stats.totalEQ || 0,
      'Upsell Gross': stats.upsellGross || 0,
      'Upsell Payable': stats.upsellPayable || 0,
      'Verified Cash': validation.verifiedCash || 0,
      'Verified Cheque': validation.verifiedCheque || 0,
      'Cash Diff': validation.cashDiff || 0,
      'Cheque Diff': validation.chequeDiff || 0,
      'Machine Rental': validation.machineRental ? 10 : 0,
      'Bonuses': totalBonuses,
      'Final Commission': validation.finalCommission || 0,
      'Validated': validation.isValidated ? 'Yes' : 'No',
      'Validated By': validation.managerName || '',
    };
  });

  // === SHEET 2: Transactions ===
  const txRows = transactions.map(tx => ({
    'Transaction ID': tx.id,
    'Job ID': tx.job_id,
    'Worker ID': tx.worker_id,
    'Worker Name': workersMap.get(tx.worker_id)?.name || tx.worker_id,
    'Timestamp': tx.timestamp,
    'Type': tx.type,
    'Price': tx.price,
    'Display Price': tx.display_price,
    'Payment Method': tx.payment_method,
    'Customer Name': `${tx.customer_snapshot?.firstName || ''} ${tx.customer_snapshot?.lastName || ''}`.trim(),
    'Address': tx.customer_snapshot?.address || tx.address,
    'Route': tx.customer_snapshot?.routeCode || tx.route_code,
    'Service Type': tx.customer_snapshot?.serviceType,
    'Phone': tx.customer_phone,
    'Email': tx.customer_email,
    'Invoice #': tx.invoice_number,
    'Cheque #': tx.cheque_number,
    'E-Transfer Email': tx.etransfer_email,
  }));

  // === SHEET 3: Bookings ===
  const bookingRows = bookings.map(b => ({
    'Booking ID': b.booking_id,
    'Route': b.route_number,
    'Status': b.status,
    'Contractor': b.contractor_id,
    'Price': b.price,
    'First Name': b.customer_details?.['First Name'],
    'Last Name': b.customer_details?.['Last Name'],
    'Address': b.customer_details?.['Full Address'],
    'Phone': b.customer_details?.['Home Phone'],
    'Email': b.customer_details?.['Email Address'],
    'Service Type': b.customer_details?.['FO/BO/FP'],
    'Prepaid': b.is_prepaid ? 'Yes' : 'No',
    'Notes': b.log_notes,
  }));

  // === SHEET 4: Bonuses Detail ===
  const bonusRows: any[] = [];
  sessions.forEach(session => {
    const worker = workersMap.get(session.worker_id);
    const workerName = worker?.name || session.worker_id;
    const bonuses = session.bonuses || [];
    
    bonuses.forEach((bonus: any) => {
      bonusRows.push({
        'Contractor ID': session.worker_id,
        'Worker Name': workerName,
        'Bonus Type': bonus.type,
        'Amount': bonus.amount,
        'Placing': bonus.placing || '',
        'Description': bonus.customDescription || '',
      });
    });
  });

  // Create workbook
  const wb = XLSX.utils.book_new();
  
  const ws1 = XLSX.utils.json_to_sheet(payoutRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Payout Summary');
  
  const ws2 = XLSX.utils.json_to_sheet(txRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Transactions');
  
  const ws3 = XLSX.utils.json_to_sheet(bookingRows);
  XLSX.utils.book_append_sheet(wb, ws3, 'Bookings');
  
  if (bonusRows.length > 0) {
    const ws4 = XLSX.utils.json_to_sheet(bonusRows);
    XLSX.utils.book_append_sheet(wb, ws4, 'Bonuses');
  }

  // Download
  const cc = commandCenterService.getCurrentCommandCenter();
  const ccName = cc?.displayName?.replace(/\s+/g, '_') || 'Session';
  XLSX.writeFile(wb, `${ccName}_Export_${date}.xlsx`);
}

/**
 * Exports session data to Google Sheets.
 * Updates completed bookings, appends accounts/logsheets/payout stats.
 * All data is scoped to the current command center.
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

  // Ensure authenticated with Google
  if (!googleSheetsService.isAuthenticated()) {
    const connected = await googleSheetsService.authenticate();
    if (!connected) throw new Error('Failed to authenticate with Google');
  }

  // Fetch all data scoped by command center
  const [sessionsRes, transactionsRes, usersRes] = await Promise.all([
    supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
    supabase.from('transactions').select('*').eq('command_center_id', ccId),
    supabase.from('users').select('*').eq('command_center_id', ccId),
  ]);

  const sessions = sessionsRes.data || [];
  const transactions = transactionsRes.data || [];
  const users = usersRes.data || [];

  // Create maps
  const workersMap = new Map<string, any>();
  const managersMap = new Map<string, any>();
  
  users.forEach(u => {
    if (u.role === 'Worker') {
      workersMap.set(u.user_id, u);
    } else if (u.role === 'RouteManager') {
      managersMap.set(u.user_id, u);
    }
  });

  // === 1. Update Completed Bookings in Feed Placeholder ===
  const completedBookings = transactions
    .filter(tx => tx.type === 'Production' && tx.job_id && !tx.job_id.startsWith('NEW-'))
    .map(tx => ({
      routeNumber: tx.customer_snapshot?.routeCode || '',
      firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '',
      dateCompleted: new Date(tx.timestamp).toLocaleDateString(),
      contractorId: tx.worker_id,
    }));

  const bookingsUpdated = await googleSheetsService.updateCompletedBookings(completedBookings);

  // === 2. Append Accounts (Sales/Upgrades with payment info) ===
  const accountTransactions = transactions.filter(tx => 
    ['Sale', 'Upgrade'].includes(tx.type) && tx.payment_method !== 'Prepaid'
  );

  const accountsData = accountTransactions.map(tx => {
    const worker = workersMap.get(tx.worker_id);
    const address = tx.customer_snapshot?.address || tx.address || '';
    const streetParts = address.split(' ');
    const streetNum = streetParts[0] || '';
    const streetName = streetParts.slice(1).join(' ') || '';
    
    return {
      routeNumber: tx.customer_snapshot?.routeCode || '',
      firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '',
      streetNum,
      streetName,
      phone: tx.customer_phone || '',
      email: tx.customer_email || '',
      clientType: tx.type === 'Sale' ? 'New' : 'Upgrade',
      propertyType: tx.customer_snapshot?.serviceType || 'FP',
      notes: tx.item_description || '',
      price: tx.price || 0,
      paymentType: tx.payment_method || '',
      contractorName: worker?.name || tx.worker_id,
      paymentDetails: tx.cc_full_number || tx.cheque_number || tx.etransfer_email || tx.invoice_number || '',
      expiry: tx.cc_expiry || '',
      cvc: tx.cc_cvc || '',
    };
  });

  if (accountsData.length > 0) {
    await googleSheetsService.appendAccounts(accountsData);
  }

  // === 3. Append Logsheets (All completed jobs) ===
  const logsheetsData = transactions
    .filter(tx => tx.type === 'Production')
    .map(tx => {
      const worker = workersMap.get(tx.worker_id);
      const address = tx.customer_snapshot?.address || tx.address || '';
      const streetParts = address.split(' ');
      const streetNum = streetParts[0] || '';
      const streetName = streetParts.slice(1).join(' ') || '';
      
      return {
        routeNumber: tx.customer_snapshot?.routeCode || '',
        firstName: tx.customer_snapshot?.firstName || '',
        lastName: tx.customer_snapshot?.lastName || '',
        streetNum,
        streetName,
        phone: tx.customer_phone || '',
        email: tx.customer_email || '',
        clientType: 'Existing',
        propertyType: tx.customer_snapshot?.serviceType || 'FP',
        notes: tx.item_description || '',
        price: tx.price || 0,
        paymentType: tx.payment_method || '',
        contractorName: worker?.name || tx.worker_id,
      };
    });

  if (logsheetsData.length > 0) {
    await googleSheetsService.appendLogsheets(logsheetsData);
  }

  // === 4. Append Payout Stats ===
  const statsData = sessions.map(session => {
    const worker = workersMap.get(session.worker_id);
    const workerName = worker?.name || '';
    const nameParts = workerName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    const managerId = worker?.metadata?.assignedManagerId;
    const manager = managerId ? managersMap.get(managerId) : null;
    const managerName = manager?.name || '';
    
    const stats = session.stats || {};
    const validation = session.validation || {};
    const bonuses = session.bonuses || [];
    
    const totalBonuses = bonuses.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
    
    // Calculate commissions
    const payoutRate = worker?.metadata?.alumniRate || 0.40;
    const productionComm = (stats.prodPayable || 0) * payoutRate;
    const upsellComm = (stats.upsellPayable || 0) * 0.15;
    const iosComm = (stats.iosCount || 0) * 5;
    const machineRental = validation.machineRental ? 10 : 0;
    const deductions = (validation.cashDiff || 0) + (validation.chequeDiff || 0) + machineRental;
    
    return {
      contractorId: session.worker_id,
      firstName,
      lastName,
      manager: managerName,
      stepCount: stats.stepCount || 0,
      iosCount: stats.iosCount || 0,
      prodBilled: stats.prodBilled || 0,
      prodCash: stats.prodCash || 0,
      prodCheque: stats.prodCheque || 0,
      prodCreditCard: stats.prodCreditCard || 0,
      prodETransfer: stats.prodETransfer || 0,
      prodFlats: stats.prodFlats || 0,
      prodPrepaid: stats.prodPrepaid || 0,
      prodPrepaidSplit: stats.prodPrepaidSplit || 0,
      prodGross: stats.prodGross || 0,
      prodPayable: stats.prodPayable || 0,
      totalEQ: stats.totalEQ || 0,
      upsellCount: stats.upsellCount || 0,
      upsellCash: stats.upsellCash || 0,
      upsellCheque: stats.upsellCheque || 0,
      upsellCreditCard: stats.upsellCreditCard || 0,
      upsellETransfer: stats.upsellETransfer || 0,
      upsellPrepaid: stats.upsellPrepaid || 0,
      upsellGross: stats.upsellGross || 0,
      upsellPayable: stats.upsellPayable || 0,
      payoutRate,
      productionComm,
      upsellComm,
      iosComm,
      machineRental,
      deductions,
      bonuses: totalBonuses,
      finalPay: validation.finalCommission || 0,
    };
  });

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