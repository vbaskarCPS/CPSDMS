// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { commandCenterService, seasonHasTeams, getSeasonConfig, getPayoutRate, createEqualSplit, EQ_DIVISOR } from './commandCenterService';
import { sessionService } from './sessionService';
import { googleSheetsService } from './googleSheetsService';
import { LogsheetSession, Worker, ManagementUser, SeasonType, ServiceFlags } from '../types';

// Helper to get CC ID with error handling
const getCCId = (): string => {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) {
    throw new Error('No command center context. Please log in first.');
  }
  return ccId;
};

/**
 * Badge map for upgrade/add-on item names to short display codes
 * Matches the badges shown in ContractorJobs component
 */
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC',
  // Central Add-Ons
  'Window Washing': 'WW',
  // East Add-Ons
  'Driveway Sealing': 'DWS',
  'Hot Asphalt': 'RAMP'
};

/**
 * Get client type from transaction, using badge abbreviations for upgrades/add-ons
 */
function getClientType(tx: any): string {
  if (tx.type === 'Production') return 'Existing';
  if (tx.type === 'Sale') return 'New';
  
  // For Upgrade and Add-On, try to get the badge from items
  if (tx.type === 'Upgrade' || tx.type === 'Add-On') {
    if (tx.items && Array.isArray(tx.items) && tx.items.length > 0) {
      const itemName = tx.items[0]?.name;
      if (itemName && BADGE_MAP[itemName]) {
        return BADGE_MAP[itemName];
      }
    }
    // Fallback to the transaction type if no badge found
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
 * Helper to get all team worker names for a transaction
 * Falls back to session team_worker_ids if completed_by_worker_ids is not set
 */
function getTeamWorkerNames(
  tx: any, 
  workersMap: Map<string, any>,
  sessionsMap?: Map<string, any>
): string {
  // First try completed_by_worker_ids from the transaction
  if (tx.completed_by_worker_ids && tx.completed_by_worker_ids.length > 0) {
    return tx.completed_by_worker_ids
      .map((id: string) => workersMap.get(id)?.name || id)
      .join(', ');
  }
  
  // Fall back to looking up the session's team_worker_ids
  if (sessionsMap) {
    // Find session that contains this worker
    for (const session of sessionsMap.values()) {
      const teamWorkerIds = session.team_worker_ids || [];
      if (teamWorkerIds.includes(tx.worker_id)) {
        return teamWorkerIds
          .map((id: string) => workersMap.get(id)?.name || id)
          .join(', ');
      }
    }
  }
  
  // Final fallback to primary worker
  return workersMap.get(tx.worker_id)?.name || tx.worker_id;
}

/**
 * Helper to get all team worker IDs for a transaction
 * Falls back to session team_worker_ids if completed_by_worker_ids is not set
 */
function getTeamWorkerIds(
  tx: any,
  sessionsMap?: Map<string, any>
): string {
  // First try completed_by_worker_ids from the transaction
  if (tx.completed_by_worker_ids && tx.completed_by_worker_ids.length > 0) {
    return tx.completed_by_worker_ids.join(', ');
  }
  
  // Fall back to looking up the session's team_worker_ids
  if (sessionsMap) {
    for (const session of sessionsMap.values()) {
      const teamWorkerIds = session.team_worker_ids || [];
      if (teamWorkerIds.includes(tx.worker_id)) {
        return teamWorkerIds.join(', ');
      }
    }
  }
  
  // Final fallback to primary worker
  return tx.worker_id;
}

/**
 * Generates and downloads a comprehensive Excel export of all session data.
 * All data is scoped to the current command center.
 */
export async function generateSessionExport(): Promise<void> {
  const ccId = getCCId();
  const date = await sessionService.getDailySessionDate();
  if (!date) throw new Error('No active session');

  // Get season type
  const seasonType = await sessionService.getSessionSeasonType();
  const isTeamSeason = seasonHasTeams(seasonType);

  // Fetch all data scoped by command center
  const [sessionsRes, transactionsRes, usersRes, bookingsRes, dailySessionRes] = await Promise.all([
    supabase.from('logsheet_sessions').select('*').eq('date', date).eq('command_center_id', ccId),
    supabase.from('transactions').select('*').eq('command_center_id', ccId),
    supabase.from('users').select('*').eq('command_center_id', ccId),
    supabase.from('bookings').select('*').eq('session_date', date).eq('command_center_id', ccId),
    supabase.from('daily_sessions').select('season_type').eq('date', date).eq('command_center_id', ccId).single(),
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

  // Create sessions map for fallback team lookup
  const sessionsMap = new Map<string, any>();
  sessions.forEach(s => sessionsMap.set(s.id, s));

  // Group transactions by worker
  const txByWorker = new Map<string, any[]>();
  transactions.forEach(tx => {
    if (!txByWorker.has(tx.worker_id)) {
      txByWorker.set(tx.worker_id, []);
    }
    txByWorker.get(tx.worker_id)!.push(tx);
  });

  // === SHEET 1: Payout Summary ===
  const payoutRows: any[] = [];
  
  if (isTeamSeason) {
    // Lawn Rejuv: One row per worker in each team
    // Use sessionService.calculateTeamPayouts for consistent calculations
    for (const session of sessions) {
      const teamWorkerIds = session.team_worker_ids || [session.worker_id];
      const equivSplit = session.equiv_split || createEqualSplit(teamWorkerIds);
      const upsellSplit = session.upsell_split || equivSplit;
      
      const stats = session.stats || {};
      const validation = session.validation || {};
      
      // Build session object for calculateTeamPayouts
      const sessionObj = {
        id: session.id,
        workerId: session.worker_id,
        date: session.date,
        status: session.status,
        stats: session.stats,
        validation: session.validation,
        bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids,
        equivSplit: session.equiv_split,
        upsellSplit: session.upsell_split,
        dailyRouteStore: [],
        financialStore: [],
      };
      
      const workersArray = Array.from(workersMap.values()).map(u => ({
        contractorId: u.user_id,
        firstName: u.name.split(' ')[0],
        lastName: u.name.split(' ').slice(1).join(' '),
        alumniRate: u.metadata?.alumniRate || 0,
        silverRate: u.metadata?.silverRate || 0,
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
        
        const workerName = worker?.name || workerId;
        const managerId = worker?.metadata?.assignedManagerId;
        const manager = managerId ? managersMap.get(managerId) : null;
        const managerName = manager?.name || 'Unassigned';
        
        // Get team member names for display
        const teamMembers = teamWorkerIds.map((id: string) => workersMap.get(id)?.name || id).join(', ');
        
        payoutRows.push({
          'Contractor ID': workerId,
          'Worker Name': workerName,
          'Team Members': teamMembers,
          'Manager': managerName,
          'Status': session.status,
          // Split by equivPercent (no rounding)
          'Steps': (stats.stepCount || 0) * equivPercent,
          'Prod Gross': (stats.prodGross || 0) * equivPercent,
          'Prod Payable': (stats.prodPayable || 0) * equivPercent,
          'Total EQ': payout.teamTotalEQ,
          'Assigned EQ': payout.assignedEQ,
          'Verified Cash': (validation.verifiedCash || 0) * equivPercent,
          'Verified Cheque': (validation.verifiedCheque || 0) * equivPercent,
          'Cash Diff': (validation.cashDiff || 0) * equivPercent,
          'Cheque Diff': (validation.chequeDiff || 0) * equivPercent,
          // Split by upsellPercent (no rounding)
          'Upsells': (stats.upsellCount || 0) * upsellPercent,
          'IOS': (stats.iosCount || 0) * upsellPercent,
          'Upsell Gross': (stats.upsellGross || 0) * upsellPercent,
          'Upsell Payable': (stats.upsellPayable || 0) * upsellPercent,
          // Payout rate breakdown
          'Base Rate': payout.basePayoutRate,
          'Alumni Rate': payout.alumniRate,
          'Silver Rate': payout.silverRate,
          'Total Rate': payout.totalPayoutRate,
          // Values directly from calculateTeamPayouts (already per-worker)
          'Base Commission': payout.baseCommission,
          'Alumni Bonus': payout.alumniBonus,
          'Silver Bonus': payout.silverBonus,
          'Production Comm': payout.productionCommission,
          'Upsell Comm': payout.upsellCommission,
          'IOS Comm': payout.iosCommission,
          'Machine Rental': payout.machineRentalDeduction,
          'Cash/Cheque Diff (Display)': payout.cashChequeDiff,
          'Total Deductions': payout.deductions,
          'Bonuses': payout.bonusAmount,
          'Final Commission': payout.finalCommission,
          'Validated': validation.isValidated ? 'Yes' : 'No',
          'Validated By': validation.managerName || '',
          'Season Type': seasonType,
          'Equiv Split %': payout.equivSplitPercent,
          'Upsell Split %': payout.upsellSplitPercent,
        });
      }
    }
  } else {
    // Aeration: One row per session
    // FIXED: Use totalEQ × (baseRate + alumniRate + silverRate) for production commission
    for (const session of sessions) {
      const worker = workersMap.get(session.worker_id);
      const workerName = worker?.name || session.worker_id;
      const managerId = worker?.metadata?.assignedManagerId;
      const manager = managerId ? managersMap.get(managerId) : null;
      const managerName = manager?.name || 'Unassigned';
      
      const stats = session.stats || {};
      const validation = session.validation || {};
      const bonuses = session.bonuses || [];
      
      const totalBonuses = bonuses.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
      
      // FIXED: Aeration rate calculation
      // Rate = baseRate + alumniRate + silverRate (all $/EQ)
      const basePayoutRate = getPayoutRate(seasonType, 1); // $8 for aeration
      const alumniRate = worker?.metadata?.alumniRate || 0;
      const silverRate = worker?.metadata?.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      
      // Use validated EQ if available, otherwise use stats
      const actualEQ = validation.isValidated 
        ? (validation.actualTotalEQ || 0) 
        : (stats.totalEQ || 0);
      
      // FIXED: Production commission = EQ × totalRate
      const baseCommission = actualEQ * basePayoutRate;
      const alumniBonus = actualEQ * alumniRate;
      const silverBonus = actualEQ * silverRate;
      const productionComm = actualEQ * totalPayoutRate;
      
      const upsellComm = (stats.upsellPayable || 0) * 0.15;
      const iosComm = (stats.iosCount || 0) * 5;
      const machineRental = validation.machineRental ? 10 : 0;
      
      // FIXED: cashChequeDiff is DISPLAY ONLY - already reflected in EQ via deltaEQ
      const cashChequeDiff = Math.abs(validation.cashDiff || 0) + Math.abs(validation.chequeDiff || 0);
      
      // FIXED: deductions no longer includes cashChequeDiff
      const deductions = machineRental;
      
      payoutRows.push({
        'Contractor ID': session.worker_id,
        'Worker Name': workerName,
        'Team Members': '',
        'Manager': managerName,
        'Status': session.status,
        'Steps': stats.stepCount || 0,
        'Prod Gross': stats.prodGross || 0,
        'Prod Payable': stats.prodPayable || 0,
        'Total EQ': actualEQ,
        'Assigned EQ': actualEQ,
        'Verified Cash': validation.verifiedCash || 0,
        'Verified Cheque': validation.verifiedCheque || 0,
        'Cash Diff': validation.cashDiff || 0,
        'Cheque Diff': validation.chequeDiff || 0,
        'Upsells': stats.upsellCount || 0,
        'IOS': stats.iosCount || 0,
        'Upsell Gross': stats.upsellGross || 0,
        'Upsell Payable': stats.upsellPayable || 0,
        'Base Rate': basePayoutRate,
        'Alumni Rate': alumniRate,
        'Silver Rate': silverRate,
        'Total Rate': totalPayoutRate,
        'Base Commission': baseCommission,
        'Alumni Bonus': alumniBonus,
        'Silver Bonus': silverBonus,
        'Production Comm': productionComm,
        'Upsell Comm': upsellComm,
        'IOS Comm': iosComm,
        'Machine Rental': machineRental,
        'Cash/Cheque Diff (Display)': cashChequeDiff,
        'Total Deductions': deductions,
        'Bonuses': totalBonuses,
        'Final Commission': validation.finalCommission || 0,
        'Validated': validation.isValidated ? 'Yes' : 'No',
        'Validated By': validation.managerName || '',
        'Season Type': seasonType,
        'Equiv Split %': 100,
        'Upsell Split %': 100,
      });
    }
  }

  // === SHEET 2: Transactions ===
  const txRows = transactions.map(tx => {
    const servicesStr = serviceFlagsToString(tx.services);
    const completedBy = getTeamWorkerIds(tx, isTeamSeason ? sessionsMap : undefined);
    
    return {
      'Transaction ID': tx.id,
      'Job ID': tx.job_id,
      'Worker ID': tx.worker_id,
      'Worker Name': workersMap.get(tx.worker_id)?.name || tx.worker_id,
      'Completed By': completedBy,
      'Timestamp': tx.timestamp,
      'Type': tx.type,
      'Price': tx.price,
      'Display Price': tx.display_price,
      'Payment Method': tx.payment_method,
      'Customer Name': `${tx.customer_snapshot?.firstName || ''} ${tx.customer_snapshot?.lastName || ''}`.trim(),
      'Address': tx.customer_snapshot?.address || tx.address,
      'Route': tx.customer_snapshot?.routeCode || tx.route_code,
      'Service Type': tx.customer_snapshot?.serviceType,
      'Services': servicesStr,
      'Phone': tx.customer_phone,
      'Email': tx.customer_email,
      'Invoice #': tx.invoice_number,
      'Cheque #': tx.cheque_number,
      'E-Transfer Email': tx.etransfer_email,
    };
  });

  // === SHEET 3: Bookings ===
  const bookingRows = bookings.map(b => {
    const servicesStr = serviceFlagsToString(b.services);
    
    return {
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
      'Services': servicesStr,
      'Prepaid': b.is_prepaid ? 'Yes' : 'No',
      'Notes': b.log_notes,
    };
  });

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
        'Split Percentages': bonus.splitPercentages ? JSON.stringify(bonus.splitPercentages) : '',
      });
    });
  });

  // === SHEET 5: Team Payouts (Team season only) ===
  let teamPayoutRows: any[] = [];
  if (isTeamSeason) {
    const workers = Array.from(workersMap.values()).map(u => ({
      contractorId: u.user_id,
      firstName: u.name.split(' ')[0],
      lastName: u.name.split(' ').slice(1).join(' '),
      alumniRate: u.metadata?.alumniRate || 0,
      silverRate: u.metadata?.silverRate || 0,
    }));
    
    for (const session of sessions) {
      if (!session.team_worker_ids || session.team_worker_ids.length <= 1) continue;
      
      const sessionObj = {
        id: session.id,
        workerId: session.worker_id,
        date: session.date,
        status: session.status,
        stats: session.stats,
        validation: session.validation,
        bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids,
        equivSplit: session.equiv_split,
        upsellSplit: session.upsell_split,
        dailyRouteStore: [],
        financialStore: [],
      };
      
      const payouts = sessionService.calculateTeamPayouts(sessionObj as any, workers as any, seasonType);
      
      for (const payout of payouts) {
        teamPayoutRows.push({
          'Session ID': session.id,
          'Worker ID': payout.workerId,
          'Worker Name': payout.workerName,
          'Equiv Split %': payout.equivSplitPercent,
          'Upsell Split %': payout.upsellSplitPercent,
          'Team Total EQ': payout.teamTotalEQ.toFixed(2),
          'Assigned EQ': payout.assignedEQ.toFixed(2),
          'Base Payout Rate': payout.basePayoutRate.toFixed(2),
          'Alumni Rate': payout.alumniRate.toFixed(2),
          'Silver Rate': payout.silverRate.toFixed(2),
          'Total Payout Rate': payout.totalPayoutRate.toFixed(2),
          'Base Commission': payout.baseCommission.toFixed(2),
          'Alumni Bonus': payout.alumniBonus.toFixed(2),
          'Silver Bonus': payout.silverBonus.toFixed(2),
          'Production Commission': payout.productionCommission.toFixed(2),
          'Upsell Commission': payout.upsellCommission.toFixed(2),
          'IOS Commission': payout.iosCommission.toFixed(2),
          'Bonus Amount': payout.bonusAmount.toFixed(2),
          'Cash/Cheque Diff (Display)': payout.cashChequeDiff.toFixed(2),
          'Machine Rental': payout.machineRentalDeduction.toFixed(2),
          'Total Deductions': payout.deductions.toFixed(2),
          'Final Commission': payout.finalCommission.toFixed(2),
        });
      }
    }
  }

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
  
  if (teamPayoutRows.length > 0) {
    const ws5 = XLSX.utils.json_to_sheet(teamPayoutRows);
    XLSX.utils.book_append_sheet(wb, ws5, 'Team Payouts');
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
 * Season-aware: handles service flags and team data.
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

  // Get season type
  const seasonType = await sessionService.getSessionSeasonType();
  const isTeamSeason = seasonHasTeams(seasonType);

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

  // Create sessions map for team lookup fallback
  const sessionsMap = new Map<string, any>();
  sessions.forEach(s => sessionsMap.set(s.id, s));

  // === 1. Update Completed Bookings in Feed Placeholder ===
  const completedBookings = transactions
    .filter(tx => tx.type === 'Production' && tx.job_id && !tx.job_id.startsWith('NEW-'))
    .map(tx => {
      // For teams, get all worker IDs (comma-separated)
      const contractorIds = getTeamWorkerIds(tx, isTeamSeason ? sessionsMap : undefined);
      
      return {
        routeNumber: tx.customer_snapshot?.routeCode || '',
        firstName: tx.customer_snapshot?.firstName || '',
        lastName: tx.customer_snapshot?.lastName || '',
        dateCompleted: new Date(tx.timestamp).toLocaleDateString(),
        contractorId: contractorIds,
        services: tx.services as ServiceFlags | undefined,
      };
    });

  const bookingsUpdated = await googleSheetsService.updateCompletedBookings(
    completedBookings,
    seasonType
  );

  // === 2. Append Accounts (ALL transactions with Billed, E-Transfer, Credit Card) ===
  // Includes ALL transaction types (Production, Sale, Upgrade, Add-On) with these payment methods
  const validAccountPaymentMethods = ['Billed', 'E-Transfer', 'Credit Card'];
  
  const accountTransactions = transactions.filter(tx => {
    // Check if payment method is one we want for accounts
    // Handle both simple payment method and payment breakdown
    if (tx.payment_breakdown && typeof tx.payment_breakdown === 'object') {
      // Check if any key in breakdown is a valid account payment method
      return Object.keys(tx.payment_breakdown).some(method => 
        validAccountPaymentMethods.some(valid => method.includes(valid))
      );
    }
    
    // Simple payment method check
    return validAccountPaymentMethods.some(valid => 
      (tx.payment_method || '').includes(valid)
    );
  });

  const accountsData = accountTransactions.map(tx => {
    const address = tx.customer_snapshot?.address || tx.address || '';
    const streetParts = address.split(' ');
    const streetNum = streetParts[0] || '';
    const streetName = streetParts.slice(1).join(' ') || '';
    
    // For teams, get all worker names (comma-separated)
    const contractorName = getTeamWorkerNames(tx, workersMap, isTeamSeason ? sessionsMap : undefined);
    
    // Use badge-based client type for upgrades/add-ons
    const clientType = getClientType(tx);
    
    return {
      routeNumber: tx.customer_snapshot?.routeCode || '',
      firstName: tx.customer_snapshot?.firstName || '',
      lastName: tx.customer_snapshot?.lastName || '',
      streetNum,
      streetName,
      phone: tx.customer_phone || '',
      email: tx.customer_email || '',
      clientType,
      propertyType: tx.customer_snapshot?.serviceType || 'FP',
      notes: tx.item_description || '',
      price: tx.price || 0,
      paymentType: tx.payment_method || '',
      contractorName,
      paymentDetails: tx.cc_full_number || tx.cheque_number || tx.etransfer_email || tx.invoice_number || '',
      expiry: tx.cc_expiry || '',
      cvc: tx.cc_cvc || '',
      services: tx.services as ServiceFlags | undefined,
    };
  });

  if (accountsData.length > 0) {
    await googleSheetsService.appendAccounts(accountsData);
  }

  // === 3. Append Logsheets (Production, Sale, Upgrade, Add-On) ===
  // Aeration: Production, Sale, Upgrade, Add-On
  // Lawn Rejuv: Production, Sale, Add-On (no Upgrades)
  const logsheetTypes = isTeamSeason 
    ? ['Production', 'Sale', 'Add-On']
    : ['Production', 'Sale', 'Upgrade', 'Add-On'];
  
  const logsheetsData = transactions
    .filter(tx => logsheetTypes.includes(tx.type))
    .map(tx => {
      const address = tx.customer_snapshot?.address || tx.address || '';
      const streetParts = address.split(' ');
      const streetNum = streetParts[0] || '';
      const streetName = streetParts.slice(1).join(' ') || '';
      
      // Use badge-based client type for upgrades/add-ons
      const clientType = getClientType(tx);
      
      // For teams, get all worker names (comma-separated)
      const contractorName = getTeamWorkerNames(tx, workersMap, isTeamSeason ? sessionsMap : undefined);
      
      return {
        routeNumber: tx.customer_snapshot?.routeCode || '',
        firstName: tx.customer_snapshot?.firstName || '',
        lastName: tx.customer_snapshot?.lastName || '',
        streetNum,
        streetName,
        phone: tx.customer_phone || '',
        email: tx.customer_email || '',
        clientType,
        propertyType: tx.customer_snapshot?.serviceType || 'FP',
        notes: tx.item_description || '',
        price: tx.price || 0,
        paymentType: tx.payment_method || '',
        contractorName,
        services: tx.services as ServiceFlags | undefined,
      };
    });

  if (logsheetsData.length > 0) {
    await googleSheetsService.appendLogsheets(logsheetsData);
  }

  // === 4. Append Payout Stats ===
  // FIXED: Property names now match what googleSheetsService expects
  const statsData: any[] = [];
  
  if (isTeamSeason) {
    // Lawn Rejuv: One row per worker in each team
    // Use calculateTeamPayouts for consistent results
    for (const session of sessions) {
      const teamWorkerIds = session.team_worker_ids || [session.worker_id];
      
      const stats = session.stats || {};
      const validation = session.validation || {};
      
      // Build session object for calculateTeamPayouts
      const sessionObj = {
        id: session.id,
        workerId: session.worker_id,
        date: session.date,
        status: session.status,
        stats: session.stats,
        validation: session.validation,
        bonuses: session.bonuses,
        teamWorkerIds: session.team_worker_ids,
        equivSplit: session.equiv_split,
        upsellSplit: session.upsell_split,
        dailyRouteStore: [],
        financialStore: [],
      };
      
      const workersArray = Array.from(workersMap.values()).map(u => ({
        contractorId: u.user_id,
        firstName: u.name.split(' ')[0],
        lastName: u.name.split(' ').slice(1).join(' '),
        alumniRate: u.metadata?.alumniRate || 0,
        silverRate: u.metadata?.silverRate || 0,
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
        
        const workerName = worker?.name || '';
        const nameParts = workerName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        const managerId = worker?.metadata?.assignedManagerId;
        const manager = managerId ? managersMap.get(managerId) : null;
        const managerName = manager?.name || '';
        
        statsData.push({
          contractorId: workerId,
          firstName,
          lastName,
          manager: managerName,
          // Split by equivPercent (no rounding for stepCount)
          stepCount: (stats.stepCount || 0) * equivPercent,
          iosCount: (stats.iosCount || 0) * upsellPercent,
          prodBilled: (stats.prodBilled || 0) * equivPercent,
          prodCash: (stats.prodCash || 0) * equivPercent,
          prodCheque: (stats.prodCheque || 0) * equivPercent,
          prodCreditCard: (stats.prodCreditCard || 0) * equivPercent,
          prodETransfer: (stats.prodETransfer || 0) * equivPercent,
          prodFlats: (stats.prodFlats || 0) * equivPercent,
          prodPrepaid: (stats.prodPrepaid || 0) * equivPercent,
          prodPrepaidSplit: (stats.prodPrepaidSplit || 0) * equivPercent,
          prodGross: (stats.prodGross || 0) * equivPercent,
          prodPayable: (stats.prodPayable || 0) * equivPercent,
          // FIXED: Use assignedEQ for column R (totalEQ)
          assignedEQ: payout.assignedEQ,
          // Split by upsellPercent (no rounding)
          upsellCount: (stats.upsellCount || 0) * upsellPercent,
          upsellCash: (stats.upsellCash || 0) * upsellPercent,
          upsellCheque: (stats.upsellCheque || 0) * upsellPercent,
          upsellCreditCard: (stats.upsellCreditCard || 0) * upsellPercent,
          upsellETransfer: (stats.upsellETransfer || 0) * upsellPercent,
          upsellPrepaid: (stats.upsellPrepaid || 0) * upsellPercent,
          upsellGross: (stats.upsellGross || 0) * upsellPercent,
          upsellPayable: (stats.upsellPayable || 0) * upsellPercent,
          // FIXED: Use totalPayoutRate for column AA (Payout rate)
          totalPayoutRate: payout.totalPayoutRate,
          // Values directly from calculateTeamPayouts (already per-worker)
          productionComm: payout.productionCommission,
          upsellComm: payout.upsellCommission,
          iosComm: payout.iosCommission,
          machineRental: payout.machineRentalDeduction,
          deductions: payout.deductions,
          bonuses: payout.bonusAmount,
          finalPay: payout.finalCommission,
        });
      }
    }
  } else {
    // Aeration: One row per session
    // FIXED: Use totalEQ × (baseRate + alumniRate + silverRate) for production commission
    for (const session of sessions) {
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
      
      // FIXED: Aeration rate calculation
      // Rate = baseRate + alumniRate + silverRate (all $/EQ)
      const basePayoutRate = getPayoutRate(seasonType, 1); // $8 for aeration
      const alumniRate = worker?.metadata?.alumniRate || 0;
      const silverRate = worker?.metadata?.silverRate || 0;
      const totalPayoutRate = basePayoutRate + alumniRate + silverRate;
      
      // Use validated EQ if available, otherwise use stats
      const actualEQ = validation.isValidated 
        ? (validation.actualTotalEQ || 0) 
        : (stats.totalEQ || 0);
      
      // FIXED: Production commission = EQ × totalRate
      const productionComm = actualEQ * totalPayoutRate;
      
      const upsellComm = (stats.upsellPayable || 0) * 0.15;
      const iosComm = (stats.iosCount || 0) * 5;
      const machineRental = validation.machineRental ? 10 : 0;
      
      // FIXED: deductions no longer includes cashChequeDiff
      const deductions = machineRental;
      
      statsData.push({
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
        // FIXED: Use assignedEQ for column R (totalEQ)
        assignedEQ: actualEQ,
        upsellCount: stats.upsellCount || 0,
        upsellCash: stats.upsellCash || 0,
        upsellCheque: stats.upsellCheque || 0,
        upsellCreditCard: stats.upsellCreditCard || 0,
        upsellETransfer: stats.upsellETransfer || 0,
        upsellPrepaid: stats.upsellPrepaid || 0,
        upsellGross: stats.upsellGross || 0,
        upsellPayable: stats.upsellPayable || 0,
        // FIXED: Use totalPayoutRate for column AA (Payout rate)
        totalPayoutRate,
        productionComm,
        upsellComm,
        iosComm,
        machineRental,
        deductions,
        bonuses: totalBonuses,
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