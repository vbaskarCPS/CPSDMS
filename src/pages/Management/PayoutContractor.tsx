import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  Calendar,
  Calculator,
  Truck,
  Loader,
  Phone,
  Mail,
  TrendingUp,
  Award,
  AlertCircle,
  Check,
  Copy
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { LogsheetSession, Worker } from '../../types';
import EditTransactionModal from '../../components/EditTransactionModal';

// Map the full service names to short badge text
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC'
};

// --- EMAIL STATUS BADGE COMPONENT ---
const EmailStatusBadge: React.FC<{ transactionId: string; email: string }> = ({ transactionId, email }) => {
  const [status, setStatus] = useState<{ sent: boolean; bounced: boolean; reason?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    sessionService.getEmailStatus(transactionId)
      .then(setStatus)
      .finally(() => setLoading(false));
  }, [transactionId]);
  
  if (loading) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-gray-500 truncate max-w-[150px] animate-pulse">
        <Mail size={12} strokeWidth={2.5} />
        {email}
      </span>
    );
  }
  
  const isBounced = status?.bounced;
  const wasSent = status?.sent;
  
  return (
    <span 
      className={`flex items-center gap-1 text-[10px] truncate max-w-[150px] ${
        isBounced ? 'text-red-400 font-bold' : wasSent ? 'text-green-400' : 'text-blue-400'
      }`}
      title={isBounced ? `⚠️ Bounced: ${status?.reason}` : wasSent ? `✓ Email sent to ${email}` : email}
    >
      <Mail size={12} strokeWidth={2.5} />
      {email}
    </span>
  );
};

