// src/lib/exportService.ts
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { sessionService } from './sessionService';

export const generateSessionExport = async () => {
  // 1. Fetch Active Session Date
  const date = await sessionService.getDailySessionDate();
  if (!date) {
    alert('No active session found.');
    return;
  }

  // 2. Fetch All Data Needed (Parallel Requests)
  const [logsheetsReq, transactionsReq, bookingsReq, usersReq] =
    await Promise.all([
      supabase.from('logsheet_sessions').select('*').eq('date', date),
      // For transactions, we really want all for this DATE, but simplified schema links them to bookings.
      // In a real query we'd join. For now fetching all might be heavy, so filtering by date is best if column exists.
      // Assuming we fetch all and filter in memory for this prototype.
      supabase.from('transactions').select('*'),
      supabase.from('bookings').select('*').eq('session_date', date),
      supabase.from('users').select('*'),
    ]);

  const logsheets = logsheetsReq.data || [];
  const transactions = transactionsReq.data || []; // Optimization needed here later
  const bookings = bookingsReq.data || [];
  const users = usersReq.data || [];

  // --- TAB 1: STATS ---
  const statsRows = logsheets.map((session) => {
    const worker = users.find((u) => u.user_id === session.worker_id);
    const stats = session.stats || {};
    const val = session.validation || {};

    // Determine Resolved Amounts (Actual vs System)
    const actualProdCash = val.isValidated
      ? val.actualProdCash
      : stats.prodCash + stats.upsellCash;
    const actualProdCheque = val.isValidated
      ? val.actualProdCheque
      : stats.prodCheque + stats.upsellCheque;
    const actualTotalEQ = val.isValidated ? val.actualTotalEQ : stats.totalEQ;

    const finalPay = val.finalCommission || 0;

    const baseRate = 8.0;
    const alumniRate = worker?.metadata?.alumniRate || 0;
    const silverRate = worker?.metadata?.silverRate || 0;
    const payoutRate = baseRate + alumniRate + silverRate;
    const prodComm = actualTotalEQ * payoutRate;
    const upsellComm = (stats.upsellPayable || 0) * 0.1;
    const iosComm = (stats.iosCount || 0) * 5.0;
    const bonusTotal = (session.bonuses || []).reduce(
      (a: any, b: any) => a + b.amount,
      0
    );

    return {
      'Contractor ID': session.worker_id,
      'First Name': worker?.name.split(' ')[0],
      'Last Name': worker?.name.split(' ').slice(1).join(' '),
      'Step Count': stats.stepCount,
      IOSCount: stats.iosCount,

      prodBilled: stats.prodBilled,
      prodCash: actualProdCash,
      prodCheque: actualProdCheque,
      prodCreditCard: stats.prodCreditCard,
      prodETransfer: stats.prodETransfer,
      ProdFlats: stats.prodFlats,
      prodPrepaid: stats.prodPrepaid,

      ProdGross: stats.prodGross,
      ProdPayable: stats.prodPayable,
      totalEQ: actualTotalEQ,

      upsellCount: stats.upsellCount,
      upsellGross: stats.upsellGross,
      upsellPayable: stats.upsellPayable,

      'Payout rate': payoutRate,
      'Production Comm.': prodComm,
      'Upsell Commission': upsellComm,
      'IOS Commission': iosComm,
      'Machine Rental': val.machineRental ? -10 : 0,
      Bonuses: bonusTotal,
      'Final Pay': finalPay,
    };
  });

  // --- TAB 2: BOOKINGS ---
  const bookingRows = bookings.map((b) => ({
    'Route #': b.route_number,
    'First Name': b.customer_details['First Name'],
    'Last Name': b.customer_details['Last Name'],
    Address: b.customer_details['Full Address'],
    Status: b.status,
    Worker: b.contractor_id,
  }));

  // --- TAB 3: LOGSHEETS (Transactions) ---
  const logsheetRows = transactions.map((tx) => {
    const worker = users.find((u) => u.user_id === tx.worker_id);
    return {
      'Route #': tx.customer_snapshot?.routeCode,
      Customer: `${tx.customer_snapshot?.firstName} ${tx.customer_snapshot?.lastName}`,
      Address: tx.customer_snapshot?.address,
      Type: tx.type,
      Price: tx.price,
      Payment: tx.payment_method,
      Worker: worker?.name,
    };
  });

  // --- BUILD WORKBOOK ---
  const wb = XLSX.utils.book_new();
  const wsStats = XLSX.utils.json_to_sheet(statsRows);
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  const wsBookings = XLSX.utils.json_to_sheet(bookingRows);
  XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');

  const wsLogsheets = XLSX.utils.json_to_sheet(logsheetRows);
  XLSX.utils.book_append_sheet(wb, wsLogsheets, 'Transactions');

  // WRITE FILE
  XLSX.writeFile(wb, `Data Out - ${date}.xlsx`);
};
