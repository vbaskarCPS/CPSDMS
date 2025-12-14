// src/pages/Management/PayoutContractor.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  CreditCard,
  Banknote,
  Calendar,
  Calculator,
  Truck,
  Loader,
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { LogsheetSession, Worker } from '../../types';

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
  const [deductionNote, setDeductionNote] = useState('');
  const [machineRental, setMachineRental] = useState(false);

  const totalCashInput =
    (parseFloat(cashBills) || 0) + (parseFloat(cashChange) || 0);
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
  }, [contractorId]);

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center bg-gray-900 text-white">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );
  if (!session || !worker)
    return <div className="p-10 text-white">Session not found.</div>;

  const stats = session.stats;

  // --- CALCULATIONS ---
  const systemTotalCash = stats.prodCash + stats.upsellCash;
  const systemTotalCheque = stats.prodCheque + stats.upsellCheque;

  const systemUpsellCash = stats.upsellCash;
  const actualProdCash = totalCashInput - systemUpsellCash;

  const systemUpsellCheque = stats.upsellCheque;
  const actualProdCheque = totalChequeInput - systemUpsellCheque;

  const systemProdNonCash = stats.prodGross - stats.prodCash - stats.prodCheque;
  const actualProdGross = systemProdNonCash + actualProdCash + actualProdCheque;

  const taxDivisor = 1.05;
  const actualProdPayable = actualProdGross / taxDivisor;
  const actualTotalEQ = actualProdPayable / 25;

  // Commissions
  const baseRate = 8.0;
  const alumniRate = worker.alumniRate || 0;
  const silverRate = worker.silverRate || 0;
  const effectiveBaseRate = baseRate + alumniRate + silverRate;

  const productionPay = actualTotalEQ * effectiveBaseRate;
  const upsellCommission = (stats.upsellPayable || 0) * 0.1;
  const iosCommission = (stats.iosCount || 0) * 5.0;
  const bonusTotal = (session.bonuses || []).reduce(
    (sum, b) => sum + b.amount,
    0
  );

  const machineDeduction = machineRental ? 10.0 : 0;
  const grossPay =
    productionPay + upsellCommission + iosCommission + bonusTotal;
  const finalPay = grossPay - totalDeductions - machineDeduction;

  const cashDiff = totalCashInput - systemTotalCash;
  const chequeDiff = totalChequeInput - systemTotalCheque;
  const isCashMatch = Math.abs(cashDiff) < 0.05;
  const isChequeMatch = Math.abs(chequeDiff) < 0.05;

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
      });
      navigate('/admin/command-center');
    } catch (err) {
      alert('Error saving payout: ' + err);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden">
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
              Actual EQ
            </div>
            <div className="text-xl font-bold text-blue-400">
              {actualTotalEQ.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">
          {/* 1. TRANSACTIONS */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
            <div className="p-4 bg-gray-800 border-b border-gray-700">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Calendar size={18} className="text-blue-400" /> Transaction
                History
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-900 text-gray-400 uppercase text-xs font-bold">
                  <tr>
                    <th className="p-3">Type</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Payment</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {session.financialStore.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-gray-500">
                        No transactions.
                      </td>
                    </tr>
                  ) : (
                    session.financialStore.map((tx, idx) => (
                      <tr key={idx} className="hover:bg-gray-750">
                        <td className="p-3">
                          <span className="text-[10px] font-bold uppercase bg-blue-900/50 text-blue-400 px-2 py-1 rounded">
                            {tx.type}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-gray-200">
                          {tx.customerName}
                        </td>
                        <td className="p-3">{tx.paymentMethod}</td>
                        <td className="p-3 text-right font-mono font-bold text-gray-200">
                          ${tx.price.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. VALIDATION & PAYOUT */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-10">
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Banknote size={20} className="text-green-400" /> Cash
                Reconciliation
              </h3>
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700 mb-4">
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-bold text-gray-300">
                    Cash Collected
                  </label>
                  <span className="text-sm text-gray-400">
                    System: ${systemTotalCash.toFixed(2)}
                  </span>
                </div>
                <div className="flex gap-4 mb-2">
                  <input
                    type="number"
                    value={cashBills}
                    onChange={(e) => setCashBills(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white"
                    placeholder="Bills"
                  />
                  <input
                    type="number"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white"
                    placeholder="Change"
                  />
                </div>
                <div
                  className={`text-sm flex justify-between p-2 rounded ${
                    isCashMatch
                      ? 'bg-green-900/30 text-green-400'
                      : 'bg-red-900/30 text-red-400'
                  }`}
                >
                  <span>Diff</span>
                  <span className="font-mono font-bold">
                    {cashDiff > 0 ? '+' : ''}
                    {cashDiff.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-bold text-gray-300">
                    Cheques
                  </label>
                  <span className="text-sm text-gray-400">
                    System: ${systemTotalCheque.toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  value={chequeAmount}
                  onChange={(e) => setChequeAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white mb-2"
                  placeholder="0.00"
                />
                <div
                  className={`text-sm flex justify-between p-2 rounded ${
                    isChequeMatch
                      ? 'bg-green-900/30 text-green-400'
                      : 'bg-red-900/30 text-red-400'
                  }`}
                >
                  <span>Diff</span>
                  <span className="font-mono font-bold">
                    {chequeDiff > 0 ? '+' : ''}
                    {chequeDiff.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Calculator size={20} className="text-blue-400" /> Commission
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="bg-gray-900/30 rounded p-3 flex justify-between text-white font-bold">
                    <span>Production Pay</span>
                    <span className="font-mono">
                      ${productionPay.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400 px-2">
                    <span>Upsell Comm</span>
                    <span className="text-white font-mono">
                      ${upsellCommission.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400 px-2">
                    <span>IOS Comm</span>
                    <span className="text-white font-mono">
                      ${iosCommission.toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-gray-700 my-2 pt-2">
                    <div className="flex items-center justify-between mb-2 bg-gray-900/50 p-2 rounded border border-gray-700">
                      <div className="flex items-center gap-2">
                        <Truck size={14} className="text-gray-400" />
                        <span>Machine Rental ($10)</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={machineRental}
                        onChange={(e) => setMachineRental(e.target.checked)}
                        className="accent-red-500 w-4 h-4"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-600">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-lg font-bold text-white">
                    Final Payout
                  </span>
                  <span className="text-2xl font-bold text-green-400 font-mono">
                    ${finalPay.toFixed(2)}
                  </span>
                </div>
                <button
                  onClick={handleFinalize}
                  disabled={!isCashMatch || !isChequeMatch}
                  className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 shadow-lg ${
                    isCashMatch && isChequeMatch
                      ? 'bg-green-600 hover:bg-green-500 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <CheckCircle size={20} />{' '}
                  {session.validation?.isValidated
                    ? 'Update Payout'
                    : 'Finalize & Paid'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayoutContractor;