const PayoutContractor: React.FC = () => {
  const { contractorId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<LogsheetSession | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);

  // --- FORM STATE ---
  const [cashBills, setCashBills] = useState('');
  const [cashChange, setCashChange] = useState('');
  const [chequeAmount, setChequeAmount] = useState('');

  const [deductions, setDeductions] = useState('');
  const [machineRental, setMachineRental] = useState(true);

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // --- COPY PHONE STATE ---
  const [copiedPhone, setCopiedPhone] = useState(false);

  // --- REFRESH KEY (triggers data reload) ---
  const [refreshKey, setRefreshKey] = useState(0);

  // Parse Inputs
  const totalCashInput = (parseFloat(cashBills) || 0) + (parseFloat(cashChange) || 0);
  const totalChequeInput = parseFloat(chequeAmount) || 0;
  const totalDeductions = parseFloat(deductions) || 0;

  useEffect(() => {
    const init = async () => {
      if (!contractorId) return;
      setLoading(true);
      try {
        const daily = await sessionService.getDailySession();
        const foundWorker = daily?.workers.find(
          (w) => w.contractorId === contractorId
        );
        const foundSession = await sessionService.getActiveLogsheetSession(
          contractorId
        );

        if (foundWorker) setWorker(foundWorker);
        if (foundSession) {
          setSession(foundSession);
          if (foundSession.validation) {
            setCashBills(foundSession.validation.verifiedCash.toString());
            setChequeAmount(foundSession.validation.verifiedCheque.toString());
            setMachineRental(foundSession.validation.machineRental);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [contractorId, refreshKey]);

  // --- HELPER: COPY PHONE ---
  const handleCopyPhone = () => {
    if (!worker?.cellPhone) return;
    navigator.clipboard.writeText(worker.cellPhone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1500);
  };

  // --- HELPER: REFRESH DATA ---
  const handleRefreshData = () => {
    setRefreshKey(prev => prev + 1);
  };

  // --- HELPER: BADGES ---
  const getBadgeInfo = (tx: any) => {
    const itemName = tx.items?.[0]?.name || '';
    const type = tx.type || '';

    // Check item name against map first
    if (BADGE_MAP[itemName]) {
      const label = BADGE_MAP[itemName];
      if (type === 'Upgrade') {
        return { label, className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
      }
      if (type === 'Add-On') {
        return { label, className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
      }
    }

    // Fallback to type-based badges
    if (type === 'Upgrade') {
      return { label: 'UPGRADE', className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
    }
    if (type === 'Add-On') {
      return { label: 'ADD-ON', className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
    }
    if (type === 'Sale') {
      return { label: 'SALE', className: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
    }
    // Production / Default
    return { label: 'DONE', className: 'bg-green-900/30 text-green-400 border-green-800' };
  };

  // --- CALCULATIONS ---
  const stats = session?.stats || {
    prodCash: 0, upsellCash: 0, prodCheque: 0, upsellCheque: 0,
    prodGross: 0, upsellPayable: 0, iosCount: 0, stepCount: 0
  };

  // 1. Reconciliation Math
  const systemTotalCash = stats.prodCash + stats.upsellCash;
  const systemTotalCheque = stats.prodCheque + stats.upsellCheque;

  const cashDiff = totalCashInput - systemTotalCash;
  const chequeDiff = totalChequeInput - systemTotalCheque;

  const systemUpsellCash = stats.upsellCash;
  const actualProdCash = totalCashInput - systemUpsellCash;

  const systemUpsellCheque = stats.upsellCheque;
  const actualProdCheque = totalChequeInput - systemUpsellCheque;

  // 2. EQ Calculations
  const taxDivisor = 1.05;

  // System/Projected EQ (based on Stats)
  const projectedProdPayable = stats.prodGross / taxDivisor;
  const projectedEQ = projectedProdPayable / 25;

  // Actual EQ (based on Inputs)
  const systemProdNonCash = stats.prodGross - stats.prodCash - stats.prodCheque;
  const actualProdGross = systemProdNonCash + actualProdCash + actualProdCheque;
  const actualProdPayable = actualProdGross / taxDivisor;
  const actualTotalEQ = actualProdPayable / 25;

  // 3. Commissions
  const baseRate = 8.0;
  const alumniRate = worker?.alumniRate || 0;
  const silverRate = worker?.silverRate || 0;
  const totalRate = baseRate + alumniRate + silverRate;

  const productionPay = actualTotalEQ * totalRate;
  const upsellCommission = (stats.upsellPayable || 0) * 0.10;
  const iosCommission = (stats.iosCount || 0) * 5.0;

  const bonusTotal = (session?.bonuses || []).reduce(
    (sum, b) => sum + b.amount,
    0
  );

  const machineDeduction = machineRental ? 10.0 : 0;
  const grossPay = productionPay + upsellCommission + iosCommission + bonusTotal;
  const finalPay = grossPay - totalDeductions - machineDeduction;

  // --- HANDLERS ---
  const handleRowClick = async (tx: any) => {
    const txId = tx.id || tx.jobId;
    if (!txId) return;

    setLoadingId(txId);

    try {
      const fullTx = await sessionService.getTransactionByJobId(tx.jobId);
      if (fullTx) {
        setSelectedTransaction(fullTx);
        setIsModalOpen(true);
      } else {
        alert("Transaction record not found.");
      }
    } catch (err) {
      console.error("Error fetching transaction:", err);
      alert("Failed to load transaction details.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleFinalize = async () => {
    if (!session) return;
    setLoading(true);

    const validationData = {
      isValidated: true,
      verifiedCash: totalCashInput,
      verifiedCheque: totalChequeInput,
      cashDiff,
      chequeDiff,
      actualProdCash,
      actualProdCheque,
      actualTotalEQ,
      finalCommission: finalPay,
      machineRental: machineRental,
      managerName: 'Admin',
      timestamp: new Date().toISOString(),
    };

    try {
      await sessionService.updateLogsheetSession(session.id, {
        validation: validationData,
        status: 'PAID', // <-- LOCKOUT: This locks the worker out of their logsheet
      });
      navigate('/admin/command-center?tab=payout');
    } catch (err) {
      alert('Error saving payout: ' + err);
      setLoading(false);
    }
  };

  // --- RENDER TRANSACTION ROW ---
  const renderTransactionRow = (tx: any) => {
    const badge = getBadgeInfo(tx);
    const isLoading = loadingId === (tx.id || tx.jobId);

    // Price display
    const displayPrice = tx.displayPrice || `$${tx.price.toFixed(2)}`;

    // Payment display
    const breakdownObj = tx.paymentBreakdown;
    const simpleMethod = tx.paymentMethod;
    let paymentDisplay = '';
    if (breakdownObj && typeof breakdownObj === 'object' && Object.keys(breakdownObj).length > 0) {
      paymentDisplay = Object.entries(breakdownObj)
        .map(([k, v]) => `${k}: $${Number(v).toFixed(2)}`)
        .join(', ');
    } else if (simpleMethod) {
      paymentDisplay = simpleMethod;
    }

    return (
      <div
        key={tx.id || tx.jobId}
        onClick={() => handleRowClick(tx)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 flex flex-col gap-1 relative mb-1 transition-colors hover:border-cps-blue cursor-pointer group"
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          {/* Left */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono font-bold bg-gray-700 text-gray-300 px-1.5 rounded text-[10px] min-w-[32px] text-center">
              {tx.routeCode || '--'}
            </span>
            <span className="font-bold text-gray-200 truncate" title={tx.customerName}>
              {tx.customerName || 'Unknown'}
            </span>
            <span className="text-gray-500 truncate text-[10px] hidden sm:block">
              {tx.address}
            </span>
          </div>

          {/* Contact Info with Email Status */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {tx.customerPhone ? (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <Phone size={12} strokeWidth={2.5} />
                {tx.customerPhone}
              </span>
            ) : (
              <Phone size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
            )}
            
            {/* Email with Bounce Detection */}
            {tx.customerEmail ? (
              <EmailStatusBadge transactionId={tx.jobId} email={tx.customerEmail} />
            ) : (
              <Mail size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
            )}
          </div>

          {/* Payment Info */}
          {paymentDisplay && (
            <div className="flex items-center justify-end text-[10px] text-gray-400 italic truncate flex-shrink text-right px-2 min-w-0 max-w-[120px]">
              {paymentDisplay}
            </div>
          )}

          {/* Right */}
          <div className="flex items-center gap-2 flex-shrink-0 text-right">
            <span className="font-mono font-bold text-gray-300 w-16 text-right">
              {displayPrice}
            </span>

            <button className={`text-[9px] font-bold px-1.5 py-0.5 rounded border min-w-[55px] text-center flex items-center justify-center gap-1 ${badge.className}`}>
              {isLoading ? <Loader size={8} className="animate-spin" /> : badge.label}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <Loader className="animate-spin text-blue-500" />
      </div>
    );

  if (!session || !worker)
    return <div className="p-10 text-white">Session not found.</div>;

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden">

      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 p-4 shadow-md z-10">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-700 rounded-full transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white">
                  {worker.firstName} {worker.lastName}
                </h1>
                
                {/* Click to Copy Phone */}
                {worker.cellPhone && (
                  <button
                    onClick={handleCopyPhone}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors text-sm border border-gray-600"
                    title="Click to copy phone number"
                  >
                    <Phone size={14} className="text-green-400" />
                    <span className="text-gray-300 font-mono">{worker.cellPhone}</span>
                    {copiedPhone ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={12} className="text-gray-500" />
                    )}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400 font-mono mt-1">
                <span className="bg-gray-700 px-2 py-0.5 rounded text-xs">
                  ID: {worker.contractorId}
                </span>
                <span>
                  Steps: <b className="text-white">{stats.stepCount}</b>
                </span>
              </div>
            </div>
          </div>

          {/* HEADER STATS */}
          <div className="flex gap-8 text-right">
            <div>
              <div className="text-xs text-gray-500 uppercase font-bold">Projected EQ</div>
              <div className="text-xl font-bold text-gray-300 font-mono">
                {projectedEQ.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase font-bold text-blue-400">Actual EQ</div>
              <div className="text-xl font-bold text-blue-400 font-mono">
                {actualTotalEQ.toFixed(2)}
              </div>
            </div>
            <div className="pl-4 border-l border-gray-700">
              <div className="text-xs text-gray-500 uppercase font-bold text-green-400">Est. Payout</div>
              <div className="text-xl font-bold text-green-400 font-mono">
                ${finalPay.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">

          {/* 1. TRANSACTION HISTORY (Card Layout) */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
            <div className="p-4 bg-gray-800 border-b border-gray-700">
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                <Calendar size={18} className="text-blue-400" /> Transaction History
              </h2>
            </div>
            <div className="p-2">
              {session.financialStore.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No transactions found.
                </div>
              ) : (
                <div className="space-y-1">
                  {session.financialStore.map((tx: any) => renderTransactionRow(tx))}
                </div>
              )}
            </div>
          </div>

          {/* 2. VISUAL BREAKDOWN */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Production */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                <Calculator size={14} className="text-blue-400" /> Production Comm
              </div>
              <div className="text-2xl font-bold text-white mb-3">
                ${productionPay.toFixed(2)}
              </div>
              <div className="bg-gray-900/50 rounded p-3 text-xs text-gray-400 space-y-2 border border-gray-700/50">
                <div className="flex justify-between items-center">
                  <span>Actual EQ</span>
                  <span className="font-mono text-blue-300 font-bold">{actualTotalEQ.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                  <span title="Base + Silver + Alumni">Total Rate (${totalRate.toFixed(2)})</span>
                  <span className="font-mono text-gray-300">
                    ${baseRate.toFixed(2)} + ${silverRate.toFixed(2)} + ${alumniRate.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Upsell */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                <TrendingUp size={14} className="text-green-400" /> Upsell Comm
              </div>
              <div className="text-2xl font-bold text-white mb-3">
                ${upsellCommission.toFixed(2)}
              </div>
              <div className="bg-gray-900/50 rounded p-3 text-xs text-gray-400 space-y-2 border border-gray-700/50">
                <div className="flex justify-between items-center">
                  <span>Payable Upsell</span>
                  <span className="font-mono text-white">${stats.upsellPayable?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                  <span>Commission</span>
                  <span className="font-mono text-gray-300">10%</span>
                </div>
              </div>
            </div>

            {/* IOS */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                <Award size={14} className="text-purple-400" /> IOS / PB Comm
              </div>
              <div className="text-2xl font-bold text-white mb-3">
                ${iosCommission.toFixed(2)}
              </div>
              <div className="bg-gray-900/50 rounded p-3 text-xs text-gray-400 space-y-2 border border-gray-700/50">
                <div className="flex justify-between items-center">
                  <span>Count</span>
                  <span className="font-mono text-white">{stats.iosCount}</span>
                </div>
                <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                  <span>Rate</span>
                  <span className="font-mono text-gray-300">$5.00 / ea</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. RECONCILIATION & FINAL ACTIONS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-10">

            {/* Cash/Cheque Inputs */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Truck size={20} className="text-green-400" /> Reconciliation
              </h3>

              {/* Cash Section */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 mb-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-bold text-gray-300">Cash Collected</label>
                  <span className="text-sm text-gray-400">
                    Expected: ${systemTotalCash.toFixed(2)}
                  </span>
                </div>
                <div className="flex gap-4 mb-2">
                  <input
                    type="number"
                    value={cashBills}
                    onChange={(e) => setCashBills(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder-gray-500"
                    placeholder="Bills ($)"
                  />
                  <input
                    type="number"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder-gray-500"
                    placeholder="Change ($)"
                  />
                </div>
                {cashDiff !== 0 && (
                  <div className={`text-xs flex items-center gap-2 p-2 rounded ${cashDiff < 0 ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/20'}`}>
                    <AlertCircle size={12} />
                    <span>
                      {cashDiff < 0 ? 'Shortage' : 'Overage'}: {cashDiff > 0 ? '+' : ''}{cashDiff.toFixed(2)}
                      (Adjusts EQ)
                    </span>
                  </div>
                )}
              </div>

              {/* Cheque Section */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-bold text-gray-300">Cheques Collected</label>
                  <span className="text-sm text-gray-400">
                    Expected: ${systemTotalCheque.toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  value={chequeAmount}
                  onChange={(e) => setChequeAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white mb-2 placeholder-gray-500"
                  placeholder="0.00"
                />
                {chequeDiff !== 0 && (
                  <div className={`text-xs flex items-center gap-2 p-2 rounded ${chequeDiff < 0 ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/20'}`}>
                    <AlertCircle size={12} />
                    <span>
                      {chequeDiff < 0 ? 'Shortage' : 'Overage'}: {chequeDiff > 0 ? '+' : ''}{chequeDiff.toFixed(2)}
                      (Adjusts EQ)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Final Summary */}
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Calculator size={20} className="text-blue-400" /> Deductions
                </h3>

                <div className="space-y-4">
                  <div className="bg-gray-900/50 p-3 rounded border border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-300 text-sm">
                      <Truck size={16} />
                      <span>Machine Rental Fee ($10.00)</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={machineRental}
                      onChange={(e) => setMachineRental(e.target.checked)}
                      className="w-5 h-5 accent-blue-500 rounded cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 uppercase font-bold mb-1 block">Other Deductions</label>
                    <input
                      type="number"
                      value={deductions}
                      onChange={(e) => setDeductions(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder-gray-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-4 border-t border-gray-600">
                <div className="flex justify-between items-end mb-4">
                  <span className="text-lg font-bold text-white">
                    Final Payout
                  </span>
                  <div className="text-right">
                    <span className="text-3xl font-bold text-green-400 font-mono tracking-tight">
                      ${finalPay.toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleFinalize}
                  className="w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 shadow-lg bg-green-600 hover:bg-green-500 text-white transition-all active:scale-[0.98]"
                >
                  <CheckCircle size={20} />{' '}
                  {session.validation?.isValidated ? 'Update Payout' : 'Finalize & Paid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Transaction Modal */}
      {selectedTransaction && (
        <EditTransactionModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTransaction(null);
          }}
          onUpdate={handleRefreshData}
          transaction={selectedTransaction}
        />
      )}
    </div>
  );
};

export default PayoutContractor;