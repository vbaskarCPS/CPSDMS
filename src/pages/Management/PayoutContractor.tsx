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
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { 
  commandCenterService,
  getPayoutRate, 
  seasonHasTeams, 
  EQ_DIVISOR, 
  createEqualSplit,
} from '../../lib/commandCenterService';
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
  'Window Washing': 'WW',
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

  // Split State (Lawn Rejuv)
  const [equivSplit, setEquivSplit] = useState<TeamSplitConfig>({});
  const [upsellSplit, setUpsellSplit] = useState<TeamSplitConfig>({});

  // Per-worker deductions (Lawn Rejuv)
  const [workerMachineRentals, setWorkerMachineRentals] = useState<Record<string, boolean>>({});
  const [workerDeductions, setWorkerDeductions] = useState<Record<string, number>>({});

  // Aeration-only state (single values)
  const [machineRental, setMachineRental] = useState(true);
  const [deductions, setDeductions] = useState('');

  // Product Cost & Tax Rate State
  const [productCostPercent, setProductCostPercent] = useState<number>(0);
  const [taxRate, setTaxRate] = useState<number>(5);

  // NEW: No Tax on Cash flag
  const [noTaxOnCash, setNoTaxOnCash] = useState(false);

  // Cash/Cheque form state
  const [cashBills, setCashBills] = useState('');
  const [cashChange, setCashChange] = useState('');
  const [chequeAmount, setChequeAmount] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Copy phone state
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Refresh key (triggers data reload)
  const [refreshKey, setRefreshKey] = useState(0);

  // Track if anything was modified
  const [isModified, setIsModified] = useState(false);

  // Parse Inputs
  const totalCashInput = (parseFloat(cashBills) || 0) + (parseFloat(cashChange) || 0);
  const totalChequeInput = parseFloat(chequeAmount) || 0;
  const totalDeductionsAeration = parseFloat(deductions) || 0;

  // Check if this is lawn rejuv season
  const isLawnRejuv = seasonType === 'lawn_rejuv';

  useEffect(() => {
    const init = async () => {
      if (!contractorId) return;
      setLoading(true);
      try {
        // Get season type
        const season = await sessionService.getSessionSeasonType();
        setSeasonType(season);
        const isTeamSeasonType = seasonHasTeams(season);

        // Get product cost percent and tax rate
        const prodCost = await sessionService.getProductCostPercent();
        setProductCostPercent(prodCost);
        
        const currentTaxRate = commandCenterService.getCurrentTaxRate();
        setTaxRate(currentTaxRate);

        // NEW: Get no-tax-on-cash flag
        const noTaxOnCashFlag = await sessionService.getSessionNoTaxOnCash();
        setNoTaxOnCash(noTaxOnCashFlag);

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
          const isTeam = isTeamSeasonType && teamIds.length > 0;
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

            // Initialize per-worker machine rentals and deductions
            const existingMachineRentals = foundSession.validation?.workerMachineRentals || {};
            const existingWorkerDeductions = foundSession.validation?.workerDeductions || {};
            
            const initialMachineRentals: Record<string, boolean> = {};
            const initialDeductions: Record<string, number> = {};
            
            teamIds.forEach(id => {
              // Default to true if not set, or use legacy machineRental flag
              initialMachineRentals[id] = existingMachineRentals[id] !== undefined 
                ? existingMachineRentals[id] 
                : (foundSession.validation?.machineRental ?? true);
              initialDeductions[id] = existingWorkerDeductions[id] || 0;
            });
            
            setWorkerMachineRentals(initialMachineRentals);
            setWorkerDeductions(initialDeductions);
            
          } else if (isTeamSeasonType && foundSession.workerId && daily) {
            // Solo "team" in lawn rejuv - just one worker
            const soloWorker = daily.workers.find(w => w.contractorId === foundSession.workerId);
            if (soloWorker) {
              setTeamWorkers([soloWorker]);
              setEquivSplit({ [soloWorker.contractorId]: 100 });
              setUpsellSplit({ [soloWorker.contractorId]: 100 });
              
              // Initialize per-worker values for solo
              const existingMachineRentals = foundSession.validation?.workerMachineRentals || {};
              const existingWorkerDeductions = foundSession.validation?.workerDeductions || {};
              
              setWorkerMachineRentals({
                [soloWorker.contractorId]: existingMachineRentals[soloWorker.contractorId] !== undefined
                  ? existingMachineRentals[soloWorker.contractorId]
                  : (foundSession.validation?.machineRental ?? true)
              });
              setWorkerDeductions({
                [soloWorker.contractorId]: existingWorkerDeductions[soloWorker.contractorId] || 0
              });
            }
          }
          
          // Restore validation inputs if already validated
          if (foundSession.validation) {
            setCashBills(foundSession.validation.verifiedCash.toString());
            setChequeAmount(foundSession.validation.verifiedCheque.toString());
            // For aeration, use legacy single value
            if (!isTeamSeasonType) {
              setMachineRental(foundSession.validation.machineRental);
            }
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

  // --- HELPER: BADGES ---
  const getBadgeInfo = (tx: any) => {
    const itemName = tx.items?.[0]?.name || '';
    const type = tx.type || '';

    if (BADGE_MAP[itemName]) {
      const label = BADGE_MAP[itemName];
      if (type === 'Upgrade') {
        return { label, className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
      }
      if (type === 'Add-On') {
        return { label, className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
      }
    }

    if (type === 'Upgrade') {
      return { label: 'UPGRADE', className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
    }
    if (type === 'Add-On') {
      return { label: 'ADD-ON', className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
    }
    if (type === 'Sale') {
      return { label: 'SALE', className: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
    }
    return { label: 'DONE', className: 'bg-green-900/30 text-green-400 border-green-800' };
  };

  // --- CALCULATIONS ---
  const stats = session?.stats || sessionService.getEmptyStats();

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
  const taxDivisor = 1 + (taxRate / 100);
  const productCostMultiplier = 1 - (productCostPercent / 100);

  const projectedEQ = stats.totalEQ;

  const prodCashDiff = actualProdCash - stats.prodCash;
  const prodChequeDiff = actualProdCheque - stats.prodCheque;
  
  // FIXED: When noTaxOnCash is on, cash portion of delta skips tax divisor
  const deltaEQ = noTaxOnCash
    ? (prodCashDiff + (prodChequeDiff / taxDivisor)) * productCostMultiplier / EQ_DIVISOR
    : ((prodCashDiff + prodChequeDiff) / taxDivisor) * productCostMultiplier / EQ_DIVISOR;
  
  const actualTotalEQ = stats.totalEQ + deltaEQ;

  // 3. Season-aware Payout Rate
  const teamSize = isLawnRejuv ? teamWorkers.length : 1;
  const baseRate = getPayoutRate(seasonType, teamSize);

  // 4. Calculate per-worker payouts (Lawn Rejuv)
  const calculateLawnRejuvPayouts = () => {
    if (!isLawnRejuv || teamWorkers.length === 0) return [];
    
    const payouts = teamWorkers.map(w => {
      const eqPercent = (equivSplit[w.contractorId] || 0) / 100;
      const upPercent = (upsellSplit[w.contractorId] || 0) / 100;
      
      const teamTotalEQ = actualTotalEQ;
      const assignedEQ = actualTotalEQ * eqPercent;
      
      const workerAlumni = w.alumniRate || 0;
      const workerSilver = w.silverRate || 0;
      const workerTotalRate = baseRate + workerAlumni + workerSilver;
      
      const productionPay = assignedEQ * workerTotalRate;
      const upsellCommission = (stats.upsellPayable || 0) * upPercent * 0.10;
      const iosCommission = (stats.iosCount || 0) * 5.0 * upPercent;
      
      // Bonuses with split
      let bonusAmount = 0;
      (session?.bonuses || []).forEach(bonus => {
        const bonusSplit = bonus.splitPercentages?.[w.contractorId] ?? (eqPercent * 100);
        bonusAmount += bonus.amount * (bonusSplit / 100);
      });
      
      // Per-worker deductions
      // FIXED: cashChequeDiff is DISPLAY ONLY - it affects EQ, not pay directly
      const cashChequeDiff = (Math.abs(cashDiff) + Math.abs(chequeDiff)) * eqPercent;
      const workerMachineDeduction = workerMachineRentals[w.contractorId] ? 10.0 : 0;
      const workerOtherDeductions = workerDeductions[w.contractorId] || 0;
      
      // FIXED: totalWorkerDeductions no longer includes cashChequeDiff
      const totalWorkerDeductions = workerOtherDeductions;
      
      // FIXED: finalPay no longer subtracts cashChequeDiff (it already affected EQ via deltaEQ)
      const finalPay = productionPay + upsellCommission + iosCommission + bonusAmount - totalWorkerDeductions - workerMachineDeduction;
      
      return {
        worker: w,
        teamTotalEQ,
        assignedEQ,
        equivSplitPercent: equivSplit[w.contractorId] || 0,
        upsellSplitPercent: upsellSplit[w.contractorId] || 0,
        baseRate,
        workerTotalRate,
        productionPay,
        upsellCommission,
        iosCommission,
        bonusAmount,
        cashChequeDiff, // Still calculated for DISPLAY purposes
        machineDeduction: workerMachineDeduction,
        otherDeductions: workerOtherDeductions,
        finalPay,
      };
    });
    
    return payouts;
  };

  // 5. Calculate aeration payout (single worker)
  const calculateAerationPayout = () => {
    if (!worker) return null;
    
    const alumniRate = worker.alumniRate || 0;
    const silverRate = worker.silverRate || 0;
    const totalRate = baseRate + alumniRate + silverRate;
    
    const productionPay = actualTotalEQ * totalRate;
    const upsellCommission = (stats.upsellPayable || 0) * 0.10;
    const iosCommission = (stats.iosCount || 0) * 5.0;
    const bonusTotal = (session?.bonuses || []).reduce((sum, b) => sum + b.amount, 0);
    const machineDeduction = machineRental ? 10.0 : 0;
    
    // FIXED: cashChequeDiff is DISPLAY ONLY - it affects EQ via deltaEQ, not pay directly
    const cashChequeDiffVal = Math.abs(cashDiff) + Math.abs(chequeDiff);
    
    const grossPay = productionPay + upsellCommission + iosCommission + bonusTotal;
    
    // FIXED: finalPay no longer subtracts cashChequeDiffVal (it already affected EQ via deltaEQ)
    const finalPay = grossPay - totalDeductionsAeration - machineDeduction;
    
    return {
      productionPay,
      upsellCommission,
      iosCommission,
      bonusTotal,
      machineDeduction,
      totalDeductions: totalDeductionsAeration,
      cashChequeDiff: cashChequeDiffVal, // Still tracked for DISPLAY purposes
      finalPay,
      totalRate,
    };
  };

  const lawnRejuvPayouts = calculateLawnRejuvPayouts();
  const aerationPayout = calculateAerationPayout();
  
  // Final pay for header display
  const finalPay = isLawnRejuv 
    ? lawnRejuvPayouts.reduce((sum, p) => sum + p.finalPay, 0)
    : (aerationPayout?.finalPay || 0);

  // Bonus total for display
  const bonusTotal = (session?.bonuses || []).reduce((sum, b) => sum + b.amount, 0);

  // Validate splits sum to 100
  const equivTotal = Object.values(equivSplit).reduce((sum, v) => sum + v, 0);
  const upsellTotal = Object.values(upsellSplit).reduce((sum, v) => sum + v, 0);
  const splitsValid = Math.abs(equivTotal - 100) < 0.01 && Math.abs(upsellTotal - 100) < 0.01;

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
    
    // Validate splits for lawn rejuv
    if (isLawnRejuv && !splitsValid) {
      alert('Split percentages must total 100% before finalizing');
      return;
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
      machineRental: isLawnRejuv ? false : machineRental, // Legacy field for aeration
      managerName: 'Admin',
      timestamp: new Date().toISOString(),
      // New per-worker fields for lawn rejuv
      workerMachineRentals: isLawnRejuv ? workerMachineRentals : undefined,
      workerDeductions: isLawnRejuv ? workerDeductions : undefined,
    };

    try {
      await sessionService.updateLogsheetSession(session.id, {
        validation: validationData,
        status: 'PAID',
        equivSplit: isLawnRejuv ? equivSplit : undefined,
        upsellSplit: isLawnRejuv ? upsellSplit : undefined,
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
    const displayPrice = tx.displayPrice || `$${tx.price.toFixed(2)}`;

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
            {renderServiceBadges(tx.services)}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {tx.customerPhone ? (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <Phone size={12} strokeWidth={2.5} />
                {tx.customerPhone}
              </span>
            ) : (
              <Phone size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
            )}
            
            {tx.customerEmail ? (
              <EmailStatusBadge transactionId={tx.jobId} email={tx.customerEmail} />
            ) : (
              <Mail size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
            )}
          </div>

          {paymentDisplay && (
            <div className="flex items-center justify-end text-[10px] text-gray-400 italic truncate flex-shrink text-right px-2 min-w-0 max-w-[120px]">
              {paymentDisplay}
            </div>
          )}

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
                <span className="text-xs">
                  Payout Rate: <b className="text-white">${baseRate.toFixed(2)}/EQ</b>
                  {isTeamSession && seasonType === 'lawn_rejuv' && (
                    <span className="text-green-400 ml-1">(Team of {teamWorkers.length})</span>
                  )}
                </span>
                {productCostPercent > 0 && (
                  <span className="text-xs text-yellow-400">
                    Prod Cost: {productCostPercent}%
                  </span>
                )}
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
              <div className="text-xs text-gray-500 uppercase font-bold text-blue-400">
                {isTeamSession ? 'Team Total EQ' : 'Actual EQ'}
              </div>
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

          {/* TRANSACTION HISTORY - Now first for both seasons */}
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

          {/* AERATION: VISUAL BREAKDOWN - Only for aeration, after transactions */}
          {!isLawnRejuv && aerationPayout && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Production */}
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-gray-400 text-xs font-bold uppercase tracking-wider">
                  <Calculator size={14} className="text-blue-400" /> Production Comm
                </div>
                <div className="text-2xl font-bold text-white mb-3">
                  ${aerationPayout.productionPay.toFixed(2)}
                </div>
                <div className="bg-gray-900/50 rounded p-3 text-xs text-gray-400 space-y-2 border border-gray-700/50">
                  <div className="flex justify-between items-center">
                    <span>Actual EQ</span>
                    <span className="font-mono text-blue-300 font-bold">{actualTotalEQ.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                    <span title="Base + Alumni + Silver">Total Rate (${aerationPayout.totalRate.toFixed(2)})</span>
                    <span className="font-mono text-gray-300">
                      ${baseRate.toFixed(2)} + ${(worker.alumniRate || 0).toFixed(2)} + ${(worker.silverRate || 0).toFixed(2)}
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
                  ${aerationPayout.upsellCommission.toFixed(2)}
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
                  ${aerationPayout.iosCommission.toFixed(2)}
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

          {/* RECONCILIATION (Full Width) - Now second for both seasons */}
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
                      <span className="text-xs ml-2 opacity-75">(affects EQ)</span>
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
                      <span className="text-xs ml-2 opacity-75">(affects EQ)</span>
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

          {/* AERATION: DEDUCTIONS & FINAL PAYOUT */}
          {!isLawnRejuv && aerationPayout && (
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
                        <span className="text-xs text-gray-500 block">($10.00)</span>
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
                        Total Bonuses: +${aerationPayout.bonusTotal.toFixed(2)}
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
                    <div className="text-xs text-gray-500 uppercase font-bold mb-2">Breakdown</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Production</span>
                        <span className="font-mono text-white">${aerationPayout.productionPay.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Upsell</span>
                        <span className="font-mono text-white">${aerationPayout.upsellCommission.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">IOS/PB</span>
                        <span className="font-mono text-white">${aerationPayout.iosCommission.toFixed(2)}</span>
                      </div>
                      {aerationPayout.machineDeduction > 0 && (
                        <div className="flex justify-between text-red-400">
                          <span>Machine Rental</span>
                          <span className="font-mono">-${aerationPayout.machineDeduction.toFixed(2)}</span>
                        </div>
                      )}
                      {aerationPayout.bonusTotal > 0 && (
                        <div className="flex justify-between text-yellow-400">
                          <span>Bonuses</span>
                          <span className="font-mono">+${aerationPayout.bonusTotal.toFixed(2)}</span>
                        </div>
                      )}
                      {aerationPayout.totalDeductions > 0 && (
                        <div className="flex justify-between text-red-400">
                          <span>Other Deductions</span>
                          <span className="font-mono">-${aerationPayout.totalDeductions.toFixed(2)}</span>
                        </div>
                      )}
                      {/* Show cash/cheque diff as info only - it affects EQ, not pay */}
                      {aerationPayout.cashChequeDiff !== 0 && (
                        <div className={`flex justify-between text-xs pt-1 border-t border-gray-700 mt-1 ${
                          aerationPayout.cashChequeDiff > 0 ? 'text-gray-500' : 'text-gray-500'
                        }`}>
                          <span>Cash/Cheque Diff</span>
                          <span className="font-mono italic">${aerationPayout.cashChequeDiff.toFixed(2)} (in EQ)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-end mb-4">
                      <span className="text-lg font-bold text-white">Final Payout</span>
                      <span className="text-3xl font-bold text-green-400 font-mono tracking-tight">
                        ${aerationPayout.finalPay.toFixed(2)}
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
          )}

          {/* LAWN REJUV: COMBINED TEAM PAYOUT CONFIG + BONUSES + FINALIZE */}
          {isLawnRejuv && teamWorkers.length > 0 && (
            <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-5 mb-10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users size={20} className="text-green-400" /> Team Payout Configuration
                </h3>
                {!splitsValid && (
                  <span className="text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded border border-red-700">
                    Splits must total 100%
                  </span>
                )}
              </div>

              {/* Grid Header */}
              <div className="grid grid-cols-12 gap-2 text-[10px] text-gray-500 uppercase font-bold mb-2 px-2">
                <div className="col-span-2">Worker</div>
                <div className="text-center">Equiv %</div>
                <div className="text-center">Upsell %</div>
                <div className="text-center">Assigned EQ</div>
                <div className="text-center">Rate</div>
                <div className="text-center">Production</div>
                <div className="text-center">Upsell+IOS</div>
                <div className="text-center">Bonus</div>
                <div className="text-center">🚜</div>
                <div className="text-center">Deductions</div>
                <div className="text-right">Final Pay</div>
              </div>

              {/* Worker Rows */}
              <div className="space-y-2">
                {lawnRejuvPayouts.map(payout => {
                  const isCurrentWorker = payout.worker.contractorId === contractorId;
                  
                  return (
                    <div 
                      key={payout.worker.contractorId}
                      className={`grid grid-cols-12 gap-2 items-center p-2 rounded-lg border ${
                        isCurrentWorker 
                          ? 'bg-blue-900/20 border-blue-700' 
                          : 'bg-gray-900/50 border-gray-700'
                      }`}
                    >
                      {/* Worker Name */}
                      <div className="col-span-2 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          isCurrentWorker ? 'bg-blue-400' : 'bg-gray-500'
                        }`} />
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">
                            {payout.worker.firstName} {payout.worker.lastName.charAt(0)}.
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono">
                            #{payout.worker.contractorId}
                          </div>
                        </div>
                      </div>

                      {/* Equiv % Input */}
                      <div className="flex justify-center">
                        <input
                          type="number"
                          value={equivSplit[payout.worker.contractorId] || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setEquivSplit(prev => ({
                              ...prev,
                              [payout.worker.contractorId]: Math.max(0, Math.min(100, val))
                            }));
                            setIsModified(true);
                          }}
                          className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-white text-center text-xs"
                          min="0"
                          max="100"
                        />
                      </div>

                      {/* Upsell % Input */}
                      <div className="flex justify-center">
                        <input
                          type="number"
                          value={upsellSplit[payout.worker.contractorId] || 0}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setUpsellSplit(prev => ({
                              ...prev,
                              [payout.worker.contractorId]: Math.max(0, Math.min(100, val))
                            }));
                            setIsModified(true);
                          }}
                          className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-white text-center text-xs"
                          min="0"
                          max="100"
                        />
                      </div>

                      {/* Assigned EQ (read-only) */}
                      <div className="text-center text-xs font-mono text-blue-300">
                        {payout.assignedEQ.toFixed(2)}
                      </div>

                      {/* Rate (read-only) */}
                      <div className="text-center text-xs font-mono text-gray-300">
                        ${payout.workerTotalRate.toFixed(2)}
                      </div>

                      {/* Production (read-only) */}
                      <div className="text-center text-xs font-mono text-white">
                        ${payout.productionPay.toFixed(2)}
                      </div>

                      {/* Upsell+IOS (read-only) */}
                      <div className="text-center text-xs font-mono text-purple-300">
                        ${(payout.upsellCommission + payout.iosCommission).toFixed(2)}
                      </div>

                      {/* Bonus (read-only) */}
                      <div className="text-center text-xs font-mono text-yellow-400">
                        {payout.bonusAmount > 0 ? `+$${payout.bonusAmount.toFixed(0)}` : '-'}
                      </div>

                      {/* Machine Checkbox */}
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={workerMachineRentals[payout.worker.contractorId] ?? true}
                          onChange={(e) => {
                            setWorkerMachineRentals(prev => ({
                              ...prev,
                              [payout.worker.contractorId]: e.target.checked
                            }));
                            setIsModified(true);
                          }}
                          className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
                          title="Machine rental ($10)"
                        />
                      </div>

                      {/* Deductions Input */}
                      <div className="flex justify-center">
                        <input
                          type="number"
                          value={workerDeductions[payout.worker.contractorId] || ''}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setWorkerDeductions(prev => ({
                              ...prev,
                              [payout.worker.contractorId]: Math.max(0, val)
                            }));
                            setIsModified(true);
                          }}
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-white text-center text-xs"
                          placeholder="0"
                          min="0"
                        />
                      </div>

                      {/* Final Pay (read-only) */}
                      <div className="text-right text-sm font-bold text-green-400 font-mono">
                        ${payout.finalPay.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals Row */}
              <div className="grid grid-cols-12 gap-2 items-center mt-3 pt-3 border-t border-gray-700 px-2">
                <div className="col-span-2 text-sm font-bold text-gray-400">TOTALS</div>
                <div className={`text-center text-xs font-bold ${
                  Math.abs(equivTotal - 100) < 0.01 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {equivTotal}%
                </div>
                <div className={`text-center text-xs font-bold ${
                  Math.abs(upsellTotal - 100) < 0.01 ? 'text-green-400' : 'text-red-400'
                }`}>
                  {upsellTotal}%
                </div>
                <div className="text-center text-xs font-mono text-blue-300">
                  {actualTotalEQ.toFixed(2)}
                </div>
                <div className="col-span-3"></div>
                <div className="text-center text-xs font-mono text-yellow-400">
                  {bonusTotal > 0 ? `+$${bonusTotal.toFixed(0)}` : '-'}
                </div>
                <div className="col-span-2"></div>
                <div className="text-right text-lg font-bold text-green-400 font-mono">
                  ${finalPay.toFixed(2)}
                </div>
              </div>

              {/* Cash/Cheque Diff Info (display only) */}
              {(cashDiff !== 0 || chequeDiff !== 0) && (
                <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 text-center">
                  Cash/Cheque difference of ${(Math.abs(cashDiff) + Math.abs(chequeDiff)).toFixed(2)} is reflected in EQ calculation, not deducted from pay
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const equalSplit = createEqualSplit(teamWorkers.map(w => w.contractorId));
                      setEquivSplit(equalSplit);
                      setUpsellSplit(equalSplit);
                      setIsModified(true);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded border border-blue-700 hover:bg-blue-900/30"
                  >
                    Split Equally
                  </button>
                  <button
                    onClick={() => {
                      const allOn: Record<string, boolean> = {};
                      teamWorkers.forEach(w => { allOn[w.contractorId] = true; });
                      setWorkerMachineRentals(allOn);
                      setIsModified(true);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors px-2 py-1 rounded border border-gray-700 hover:bg-gray-800"
                  >
                    All Machine ✓
                  </button>
                  <button
                    onClick={() => {
                      const allOff: Record<string, boolean> = {};
                      teamWorkers.forEach(w => { allOff[w.contractorId] = false; });
                      setWorkerMachineRentals(allOff);
                      setIsModified(true);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors px-2 py-1 rounded border border-gray-700 hover:bg-gray-800"
                  >
                    All Machine ✗
                  </button>
                </div>
              </div>

              {/* Bonuses Section */}
              <div className="mt-6 pt-6 border-t border-gray-700">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Bonuses */}
                  <div>
                    <label className="text-xs text-gray-400 uppercase font-bold mb-2 block flex items-center gap-2">
                      <Trophy size={14} className="text-yellow-400" /> Team Bonuses
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

                  {/* Finalize Button */}
                  <div className="flex flex-col justify-end">
                    <div className="flex justify-between items-end mb-4">
                      <span className="text-lg font-bold text-white">Team Total Payout</span>
                      <span className="text-3xl font-bold text-green-400 font-mono tracking-tight">
                        ${finalPay.toFixed(2)}
                      </span>
                    </div>

                    <button
                      onClick={handleFinalize}
                      disabled={!splitsValid}
                      className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
                        splitsValid 
                          ? 'bg-green-600 hover:bg-green-500 text-white' 
                          : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      <CheckCircle size={20} />{' '}
                      {session.validation?.isValidated ? 'Update Payout' : 'Finalize & Paid'}
                    </button>
                    {!splitsValid && (
                      <p className="text-xs text-red-400 mt-2 text-center">
                        Fix split percentages before finalizing
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

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