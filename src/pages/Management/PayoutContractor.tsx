// src/pages/Management/PayoutContractor.tsx
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
  MapPin,
  ChevronRight,
  TrendingUp,
  Award,
  AlertCircle
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { LogsheetSession, Worker } from '../../types';
// IMPORT WITHOUT CURLY BRACES:
import EditTransactionModal from '../../components/EditTransactionModal'; 

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
  // Machine rental defaults to true as requested
  const [machineRental, setMachineRental] = useState(true); 

  // --- MODAL STATE ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any | null>(null);

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
          // Pre-fill validation data if it exists
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
  }, [contractorId]);

  // --- HELPER: BADGES ---
  // Detects specific keywords in item_name to assign badge styles
  const getBadgeStyle = (itemName: string) => {
    const name = (itemName || '').toLowerCase();
    if (name.includes('sp pro')) return { label: 'SP Pro', className: 'bg-blue-900/50 text-blue-400 border border-blue-800' };
    if (name.includes('rejuv')) return { label: 'Rejuv', className: 'bg-purple-900/50 text-purple-400 border border-purple-800' };
    if (name.includes('det')) return { label: 'Det', className: 'bg-orange-900/50 text-orange-400 border border-orange-800' };
    if (name.includes('grub')) return { label: 'Grub', className: 'bg-green-900/50 text-green-400 border border-green-800' };
    return { label: 'STD', className: 'bg-gray-700 text-gray-400 border border-gray-600' };
  };

  // --- CALCULATIONS ---
  const stats = session?.stats || { 
    prodCash: 0, upsellCash: 0, prodCheque: 0, upsellCheque: 0, 
    prodGross: 0, upsellPayable: 0, iosCount: 0, stepCount: 0 
  };

  // 1. Reconciliation Math (System vs Actual)
  const systemTotalCash = stats.prodCash + stats.upsellCash;
  const systemTotalCheque = stats.prodCheque + stats.upsellCheque;

  const cashDiff = totalCashInput - systemTotalCash;
  const chequeDiff = totalChequeInput - systemTotalCheque;

  // 2. Adjust Production Credit based on Inputs
  // IF user is short on cash, actualProdCash drops, which lowers EQ automatically.
  const systemUpsellCash = stats.upsellCash;
  const actualProdCash = totalCashInput - systemUpsellCash;

  const systemUpsellCheque = stats.upsellCheque;
  const actualProdCheque = totalChequeInput - systemUpsellCheque;

  // 3. Calculate Actual EQ
  const systemProdNonCash = stats.prodGross - stats.prodCash - stats.prodCheque;
  const actualProdGross = systemProdNonCash + actualProdCash + actualProdCheque;

  const taxDivisor = 1.05;
  const actualProdPayable = actualProdGross / taxDivisor;
  const actualTotalEQ = actualProdPayable / 25;

  // 4. Commissions
  // Rates
  const baseRate = 8.0; 
  const alumniRate = worker?.alumniRate || 0;
  const silverRate = worker?.silverRate || 0;
  const totalRate = baseRate + alumniRate + silverRate;

  // Components
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
  const handleRowClick = (transaction: any) => {
    setSelectedTransaction(transaction);
    setIsModalOpen(true);
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
      managerName: 'Admin', // Replace with dynamic user if available
      timestamp: new Date().toISOString(),
    };

    try {
      await sessionService.updateLogsheetSession(session.id, {
        validation: validationData,
      });
      navigate('/admin/command-center');
    } catch (err) {
      alert('Error saving payout: ' + err);
      setLoading(false);
    }
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
              <h1 className="text-2xl font-bold text-white">
                {worker.firstName} {worker.lastName}
              </h1>
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
          <div className="text-right">
            <div className="text-xs text-gray-500 uppercase font-bold text-blue-400">
              Est. Payout
            </div>
            <div className="text-3xl font-bold text-green-400">
              ${finalPay.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
          
          {/* 1. VISUAL BREAKDOWN (NEW) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Production */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
               <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                 <Calculator size={14} className="text-blue-400"/> Production Comm
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
                    <span title="Base + Silver + Alumni">Total Rate ({totalRate.toFixed(2)}%)</span>
                    <span className="font-mono text-gray-300">
                      {baseRate}% + {silverRate}% + {alumniRate}%
                    </span>
                  </div>
               </div>
            </div>

            {/* Upsell */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
               <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                 <TrendingUp size={14} className="text-green-400"/> Upsell Comm
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
                 <Award size={14} className="text-purple-400"/> IOS / PB Comm
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

          {/* 2. TRANSACTION HISTORY (UPDATED) */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
            <div className="p-4 bg-gray-800 border-b border-gray-700">
              <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                <Calendar size={18} className="text-blue-400" /> Transaction History
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-900 text-gray-400 uppercase text-xs font-bold">
                  <tr>
                    <th className="p-3">Type</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Contact Info</th>
                    <th className="p-3">Item</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {session.financialStore.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        No transactions found.
                      </td>
                    </tr>
                  ) : (
                    session.financialStore.map((tx: any, idx: number) => {
                      const badge = getBadgeStyle(tx.item_name || tx.type || '');
                      return (
                        <tr 
                          key={tx.id || idx} 
                          className="hover:bg-gray-750 cursor-pointer transition-colors"
                          onClick={() => handleRowClick(tx)}
                        >
                          <td className="p-3 align-top">
                            <span className={`inline-block text-[10px] font-bold uppercase px-2 py-1 rounded ${badge.className}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="p-3 align-top">
                            <div className="font-bold text-gray-200">{tx.customerName}</div>
                            {tx.customerAddress && (
                              <div className="flex items-start gap-1 mt-1 text-xs text-gray-500">
                                <MapPin size={10} className="mt-0.5 shrink-0" />
                                <span className="truncate max-w-[150px]">{tx.customerAddress}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3 align-top">
                            <div className="flex flex-col gap-1 text-xs text-gray-400">
                              {tx.customerPhone && (
                                <div className="flex items-center gap-1.5">
                                  <Phone size={10} /> {tx.customerPhone}
                                </div>
                              )}
                              {tx.customerEmail && (
                                <div className="flex items-center gap-1.5">
                                  <Mail size={10} /> 
                                  <span className="truncate max-w-[150px]">{tx.customerEmail}</span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3 align-top text-gray-300">
                            {tx.item_name || 'Service'}
                          </td>
                          <td className="p-3 align-top text-right font-mono font-bold text-gray-200">
                            ${tx.price.toFixed(2)}
                          </td>
                          <td className="p-3 align-middle text-gray-500">
                            <ChevronRight size={16} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
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
          onClose={() => setIsModalOpen(false)}
          transaction={selectedTransaction}
        />
      )}
    </div>
  );
};

export default PayoutContractor;