// src/pages/Management/PayoutToday.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Loader,
  Trophy,
  DollarSign,
  Plus,
  Clock,
} from 'lucide-react';
import { Worker, SortOption, Bonus, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';

interface PayoutTodayProps {
  consoleProfileId: number;
  date: string;
  sortOption: SortOption;
  searchTerm: string;
}

const PayoutToday: React.FC<PayoutTodayProps> = ({
  date,
  sortOption,
  searchTerm,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<
    { worker: Worker; session: LogsheetSession }[]
  >([]);

  // Bonus Modal State
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusType, setBonusType] = useState('Performance');

  const loadData = async () => {
    setLoading(true);
    try {
      const dailySession = await sessionService.getDailySession();
      if (!dailySession) {
        setItems([]);
        return;
      }
      const allWorkers = dailySession.workers || [];
      const allSessions = await sessionService.getLogsheetSessions();

      const merged = allSessions
        .map((session) => {
          const worker = allWorkers.find(
            (w) => w.contractorId === session.workerId
          );
          if (!worker) return null;
          return { worker, session };
        })
        .filter(Boolean) as { worker: Worker; session: LogsheetSession }[];

      setItems(merged);
    } catch (err) {
      console.error('PayoutToday Load Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [date]);

  const sortedItems = useMemo(() => {
    let filtered = items;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.worker.firstName.toLowerCase().includes(lower) ||
          i.worker.lastName.toLowerCase().includes(lower) ||
          i.worker.contractorId.includes(lower)
      );
    }

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'alpha':
          return a.worker.lastName.localeCompare(b.worker.lastName);
        case 'steps':
          return (
            (b.session.stats.stepCount || 0) - (a.session.stats.stepCount || 0)
          );
        case 'equiv':
          return (
            (b.session.stats.totalEQ || 0) - (a.session.stats.totalEQ || 0)
          );
        case 'upsell':
          return (
            (b.session.stats.upsellCount || 0) -
            (a.session.stats.upsellCount || 0)
          );
        case 'commission':
          const payA = a.session.validation?.finalCommission || 0;
          const payB = b.session.validation?.finalCommission || 0;
          return payB - payA;
        default:
          return 0;
      }
    });
  }, [items, searchTerm, sortOption]);

  const handleAddBonus = async () => {
    if (!selectedSessionId || !bonusAmount) return;

    const item = items.find((i) => i.session.id === selectedSessionId);
    if (!item) return;

    const amt = parseFloat(bonusAmount);
    const newBonus: Bonus = { id: Date.now(), type: bonusType, amount: amt };

    const updatedBonuses = [...(item.session.bonuses || []), newBonus];

    const currentPay = item.session.validation?.finalCommission || 0;
    const newPay = currentPay + amt;

    const updatedValidation = item.session.validation
      ? {
          ...item.session.validation,
          finalCommission: newPay,
        }
      : undefined;

    await sessionService.updateLogsheetSession(item.session.id, {
      bonuses: updatedBonuses,
      validation: updatedValidation,
    });

    setShowBonusModal(false);
    setBonusAmount('');
    loadData();
  };

  if (loading)
    return (
      <div className="p-10 text-center">
        <Loader className="inline animate-spin text-cps-blue" /> Loading
        Payouts...
      </div>
    );

  return (
    <>
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
        {sortedItems.length === 0 && (
          <div className="text-center py-10 text-gray-500 flex flex-col items-center">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <p>No active sessions found for this date.</p>
          </div>
        )}

        {sortedItems.map(({ worker, session }) => {
          const isValidated = session.validation?.isValidated || false;
          const payAmount = session.validation?.finalCommission ?? 0;

          return (
            <div
              key={session.id}
              onClick={() =>
                navigate(`/admin/payout/${worker.contractorId}?date=${date}`)
              }
              className="bg-gray-800 border border-gray-700 p-3 rounded-lg flex items-center justify-between hover:bg-gray-750 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-1 h-10 rounded-full ${
                    isValidated ? 'bg-green-500' : 'bg-yellow-500'
                  }`}
                ></div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-200">
                      {worker.firstName} {worker.lastName}
                    </span>
                    {isValidated && (
                      <CheckCircle size={14} className="text-green-500" />
                    )}
                  </div>
                  <div className="text-xs text-gray-400 font-mono flex items-center gap-2">
                    <span>#{worker.contractorId}</span>
                    <span className="text-gray-500">|</span>
                    <span
                      className={`flex items-center gap-1 ${
                        isValidated ? 'text-green-400' : 'text-yellow-500'
                      }`}
                    >
                      <Clock size={10} />
                      {isValidated ? 'Paid' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 sm:gap-6">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] text-gray-500 uppercase font-bold">
                    Steps
                  </div>
                  <div className="text-sm font-bold text-gray-300">
                    {session.stats.stepCount}
                  </div>
                </div>
                <div className="text-right hidden md:block">
                  <div className="text-[10px] text-gray-500 uppercase font-bold">
                    Upsell Gross
                  </div>
                  <div className="text-sm font-bold text-white">
                    ${session.stats.upsellGross.toFixed(2)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-500 uppercase font-bold">
                    EQ
                  </div>
                  <div className="text-sm font-mono font-bold text-blue-300">
                    {session.stats.totalEQ.toFixed(2)}
                  </div>
                </div>
                <div className="text-right min-w-[60px]">
                  <div className="text-[10px] text-gray-500 uppercase font-bold">
                    Comm
                  </div>
                  <div
                    className={`text-sm font-mono font-bold ${
                      isValidated ? 'text-green-400' : 'text-gray-500'
                    }`}
                  >
                    ${payAmount.toFixed(2)}
                  </div>
                </div>
                {isValidated && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedSessionId(session.id);
                      setBonusAmount('');
                      setShowBonusModal(true);
                    }}
                    className="px-2 py-1 bg-blue-900/30 text-blue-400 border border-blue-800 rounded text-xs hover:bg-blue-900/50 transition-colors z-10"
                  >
                    <Plus size={12} /> Bonus
                  </button>
                )}
                <ChevronRight
                  size={18}
                  className="text-gray-600 group-hover:text-white transition-colors"
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* Bonus Modal - Only structural updates needed */}
      {showBonusModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full border border-gray-700">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Trophy size={20} className="text-yellow-400" /> Add Bonus
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Amount ($)
                </label>
                <div className="relative">
                  <DollarSign
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                  <input
                    type="number"
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 pl-8 text-white focus:ring-2 focus:ring-green-500 outline-none"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Type</label>
                <select
                  value={bonusType}
                  onChange={(e) => setBonusType(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option>Performance</option>
                  <option>Rookie of Day</option>
                  <option>Top Sales</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowBonusModal(false)}
                  className="flex-1 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddBonus}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold shadow-lg transition-transform transform hover:scale-105"
                >
                  Add Bonus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PayoutToday;
