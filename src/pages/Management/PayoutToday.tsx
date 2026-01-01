// src/pages/Management/PayoutToday.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Loader,
  Clock,
  Users,
  TrendingUp,
  DollarSign,
  Banknote,
  CreditCard,
  Receipt,
  Wallet,
} from 'lucide-react';
import { Worker, SortOption, ManagementUser, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';

interface PayoutTodayProps {
  consoleProfileId: number;
  date: string;
  sortOption: SortOption;
  searchTerm: string;
  managers: ManagementUser[];
  workers: Worker[];
}

interface AggregatedStats {
  workerCount: number;
  totalSteps: number;
  prodGross: number;
  avgEQ: number;
  upsellCount: number;
  upsellGross: number;
  totalCash: number;
  totalCheque: number;
  totalETransfer: number;
  totalCreditCard: number;
  totalPrepaid: number;
  totalBilled: number;
}

const PayoutToday: React.FC<PayoutTodayProps> = ({
  date,
  sortOption,
  searchTerm,
  managers,
  workers,
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [items, setItems] = useState<
    { worker: Worker; session: LogsheetSession }[]
  >([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const allSessions = await sessionService.getLogsheetSessions();

      const merged = allSessions
        .map((session) => {
          const worker = workers.find(
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
    if (workers.length > 0) {
      loadData();
    }
  }, [date, workers]);

  // --- AGGREGATED STATS CALCULATION ---
  const aggregatedStats = useMemo<AggregatedStats>(() => {
    const stats: AggregatedStats = {
      workerCount: items.length,
      totalSteps: 0,
      prodGross: 0,
      avgEQ: 0,
      upsellCount: 0,
      upsellGross: 0,
      totalCash: 0,
      totalCheque: 0,
      totalETransfer: 0,
      totalCreditCard: 0,
      totalPrepaid: 0,
      totalBilled: 0,
    };

    let totalEQ = 0;

    items.forEach(({ session }) => {
      const s = session.stats;
      const v = session.validation;
      const isValidated = v?.isValidated || false;

      // Steps
      stats.totalSteps += s.stepCount || 0;

      // Prod Gross (uses actual when validated for cash/cheque)
      const prodCash = isValidated ? (v?.actualProdCash || 0) : (s.prodCash || 0);
      const prodCheque = isValidated ? (v?.actualProdCheque || 0) : (s.prodCheque || 0);
      const prodGrossCalc = (s.prodPrepaid || 0) + (s.prodBilled || 0) + prodCash + prodCheque + 
                           (s.prodETransfer || 0) + (s.prodCreditCard || 0) + 
                           (s.prodFlats || 0) + (s.prodPrepaidSplit || 0);
      stats.prodGross += prodGrossCalc;

      // EQ (uses actual when validated)
      const eq = isValidated ? (v?.actualTotalEQ || 0) : (s.totalEQ || 0);
      totalEQ += eq;

      // Upsells
      stats.upsellCount += s.upsellCount || 0;
      stats.upsellGross += s.upsellGross || 0;

      // Cash (prod + upsell, use actual for prod when validated)
      stats.totalCash += prodCash + (s.upsellCash || 0);

      // Cheque (prod + upsell, use actual for prod when validated)
      stats.totalCheque += prodCheque + (s.upsellCheque || 0);

      // E-Transfer
      stats.totalETransfer += (s.prodETransfer || 0) + (s.upsellETransfer || 0);

      // Credit Card
      stats.totalCreditCard += (s.prodCreditCard || 0) + (s.upsellCreditCard || 0);

      // Prepaid (prodFlats + prodPrepaid + prodPrepaidSplit + upsellPrepaid)
      stats.totalPrepaid += (s.prodFlats || 0) + (s.prodPrepaid || 0) + 
                           (s.prodPrepaidSplit || 0) + (s.upsellPrepaid || 0);

      // Billed (prodBilled ONLY)
      stats.totalBilled += s.prodBilled || 0;
    });

    stats.avgEQ = items.length > 0 ? totalEQ / items.length : 0;

    return stats;
  }, [items]);

  // --- SORTING LOGIC ---
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
        case 'standard': {
          // Sort by manager name first, then alphabetically by worker last name
          const aManager = managers.find(m => m.userId === a.worker.assignedManagerId)?.name || 'ZZZ';
          const bManager = managers.find(m => m.userId === b.worker.assignedManagerId)?.name || 'ZZZ';
          if (aManager !== bManager) return aManager.localeCompare(bManager);
          const lastNameCompare = a.worker.lastName.localeCompare(b.worker.lastName);
          if (lastNameCompare !== 0) return lastNameCompare;
          return a.worker.firstName.localeCompare(b.worker.firstName);
        }
        case 'alpha':
          return a.worker.lastName.localeCompare(b.worker.lastName);
        case 'steps':
          return (b.session.stats.stepCount || 0) - (a.session.stats.stepCount || 0);
        case 'equiv':
          return (b.session.stats.totalEQ || 0) - (a.session.stats.totalEQ || 0);
        case 'upsell':
          return (b.session.stats.upsellCount || 0) - (a.session.stats.upsellCount || 0);
        case 'gross':
          return (b.session.stats.prodGross + b.session.stats.upsellGross) - 
                 (a.session.stats.prodGross + a.session.stats.upsellGross);
        case 'commission':
          const payA = a.session.validation?.finalCommission || 0;
          const payB = b.session.validation?.finalCommission || 0;
          return payB - payA;
        default:
          return 0;
      }
    });
  }, [items, searchTerm, sortOption, managers]);

  // --- GROUP BY MANAGER (for standard sort display) ---
  const groupedByManager = useMemo(() => {
    if (sortOption !== 'standard') return null;
    
    const groups: Record<string, { manager: ManagementUser | null; items: typeof sortedItems }> = {};
    
    sortedItems.forEach(item => {
      const managerId = item.worker.assignedManagerId || 'unassigned';
      if (!groups[managerId]) {
        const manager = managers.find(m => m.userId === managerId) || null;
        groups[managerId] = { manager, items: [] };
      }
      groups[managerId].items.push(item);
    });

    // Sort groups by manager name
    return Object.entries(groups).sort(([, a], [, b]) => {
      const aName = a.manager?.name || 'ZZZ';
      const bName = b.manager?.name || 'ZZZ';
      return aName.localeCompare(bName);
    });
  }, [sortedItems, sortOption, managers]);

  if (loading)
    return (
      <div className="p-10 text-center flex-1 flex items-center justify-center">
        <Loader className="inline animate-spin text-cps-blue" /> 
        <span className="ml-2 text-gray-400">Loading Payouts...</span>
      </div>
    );

  // --- RENDER SINGLE WORKER ROW ---
  const renderWorkerRow = ({ worker, session }: { worker: Worker; session: LogsheetSession }) => {
    const isValidated = session.validation?.isValidated || false;
    const payAmount = session.validation?.finalCommission ?? 0;
    const eq = isValidated ? (session.validation?.actualTotalEQ || 0) : session.stats.totalEQ;

    return (
      <div
        key={session.id}
        onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
        className="bg-gray-800 border border-gray-700 py-1.5 px-2 rounded flex items-center gap-2 hover:bg-gray-750 hover:border-gray-600 transition-colors cursor-pointer group text-xs"
      >
        {/* Status Indicator */}
        <div
          className={`w-0.5 h-5 rounded-full flex-shrink-0 ${
            isValidated ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />

        {/* Name */}
        <div className="font-bold text-gray-200 min-w-[120px] truncate">
          {worker.firstName} {worker.lastName}
        </div>

        {/* ID */}
        <span className="text-gray-500 font-mono text-[10px] min-w-[50px]">
          #{worker.contractorId}
        </span>

        {/* Separator */}
        <span className="text-gray-700">|</span>

        {/* Status Badge */}
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 min-w-[55px] justify-center ${
            isValidated 
              ? 'bg-green-900/30 text-green-400 border border-green-800' 
              : 'bg-yellow-900/30 text-yellow-500 border border-yellow-800'
          }`}
        >
          <Clock size={8} />
          {isValidated ? 'Paid' : 'Pending'}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-gray-400">
          <div className="text-center min-w-[40px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Steps</span>
            <span className="font-bold text-gray-300">{session.stats.stepCount}</span>
          </div>
          <div className="text-center min-w-[50px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Upsell</span>
            <span className="font-bold text-white">${session.stats.upsellGross.toFixed(0)}</span>
          </div>
          <div className="text-center min-w-[40px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">EQ</span>
            <span className="font-mono font-bold text-blue-300">{eq.toFixed(2)}</span>
          </div>
          <div className="text-center min-w-[55px]">
            <span className="text-[9px] text-gray-600 uppercase block leading-none">Comm</span>
            <span
              className={`font-mono font-bold ${
                isValidated ? 'text-green-400' : 'text-gray-500'
              }`}
            >
              ${payAmount.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Arrow */}
        <ChevronRight
          size={14}
          className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0"
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* --- STATS HEADER --- */}
      <div className="border-b border-gray-700 bg-gray-900/50">
        {/* Line 1: Performance Stats */}
        <div className="grid grid-cols-6 gap-px bg-gray-700">
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Users size={10} />
              <span className="text-[9px] uppercase font-bold">Workers</span>
            </div>
            <div className="text-lg font-bold text-blue-300">{aggregatedStats.workerCount}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <TrendingUp size={10} />
              <span className="text-[9px] uppercase font-bold">Steps</span>
            </div>
            <div className="text-lg font-bold text-white">{aggregatedStats.totalSteps}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <DollarSign size={10} />
              <span className="text-[9px] uppercase font-bold">Prod Gross</span>
            </div>
            <div className="text-lg font-bold text-green-400">${aggregatedStats.prodGross.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Avg EQ</span>
            </div>
            <div className={`text-lg font-bold ${
              aggregatedStats.avgEQ >= 3 ? 'text-green-400' : 
              aggregatedStats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {aggregatedStats.avgEQ.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Upsells</span>
            </div>
            <div className="text-lg font-bold text-purple-400">{aggregatedStats.upsellCount}</div>
          </div>
          <div className="bg-gray-800 p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[9px] uppercase font-bold">Up Gross</span>
            </div>
            <div className="text-lg font-bold text-purple-300">${aggregatedStats.upsellGross.toFixed(0)}</div>
          </div>
        </div>

        {/* Line 2: Payment Method Breakdown */}
        <div className="grid grid-cols-6 gap-px bg-gray-700">
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Banknote size={9} />
              <span className="text-[8px] uppercase font-bold">Cash</span>
            </div>
            <div className="text-sm font-bold text-green-300 font-mono">${aggregatedStats.totalCash.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Receipt size={9} />
              <span className="text-[8px] uppercase font-bold">Cheque</span>
            </div>
            <div className="text-sm font-bold text-blue-300 font-mono">${aggregatedStats.totalCheque.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">E-Trans</span>
            </div>
            <div className="text-sm font-bold text-cyan-300 font-mono">${aggregatedStats.totalETransfer.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <CreditCard size={9} />
              <span className="text-[8px] uppercase font-bold">CC</span>
            </div>
            <div className="text-sm font-bold text-orange-300 font-mono">${aggregatedStats.totalCreditCard.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Wallet size={9} />
              <span className="text-[8px] uppercase font-bold">Prepaid</span>
            </div>
            <div className="text-sm font-bold text-indigo-300 font-mono">${aggregatedStats.totalPrepaid.toFixed(0)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">Billed</span>
            </div>
            <div className="text-sm font-bold text-gray-400 font-mono">${aggregatedStats.totalBilled.toFixed(0)}</div>
          </div>
        </div>
      </div>

      {/* --- WORKER LIST --- */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
        {sortedItems.length === 0 && (
          <div className="text-center py-10 text-gray-500 flex flex-col items-center">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <p>No active sessions found for this date.</p>
          </div>
        )}

        {/* Standard Sort: Grouped by Manager */}
        {sortOption === 'standard' && groupedByManager && groupedByManager.map(([managerId, group]) => (
          <div key={managerId} className="mb-3">
            {/* Manager Header */}
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur py-1 px-2 mb-1 z-10 flex items-center gap-2 border-b border-gray-800">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                {group.manager?.name || 'Unassigned'}
              </span>
              <span className="text-[9px] text-gray-600">({group.items.length})</span>
            </div>
            
            {/* Workers in this group */}
            <div className="space-y-1">
              {group.items.map(renderWorkerRow)}
            </div>
          </div>
        ))}

        {/* Other Sorts: Flat List */}
        {sortOption !== 'standard' && sortedItems.map(renderWorkerRow)}
      </div>
    </div>
  );
};

export default PayoutToday;