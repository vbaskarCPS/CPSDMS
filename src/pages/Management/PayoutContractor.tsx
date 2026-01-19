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
  Copy,
  Wallet,
  CreditCard,
  Receipt,
  Banknote,
  Trophy,
  Trash2,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { getPayoutRate, seasonHasTeams, EQ_DIVISOR, createEqualSplit } from '../../lib/commandCenterService';
import { 
  LogsheetSession, 
  Worker, 
  SeasonType, 
  TeamSplitConfig,
  SERVICE_FLAG_KEYS,
  SERVICE_FLAG_LABELS,
} from '../../types';
import EditTransactionModal from '../../components/EditTransactionModal';

// Map the full service names to short badge text
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

// Service badge colors (for Lawn Rejuv)
const SERVICE_BADGE_COLORS: Record<string, string> = {
  aeration: 'bg-blue-900/30 text-blue-400 border-blue-700',
  dethatch: 'bg-orange-900/30 text-orange-400 border-orange-700',
  fertilizer: 'bg-green-900/30 text-green-400 border-green-700',
  seed: 'bg-yellow-900/30 text-yellow-400 border-yellow-700',
  lime: 'bg-purple-900/30 text-purple-400 border-purple-700',
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

// --- TEAM MEMBER CARD COMPONENT ---
const TeamMemberCard: React.FC<{ 
  worker: Worker; 
  isCurrentWorker: boolean;
  onCopyPhone: (phone: string) => void;
}> = ({ worker, isCurrentWorker, onCopyPhone }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (worker.cellPhone) {
      onCopyPhone(worker.cellPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={`flex items-center justify-between p-2 rounded ${
      isCurrentWorker ? 'bg-blue-900/30 border border-blue-700' : 'bg-gray-700/50'
    }`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isCurrentWorker ? 'bg-blue-400' : 'bg-gray-500'}`} />
        <span className="text-sm text-white">
          {worker.firstName} {worker.lastName}
        </span>
        <span className="text-xs text-gray-500 font-mono">({worker.contractorId})</span>
      </div>
      {worker.cellPhone && (
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <Phone size={12} />
          {worker.cellPhone}
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={10} />}
        </button>
      )}
    </div>
  );
};

// --- SPLIT EDITOR COMPONENT ---
const SplitEditor: React.FC<{
  title: string;
  icon: React.ReactNode;
  split: TeamSplitConfig;
  workers: Worker[];
  onChange: (newSplit: TeamSplitConfig) => void;
  disabled?: boolean;
}> = ({ title, icon, split, workers, onChange, disabled }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const total = Object.values(split).reduce((sum, v) => sum + v, 0);
  const isValid = Math.abs(total - 100) < 0.01;

  const handleChange = (workerId: string, value: number) => {
    const newSplit = { ...split, [workerId]: Math.max(0, Math.min(100, value)) };
    onChange(newSplit);
  };

  const handleEqualize = () => {
    const count = workers.length;
    const equalShare = Math.floor(100 / count);
    const remainder = 100 - (equalShare * count);
    
    const newSplit: TeamSplitConfig = {};
    workers.forEach((w, i) => {
      newSplit[w.contractorId] = equalShare + (i === 0 ? remainder : 0);
    });
    onChange(newSplit);
  };

  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold text-gray-300">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${isValid ? 'text-green-400' : 'text-red-400'}`}>
            {total.toFixed(0)}%
          </span>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 border-t border-gray-700 space-y-3">
          {workers.map((worker) => (
            <div key={worker.contractorId} className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-300 flex-1">
                {worker.firstName} {worker.lastName.charAt(0)}.
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={split[worker.contractorId] || 0}
                  onChange={(e) => handleChange(worker.contractorId, parseFloat(e.target.value) || 0)}
                  className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-right text-sm"
                  min="0"
                  max="100"
                  step="1"
                  disabled={disabled}
                />
                <span className="text-gray-500 text-sm">%</span>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2 border-t border-gray-700">
            <button
              onClick={handleEqualize}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              disabled={disabled}
            >
              Split Equally
            </button>
            {!isValid && (
              <span className="text-xs text-red-400">
                Must equal 100% (currently {total.toFixed(0)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// --- WORKER PAYOUT BREAKDOWN ROW ---
const WorkerPayoutRow: React.FC<{
  worker: Worker;
  assignedEQ: number;
  baseRate: number;
  productionPay: number;
  upsellCommission: number;
  iosCommission: number;
  bonusAmount: number;
  deductions: number;
  machineDeduction: number;
  finalPay: number;
  isCurrentWorker: boolean;
}> = ({ worker, assignedEQ, baseRate, productionPay, upsellCommission, iosCommission, bonusAmount, deductions, machineDeduction, finalPay, isCurrentWorker }) => {
  const totalRate = baseRate + (worker.alumniRate || 0) + (worker.silverRate || 0);
  
  return (
    <div className={`p-3 rounded-lg border ${
      isCurrentWorker ? 'bg-blue-900/20 border-blue-700' : 'bg-gray-800/50 border-gray-700'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white">{worker.firstName} {worker.lastName}</span>
          {isCurrentWorker && (
            <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded border border-blue-700">
              CURRENT
            </span>
          )}
        </div>
        <span className="text-lg font-bold text-green-400 font-mono">${finalPay.toFixed(2)}</span>
      </div>
      
      <div className="grid grid-cols-5 gap-2 text-xs">
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-500 mb-1">Assigned EQ</div>
          <div className="text-white font-mono">{assignedEQ.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-500 mb-1">Rate</div>
          <div className="text-white font-mono">${totalRate.toFixed(2)}</div>
          <div className="text-[10px] text-gray-600">
            ${baseRate} + ${(worker.alumniRate || 0).toFixed(2)} + ${(worker.silverRate || 0).toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-500 mb-1">Production</div>
          <div className="text-white font-mono">${productionPay.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-500 mb-1">Upsell + IOS</div>
          <div className="text-white font-mono">${(upsellCommission + iosCommission).toFixed(2)}</div>
        </div>
        <div className="bg-gray-900/50 rounded p-2">
          <div className="text-gray-500 mb-1">Deductions</div>
          <div className="text-red-400 font-mono">-${(deductions + machineDeduction).toFixed(2)}</div>
          {machineDeduction > 0 && (
            <div className="text-[10px] text-gray-600">
              (Machine: $10)
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PayoutContractor: React.FC = () => {
  const { contractorId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<LogsheetSession | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Season & Team State
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  const [teamWorkers, setTeamWorkers] = useState<Worker[]>([]);
  const [isTeamSession, setIsTeamSession] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);

  // Split State
  const [equivSplit, setEquivSplit] = useState<TeamSplitConfig>({});
  const [upsellSplit, setUpsellSplit] = useState<TeamSplitConfig>({});
  const [splitsModified, setSplitsModified] = useState(false);

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
        // Get season type
        const season = await sessionService.getSessionSeasonType();
        setSeasonType(season);
        const isTeamSeasonType = seasonHasTeams(season);

        const daily = await sessionService.getDailySession();
        
        // Find the worker that was clicked
        const foundWorker = daily?.workers.find(
          (w) => w.contractorId === contractorId
        );
        
        // Get the session - this handles team lookups automatically
        const foundSession = await sessionService.getActiveLogsheetSession(contractorId);

        if (foundWorker) setWorker(foundWorker);
        
        if (foundSession) {
          setSession(foundSession);
          
          // Check if team session (has multiple workers)
          const teamIds = foundSession.teamWorkerIds || [];
          const isTeam = isTeamSeasonType && teamIds.length > 1;
          setIsTeamSession(isTeam);
          
          if (isTeam && daily) {
            // Get all team workers
            const teamMembers = daily.workers.filter(w => teamIds.includes(w.contractorId));
            setTeamWorkers(teamMembers);
            
            // Initialize splits - use existing or create equal split
            const existingEquivSplit = foundSession.equivSplit || {};
            const existingUpsellSplit = foundSession.upsellSplit || {};
            
            // Check if splits are valid (have all team members)
            const hasValidEquivSplit = teamIds.every(id => existingEquivSplit[id] !== undefined);
            const hasValidUpsellSplit = teamIds.every(id => existingUpsellSplit[id] !== undefined);
            
            if (hasValidEquivSplit) {
              setEquivSplit(existingEquivSplit);
            } else {
              setEquivSplit(createEqualSplit(teamIds));
            }
            
            if (hasValidUpsellSplit) {
              setUpsellSplit(existingUpsellSplit);
            } else {
              setUpsellSplit(createEqualSplit(teamIds));
            }
          } else if (isTeamSeasonType && foundSession.workerId && daily) {
            // Solo "team" in lawn rejuv - just one worker
            const soloWorker = daily.workers.find(w => w.contractorId === foundSession.workerId);
            if (soloWorker) {
              setTeamWorkers([soloWorker]);
              setEquivSplit({ [soloWorker.contractorId]: 100 });
              setUpsellSplit({ [soloWorker.contractorId]: 100 });
            }
          }
          
          // Restore validation inputs if already validated
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
  const handleCopyPhone = (phone?: string) => {
    const phoneNum = phone || worker?.cellPhone;
    if (!phoneNum) return;
    navigator.clipboard.writeText(phoneNum);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 1500);
  };

  // --- HELPER: REFRESH DATA ---
  const handleRefreshData = () => {
    setRefreshKey(prev => prev + 1);
  };

  // --- HELPER: SAVE SPLITS ---
  const handleSaveSplits = async () => {
    if (!session) return;
    try {
      await sessionService.updateTeamSplits(session.id, equivSplit, upsellSplit);
      setSplitsModified(false);
      handleRefreshData();
    } catch (err) {
      alert('Error saving splits: ' + err);
    }
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
    prodGross: 0, upsellPayable: 0, iosCount: 0, stepCount: 0,
    prodETransfer: 0, upsellETransfer: 0,
    prodCreditCard: 0, upsellCreditCard: 0,
    prodFlats: 0, prodPrepaid: 0, prodPrepaidSplit: 0, upsellPrepaid: 0,
    prodBilled: 0, totalEQ: 0, upsellGross: 0,
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

  // Combined totals for display-only payment methods
  const totalETransfer = (stats.prodETransfer || 0) + (stats.upsellETransfer || 0);
  const totalCreditCard = (stats.prodCreditCard || 0) + (stats.upsellCreditCard || 0);
  const totalPrepaid = (stats.prodFlats || 0) + (stats.prodPrepaid || 0) + (stats.prodPrepaidSplit || 0) + (stats.upsellPrepaid || 0);
  const totalBilled = stats.prodBilled || 0;

  // 2. EQ Calculations
  const taxDivisor = 1.05;

  // System/Projected EQ (based on Stats)
  const projectedProdPayable = stats.prodGross / taxDivisor;
  const projectedEQ = projectedProdPayable / EQ_DIVISOR;

  // Actual EQ (based on Inputs)
  const systemProdNonCash = stats.prodGross - stats.prodCash - stats.prodCheque;
  const actualProdGross = systemProdNonCash + actualProdCash + actualProdCheque;
  const actualProdPayable = actualProdGross / taxDivisor;
  const actualTotalEQ = actualProdPayable / EQ_DIVISOR;

  // 3. Season-aware Payout Rate ($/EQ for commission calculation)
  const teamSize = isTeamSession ? teamWorkers.length : 1;
  const baseRate = getPayoutRate(seasonType, teamSize);
  
  const alumniRate = worker?.alumniRate || 0;
  const silverRate = worker?.silverRate || 0;
  const totalRate = baseRate + alumniRate + silverRate;

  // 4. Calculate per-worker payouts
  const calculateWorkerPayouts = () => {
    // For team sessions in lawn_rejuv
    if (isTeamSession && teamWorkers.length > 0) {
      const payouts = teamWorkers.map(w => {
        const eqPercent = (equivSplit[w.contractorId] || 0) / 100;
        const upPercent = (upsellSplit[w.contractorId] || 0) / 100;
        
        const assignedEQ = actualTotalEQ * eqPercent;
        const workerAlumni = w.alumniRate || 0;
        const workerSilver = w.silverRate || 0;
        const workerTotalRate = baseRate + workerAlumni + workerSilver;
        
        const productionPay = assignedEQ * workerTotalRate;
        const upsellCommission = (stats.upsellPayable || 0) * upPercent * 0.15;
        const iosCommission = (stats.iosCount || 0) * 5.0 * upPercent;
        
        // Bonuses with split
        let bonusAmount = 0;
        (session?.bonuses || []).forEach(bonus => {
          const bonusSplit = bonus.splitPercentages?.[w.contractorId] || (eqPercent * 100);
          bonusAmount += bonus.amount * (bonusSplit / 100);
        });
        
        // Machine rental is $10 PER WORKER (not split)
        const workerMachineDeduction = machineRental ? 10.0 : 0;
        
        // Other deductions split evenly among team
        const workerDeductions = totalDeductions / teamWorkers.length;
        
        const finalPay = productionPay + upsellCommission + iosCommission + bonusAmount - workerDeductions - workerMachineDeduction;
        
        return {
          worker: w,
          assignedEQ,
          baseRate,
          productionPay,
          upsellCommission,
          iosCommission,
          bonusAmount,
          deductions: workerDeductions,
          machineDeduction: workerMachineDeduction,
          finalPay,
        };
      });
      
      return payouts;
    }

    // Single worker - standard calculation (aeration or solo lawn_rejuv)
    if (!worker) return [];
    
    const productionPay = actualTotalEQ * totalRate;
    const upsellCommission = (stats.upsellPayable || 0) * 0.15;
    const iosCommission = (stats.iosCount || 0) * 5.0;
    const bonusTotal = (session?.bonuses || []).reduce((sum, b) => sum + b.amount, 0);
    const machineDeduction = machineRental ? 10.0 : 0;
    const grossPay = productionPay + upsellCommission + iosCommission + bonusTotal;
    const finalPay = grossPay - totalDeductions - machineDeduction;
    
    return [{
      worker: worker,
      assignedEQ: actualTotalEQ,
      baseRate,
      productionPay,
      upsellCommission,
      iosCommission,
      bonusAmount: bonusTotal,
      deductions: totalDeductions,
      machineDeduction,
      finalPay,
    }];
  };

  const workerPayouts = calculateWorkerPayouts();
  const currentWorkerPayout = workerPayouts.find(p => p.worker.contractorId === contractorId);
  
  // For header display - solo worker values
  const productionPay = currentWorkerPayout?.productionPay || 0;
  const upsellCommission = currentWorkerPayout?.upsellCommission || 0;
  const iosCommission = currentWorkerPayout?.iosCommission || 0;
  const bonusTotal = (session?.bonuses || []).reduce((sum, b) => sum + b.amount, 0);
  
  // Total team payout (sum of all individual payouts)
  const totalTeamPayout = workerPayouts.reduce((sum, p) => sum + p.finalPay, 0);
  
  // Final pay shown in header
  const finalPay = isTeamSession ? totalTeamPayout : (currentWorkerPayout?.finalPay || 0);

  // Machine rental display - for teams, show total machine cost
  const totalMachineDeduction = isTeamSession 
    ? (machineRental ? 10.0 * teamWorkers.length : 0)
    : (machineRental ? 10.0 : 0);

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

  const handleRemoveBonus = async (bonusId: number) => {
    if (!session) return;

    const bonusToRemove = session.bonuses?.find(b => b.id === bonusId);
    if (!bonusToRemove) return;

    if (!window.confirm(`Remove ${bonusToRemove.type} bonus of $${bonusToRemove.amount.toFixed(2)}?`)) {
      return;
    }

    const updatedBonuses = (session.bonuses || []).filter(b => b.id !== bonusId);

    const currentPay = session.validation?.finalCommission || 0;
    const newPay = currentPay - bonusToRemove.amount;

    const updatedValidation = session.validation
      ? {
          ...session.validation,
          finalCommission: newPay,
        }
      : undefined;

    try {
      await sessionService.updateLogsheetSession(session.id, {
        bonuses: updatedBonuses,
        validation: updatedValidation,
      });
      handleRefreshData();
    } catch (err) {
      alert('Error removing bonus: ' + err);
    }
  };

  const handleFinalize = async () => {
    if (!session) return;
    
    // Validate splits for team sessions
    if (isTeamSession) {
      const equivTotal = Object.values(equivSplit).reduce((sum, v) => sum + v, 0);
      const upsellTotal = Object.values(upsellSplit).reduce((sum, v) => sum + v, 0);
      
      if (Math.abs(equivTotal - 100) > 0.01 || Math.abs(upsellTotal - 100) > 0.01) {
        alert('Split percentages must total 100% before finalizing');
        return;
      }
      
      // Save splits if modified
      if (splitsModified) {
        await handleSaveSplits();
      }
    }
    
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
        status: 'PAID', // <-- LOCKOUT: This locks the worker(s) out of their logsheet
        equivSplit: isTeamSession ? equivSplit : undefined,
        upsellSplit: isTeamSession ? upsellSplit : undefined,
      });
      navigate('/admin/command-center?tab=payout');
    } catch (err) {
      alert('Error saving payout: ' + err);
      setLoading(false);
    }
  };

  // --- HELPER: Format bonus display ---
  const formatBonusDisplay = (bonus: any): string => {
    if (bonus.type === 'Other') {
      return bonus.customDescription || 'Other';
    }
    
    if (bonus.placing === 'other') {
      return `${bonus.type} - ${bonus.customDescription}`;
    }
    
    const placingStr = bonus.placing === 1 ? '1st' : bonus.placing === 2 ? '2nd' : bonus.placing === 3 ? '3rd' : `${bonus.placing}th`;
    return `${bonus.type} - ${placingStr} Place`;
  };

  // --- RENDER SERVICE BADGES (for Lawn Rejuv) ---
  const renderServiceBadges = (services: any) => {
    if (!services || seasonType !== 'lawn_rejuv') return null;
    
    return (
      <div className="flex gap-0.5">
        {SERVICE_FLAG_KEYS.map(key => {
          if (!services[key]) return null;
          const label = SERVICE_FLAG_LABELS[key];
          const color = SERVICE_BADGE_COLORS[key];
          return (
            <span
              key={key}
              className={`text-[8px] font-bold px-1 py-0.5 rounded border ${color}`}
              title={label.full}
            >
              {label.short}
            </span>
          );
        })}
      </div>
    );
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
            {/* Service badges for Lawn Rejuv */}
            {renderServiceBadges(tx.services)}
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
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
        <AlertCircle size={48} className="text-red-400 mb-4" />
        <h2 className="text-xl font-bold mb-2">Session not found</h2>
        <p className="text-gray-400 mb-4">Could not find a session for worker {contractorId}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          Go Back
        </button>
      </div>
    );

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
                
                {/* Team Indicator */}
                {isTeamSession && (
                  <button
                    onClick={() => setShowTeamModal(true)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-900/30 hover:bg-green-900/50 transition-colors text-sm border border-green-700"
                    title="View team members"
                  >
                    <Users size={14} className="text-green-400" />
                    <span className="text-green-400 font-bold">{teamWorkers.length}</span>
                  </button>
                )}
                
                {/* Click to Copy Phone */}
                {worker.cellPhone && (
                  <button
                    onClick={() => handleCopyPhone()}
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
                {/* Season Badge */}
                <span className={`px-2 py-0.5 rounded text-xs ${
                  seasonType === 'lawn_rejuv' 
                    ? 'bg-green-900/30 text-green-400 border border-green-700' 
                    : 'bg-blue-900/30 text-blue-400 border border-blue-700'
                }`}>
                  {seasonType === 'lawn_rejuv' ? 'Lawn Rejuv' : 'Aeration'}
                </span>
                <span>
                  Steps: <b className="text-white">{stats.stepCount}</b>
                </span>
                {/* Payout Rate Display */}
                <span className="text-xs">
                  Payout Rate: <b className="text-white">${baseRate.toFixed(2)}/EQ</b>
                  {isTeamSession && seasonType === 'lawn_rejuv' && (
                    <span className="text-green-400 ml-1">(Team of {teamWorkers.length})</span>
                  )}
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
              <div className="text-xs text-gray-500 uppercase font-bold text-green-400">
                {isTeamSession ? 'Team Payout' : 'Est. Payout'}
              </div>
              <div className="text-xl font-bold text-green-400 font-mono">
                ${finalPay.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="max-w-7xl mx-auto w-full space-y-6">

          {/* TEAM SPLIT SECTION (Lawn Rejuv Teams Only) */}
          {isTeamSession && seasonType === 'lawn_rejuv' && (
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users size={20} className="text-green-400" /> Team Split Configuration
                </h3>
                {splitsModified && (
                  <button
                    onClick={handleSaveSplits}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-bold flex items-center gap-2 transition-colors"
                  >
                    <Check size={14} /> Save Splits
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SplitEditor
                  title="Equiv Split"
                  icon={<Calculator size={16} className="text-blue-400" />}
                  split={equivSplit}
                  workers={teamWorkers}
                  onChange={(newSplit) => {
                    setEquivSplit(newSplit);
                    setSplitsModified(true);
                  }}
                />
                <SplitEditor
                  title="Upsell Split"
                  icon={<TrendingUp size={16} className="text-green-400" />}
                  split={upsellSplit}
                  workers={teamWorkers}
                  onChange={(newSplit) => {
                    setUpsellSplit(newSplit);
                    setSplitsModified(true);
                  }}
                />
              </div>

              {/* Per-Worker Breakdown */}
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-bold text-gray-400 uppercase">Per-Worker Breakdown</h4>
                {workerPayouts.map(payout => (
                  <WorkerPayoutRow
                    key={payout.worker.contractorId}
                    worker={payout.worker}
                    assignedEQ={payout.assignedEQ}
                    baseRate={payout.baseRate}
                    productionPay={payout.productionPay}
                    upsellCommission={payout.upsellCommission}
                    iosCommission={payout.iosCommission}
                    bonusAmount={payout.bonusAmount}
                    deductions={payout.deductions}
                    machineDeduction={payout.machineDeduction}
                    finalPay={payout.finalPay}
                    isCurrentWorker={payout.worker.contractorId === contractorId}
                  />
                ))}
              </div>
            </div>
          )}

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

          {/* 2. VISUAL BREAKDOWN (hide for team sessions - shown in split section) */}
          {!isTeamSession && (
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
                    <span className="font-mono text-gray-300">15%</span>
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
          )}

          {/* 3. RECONCILIATION (Full Width) */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Receipt size={20} className="text-green-400" /> Reconciliation
            </h3>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Cash Input */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Banknote size={18} className="text-green-400" />
                  <span className="text-sm font-bold text-gray-300">Cash Collected</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Expected: <span className="font-mono text-green-300">${systemTotalCash.toFixed(2)}</span>
                </div>
                <div className="flex gap-2 mb-2">
                  <input
                    type="number"
                    value={cashBills}
                    onChange={(e) => setCashBills(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder-gray-500 text-sm"
                    placeholder="Bills ($)"
                  />
                  <input
                    type="number"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded p-2 text-white placeholder-gray-500 text-sm"
                    placeholder="Change ($)"
                  />
                </div>
                {cashDiff !== 0 && (
                  <div className={`text-sm flex items-center gap-2 p-3 rounded-lg font-bold ${
                    cashDiff < 0 
                      ? 'text-red-300 bg-red-900/40 border border-red-700' 
                      : 'text-green-300 bg-green-900/40 border border-green-700'
                  }`}>
                    <AlertCircle size={18} />
                    <span>
                      {cashDiff < 0 ? 'SHORTAGE' : 'OVERAGE'}: {cashDiff > 0 ? '+' : ''}${cashDiff.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* Cheque Input */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Receipt size={18} className="text-blue-400" />
                  <span className="text-sm font-bold text-gray-300">Cheques Collected</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Expected: <span className="font-mono text-blue-300">${systemTotalCheque.toFixed(2)}</span>
                </div>
                <input
                  type="number"
                  value={chequeAmount}
                  onChange={(e) => setChequeAmount(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white mb-2 placeholder-gray-500 text-sm"
                  placeholder="0.00"
                />
                {chequeDiff !== 0 && (
                  <div className={`text-sm flex items-center gap-2 p-3 rounded-lg font-bold ${
                    chequeDiff < 0 
                      ? 'text-red-300 bg-red-900/40 border border-red-700' 
                      : 'text-green-300 bg-green-900/40 border border-green-700'
                  }`}>
                    <AlertCircle size={18} />
                    <span>
                      {chequeDiff < 0 ? 'SHORTAGE' : 'OVERAGE'}: {chequeDiff > 0 ? '+' : ''}${chequeDiff.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* E-Transfer (Display Only) */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={18} className="text-cyan-400" />
                  <span className="text-sm font-bold text-gray-300">E-Transfer</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">System Total</div>
                <div className="text-2xl font-bold font-mono text-cyan-400">
                  ${totalETransfer.toFixed(2)}
                </div>
              </div>

              {/* Credit Card (Display Only) */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard size={18} className="text-orange-400" />
                  <span className="text-sm font-bold text-gray-300">Credit Card</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">System Total</div>
                <div className="text-2xl font-bold font-mono text-orange-400">
                  ${totalCreditCard.toFixed(2)}
                </div>
              </div>

              {/* Prepaid (Display Only) */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={18} className="text-indigo-400" />
                  <span className="text-sm font-bold text-gray-300">Prepaid</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">System Total</div>
                <div className="text-2xl font-bold font-mono text-indigo-400">
                  ${totalPrepaid.toFixed(2)}
                </div>
              </div>

              {/* Billed (Display Only) */}
              <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <Receipt size={18} className="text-gray-400" />
                  <span className="text-sm font-bold text-gray-300">Billed</span>
                </div>
                <div className="text-xs text-gray-500 mb-2">System Total</div>
                <div className="text-2xl font-bold font-mono text-gray-400">
                  ${totalBilled.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* 4. DEDUCTIONS & FINAL PAYOUT (Full Width) */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5 mb-10">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Calculator size={20} className="text-blue-400" /> Deductions & Final Payout
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Deductions Column */}
              <div className="space-y-4">
                <div className="bg-gray-900/50 p-3 rounded border border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-300 text-sm">
                    <Truck size={16} />
                    <div>
                      <span>Machine Rental Fee</span>
                      {isTeamSession ? (
                        <span className="text-xs text-gray-500 block">
                          ($10.00 × {teamWorkers.length} workers = ${(10 * teamWorkers.length).toFixed(2)})
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 block">($10.00)</span>
                      )}
                    </div>
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
                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white placeholder-gray-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Bonuses Column */}
              <div>
                <label className="text-xs text-gray-400 uppercase font-bold mb-2 block flex items-center gap-2">
                  <Trophy size={14} className="text-yellow-400" /> Bonuses
                </label>
                {session.bonuses && session.bonuses.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {session.bonuses.map((bonus) => (
                      <div 
                        key={bonus.id} 
                        className="flex items-center justify-between bg-yellow-900/20 p-2 rounded border border-yellow-700/50"
                      >
                        <div className="flex items-center gap-2">
                          <Trophy size={14} className="text-yellow-400" />
                          <span className="text-sm text-white">{formatBonusDisplay(bonus)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-green-400">+${bonus.amount.toFixed(2)}</span>
                          <button
                            onClick={() => handleRemoveBonus(bonus.id)}
                            className="text-red-400 hover:text-red-300 p-1"
                            title="Remove bonus"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="text-right text-sm text-yellow-400 font-bold pt-1 border-t border-gray-700">
                      Total Bonuses: +${bonusTotal.toFixed(2)}
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-900/50 p-4 rounded border border-gray-700 text-center text-gray-500 text-sm">
                    No bonuses assigned
                  </div>
                )}
              </div>

              {/* Final Payout Column */}
              <div className="flex flex-col justify-between">
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700 mb-4">
                  <div className="text-xs text-gray-500 uppercase font-bold mb-2">
                    {isTeamSession ? 'Team Summary' : 'Breakdown'}
                  </div>
                  <div className="space-y-1 text-sm">
                    {isTeamSession ? (
                      // Team breakdown summary
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Total Team EQ</span>
                          <span className="font-mono text-white">{actualTotalEQ.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Team Members</span>
                          <span className="font-mono text-white">{teamWorkers.length}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-1">
                          <span className="text-gray-400">Combined Production</span>
                          <span className="font-mono text-white">
                            ${workerPayouts.reduce((sum, p) => sum + p.productionPay, 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Combined Upsell + IOS</span>
                          <span className="font-mono text-white">
                            ${workerPayouts.reduce((sum, p) => sum + p.upsellCommission + p.iosCommission, 0).toFixed(2)}
                          </span>
                        </div>
                        {totalMachineDeduction > 0 && (
                          <div className="flex justify-between text-red-400">
                            <span>Machine Rental ({teamWorkers.length} × $10)</span>
                            <span className="font-mono">-${totalMachineDeduction.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      // Individual breakdown
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Production</span>
                          <span className="font-mono text-white">${productionPay.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Upsell</span>
                          <span className="font-mono text-white">${upsellCommission.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">IOS/PB</span>
                          <span className="font-mono text-white">${iosCommission.toFixed(2)}</span>
                        </div>
                        {totalMachineDeduction > 0 && (
                          <div className="flex justify-between text-red-400">
                            <span>Machine Rental</span>
                            <span className="font-mono">-${totalMachineDeduction.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {bonusTotal > 0 && (
                      <div className="flex justify-between text-yellow-400">
                        <span>Bonuses</span>
                        <span className="font-mono">+${bonusTotal.toFixed(2)}</span>
                      </div>
                    )}
                    {totalDeductions > 0 && (
                      <div className="flex justify-between text-red-400">
                        <span>Other Deductions</span>
                        <span className="font-mono">-${totalDeductions.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-end mb-4">
                    <span className="text-lg font-bold text-white">
                      {isTeamSession ? 'Total Team Payout' : 'Final Payout'}
                    </span>
                    <span className="text-3xl font-bold text-green-400 font-mono tracking-tight">
                      ${finalPay.toFixed(2)}
                    </span>
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

      {/* Team Members Modal */}
      {showTeamModal && isTeamSession && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Users size={20} className="text-green-400" />
                Team Members ({teamWorkers.length})
              </h3>
              <button
                onClick={() => setShowTeamModal(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {teamWorkers.map(w => (
                <TeamMemberCard
                  key={w.contractorId}
                  worker={w}
                  isCurrentWorker={w.contractorId === contractorId}
                  onCopyPhone={handleCopyPhone}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayoutContractor;