// src/pages/Logsheet/NewJob.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, Save, AlertCircle, RefreshCw, CheckCircle, Phone, Mail, Loader, TrendingUp, GraduationCap, Info, Shovel, Bookmark } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { commandCenterService, getTaxRateForRegion, Region, seasonHasTeams } from '../../lib/commandCenterService';
import { 
  Worker, 
  SessionTransaction, 
  SeasonType,
  ServiceFlags,
  SERVICE_FLAG_KEYS,
  SERVICE_FLAG_LABELS,
  PendingSaleInput,
  PendingSaleUpdate
} from '../../types';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import CreditCardModal from '../../components/CreditCardModal';
import BamboraLiveModal from '../../components/BamboraLiveModal';
import EtransferProtocolModal from '../../components/EtransferProtocolModal';
import AddContractModal from '../../components/AddContractModal';
import { 
  formatPhoneNumber, 
  normalizeEmail,
  getPhoneValidationError, 
  getEmailValidationError 
} from '../../lib/validationUtils';

// --- HELPER: Generate Valid UUIDs ---
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// --- HELPER: Capitalize first letter after spaces and hyphens ---
function capitalizeWords(value: string): string {
  return value
    .split(' ')
    .map(word => 
      word
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
    )
    .join(' ');
}

// --- HELPER: Get the property type button list for a given season ---
// Aeration & Lawn Rejuv use FP/FO/BO. Sealing uses SS/SSP (Ramp is in the enum
// but reserved for a separate future plan).
// TODO: When Central 'cleaning' season ships, add its property types here.
function getPropertyTypesForSeason(seasonType: SeasonType): string[] {
  if (seasonType === 'sealing') return ['SS', 'SSP'];
  return ['FP', 'FO', 'BO'];
}

// --- HELPER: Get the default property type for a given season ---
function getDefaultPropertyTypeForSeason(seasonType: SeasonType): string {
  if (seasonType === 'sealing') return 'SS';
  return 'FP';
}

// --- HELPER: Get the transaction item/service name for a given season ---
// TODO: When 'cleaning' season ships, return 'Cleaning' for it.
function getItemNameForSeason(seasonType: SeasonType): string {
  if (seasonType === 'lawn_rejuv') return 'Lawn Rejuvenation';
  if (seasonType === 'sealing') return 'Sealing';
  return 'Aeration';
}

// --- HELPER: Build the seasonId stamp for a transaction ---
// Format: `<region>-<season-slug>` (e.g. 'west-aeration', 'east-sealing', 'west-lawn-rejuv')
function buildSeasonId(region: Region, seasonType: SeasonType): string {
  const regionSlug = region.toLowerCase();
  if (seasonType === 'lawn_rejuv') return `${regionSlug}-lawn-rejuv`;
  if (seasonType === 'sealing') return `${regionSlug}-sealing`;
  return `${regionSlug}-aeration`;
}

// --- SERVICE TOGGLE COLORS (Lawn Rejuv) ---
const SERVICE_TOGGLE_COLORS: Record<keyof ServiceFlags, { active: string; inactive: string }> = {
  aeration: { 
    active: 'bg-blue-600 border-blue-500 text-white', 
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-blue-500' 
  },
  dethatch: { 
    active: 'bg-orange-600 border-orange-500 text-white', 
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-orange-500' 
  },
  fertilizer: { 
    active: 'bg-green-600 border-green-500 text-white', 
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-green-500' 
  },
  seed: { 
    active: 'bg-yellow-600 border-yellow-500 text-white', 
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-yellow-500' 
  },
  lime: { 
    active: 'bg-purple-600 border-purple-500 text-white', 
    inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-purple-500' 
  },
};

// --- SERVICE TOGGLES COMPONENT (Lawn Rejuv only) ---
const ServiceToggles: React.FC<{
  services: ServiceFlags;
  onChange: (services: ServiceFlags) => void;
}> = ({ services, onChange }) => {
  const toggleService = (key: keyof ServiceFlags) => {
    onChange({
      ...services,
      [key]: !services[key],
    });
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-gray-500 uppercase block">Services to Perform</label>
      <div className="flex flex-wrap gap-2">
        {SERVICE_FLAG_KEYS.map((key) => {
          const isActive = services[key];
          const colors = SERVICE_TOGGLE_COLORS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleService(key)}
              className={`px-3 py-1.5 rounded border-2 font-bold text-xs transition-all ${
                isActive ? colors.active : colors.inactive
              }`}
            >
              {SERVICE_FLAG_LABELS[key].short} - {SERVICE_FLAG_LABELS[key].full}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const NewJob: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // --- Training mode state ---
  const [isTrainingMode, setIsTrainingMode] = useState(false);

  // --- Region and Tax Rate State ---
  const [region, setRegion] = useState<Region>('West');
  const [taxRate, setTaxRate] = useState(5);

  // --- Season type state (supports aeration | lawn_rejuv | sealing) ---
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');

  // Live Card Processing flag (production only, stays false in training)
  const [liveCardEnabled, setLiveCardEnabled] = useState(false);

  // --- PENDING SALE STATE ---
  // When NewJob is opened with ?pendingSaleId=xxx, we prefill from the
  // pending_sales row. On Save & Complete, we pass pendingSaleId to
  // completeJob() which deletes the row after the transaction writes.
  // On Save Pending, we update the existing row instead of creating a new one.
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [isResumingPending, setIsResumingPending] = useState(false);

  // --- Form State ---
  const [routeCode, setRouteCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState(''); 
  const [propertyType, setPropertyType] = useState('FP'); 
  
  // Service Flags (Lawn Rejuv only)
  const [services, setServices] = useState<ServiceFlags>({
    aeration: false,
    dethatch: false,
    fertilizer: false,
    seed: false,
    lime: false,
  });

  // Payment State - Default to empty string to force selection
  const [paymentMethod, setPaymentMethod] = useState('');
  const [etransferEmail, setEtransferEmail] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  
  // Split Payment State
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState({
    cash: '',
    cheque: '',
    etransfer: '',
    creditCard: ''
  });
  const [splitEtransferEmail, setSplitEtransferEmail] = useState('');
  const [splitChequeNumber, setSplitChequeNumber] = useState('');
  const [splitCcPaid, setSplitCcPaid] = useState(false);
  const [splitCcData, setSplitCcData] = useState<any>(null);
  
  // Credit Card Data
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [ccData, setCcData] = useState<any>(null);

  // E-Transfer Protocol Modal
  const [showEtransferProtocol, setShowEtransferProtocol] = useState(false);

  // Upgrade Modal
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Upsells enabled state
  const [upsellsEnabled, setUpsellsEnabled] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);
  const [suggestedStreets, setSuggestedStreets] = useState<string[]>([]);
  const [isCustomStreetMode, setIsCustomStreetMode] = useState(false);

  // Validation Errors
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [etransferEmailError, setEtransferEmailError] = useState<string | null>(null);
  const [splitEtransferEmailError, setSplitEtransferEmailError] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  // Saving state to prevent double-click
  // Two flavours: `saving` covers Save & Complete; `savingPending` covers the
  // new Save Pending button. Separate so each can spin independently.
  const [saving, setSaving] = useState(false);
  const [savingPending, setSavingPending] = useState(false);

  // --- COMPUTED: Can show upgrade button (West only, Aeration season only) ---
  const canShowUpgradeButton = region === 'West' && seasonType === 'aeration';

  // --- COMPUTED: Property type list for the current season ---
  const propertyTypeOptions = getPropertyTypesForSeason(seasonType);

  // --- COMPUTED: Does this season hide the upsell-style "Services" header? ---
  // Lawn Rejuv and Sealing both use the simpler "Pricing" label.
  const seasonUsesPricingOnlyLabel = seasonType === 'lawn_rejuv' || seasonType === 'sealing';

  // --- COMPUTED: Is this a team season? ---
  // Drives whether the Save Pending button is visible. Training mode is always
  // Aeration in this codebase, so the inner check excludes training entirely.
  const isTeamSeason = seasonHasTeams(seasonType) && !isTrainingMode;

  // --- COMPUTED: Get customer address for E-Transfer protocol ---
  const getCustomerAddress = (): string => {
    return `${houseNumber} ${streetName}`.trim();
  };

  // --- SPLIT PAYMENT HELPERS ---
  const getSplitTotal = () => {
    const cash = parseFloat(splitAmounts.cash) || 0;
    const cheque = parseFloat(splitAmounts.cheque) || 0;
    const etransfer = parseFloat(splitAmounts.etransfer) || 0;
    const creditCard = parseFloat(splitAmounts.creditCard) || 0;
    return Math.round((cash + cheque + etransfer + creditCard) * 100) / 100;
  };

  const hasSplitCreditCard = () => {
    return (parseFloat(splitAmounts.creditCard) || 0) > 0;
  };

  const hasSplitEtransfer = () => {
    return (parseFloat(splitAmounts.etransfer) || 0) > 0;
  };

  const hasSplitCheque = () => {
    return (parseFloat(splitAmounts.cheque) || 0) > 0;
  };

  // --- HANDLERS FOR NAME FIELDS ---
  const handleFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFirstName(capitalizeWords(e.target.value));
  };

  const handleLastNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLastName(capitalizeWords(e.target.value));
  };

  // --- HANDLERS FOR PHONE & EMAIL ---
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
    setPhoneError(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setEmailError(null);
  };

  const handleEmailBlur = () => {
    if (email) setEmail(normalizeEmail(email));
  };

  const handleEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEtransferEmail(e.target.value);
    setEtransferEmailError(null);
  };

  const handleEtransferEmailBlur = () => {
    if (etransferEmail) setEtransferEmail(normalizeEmail(etransferEmail));
  };

  const handleSplitEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSplitEtransferEmail(e.target.value);
    setSplitEtransferEmailError(null);
  };

  const handleSplitEtransferEmailBlur = () => {
    if (splitEtransferEmail) setSplitEtransferEmail(normalizeEmail(splitEtransferEmail));
  };

  // Handle split e-transfer amount blur - show protocol if amount > 0
  const handleSplitEtransferAmountBlur = () => {
    const etransferAmount = parseFloat(splitAmounts.etransfer) || 0;
    if (etransferAmount > 0) {
      // Auto-populate email if empty
      if (!splitEtransferEmail && email) {
        setSplitEtransferEmail(email);
      }
      setShowEtransferProtocol(true);
    }
  };

  // --- HANDLER FOR PAYMENT METHOD ---
  const handlePaymentMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setPaymentMethod(value);
    setPaymentMethodError(null);
    
    if (value === 'Split Payment') {
      setIsSplitPayment(true);
      // Reset split state
      setSplitAmounts({ cash: '', cheque: '', etransfer: '', creditCard: '' });
      setSplitEtransferEmail('');
      setSplitChequeNumber('');
      setSplitCcPaid(false);
      setSplitCcData(null);
    } else {
      setIsSplitPayment(false);
      if (value === 'Credit Card') setShowCreditModal(true);
      
      // Show E-Transfer protocol when E-Transfer is selected
      if (value === 'E-Transfer') {
        // Auto-populate email if empty
        if (!etransferEmail && email) {
          setEtransferEmail(email);
        }
        setShowEtransferProtocol(true);
      }
    }
  };

  // Determine if upgrade button should be enabled (West only, Aeration season, with other conditions)
  const canUpgrade = upsellsEnabled &&
                     canShowUpgradeButton &&
                     firstName.trim() !== '' && 
                     lastName.trim() !== '' && 
                     houseNumber.trim() !== '' && 
                     streetName.trim() !== '';

  useEffect(() => {
    const init = async () => {
      // Check training mode
      const trainingMode = trainingService.isTrainingMode();
      setIsTrainingMode(trainingMode);

      const currentWorker = getStorageItem<Worker | null>('current_user', null);
      
      // Get region and tax rate
      if (trainingMode) {
        // Training is always West, aeration season — liveCardEnabled stays false
        setRegion('West');
        setTaxRate(5);
        setSeasonType('aeration');
      } else {
        const cc = commandCenterService.getCurrentCommandCenter();
        if (cc) {
          setRegion(cc.region);
          setTaxRate(getTaxRateForRegion(cc.region));
        }
        
        // Get current season type
        try {
          const currentSeasonType = await sessionService.getSessionSeasonType();
          setSeasonType(currentSeasonType);
          
          // Default property type based on season
          setPropertyType(getDefaultPropertyTypeForSeason(currentSeasonType));
          
          // Default price to 0 for lawn_rejuv and sealing (worker fills in manually)
          if (currentSeasonType === 'lawn_rejuv' || currentSeasonType === 'sealing') {
            setAmount('0');
          }
        } catch (err) {
          console.warn('Could not get season type, defaulting to aeration');
        }

        // Get live card processing setting from session
        try {
          const liveCard = await sessionService.getSessionLiveCardEnabled();
          setLiveCardEnabled(liveCard);
        } catch (err) {
          console.warn('Could not get live card status, defaulting to false');
        }
      }
      
      if (currentWorker) {
          setWorker(currentWorker);
          
          try {
              const service = trainingMode ? trainingService : sessionService;
              const dailySession = await service.getDailySession();
              let myRoutes: string[] = [];

              if (dailySession && dailySession.routes) {
                  myRoutes = dailySession.routes
                      .filter((r: any) => r.assignedWorkerIds && r.assignedWorkerIds.includes(currentWorker.contractorId))
                      .map((r: any) => r.routeCode);
                  
                  myRoutes.sort((a, b) => a.localeCompare(b));
              }

              setAssignedRoutes(myRoutes);
              
              if (myRoutes.length === 0) {
                  alert('You have no assigned routes. Please contact your manager to create sales.');
                  navigate('/logsheet');
                  return;
              }

              setRouteCode(myRoutes[0]);
              
              // Fetch upsellsEnabled status
              const upsellStatus = await service.getWorkerUpsellsEnabled(currentWorker.contractorId);
              setUpsellsEnabled(upsellStatus);
          } catch(err) {
              console.warn("Offline/No session found", err);
              alert('Unable to load route assignments. Please try again.');
              navigate('/logsheet');
          }
      }
    };
    init();
  }, [navigate]);

  // --- PREFILL FROM PENDING SALE ---
  // Runs once when worker + season are loaded. If ?pendingSaleId= is in the
  // URL, fetch the row and copy each saved field into the corresponding form
  // state. Skipped in training mode (training is always Aeration).
  // Graceful failure: if the fetch fails or returns null, the worker still
  // ends up with a normal blank-form experience.
  useEffect(() => {
    const prefillFromPending = async () => {
      const psId = searchParams.get('pendingSaleId');
      if (!psId || !worker || isTrainingMode) return;

      try {
        const ps = await sessionService.getPendingSaleById(psId);
        if (!ps) {
          console.warn('[NewJob] Pending sale not found, continuing with blank form:', psId);
          return;
        }

        setPendingSaleId(ps.id);
        setIsResumingPending(true);

        // Copy each saved field, leaving anything blank if the pending sale
        // didn't have it. Worker fills in the rest before saving/completing.
        if (ps.routeCode) setRouteCode(ps.routeCode);
        if (ps.houseNumber) setHouseNumber(ps.houseNumber);
        if (ps.streetName) {
          setStreetName(ps.streetName);
          // Force custom street mode so the prefilled value renders in the
          // input field rather than getting clobbered by the dropdown reset
          // effect below.
          setIsCustomStreetMode(true);
        }
        if (ps.price) setAmount(ps.price);
        if (ps.propertyType) setPropertyType(ps.propertyType);
        if (ps.services) setServices(ps.services);
        // Notes live in itemDescription/Log Sheet Notes territory; we don't
        // have a notes field in NewJob's form proper, so we'll forward them
        // through itemDescription when the transaction writes. For now, stash
        // on the pendingSale row only — workers see it on the card.
      } catch (err) {
        console.warn('[NewJob] Failed to load pending sale, continuing with blank form:', err);
      }
    };
    prefillFromPending();
    // Intentionally only depends on worker + isTrainingMode. searchParams
    // doesn't need to be a dep — it's read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker, isTrainingMode]);

  useEffect(() => {
    if (routeCode) {
        const service = isTrainingMode ? trainingService : sessionService;
        service.getStreetsForRoute(routeCode).then(streets => {
            if (streets && streets.length > 0) {
                setSuggestedStreets(streets);
                // If we already prefilled a custom street from a pending sale,
                // don't yank it back into dropdown mode and blank the field.
                if (!isResumingPending || !streetName) {
                  setIsCustomStreetMode(false);
                  setStreetName('');
                }
            } else {
                setSuggestedStreets([]);
                setIsCustomStreetMode(true);
            }
        });
    } else {
        setSuggestedStreets([]);
        setIsCustomStreetMode(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCode, isTrainingMode]);

  const handleTaxClick = () => { 
      const current = parseFloat(amount) || 0; 
      const tax = current * (taxRate / 100); 
      setAmount((Math.round((current + tax) * 100) / 100).toFixed(2)); 
  };

  // --- GATHER CURRENT FORM STATE FOR PENDING SAVE ---
  // Builds a clean PendingSaleInput from the current form fields. Used by both
  // create (new pending) and update (resuming pending) paths in handleSavePending.
  // No payment fields here — pending sales are pre-payment by definition.
  const gatherPendingPayload = (): {
    forCreate: PendingSaleInput;
    forUpdate: PendingSaleUpdate;
  } | null => {
    if (!worker) return null;

    // Pending sales are scoped to a logsheet session. Fetching the current
    // session id is cheap — same call sessionService uses internally for
    // completeJob's session stamp.
    // Note: getActiveLogsheetSession is called below in handleSavePending so
    // we can keep this helper synchronous and not double-fetch.

    const base = {
      routeCode: routeCode || undefined,
      houseNumber: houseNumber.trim() || undefined,
      streetName: streetName.trim() || undefined,
      price: amount.trim() || undefined,
      propertyType: propertyType || undefined,
      services: seasonType === 'lawn_rejuv' ? services : undefined,
      // Notes flow: we don't have a dedicated notes field in NewJob proper.
      // If we later add one, plumb it through here. For now, leave undefined.
      notes: undefined as string | undefined,
    };

    return {
      forCreate: {
        sessionId: '', // filled in by handleSavePending after session lookup
        workerId: worker.contractorId,
        ...base,
      },
      forUpdate: { ...base },
    };
  };

  // --- SAVE PENDING (team seasons only) ---
  // Two paths:
  //   - Resuming an existing pending sale (pendingSaleId set): call updatePendingSale
  //   - New pending sale (pendingSaleId null): look up the worker's active session,
  //     then call createPendingSale
  // No payment validation — pending sales are pre-payment by definition.
  // Address validation is permissive: at least one of (house #, street) must be filled.
  const handleSavePending = async () => {
    if (savingPending || saving) return;
    setError(null);

    if (!worker) {
      setError('No worker session.');
      return;
    }

    const payload = gatherPendingPayload();
    if (!payload) {
      setError('Could not gather form state.');
      return;
    }

    // Permissive validation — pending sales are by definition incomplete.
    // But we won't save a totally blank row. Same rule as QuickPendingModal.
    if (!payload.forUpdate.houseNumber && !payload.forUpdate.streetName) {
      setError('Please enter at least a house number or street name before parking this sale.');
      return;
    }

    setSavingPending(true);

    try {
      if (pendingSaleId) {
        // RESUMING — update the existing row in place
        await sessionService.updatePendingSale(pendingSaleId, payload.forUpdate);
      } else {
        // NEW — need the active session id to scope the new row
        const activeSession = await sessionService.getActiveLogsheetSession(worker.contractorId);
        if (!activeSession?.id) {
          setError('Could not find your active session. Please reload and try again.');
          setSavingPending(false);
          return;
        }
        await sessionService.createPendingSale({
          ...payload.forCreate,
          sessionId: activeSession.id,
        });
      }

      navigate('/logsheet');
    } catch (err: any) {
      console.error('[NewJob] handleSavePending failed:', err);
      setError(err?.message || 'Failed to save pending sale. Please try again.');
      setSavingPending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (saving) return;
    
    setError(null);

    if (!worker) { setError("No worker session."); return; }

    // --- VALIDATION ---
    const pError = getPhoneValidationError(phone);
    const eError = getEmailValidationError(email);
    
    // Split payment validation
    if (isSplitPayment) {
      const splitTotal = getSplitTotal();
      if (splitTotal <= 0) {
        setError('Please enter at least one payment amount.');
        return;
      }
      
      // E-Transfer email validation
      if (hasSplitEtransfer()) {
        const etError = getEmailValidationError(splitEtransferEmail);
        if (etError) {
          setSplitEtransferEmailError(etError);
          setError('Please fix validation errors before saving.');
          return;
        }
      }
      
      // Credit card validation
      if (hasSplitCreditCard() && !splitCcPaid) {
        setError('Please process the credit card payment before saving.');
        return;
      }
    } else {
      // Non-split validation
      const etError = paymentMethod === 'E-Transfer' ? getEmailValidationError(etransferEmail) : null;
      const pmError = !paymentMethod ? 'Please select a payment method' : null;

      if (pError || eError || etError || pmError) {
        setPhoneError(pError);
        setEmailError(eError);
        setEtransferEmailError(etError);
        setPaymentMethodError(pmError);
        setError('Please fix validation errors before saving.');
        return;
      }
    }

    // General validation
    if (pError || eError) {
      setPhoneError(pError);
      setEmailError(eError);
      setError('Please fix validation errors before saving.');
      return;
    }

    // Lawn Rejuv: Validate at least one service is selected
    if (seasonType === 'lawn_rejuv') {
      const hasService = SERVICE_FLAG_KEYS.some(k => services[k]);
      if (!hasService) {
        setError('Please select at least one service');
        return;
      }
    }
    
    setSaving(true);

    try {
      const service = isTrainingMode ? trainingService : sessionService;
      
      let activeSession = await service.getActiveLogsheetSession(worker.contractorId);
      if (!activeSession) { 
          activeSession = await service.startLogsheetSession(worker.contractorId);
      }

      let transactionPrice: number;
      let finalPaymentMethod: string;
      let paymentBreakdown: Record<string, number> | undefined;
      let finalEtransferEmail: string | undefined;
      let finalChequeNumber: string | undefined;
      let finalCcData: any = null;

      if (isSplitPayment) {
        transactionPrice = getSplitTotal();
        finalPaymentMethod = 'Split';
        paymentBreakdown = {};
        
        const cashAmt = parseFloat(splitAmounts.cash) || 0;
        const chequeAmt = parseFloat(splitAmounts.cheque) || 0;
        const etransferAmt = parseFloat(splitAmounts.etransfer) || 0;
        const creditCardAmt = parseFloat(splitAmounts.creditCard) || 0;
        
        if (cashAmt > 0) paymentBreakdown['Cash'] = cashAmt;
        if (chequeAmt > 0) paymentBreakdown['Cheque'] = chequeAmt;
        if (etransferAmt > 0) paymentBreakdown['E-Transfer'] = etransferAmt;
        if (creditCardAmt > 0) paymentBreakdown['Credit Card'] = creditCardAmt;
        
        if (hasSplitEtransfer()) finalEtransferEmail = splitEtransferEmail;
        if (hasSplitCheque()) finalChequeNumber = splitChequeNumber;
        if (hasSplitCreditCard()) finalCcData = splitCcData;
      } else {
        const rawPrice = parseFloat(amount) || 0;
        transactionPrice = Math.round(rawPrice * 100) / 100;
        finalPaymentMethod = paymentMethod;
        finalEtransferEmail = paymentMethod === 'E-Transfer' ? etransferEmail : undefined;
        finalChequeNumber = paymentMethod === 'Cheque' ? chequeNumber : undefined;
        finalCcData = ccData;
      }
      
      const newTransactionId = generateUUID();
      const placeholderJobId = `NEW-${Date.now()}`;
      const itemName = getItemNameForSeason(seasonType);

      const transactionData: SessionTransaction = {
          id: newTransactionId,
          jobId: placeholderJobId, 
          timestamp: new Date().toISOString(),
          customerId: "WALKUP",
          customerName: `${firstName} ${lastName}`,
          address: `${houseNumber} ${streetName}`.trim(),
          customerPhone: phone,
          customerEmail: email,
          workerId: worker.contractorId,
          workerName: worker.firstName,
          
          routeManagerName: 'RM', 
          routeCode: routeCode,
          
          price: transactionPrice,
          displayPrice: isSplitPayment ? transactionPrice.toFixed(2) : amount, 
          type: 'Sale',
          items: [{ name: itemName, price: transactionPrice }],
          paymentMethod: finalPaymentMethod,
          paymentBreakdown: paymentBreakdown,
          isPaid: finalPaymentMethod !== 'Billed',
          etransferEmail: finalEtransferEmail,
          chequeNumber: finalChequeNumber,
          ccFullNumber: finalCcData?.number,
          ccExpiry: finalCcData?.expiry,
          ccCVC: finalCcData?.cvc,
          itemDescription: 'New Sale',
          serviceType: propertyType as any, 
          region: region, 
          seasonId: buildSeasonId(region, seasonType),
          isWestSplit: false,
          
          // Include services for Lawn Rejuv season
          services: seasonType === 'lawn_rejuv' ? services : undefined,
      } as any;

      // PENDING SALE CLEANUP — if this completion is resolving a pending sale,
      // pass the id as the 5th arg so completeJob deletes the row after the
      // transaction writes. trainingService doesn't support this param, but
      // training is always Aeration so pendingSaleId is always null there.
      if (isTrainingMode) {
        await service.completeJob(transactionData, placeholderJobId, worker.contractorId);
      } else {
        await sessionService.completeJob(
          transactionData,
          placeholderJobId,
          worker.contractorId,
          undefined,           // teamWorkerIds — unchanged behaviour
          pendingSaleId || undefined  // triggers pending row deletion on success
        );
      }

      const session = await service.getActiveLogsheetSession(worker.contractorId);
      if (session) {
          const newStats = service.recalculateStats(session.financialStore, taxRate);
          await service.updateLogsheetSession(session.id, { stats: newStats });
      }

      navigate('/logsheet');
    } catch (err: any) {
      console.error(err);
      setError("Failed to save sale: " + err.message);
      setSaving(false);
    }
  };

  // Build the client data for direct upgrade
  const getUpgradeClientData = () => ({
    firstName,
    lastName,
    houseNumber,
    streetName,
    phone,
    email,
    routeCode,
    propertyType
  });

  if (assignedRoutes.length === 0) {
    return null;
  }return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">New Sale</h2>
            {isTrainingMode && (
              <span className="bg-yellow-900/30 text-yellow-400 text-[10px] px-1.5 py-0.5 rounded border border-yellow-700 flex items-center gap-1">
                <GraduationCap size={10}/> Training
              </span>
            )}
            {/* Season badge — 3-way branch: lawn_rejuv | sealing | (none for aeration) */}
            {/* TODO: Add a 'cleaning' branch here once Central Cleaning ships. */}
            {seasonType === 'lawn_rejuv' && (
              <span className="bg-green-900/30 text-green-400 text-[10px] px-1.5 py-0.5 rounded border border-green-700">
                LAWN REJUV
              </span>
            )}
            {seasonType === 'sealing' && (
              <span className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-slate-600 flex items-center gap-1">
                <Shovel size={10}/> SEALING
              </span>
            )}
            {/* RESUMING PENDING pill — only when prefilled from a pending sale */}
            {isResumingPending && (
              <span className="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-0.5 rounded border border-slate-500 flex items-center gap-1">
                <Bookmark size={10}/> RESUMING PENDING
              </span>
            )}
          </div>
          <button onClick={() => navigate('/logsheet')} className="text-gray-400 hover:text-white" disabled={saving || savingPending}><X size={24} /></button>
        </div>
        
        {error && <div className="m-4 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto p-4 space-y-6 flex-grow custom-scrollbar">
            
            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Client Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                    <select value={routeCode} onChange={(e) => setRouteCode(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono">
                        {assignedRoutes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                <div className="md:col-span-2 grid grid-cols-2 gap-4">
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">First Name *</label><input value={firstName} onChange={handleFirstNameChange} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Last Name *</label><input value={lastName} onChange={handleLastNameChange} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
                </div>
                <div className="md:col-span-3 grid grid-cols-4 gap-4">
                    <div className="col-span-1"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">House # *</label><input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
                    <div className="col-span-3">
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Street Name *</label>
                        <div className="flex gap-2">
                            {!isCustomStreetMode ? (
                                <select value={streetName} onChange={(e) => { if (e.target.value === '__CUSTOM__') { setIsCustomStreetMode(true); setStreetName(''); } else { setStreetName(e.target.value); } }} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required disabled={!routeCode}>
                                    <option value="">{routeCode ? '-- Select Street --' : 'Select Route First'}</option>
                                    {suggestedStreets.map((s, i) => <option key={i} value={s}>{s}</option>)}
                                    <option value="__CUSTOM__" className="text-blue-400 font-bold">+ Other / Type Custom</option>
                                </select>
                            ) : (
                                <input value={streetName} onChange={(e) => setStreetName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="Enter street name" required />
                            )}
                            {isCustomStreetMode && suggestedStreets.length > 0 && <button type="button" onClick={() => setIsCustomStreetMode(false)} className="p-2 bg-gray-700 rounded border border-gray-600 text-gray-300"><RefreshCw size={18}/></button>}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:col-span-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phone</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input 
                          value={phone} 
                          onChange={handlePhoneChange}
                          placeholder="000 000 0000"
                          maxLength={12}
                          className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${
                            phoneError ? 'border-red-500' : 'border-gray-700'
                          }`}
                        />
                      </div>
                      {phoneError && <p className="text-red-400 text-[10px] mt-1">{phoneError}</p>}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Email</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input 
                          type="email"
                          value={email} 
                          onChange={handleEmailChange}
                          onBlur={handleEmailBlur}
                          placeholder="client@example.com"
                          className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${
                            emailError ? 'border-red-500' : 'border-gray-700'
                          }`}
                        />
                      </div>
                      {emailError && <p className="text-red-400 text-[10px] mt-1">{emailError}</p>}
                    </div>
                </div>
              </div>
            </div>

            {/* SERVICES (Lawn Rejuv only) */}
            {seasonType === 'lawn_rejuv' && (
              <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
                <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Services</h3>
                <ServiceToggles services={services} onChange={setServices} />
              </div>
            )}

            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
                <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">
                  {seasonUsesPricingOnlyLabel ? 'Pricing' : 'Services & Pricing'}
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                          Total Amount ($)
                          {seasonUsesPricingOnlyLabel && (
                            <span className="text-gray-600 font-normal ml-1">(Default: $0 for manual)</span>
                          )}
                        </label>
                        <div className="flex gap-2">
                            <input 
                              type="number" 
                              value={isSplitPayment ? getSplitTotal().toFixed(2) : amount} 
                              onChange={(e) => setAmount(e.target.value)} 
                              className={`flex-grow bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400 ${isSplitPayment ? 'opacity-50 cursor-not-allowed' : ''}`} 
                              placeholder="0.00" 
                              step="0.01"
                              disabled={isSplitPayment}
                              readOnly={isSplitPayment}
                            />
                            {!isSplitPayment && (
                              <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>
                            )}
                        </div>
                        {isSplitPayment && (
                          <p className="text-gray-500 text-[10px] mt-1">Total calculated from split amounts</p>
                        )}
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Property Type</label>
                        <div className="flex bg-gray-700 rounded-md border border-gray-600 overflow-hidden">
                            {propertyTypeOptions.map(type => (
                                <button key={type} type="button" onClick={() => setPropertyType(type)} className={`flex-1 py-2 text-xs font-bold transition-colors ${propertyType === type ? 'bg-cps-blue text-white' : 'text-gray-400 hover:bg-gray-600'}`}>{type}</button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Payment & Completion</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                      <select 
                        value={paymentMethod} 
                        onChange={handlePaymentMethodChange} 
                        className={`w-full bg-gray-800 border rounded p-2 text-white ${
                          paymentMethodError ? 'border-red-500' : 'border-gray-700'
                        }`}
                      >
                          <option value="">-- Select Payment --</option>
                          <option value="Cash">Cash</option>
                          <option value="Cheque">Cheque</option>
                          <option value="E-Transfer">E-Transfer</option>
                          <option value="Credit Card">Credit Card</option>
                          <option value="Split Payment">Split Payment</option>
                      </select>
                      {paymentMethodError && <p className="text-red-400 text-[10px] mt-1">{paymentMethodError}</p>}
                      
                      {/* DIRECT UPGRADE BUTTON - Only show if upsells enabled AND region is West AND season is Aeration */}
                      {upsellsEnabled && canShowUpgradeButton && (
                        <button
                          type="button"
                          onClick={() => setShowUpgradeModal(true)}
                          disabled={!canUpgrade}
                          className={`w-full mt-3 py-2 px-4 rounded-md font-bold text-sm flex items-center justify-center gap-2 transition-colors ${
                            canUpgrade 
                              ? 'bg-purple-600 hover:bg-purple-500 text-white border border-purple-500' 
                              : 'bg-gray-700 text-gray-500 border border-gray-600 cursor-not-allowed'
                          }`}
                        >
                          <TrendingUp size={16} />
                          Upgrade Instead
                        </button>
                      )}
                  </div>
                  {paymentMethod === 'E-Transfer' && !isSplitPayment && (
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block flex items-center gap-1">
                          Bank Email
                          <button
                            type="button"
                            onClick={() => setShowEtransferProtocol(true)}
                            className="text-gray-400 hover:text-cps-blue transition-colors"
                            title="View E-Transfer Protocol"
                          >
                            <Info size={12} />
                          </button>
                        </label>
                        <input 
                          type="email" 
                          value={etransferEmail} 
                          onChange={handleEtransferEmailChange}
                          onBlur={handleEtransferEmailBlur}
                          className={`w-full bg-gray-800 border rounded p-2 text-white ${
                            etransferEmailError ? 'border-red-500' : 'border-gray-700'
                          }`}
                          placeholder="client@bank.com" 
                        />
                        {etransferEmailError && <p className="text-red-400 text-[10px] mt-1">{etransferEmailError}</p>}
                      </div>
                  )}
                  {paymentMethod === 'Cheque' && !isSplitPayment && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number (Optional)</label><input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="#001" /></div>
                  )}
              </div>

              {/* SPLIT PAYMENT SECTION */}
              {isSplitPayment && (
                <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-600 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-gray-300">Split Payment Amounts</h4>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-500 uppercase">Total</span>
                      <p className="text-lg font-mono font-bold text-green-400">${getSplitTotal().toFixed(2)}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cash</label>
                      <input 
                        type="number" 
                        value={splitAmounts.cash} 
                        onChange={e => setSplitAmounts({...splitAmounts, cash: e.target.value})}
                        className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" 
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque</label>
                      <input 
                        type="number" 
                        value={splitAmounts.cheque} 
                        onChange={e => setSplitAmounts({...splitAmounts, cheque: e.target.value})}
                        className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" 
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">E-Transfer</label>
                      <input 
                        type="number" 
                        value={splitAmounts.etransfer} 
                        onChange={e => setSplitAmounts({...splitAmounts, etransfer: e.target.value})}
                        onBlur={handleSplitEtransferAmountBlur}
                        className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" 
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Credit Card</label>
                      <input 
                        type="number" 
                        value={splitAmounts.creditCard} 
                        onChange={e => setSplitAmounts({...splitAmounts, creditCard: e.target.value})}
                        className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" 
                        placeholder="0.00"
                        step="0.01"
                      />
                    </div>
                  </div>

                  {/* Conditional fields for split payment */}
                  {hasSplitCheque() && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number</label>
                      <input 
                        value={splitChequeNumber} 
                        onChange={e => setSplitChequeNumber(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white" 
                        placeholder="#001"
                      />
                    </div>
                  )}

                  {hasSplitEtransfer() && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block flex items-center gap-1">
                        E-Transfer Email *
                        <button
                          type="button"
                          onClick={() => setShowEtransferProtocol(true)}
                          className="text-gray-400 hover:text-cps-blue transition-colors"
                          title="View E-Transfer Protocol"
                        >
                          <Info size={12} />
                        </button>
                      </label>
                      <input 
                        type="email"
                        value={splitEtransferEmail} 
                        onChange={handleSplitEtransferEmailChange}
                        onBlur={handleSplitEtransferEmailBlur}
                        className={`w-full bg-gray-700 border rounded p-2 text-white ${
                          splitEtransferEmailError ? 'border-red-500' : 'border-gray-600'
                        }`}
                        placeholder="client@bank.com"
                      />
                      {splitEtransferEmailError && <p className="text-red-400 text-[10px] mt-1">{splitEtransferEmailError}</p>}
                    </div>
                  )}

                  {hasSplitCreditCard() && (
                    <div className={`p-3 rounded border flex items-center justify-between ${splitCcPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                      <div>
                        <span className="text-sm font-medium">{splitCcPaid ? "Card Info Secured" : "Process Credit Card"}</span>
                        <p className="text-[10px] opacity-75">Amount: ${(parseFloat(splitAmounts.creditCard) || 0).toFixed(2)}</p>
                      </div>
                      {splitCcPaid ? (
                        <CheckCircle size={20}/>
                      ) : (
                        <button 
                          type="button" 
                          onClick={() => setShowCreditModal(true)} 
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs font-bold"
                        >
                          Open Terminal
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'Credit Card' && !isSplitPayment && (
                  <div className={`mt-3 p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                      <span className="text-sm font-medium">{isCreditPaid ? "Secured Card Info to HQ" : "Open Terminal to Secure"}</span>
                      {isCreditPaid ? <CheckCircle size={20}/> : <button type="button" onClick={() => setShowCreditModal(true)} className="text-xs underline">Re-open Card Entry</button>}
                  </div>
              )}
            </div>

          </div>
          
          {/* FOOTER ACTIONS — 3 buttons in team seasons (Cancel | Save Pending | Save & Complete),
              2 buttons in Aeration (Cancel | Save & Complete) */}
          <div className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-end gap-3 flex-shrink-0">
              <button type="button" onClick={() => navigate('/logsheet')} className="px-4 py-3 text-gray-400 hover:text-white font-medium" disabled={saving || savingPending}>Cancel</button>

              {/* SAVE PENDING BUTTON — team seasons only.
                  Parks the current form state as a pending sale (creates if new,
                  updates if resuming) without writing a transaction. */}
              {isTeamSeason && (
                <button
                  type="button"
                  onClick={handleSavePending}
                  disabled={saving || savingPending}
                  className="px-5 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-500 text-slate-100 rounded-md font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingPending ? (
                    <>
                      <Loader className="animate-spin" size={16} /> Saving...
                    </>
                  ) : (
                    <>
                      <Bookmark size={16} /> {isResumingPending ? 'Update Pending' : 'Save Pending'}
                    </>
                  )}
                </button>
              )}

              <button 
                type="submit"
                disabled={saving || savingPending || (paymentMethod === 'Credit Card' && !isCreditPaid && !isSplitPayment) || (isSplitPayment && hasSplitCreditCard() && !splitCcPaid)}
                className="px-8 py-3 bg-cps-green hover:bg-green-600 text-white rounded-md font-bold shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader className="animate-spin" size={18} /> Processing...
                  </>
                ) : (
                  <>
                    <Save size={18} /> Save & Complete
                  </>
                )}
              </button>
          </div>
        </form>
      </div>

      {/* Credit Card / Bambora Live Terminal */}
      {showCreditModal && (
        liveCardEnabled ? (
          <BamboraLiveModal
            amount={isSplitPayment ? splitAmounts.creditCard : amount}
            clientName={`${firstName} ${lastName}`}
            onClose={() => setShowCreditModal(false)}
            onProcess={(details) => {
              if (isSplitPayment) {
                setSplitCcPaid(true);
                setSplitCcData({
                  number: `BAMBORA-${details.bamboraTransactionId}`,
                  expiry: details.authCode,
                  cvc: details.last4,
                });
              } else {
                setIsCreditPaid(true);
                setCcData({
                  number: `BAMBORA-${details.bamboraTransactionId}`,
                  expiry: details.authCode,
                  cvc: details.last4,
                });
              }
              setShowCreditModal(false);
            }}
          />
        ) : (
          <CreditCardModal 
            amount={isSplitPayment ? splitAmounts.creditCard : amount} 
            clientName={`${firstName} ${lastName}`} 
            onClose={() => setShowCreditModal(false)} 
            onProcess={(details) => { 
              if (isSplitPayment) {
                setSplitCcPaid(true);
                setSplitCcData({
                  number: details.number,
                  expiry: details.expiry,
                  cvc: details.cvc
                });
              } else {
                setIsCreditPaid(true); 
                setCcData({
                  number: details.number,
                  expiry: details.expiry,
                  cvc: details.cvc
                });
              }
              setShowCreditModal(false); 
            }} 
          />
        )
      )}

      {/* DIRECT UPGRADE MODAL */}
      {showUpgradeModal && (
        <AddContractModal
          onClose={() => setShowUpgradeModal(false)}
          directUpgradeClient={getUpgradeClientData()}
          onSuccess={() => navigate('/logsheet')}
        />
      )}

      {/* E-Transfer Protocol Modal */}
      <EtransferProtocolModal
        isOpen={showEtransferProtocol}
        onClose={() => setShowEtransferProtocol(false)}
        customerAddress={getCustomerAddress()}
        contractorFirstName={worker?.firstName || ''}
        contractorLastName={worker?.lastName || ''}
      />
    </div>
  );
};

export default NewJob;