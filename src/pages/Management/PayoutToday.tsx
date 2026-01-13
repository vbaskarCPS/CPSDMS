// src/pages/Management/PayoutToday.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
  Trophy,
  Plus,
  X,
  Trash2,
  Star,
  Sparkles,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Worker, SortOption, ManagementUser, LogsheetSession, Bonus, BonusType, SessionTransaction } from '../../types';
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

// Stats for each manager group
interface ManagerGroupStats {
  totalSteps: number;
  totalUpsellGross: number;
  avgEQ: number;
  avgCommission: number;
}

// Bonus qualification result
interface BonusQualification {
  qualified: boolean;
  ratioPass: boolean;
  detailsPass: boolean;
  prebookCount: number;      // renamed from doneCount
  salesCount: number;        // renamed from upgradesSalesCount
  detailsCollected: number;
  detailsPossible: number;
}

/**
 * Checks if a worker qualifies for bonuses based on:
 * 1. Production Ratio: Upgrades + Sales >= Production (Prebooks)
 * 2. Client Details: 80% of phone+email collected for Upgrades and Sales
 */
function checkBonusQualification(transactions: SessionTransaction[]): BonusQualification {
  // Count transaction types
  const prebookCount = transactions.filter(tx => tx.type === 'Production').length;
  const salesCount = transactions.filter(tx => tx.type === 'Upgrade' || tx.type === 'Sale').length;
  
  // Criteria 1: Ratio (must have at least some upgrades/sales)
  const ratioPass = salesCount > 0 && salesCount >= prebookCount;
  
  // Criteria 2: Client details (80% threshold)
  const upgradesAndSales = transactions.filter(tx => tx.type === 'Upgrade' || tx.type === 'Sale');
  const detailsPossible = upgradesAndSales.length * 2; // phone + email each
  
  let detailsCollected = 0;
  upgradesAndSales.forEach(tx => {
    if (tx.customerPhone && tx.customerPhone.trim() !== '') detailsCollected++;
    if (tx.customerEmail && tx.customerEmail.trim() !== '') detailsCollected++;
  });
  
  const detailsPass = detailsPossible === 0 ? false : (detailsCollected >= detailsPossible * 0.8);
  
  return {
    qualified: ratioPass && detailsPass,
    ratioPass,
    detailsPass,
    prebookCount,
    salesCount,
    detailsCollected,
    detailsPossible
  };
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

  // Bonus Modal State
  const [showBonusModal, setShowBonusModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<LogsheetSession | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState<string>('');
  
  // Bonus form state
  const [bonusStep, setBonusStep] = useState<'type' | 'details'>('type');
  const [selectedBonusType, setSelectedBonusType] = useState<BonusType | null>(null);
  const [bonusPlacing, setBonusPlacing] = useState<number | 'other' | ''>('');
  const [bonusCustomDesc, setBonusCustomDesc] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');

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
        case 'alpha': {
          // Sort by last name, then first name as tiebreaker
          const lastNameCompare = a.worker.lastName.localeCompare(b.worker.lastName);
          if (lastNameCompare !== 0) return lastNameCompare;
          return a.worker.firstName.localeCompare(b.worker.firstName);
        }
        case 'steps':
          return (b.session.stats.stepCount || 0) - (a.session.stats.stepCount || 0);
        case 'equiv':
          return (b.session.stats.totalEQ || 0) - (a.session.stats.totalEQ || 0);
        case 'upsell':
          return (b.session.stats.upsellCount || 0) - (a.session.stats.upsellCount || 0);
        case 'upGross':
          // Sort by upsell gross only (renamed from 'gross')
          return (b.session.stats.upsellGross || 0) - (a.session.stats.upsellGross || 0);
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
    
    const groups: Record<string, { 
      manager: ManagementUser | null; 
      items: typeof sortedItems;
      stats: ManagerGroupStats;
    }> = {};
    
    sortedItems.forEach(item => {
      const managerId = item.worker.assignedManagerId || 'unassigned';
      if (!groups[managerId]) {
        const manager = managers.find(m => m.userId === managerId) || null;
        groups[managerId] = { 
          manager, 
          items: [],
          stats: { totalSteps: 0, totalUpsellGross: 0, avgEQ: 0, avgCommission: 0 }
        };
      }
      groups[managerId].items.push(item);
    });

    // Calculate stats for each group
    Object.values(groups).forEach(group => {
      let totalEQ = 0;
      let totalCommission = 0;
      
      group.items.forEach(({ session }) => {
        const v = session.validation;
        const isValidated = v?.isValidated || false;
        
        // Total Steps
        group.stats.totalSteps += session.stats.stepCount || 0;
        
        // Total Upsell Gross
        group.stats.totalUpsellGross += session.stats.upsellGross || 0;
        
        // EQ (uses actual when validated)
        const eq = isValidated ? (v?.actualTotalEQ || 0) : (session.stats.totalEQ || 0);
        totalEQ += eq;
        
        // Commission
        totalCommission += v?.finalCommission || 0;
      });
      
      // Calculate averages
      const workerCount = group.items.length;
      group.stats.avgEQ = workerCount > 0 ? totalEQ / workerCount : 0;
      group.stats.avgCommission = workerCount > 0 ? totalCommission / workerCount : 0;
    });

    // Sort groups by manager name
    return Object.entries(groups).sort(([, a], [, b]) => {
      const aName = a.manager?.name || 'ZZZ';
      const bName = b.manager?.name || 'ZZZ';
      return aName.localeCompare(bName);
    });
  }, [sortedItems, sortOption, managers]);

  // --- BONUS HANDLERS ---
  const handleOpenBonusModal = (session: LogsheetSession, workerName: string) => {
    setSelectedSession(session);
    setSelectedWorkerName(workerName);
    // Reset form state
    setBonusStep('type');
    setSelectedBonusType(null);
    setBonusPlacing('');
    setBonusCustomDesc('');
    setBonusAmount('');
    setShowBonusModal(true);
  };

  const handleCloseBonusModal = () => {
    setShowBonusModal(false);
    setSelectedSession(null);
  };

  const handleSelectBonusType = (type: BonusType) => {
    setSelectedBonusType(type);
    setBonusPlacing('');
    setBonusCustomDesc('');
    setBonusAmount('');
    setBonusStep('details');
  };

  const handleBackToTypeSelection = () => {
    setBonusStep('type');
    setSelectedBonusType(null);
  };

  const handleAddBonus = async () => {
    if (!selectedSession || !selectedBonusType || !bonusAmount) return;

    const amt = parseFloat(bonusAmount);
    if (isNaN(amt) || amt <= 0) return;

    // Validate based on type
    if (selectedBonusType !== 'Other' && !bonusPlacing) return;
    if (selectedBonusType === 'Other' && !bonusCustomDesc.trim()) return;
    if (bonusPlacing === 'other' && !bonusCustomDesc.trim()) return;

    const newBonus: Bonus = {
      id: Date.now(),
      type: selectedBonusType,
      amount: amt,
      placing: selectedBonusType !== 'Other' ? bonusPlacing as number | 'other' : undefined,
      customDescription: selectedBonusType === 'Other' || bonusPlacing === 'other' ? bonusCustomDesc : undefined
    };

    const updatedBonuses = [...(selectedSession.bonuses || []), newBonus];

    const currentPay = selectedSession.validation?.finalCommission || 0;
    const newPay = currentPay + amt;

    const updatedValidation = selectedSession.validation
      ? {
          ...selectedSession.validation,
          finalCommission: newPay,
        }
      : undefined;

    await sessionService.updateLogsheetSession(selectedSession.id, {
      bonuses: updatedBonuses,
      validation: updatedValidation,
    });

    // Close modal and refresh data
    handleCloseBonusModal();
    loadData();
  };

  const handleRemoveBonus = async (bonusId: number) => {
    if (!selectedSession) return;

    const bonusToRemove = selectedSession.bonuses?.find(b => b.id === bonusId);
    if (!bonusToRemove) return;

    const updatedBonuses = (selectedSession.bonuses || []).filter(b => b.id !== bonusId);

    const currentPay = selectedSession.validation?.finalCommission || 0;
    const newPay = currentPay - bonusToRemove.amount;

    const updatedValidation = selectedSession.validation
      ? {
          ...selectedSession.validation,
          finalCommission: newPay,
        }
      : undefined;

    await sessionService.updateLogsheetSession(selectedSession.id, {
      bonuses: updatedBonuses,
      validation: updatedValidation,
    });

    // Close modal and refresh data
    handleCloseBonusModal();
    loadData();
  };

  // Format bonus display text
  const formatBonusDisplay = (bonus: Bonus): string => {
    if (bonus.type === 'Other') {
      return bonus.customDescription || 'Other';
    }
    
    if (bonus.placing === 'other') {
      return `${bonus.type} - ${bonus.customDescription}`;
    }
    
    const placeSuffix = (n: number) => {
      if (n === 1) return '1st';
      if (n === 2) return '2nd';
      if (n === 3) return '3rd';
      return `${n}th`;
    };
    
    return `${bonus.type} - ${placeSuffix(bonus.placing as number)} Place`;
  };

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
    const bonusTotal = (session.bonuses || []).reduce((sum, b) => sum + b.amount, 0);
    
    // Check bonus qualification using transactions
    const qualification = checkBonusQualification(session.financialStore || []);

    return (
      <div
        key={session.id}
        className="bg-gray-800 border border-gray-700 py-1.5 px-2 rounded flex items-center gap-2 hover:bg-gray-750 hover:border-gray-600 transition-colors group text-xs"
      >
        {/* Status Indicator */}
        <div
          className={`w-0.5 h-5 rounded-full flex-shrink-0 ${
            isValidated ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />

        {/* Name - Clickable */}
        <div 
          onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
          className="font-bold text-gray-200 min-w-[120px] truncate cursor-pointer hover:text-white"
        >
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
            <span className="font-bold text-white">${session.stats.upsellGross.toFixed(2)}</span>
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

        {/* Bonus Button Area - Always takes same space for alignment */}
        <div className="ml-2 min-w-[70px] flex justify-center">
          {isValidated ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenBonusModal(session, `${worker.firstName} ${worker.lastName}`);
              }}
              className={`px-2 py-1 rounded text-[9px] font-bold flex items-center gap-1 transition-colors ${
                bonusTotal > 0 
                  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-700 hover:bg-yellow-900/50' 
                  : qualification.qualified
                    ? 'bg-blue-900/30 text-blue-400 border border-blue-800 hover:bg-blue-900/50'
                    : 'bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50'
              }`}
            >
              {bonusTotal > 0 ? (
                <>
                  <Trophy size={10} /> +${bonusTotal.toFixed(0)}
                </>
              ) : (
                <>
                  <Plus size={10} /> Bonus
                </>
              )}
            </button>
          ) : (
            /* Empty placeholder for non-validated to maintain alignment */
            <div className="w-[60px]" />
          )}
        </div>

        {/* Arrow */}
        <ChevronRight
          size={14}
          onClick={() => navigate(`/admin/payout/${worker.contractorId}?date=${date}`)}
          className="text-gray-600 group-hover:text-white transition-colors flex-shrink-0 cursor-pointer"
        />
      </div>
    );
  };

  // Get qualification for selected session (for modal display)
  const selectedQualification = selectedSession 
    ? checkBonusQualification(selectedSession.financialStore || [])
    : null;

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
            <div className="text-lg font-bold text-green-400">${aggregatedStats.prodGross.toFixed(2)}</div>
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
            <div className="text-lg font-bold text-purple-300">${aggregatedStats.upsellGross.toFixed(2)}</div>
          </div>
        </div>

        {/* Line 2: Payment Method Breakdown */}
        <div className="grid grid-cols-6 gap-px bg-gray-700">
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Banknote size={9} />
              <span className="text-[8px] uppercase font-bold">Cash</span>
            </div>
            <div className="text-sm font-bold text-green-300 font-mono">${aggregatedStats.totalCash.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Receipt size={9} />
              <span className="text-[8px] uppercase font-bold">Cheque</span>
            </div>
            <div className="text-sm font-bold text-blue-300 font-mono">${aggregatedStats.totalCheque.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">E-Trans</span>
            </div>
            <div className="text-sm font-bold text-cyan-300 font-mono">${aggregatedStats.totalETransfer.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <CreditCard size={9} />
              <span className="text-[8px] uppercase font-bold">CC</span>
            </div>
            <div className="text-sm font-bold text-orange-300 font-mono">${aggregatedStats.totalCreditCard.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <Wallet size={9} />
              <span className="text-[8px] uppercase font-bold">Prepaid</span>
            </div>
            <div className="text-sm font-bold text-indigo-300 font-mono">${aggregatedStats.totalPrepaid.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800/80 p-1.5 text-center">
            <div className="flex items-center justify-center gap-1 text-gray-500 mb-0.5">
              <span className="text-[8px] uppercase font-bold">Billed</span>
            </div>
            <div className="text-sm font-bold text-gray-400 font-mono">${aggregatedStats.totalBilled.toFixed(2)}</div>
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
            {/* Manager Header Card - Same size as worker rows */}
            <div className="sticky top-0 z-10 bg-gray-700 border border-gray-600 py-1.5 px-2 rounded flex items-center gap-2 text-xs mb-1">
              {/* Manager Icon Indicator */}
              <div className="w-0.5 h-5 rounded-full flex-shrink-0 bg-blue-500" />

              {/* Manager Name */}
              <div className="font-bold text-white min-w-[120px] truncate uppercase tracking-wide">
                {group.manager?.name || 'Unassigned'}
              </div>

              {/* Worker Count Badge */}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 min-w-[55px] justify-center bg-blue-900/30 text-blue-400 border border-blue-800">
                <Users size={8} />
                {group.items.length}
              </span>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Stats - Matching worker row layout */}
              <div className="flex items-center gap-3 text-gray-400">
                <div className="text-center min-w-[40px]">
                  <span className="text-[9px] text-gray-500 uppercase block leading-none">Steps</span>
                  <span className="font-bold text-white">{group.stats.totalSteps}</span>
                </div>
                <div className="text-center min-w-[50px]">
                  <span className="text-[9px] text-gray-500 uppercase block leading-none">Upsell</span>
                  <span className="font-bold text-purple-300">${group.stats.totalUpsellGross.toFixed(2)}</span>
                </div>
                <div className="text-center min-w-[40px]">
                  <span className="text-[9px] text-gray-500 uppercase block leading-none">Avg EQ</span>
                  <span className={`font-mono font-bold ${
                    group.stats.avgEQ >= 3 ? 'text-green-400' : 
                    group.stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {group.stats.avgEQ.toFixed(2)}
                  </span>
                </div>
                <div className="text-center min-w-[55px]">
                  <span className="text-[9px] text-gray-500 uppercase block leading-none">Avg Comm</span>
                  <span className="font-mono font-bold text-green-400">
                    ${group.stats.avgCommission.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Spacer to match bonus button area */}
              <div className="ml-2 min-w-[70px]" />

              {/* Chevron placeholder to align with worker rows */}
              <div className="w-[14px]" />
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

      {/* --- BONUS MODAL --- */}
      {showBonusModal && selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg border border-gray-700 max-h-[90vh] flex flex-col">
            
            {/* Header */}
            <div className="p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Trophy size={20} className="text-yellow-400" /> Manage Bonuses
                </h3>
                <p className="text-sm text-gray-400">{selectedWorkerName}</p>
              </div>
              <button onClick={handleCloseBonusModal} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            {/* Qualification Status */}
            {selectedQualification && (
              <div className={`mx-4 mt-4 p-3 rounded-lg border ${
                selectedQualification.qualified 
                  ? 'bg-green-900/20 border-green-700/50' 
                  : 'bg-red-900/20 border-red-700/50'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {selectedQualification.qualified ? (
                    <Check size={16} className="text-green-400" />
                  ) : (
                    <AlertTriangle size={16} className="text-red-400" />
                  )}
                  <span className={`text-sm font-bold ${
                    selectedQualification.qualified ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {selectedQualification.qualified ? 'Qualified for Bonus' : 'Not Qualified for Bonus'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className={`flex items-center gap-1 ${selectedQualification.ratioPass ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedQualification.ratioPass ? <Check size={12} /> : <X size={12} />}
                    <span>Ratio: {selectedQualification.salesCount} Sales vs {selectedQualification.prebookCount} Prebooks</span>
                  </div>
                  <div className={`flex items-center gap-1 ${selectedQualification.detailsPass ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedQualification.detailsPass ? <Check size={12} /> : <X size={12} />}
                    <span>Details: {selectedQualification.detailsCollected}/{selectedQualification.detailsPossible} (80% req)</span>
                  </div>
                </div>
              </div>
            )}

            {/* Existing Bonuses List */}
            {selectedSession.bonuses && selectedSession.bonuses.length > 0 && (
              <div className="mx-4 mt-4">
                <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Assigned Bonuses</h4>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {selectedSession.bonuses.map((bonus) => (
                    <div key={bonus.id} className="flex items-center justify-between bg-gray-900/50 p-2 rounded border border-gray-700">
                      <div className="flex items-center gap-2">
                        <Trophy size={14} className="text-yellow-400" />
                        <span className="text-sm text-white">{formatBonusDisplay(bonus)}</span>
                        <span className="text-sm font-bold text-green-400">${bonus.amount.toFixed(2)}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveBonus(bonus.id)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto p-4">
              
              {/* Step 1: Type Selection */}
              {bonusStep === 'type' && (
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">Select Bonus Type</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Performance EQ */}
                    <button
                      onClick={() => handleSelectBonusType('Performance EQ')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-blue-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-blue-900/30 text-blue-400 group-hover:bg-blue-900/50">
                          <TrendingUp size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Performance EQ</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Best EQ performers</p>
                    </button>

                    {/* Total Upsell */}
                    <button
                      onClick={() => handleSelectBonusType('Total Upsell')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-purple-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-purple-900/30 text-purple-400 group-hover:bg-purple-900/50">
                          <DollarSign size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Total Upsell</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Highest upsell gross</p>
                    </button>

                    {/* Rookie */}
                    <button
                      onClick={() => handleSelectBonusType('Rookie')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-yellow-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-yellow-900/30 text-yellow-400 group-hover:bg-yellow-900/50">
                          <Star size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Rookie</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Best new worker</p>
                    </button>

                    {/* Other */}
                    <button
                      onClick={() => handleSelectBonusType('Other')}
                      className="p-4 bg-gray-900 border border-gray-600 rounded-lg hover:border-gray-500 hover:bg-gray-800 transition-all text-left group"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-full bg-gray-700 text-gray-400 group-hover:bg-gray-600">
                          <Sparkles size={20} />
                        </div>
                      </div>
                      <h5 className="font-bold text-white text-sm">Other</h5>
                      <p className="text-[10px] text-gray-500 mt-1">Custom bonus type</p>
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Details */}
              {bonusStep === 'details' && selectedBonusType && (
                <div className="space-y-4">
                  <button 
                    onClick={handleBackToTypeSelection}
                    className="text-sm text-gray-400 hover:text-white flex items-center gap-1"
                  >
                    ← Back to type selection
                  </button>

                  <div className="flex items-center gap-2 p-3 bg-gray-900 rounded-lg border border-gray-700">
                    {selectedBonusType === 'Performance EQ' && <TrendingUp size={20} className="text-blue-400" />}
                    {selectedBonusType === 'Total Upsell' && <DollarSign size={20} className="text-purple-400" />}
                    {selectedBonusType === 'Rookie' && <Star size={20} className="text-yellow-400" />}
                    {selectedBonusType === 'Other' && <Sparkles size={20} className="text-gray-400" />}
                    <span className="font-bold text-white">{selectedBonusType}</span>
                  </div>

                  {/* Placing Selection (for Performance EQ, Total Upsell, Rookie) */}
                  {selectedBonusType !== 'Other' && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-2">Placing</label>
                      <select
                        value={bonusPlacing}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBonusPlacing(val === 'other' ? 'other' : val === '' ? '' : parseInt(val));
                        }}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">Select placing...</option>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                          <option key={n} value={n}>{n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`} Place</option>
                        ))}
                        <option value="other">Other</option>
                      </select>
                    </div>
                  )}

                  {/* Custom Description (for Other type or "other" placing) */}
                  {(selectedBonusType === 'Other' || bonusPlacing === 'other') && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-2">
                        {selectedBonusType === 'Other' ? 'Bonus Description' : 'Custom Placing Description'}
                      </label>
                      <input
                        type="text"
                        value={bonusCustomDesc}
                        onChange={(e) => setBonusCustomDesc(e.target.value)}
                        placeholder={selectedBonusType === 'Other' ? 'e.g., Team spirit award' : 'e.g., 11th place'}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  )}

                  {/* Amount */}
                  <div>
                    <label className="text-xs text-gray-400 block mb-2">Amount ($)</label>
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
                </div>
              )}
            </div>

            {/* Footer */}
            {bonusStep === 'details' && (
              <div className="p-4 border-t border-gray-700 flex-shrink-0">
                <button
                  onClick={handleAddBonus}
                  disabled={
                    !bonusAmount || 
                    parseFloat(bonusAmount) <= 0 ||
                    (selectedBonusType !== 'Other' && !bonusPlacing) ||
                    (selectedBonusType === 'Other' && !bonusCustomDesc.trim()) ||
                    (bonusPlacing === 'other' && !bonusCustomDesc.trim())
                  }
                  className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-bold shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={18} /> Add Bonus
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

export default PayoutToday;