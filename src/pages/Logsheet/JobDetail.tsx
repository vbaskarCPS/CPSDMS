// src/pages/Logsheet/JobDetail.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, X, CheckCircle2, Ban, Lock,
  Loader, CheckCircle, FileText, TrendingUp, DollarSign, GraduationCap, Info, Shovel, Droplets
} from 'lucide-react';
import { sessionService, AsphaltCompletionContext } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { commandCenterService, getTaxRateForRegion, Region } from '../../lib/commandCenterService';
import { getStorageItem } from '../../lib/localStorage';
import {
  Worker,
  MasterBooking,
  SessionTransaction,
  SeasonType,
  ServiceFlags,
  SERVICE_FLAG_KEYS,
  SERVICE_FLAG_LABELS,
  RAMP_CREW_TEAM_ID_PATTERN,
} from '../../types';
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

// --- HELPER: RC detection (local, case-sensitive match on Worker.teamId) ---
// Matches 'RC', 'RC1', 'RC2', 'RC10', ... case-sensitively. Uses the regex
// from types/index.ts so we don't rely on a separate service import.
function isRC(teamId: string | undefined | null): boolean {
  if (!teamId) return false;
  return RAMP_CREW_TEAM_ID_PATTERN.test(teamId);
}

// --- HELPER: Get the property type button list for a given season ---
// Aeration & Lawn Rejuv use FP/FO/BO. Sealing uses SS/SSP (Ramp is in the enum
// but reserved for the asphalt add-on workflow's child row display on export).
// TODO: When Central 'cleaning' season ships, add its property types here.
function getPropertyTypesForSeason(seasonType: SeasonType): string[] {
  if (seasonType === 'sealing') return ['SS', 'SSP'];
  if (seasonType === 'cleaning') return ['WW', 'WW+'];
  return ['FP', 'FO', 'BO'];
}

// --- HELPER: Get the default property type for a given season ---
function getDefaultPropertyTypeForSeason(seasonType: SeasonType): string {
  if (seasonType === 'sealing') return 'SS';
  if (seasonType === 'cleaning') return 'WW';
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
  aeration:   { active: 'bg-blue-600 border-blue-500 text-white',     inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-blue-500' },
  dethatch:   { active: 'bg-orange-600 border-orange-500 text-white', inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-orange-500' },
  fertilizer: { active: 'bg-green-600 border-green-500 text-white',   inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-green-500' },
  seed:       { active: 'bg-yellow-600 border-yellow-500 text-white', inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-yellow-500' },
  lime:       { active: 'bg-purple-600 border-purple-500 text-white', inactive: 'bg-gray-700 border-gray-600 text-gray-400 hover:border-purple-500' },
};

// --- SERVICE TOGGLES COMPONENT (Lawn Rejuv only) ---
const ServiceToggles: React.FC<{
  services: ServiceFlags;
  onChange: (services: ServiceFlags) => void;
  disabled?: boolean;
}> = ({ services, onChange, disabled = false }) => {
  const toggleService = (key: keyof ServiceFlags) => {
    if (disabled) return;
    onChange({ ...services, [key]: !services[key] });
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-gray-500 uppercase block">Services Performed</label>
      <div className="flex flex-wrap gap-2">
        {SERVICE_FLAG_KEYS.map((key) => {
          const isActive = services[key];
          const colors = SERVICE_TOGGLE_COLORS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleService(key)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded border-2 font-bold text-xs transition-all ${isActive ? colors.active : colors.inactive} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {SERVICE_FLAG_LABELS[key].short} - {SERVICE_FLAG_LABELS[key].full}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const JobDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  // --- STATE ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [originalJob, setOriginalJob] = useState<MasterBooking | null>(null);
  const [region, setRegion] = useState<Region>('West');
  const [taxRate, setTaxRate] = useState(5);

  // Training mode state
  const [isTrainingMode, setIsTrainingMode] = useState(false);

  // Season type state (supports aeration | lawn_rejuv | sealing)
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');

  // Live Card Processing flag (production only, stays false in training)
  const [liveCardEnabled, setLiveCardEnabled] = useState(false);

  // Form Fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [officeNotes, setOfficeNotes] = useState('');
  const [price, setPrice] = useState<string | number>('0.00');
  const [propertyType, setPropertyType] = useState('FP');
  const [routeNumber, setRouteNumber] = useState('');

  // Service Flags (Lawn Rejuv only)
  const [services, setServices] = useState<ServiceFlags>({
    aeration: false, dethatch: false, fertilizer: false, seed: false, lime: false,
  });

  // Payment - Default to empty string to force selection
  const [paymentMethod, setPaymentMethod] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [etransferEmail, setEtransferEmail] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [ccData, setCcData] = useState<any>(null);

  // Split Payment State
  const [splitCash, setSplitCash] = useState('');
  const [splitCheque, setSplitCheque] = useState('');
  const [splitEtransfer, setSplitEtransfer] = useState('');
  const [splitCreditCard, setSplitCreditCard] = useState('');
  const [splitEtransferEmail, setSplitEtransferEmail] = useState('');
  const [splitChequeNumber, setSplitChequeNumber] = useState('');

  // Modals
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showEtransferProtocol, setShowEtransferProtocol] = useState(false);

  // Upsells enabled state
  const [upsellsEnabled, setUpsellsEnabled] = useState(true);

  // --- ASPHALT STATE (Sealing season only) ---
  // Worker-toggled. When on, an asphalt component is being sold alongside the
  // office booking's driveway portion. handleSave routes through
  // sessionService.completeJob with an AsphaltCompletionContext.
  //
  // JobDetail only ever resolves to ONE of two modes:
  //   - isRampCrew=true  → 'self-both'         (RC sells + executes everything)
  //   - isRampCrew=false → 'driveway-deferred' (cart writes driveway tx; asphalt
  //                                              child pending row created for RM queue)
  // The other two modes ('completer-with-phantom' / 'asphalt-executor-only')
  // arise from resuming pending sales, which JobDetail doesn't do.
  const [asphaltEnabled, setAsphaltEnabled] = useState(false);
  const [asphaltAmount, setAsphaltAmount] = useState('');
  const [upsoldAsphaltAmount, setUpsoldAsphaltAmount] = useState('');

  // RC detection — Worker.teamId matches /^RC\d*$/ case-sensitively.
  // Drives Upsold field visibility and mode resolution.
  const [isRampCrew, setIsRampCrew] = useState(false);

  // Validation Errors
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [etransferEmailError, setEtransferEmailError] = useState<string | null>(null);
  const [splitEtransferEmailError, setSplitEtransferEmailError] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  // --- COMPUTED FLAGS ---
  const isSplitPayment = paymentMethod === 'Split Payment';

  const splitTotal =
    (parseFloat(splitCash) || 0) +
    (parseFloat(splitCheque) || 0) +
    (parseFloat(splitEtransfer) || 0) +
    (parseFloat(splitCreditCard) || 0);

  const splitCCAmount = parseFloat(splitCreditCard) || 0;
  const splitCCNeedsProcessing = splitCCAmount > 0 && !isCreditPaid;

  const canShowUpgradeButton = region === 'West' && seasonType === 'aeration';
  const propertyTypeOptions = getPropertyTypesForSeason(seasonType);

  const isSealingSeason = seasonType === 'sealing' && !isTrainingMode;

  // Prepaid detection — used to block asphalt toggle (prepaid driveway + on-site
  // cash asphalt would need a mixed payment breakdown that the current single-
  // method form doesn't cleanly support; block it rather than ship half-working math).
  const isPrepaid = originalJob?.Prepaid === 'x';

  // Already-upgrade detection — Aeration West only (SP/RJ/GF). Doesn't intersect
  // with sealing, but included in the asphalt toggle's gating for symmetry.
  const isAlreadyUpgrade = (() => {
    const priceStr = String(originalJob?.Price || '').toUpperCase();
    return priceStr.startsWith('SP') || priceStr.startsWith('RJ') || priceStr.startsWith('GF');
  })();

  // The asphalt toggle is visible only when ALL the following hold:
  //   - sealing season
  //   - not training mode
  //   - job is not already completed (would be read-only)
  //   - job is not already an upgrade
  // (When isPrepaid, the toggle is still SHOWN but DISABLED with an explanation.)
  const canShowAsphaltToggle = isSealingSeason && !isReadOnly && !isAlreadyUpgrade;
  const isAsphaltToggleDisabled = isPrepaid;
  const canShowUpsoldField = asphaltEnabled && isRampCrew;

  // --- COMPUTED: Get customer address for E-Transfer protocol ---
  const getCustomerAddress = (): string => `${houseNumber} ${streetName}`.trim();

  // --- HANDLERS FOR NAME FIELDS ---
  const handleFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => setFirstName(capitalizeWords(e.target.value));
  const handleLastNameChange  = (e: React.ChangeEvent<HTMLInputElement>) => setLastName(capitalizeWords(e.target.value));

  // --- HANDLERS FOR PHONE & EMAIL ---
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneNumber(e.target.value));
    setPhoneError(null);
  };
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setEmailError(null);
  };
  const handleEmailBlur = () => { if (email) setEmail(normalizeEmail(email)); };
  const handleEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEtransferEmail(e.target.value);
    setEtransferEmailError(null);
  };
  const handleEtransferEmailBlur = () => { if (etransferEmail) setEtransferEmail(normalizeEmail(etransferEmail)); };

  const handleSplitEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSplitEtransferEmail(e.target.value);
    setSplitEtransferEmailError(null);
  };
  const handleSplitEtransferEmailBlur = () => { if (splitEtransferEmail) setSplitEtransferEmail(normalizeEmail(splitEtransferEmail)); };

  const handleSplitEtransferAmountBlur = () => {
    const amount = parseFloat(splitEtransfer) || 0;
    if (amount > 0) {
      if (!splitEtransferEmail && email) setSplitEtransferEmail(email);
      setShowEtransferProtocol(true);
    }
  };

  // --- HANDLER FOR PAYMENT METHOD ---
  const handlePaymentMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setPaymentMethod(value);
    setPaymentMethodError(null);

    if (value !== 'Split Payment') {
      setSplitCash(''); setSplitCheque(''); setSplitEtransfer(''); setSplitCreditCard('');
      setSplitEtransferEmail(''); setSplitChequeNumber('');
    }

    if (value !== 'Credit Card' && value !== 'Split Payment') {
      setIsCreditPaid(false);
      setCcData(null);
    }

    if (value === 'Credit Card') setShowCreditModal(true);

    if (value === 'E-Transfer') {
      if (!etransferEmail && email) setEtransferEmail(email);
      setShowEtransferProtocol(true);
    }
  };

  // --- ASPHALT TOGGLE HANDLER ---
  // Off-state clears amounts so a non-submitted toggle-on→off cycle doesn't
  // leak stale values. On-state leaves them alone.
  const handleAsphaltToggleChange = (next: boolean) => {
    if (isAsphaltToggleDisabled) return;
    setAsphaltEnabled(next);
    if (!next) {
      setAsphaltAmount('');
      setUpsoldAsphaltAmount('');
    }
  };

  // --- ASPHALT TOTAL HELPER ---
  // Computes the customer-facing collected total when asphalt is on.
  // Used for the "Total Collected" display in the asphalt section and (in
  // non-split mode) as transactionPrice on the tx.
  //
  // For JobDetail (no asphalt-executor-only mode):
  //   self-both (RC):              driveway + asphalt + upsold
  //   driveway-deferred (non-RC):  driveway + asphalt   (no upsold — RC-only)
  const computeAsphaltTotalCollected = (): number => {
    if (!asphaltEnabled) return 0;
    const D = parseFloat(price.toString().replace(/[^0-9.]/g, '')) || 0;
    const A = parseFloat(asphaltAmount) || 0;
    const U = isRampCrew ? (parseFloat(upsoldAsphaltAmount) || 0) : 0;
    return Math.round((D + A + U) * 100) / 100;
  };

  // --- INITIALIZATION ---
  useEffect(() => {
    const init = async () => {
      // Check training mode
      const trainingMode = trainingService.isTrainingMode();
      setIsTrainingMode(trainingMode);

      const w = getStorageItem<Worker | null>('current_user', null);
      if (!w || !jobId) {
        navigate('/');
        return;
      }
      setWorker(w);

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

        // RC detection — case-sensitive teamId match. Never RC in training mode.
        setIsRampCrew(isRC(w.teamId));
      }

      const decodedId = decodeURIComponent(jobId);

      try {
        const service = trainingMode ? trainingService : sessionService;
        const allJobs = await service.getWorkerAssignments(w.contractorId);
        const foundJob = allJobs.find((j) => j['Booking ID'] === decodedId);

        if (foundJob) {
          setOriginalJob(foundJob);
          setIsReadOnly(foundJob.Status === 'completed' || foundJob.Completed === 'x');
          // Determine season for loadFormData defaults
          const seasonForLoad = trainingMode
            ? 'aeration'
            : (await sessionService.getSessionSeasonType().catch(() => 'aeration')) as SeasonType;
          loadFormData(foundJob, seasonForLoad);

          // Fetch upsellsEnabled status
          const upsellStatus = trainingMode
            ? await trainingService.getWorkerUpsellsEnabled(w.contractorId)
            : await sessionService.getWorkerUpsellsEnabled(w.contractorId);
          setUpsellsEnabled(upsellStatus);
        } else {
          console.warn("Job ID not found in assignments:", decodedId);
          alert('Job not found.');
          navigate('/logsheet');
        }
      } catch (err) {
        console.error("Error loading job:", err);
        alert('Failed to load job details.');
        navigate('/logsheet');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [jobId, navigate]);

  const loadFormData = (job: MasterBooking, currentSeasonType: SeasonType = 'aeration') => {
    const fullAddr = job['Full Address'] || '';
    let hNum = job['House Number'] || '';
    let sName = job['Street Name'] || '';

    if (!hNum || !sName) {
      const parts = fullAddr.split(' ');
      if (parts.length > 1 && /^\d+$/.test(parts[0])) {
        hNum = parts[0];
        sName = parts.slice(1).join(' ');
      } else {
        sName = fullAddr;
      }
    }

    setFirstName(job['First Name'] || '');
    setLastName(job['Last Name'] || '');
    setHouseNumber(hNum);
    setStreetName(sName);
    setPhone(formatPhoneNumber(job['Home Phone'] || job['Cell Phone'] || ''));
    setEmail(normalizeEmail(job['Email Address'] || ''));
    setRouteNumber(job['Route Number'] || '');
    setOfficeNotes(job['Log Sheet Notes'] || '');
    setPrice(job.Price || '0.00');

    // Set payment method: Prepaid if prepaid, otherwise blank to force selection
    if (job.Prepaid === 'x') {
      setPaymentMethod('Prepaid');
    } else {
      setPaymentMethod('');
    }

    // Property type — default depends on season (Sealing → 'SS', else → 'FP')
    setPropertyType(job['FO/BO/FP'] || getDefaultPropertyTypeForSeason(currentSeasonType));

    // Load service flags if present (Lawn Rejuv)
    if (job.services) {
      setServices(job.services);
    }

    // Restore payment details if available
    if ((job as any).invoiceNumber) setInvoiceNumber((job as any).invoiceNumber);
    if ((job as any).chequeNumber) setChequeNumber((job as any).chequeNumber);
    if ((job as any).etransferEmail) setEtransferEmail(normalizeEmail((job as any).etransferEmail));
  };

  // Determine if upgrade button should be enabled (West only, Aeration season, with other conditions)
  const canUpgrade = !isReadOnly &&
                     !isAlreadyUpgrade &&
                     upsellsEnabled &&
                     canShowUpgradeButton &&
                     firstName.trim() !== '' &&
                     lastName.trim() !== '' &&
                     houseNumber.trim() !== '' &&
                     streetName.trim() !== '';

  const handleTaxClick = () => {
    if (isPrepaid || isReadOnly) return;
    const current = parseFloat(price.toString());
    if (isNaN(current)) return;
    const taxMultiplier = 1 + (taxRate / 100);
    const total = Math.round(current * taxMultiplier * 100) / 100;
    setPrice(total.toFixed(2));
  };

  // --- RESOLVE ASPHALT COMPLETION CONTEXT ---
  // JobDetail's mode resolver — only TWO cases (vs. NewJob's eight, since there
  // is no resume path here):
  //
  //   Case A: RC + asphalt          → self-both
  //   Case B: Non-RC + asphalt      → driveway-deferred (creates asphalt child
  //                                                       pending row for the RM queue)
  //
  // Returns undefined when asphalt is off (so completeJob runs through its
  // normal path). Throws on invalid inputs with user-facing messages.
  const resolveAsphaltContext = (currentSessionId: string, drivewayAmt: number): AsphaltCompletionContext | undefined => {
    if (!asphaltEnabled) return undefined;
    if (!worker || !originalJob) throw new Error('No worker/job context.');

    const asphaltAmt = Math.round((parseFloat(asphaltAmount) || 0) * 100) / 100;
    const upsoldAmt = isRampCrew
      ? Math.round((parseFloat(upsoldAsphaltAmount) || 0) * 100) / 100
      : 0;

    if (asphaltAmt <= 0) {
      throw new Error('Asphalt amount must be greater than zero.');
    }

    // Case A — RC fires self-both. Single tx covers everything.
    if (isRampCrew) {
      return {
        mode: 'self-both',
        completerRole: 'self-both',
        drivewayAmount: drivewayAmt,
        asphaltAmount: asphaltAmt,
        upsoldAmount: upsoldAmt,
      };
    }

    // Case B — Non-RC fires driveway-deferred. Cart writes the driveway tx; an
    // asphalt child pending row is created atomically with sharedJobKey set on
    // the cart's tx + the child. RC picks it up later via NewJob's
    // asphalt-executor-only mode.
    //
    // Office notes flow through to the child's notes so the RC sees context
    // when they pick up the asphalt later.
    return {
      mode: 'driveway-deferred',
      completerRole: 'driveway-seller',
      drivewayAmount: drivewayAmt,
      asphaltAmount: asphaltAmt,
      upsoldAmount: 0,
      childPending: {
        sessionId: currentSessionId,
        workerId: worker.contractorId,
        routeCode: routeNumber || undefined,
        houseNumber: houseNumber.trim() || undefined,
        streetName: streetName.trim() || undefined,
        propertyType: propertyType || undefined,
        notes: officeNotes || undefined,
      },
    };
  };

  const handleSave = async () => {
    if (!worker || !originalJob) return;

    if (saving) return;

    // --- VALIDATION ---
    const pError = getPhoneValidationError(phone);
    const eError = getEmailValidationError(email);

    let etError: string | null = null;
    let splitEtError: string | null = null;

    if (isSplitPayment) {
      if ((parseFloat(splitEtransfer) || 0) > 0) {
        splitEtError = getEmailValidationError(splitEtransferEmail);
      }
    } else {
      etError = paymentMethod === 'E-Transfer' ? getEmailValidationError(etransferEmail) : null;
    }

    const pmError = !isPrepaid && !paymentMethod ? 'Please select a payment method' : null;

    if (isSplitPayment && splitTotal <= 0) {
      setPhoneError(pError);
      setEmailError(eError);
      setPaymentMethodError('Please enter at least one split payment amount.');
      return;
    }

    if (seasonType === 'lawn_rejuv') {
      const hasService = SERVICE_FLAG_KEYS.some(k => services[k]);
      if (!hasService) {
        alert('Please select at least one service');
        return;
      }
    }

    // Asphalt validation — amount must be > 0 when toggle is on.
    if (asphaltEnabled) {
      const asphaltVal = parseFloat(asphaltAmount) || 0;
      if (asphaltVal <= 0) {
        alert('Please enter an asphalt amount greater than zero.');
        return;
      }
      // Defensive: shouldn't be reachable since the toggle is disabled on
      // prepaid bookings, but block here too in case the worker forces it.
      if (isPrepaid) {
        alert('Asphalt cannot be added to a prepaid booking. Please contact your manager.');
        return;
      }
    }

    if (pError || eError || etError || splitEtError || pmError) {
      setPhoneError(pError);
      setEmailError(eError);
      setEtransferEmailError(etError);
      setSplitEtransferEmailError(splitEtError);
      setPaymentMethodError(pmError);
      return;
    }

    setSaving(true);

    try {
      // Determine driveway price (the office's nominal $ for the driveway portion).
      // This goes into the asphalt context as drivewayAmount and feeds the
      // transaction.price calculation.
      let drivewayPriceVal: number;
      let rawPrice: string;

      rawPrice = (price || '').toString().trim().toUpperCase();
      drivewayPriceVal = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;

      // Map office flat codes to their dollar values (Aeration/Rejuv codes only;
      // Sealing has no office flats so this is a no-op for asphalt jobs).
      if (rawPrice.startsWith('RJ') || rawPrice.startsWith('SP')) {
        drivewayPriceVal = 52.5;
      } else if (rawPrice.startsWith('FSL')) {
        drivewayPriceVal = 157.5;
      }

      // --- ASPHALT MODE RESOLUTION ---
      // Resolve the completion context BEFORE assembling the transaction so we
      // know how to size price and breakdown. Returns undefined when asphalt
      // is off (so completeJob runs its normal path).
      let asphaltContext: AsphaltCompletionContext | undefined;

      // Resolve the active session id first (needed by driveway-deferred mode
      // to attach the new child pending row to the right cart).
      const service = isTrainingMode ? trainingService : sessionService;
      let activeSessionForAsphalt = await service.getActiveLogsheetSession(worker.contractorId);
      if (!activeSessionForAsphalt) {
        activeSessionForAsphalt = await service.startLogsheetSession(worker.contractorId);
      }

      try {
        asphaltContext = resolveAsphaltContext(activeSessionForAsphalt.id, drivewayPriceVal);
      } catch (resolveErr: any) {
        alert(resolveErr?.message || 'Could not determine asphalt mode.');
        setSaving(false);
        return;
      }

      // Final price and payment info.
      let priceVal: number;
      let finalPaymentMethod: string;
      let paymentBreakdown: Record<string, number> | undefined;

      if (isSplitPayment) {
        priceVal = Math.round(splitTotal * 100) / 100;
        finalPaymentMethod = 'Split';
        rawPrice = priceVal.toFixed(2);

        paymentBreakdown = {};
        if ((parseFloat(splitCash) || 0) > 0) paymentBreakdown['Cash'] = parseFloat(splitCash);
        if ((parseFloat(splitCheque) || 0) > 0) paymentBreakdown['Cheque'] = parseFloat(splitCheque);
        if ((parseFloat(splitEtransfer) || 0) > 0) paymentBreakdown['E-Transfer'] = parseFloat(splitEtransfer);
        if ((parseFloat(splitCreditCard) || 0) > 0) paymentBreakdown['Credit Card'] = parseFloat(splitCreditCard);
      } else {
        // Non-split. With asphalt on, price is the total collected (driveway +
        // asphalt + upsold). Without asphalt, price is the office's $ value.
        if (asphaltContext) {
          priceVal = computeAsphaltTotalCollected();
          rawPrice = priceVal.toFixed(2);
        } else {
          priceVal = drivewayPriceVal;
        }

        finalPaymentMethod = isPrepaid ? 'Prepaid' : paymentMethod;

        // For asphalt completions, materialise paymentBreakdown explicitly so
        // exportService's Path 3 dual-breakdown branch reliably uses it.
        // Single-method case → one entry: { [paymentMethod]: total }.
        if (asphaltContext) {
          paymentBreakdown = { [finalPaymentMethod]: priceVal };
        }
      }

      const fullAddress = `${houseNumber} ${streetName}`.trim();
      const newTxId = generateUUID();
      const itemName = getItemNameForSeason(seasonType);

      const tx: SessionTransaction = {
        id: newTxId,
        jobId: originalJob['Booking ID'],
        timestamp: new Date().toISOString(),
        customerId: originalJob['Booking ID'],
        customerName: `${firstName} ${lastName}`,
        address: fullAddress,
        customerPhone: phone,
        customerEmail: email,
        workerId: worker.contractorId,
        workerName: worker.firstName,
        routeManagerName: 'RM',
        routeCode: routeNumber,
        type: 'Production',
        price: priceVal,
        displayPrice: rawPrice,
        isPaid: finalPaymentMethod !== 'Billed',
        paymentMethod: finalPaymentMethod,
        paymentBreakdown: paymentBreakdown,

        invoiceNumber: paymentMethod === 'Billed' ? invoiceNumber : undefined,

        // For regular E-Transfer or Split with E-Transfer
        etransferEmail: isSplitPayment
          ? ((parseFloat(splitEtransfer) || 0) > 0 ? splitEtransferEmail : undefined)
          : (paymentMethod === 'E-Transfer' ? etransferEmail : undefined),

        // For regular Cheque or Split with Cheque
        chequeNumber: isSplitPayment
          ? ((parseFloat(splitCheque) || 0) > 0 ? splitChequeNumber : undefined)
          : (paymentMethod === 'Cheque' ? chequeNumber : undefined),

        ccFullNumber: ccData?.number,
        ccExpiry: ccData?.expiry,
        ccCVC: ccData?.cvc,
        items: [{ name: itemName, price: priceVal }],
        itemDescription: officeNotes,
        region: region,
        seasonId: buildSeasonId(region, seasonType),
        isWestSplit: false,
        serviceType: propertyType as any,

        // Include services for Lawn Rejuv season
        services: seasonType === 'lawn_rejuv' ? services : undefined,
      } as any;

      // ASPHALT BRANCH: when asphaltContext is set, completeJob delegates to
      // completeAsphaltJob, which writes the cart's tx + (for driveway-deferred)
      // creates the asphalt child pending row atomically. trainingService doesn't
      // support asphalt — but training is always Aeration, so asphaltContext will
      // always be undefined in training and we route through the legacy call.
      if (isTrainingMode) {
        await service.completeJob(tx, originalJob['Booking ID'], worker.contractorId);
      } else {
        await sessionService.completeJob(
          tx,
          originalJob['Booking ID'],
          worker.contractorId,
          undefined,         // teamWorkerIds — unchanged
          undefined,         // pendingSaleId — not applicable (JobDetail handles office bookings, not pending sales)
          asphaltContext,    // 2-case asphalt union (or undefined for non-asphalt completion)
        );
      }

      const session = await service.getActiveLogsheetSession(worker.contractorId);
      if (session) {
        const newStats = service.recalculateStats(session.financialStore, taxRate);
        await service.updateLogsheetSession(session.id, { stats: newStats });
      }

      navigate('/logsheet');
    } catch (err) {
      console.error(err);
      alert('Failed to save job. Please try again.');
      setSaving(false);
    }
  };

  const handleCancel = async (status: 'next_time' | 'cancelled') => {
    if (!originalJob) return;

    setLoading(true);
    try {
      const service = isTrainingMode ? trainingService : sessionService;
      await service.updateBookingStatus(originalJob['Booking ID'], status);
      navigate('/logsheet');
    } catch (err) {
      console.error('Failed to update booking status:', err);
      alert('Failed to update status. Please try again.');
      setLoading(false);
    }
  };

  // Build the MasterBooking object for direct upgrade
  const getUpgradeBooking = (): MasterBooking => {
    return {
      ...originalJob,
      'Booking ID': originalJob?.['Booking ID'] || '',
      'First Name': firstName,
      'Last Name': lastName,
      'Full Address': `${houseNumber} ${streetName}`.trim(),
      'House Number': houseNumber,
      'Street Name': streetName,
      'Home Phone': phone,
      'Cell Phone': phone,
      'Email Address': email,
      'Route Number': routeNumber,
      'FO/BO/FP': propertyType,
      'Price': price,
      'Prepaid': originalJob?.Prepaid,
    } as MasterBooking;
  };

  if (loading) return <div className="h-screen bg-black flex items-center justify-center"><Loader className="text-cps-blue animate-spin" /></div>;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">

        {/* HEADER */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-3">
              <button onClick={() => navigate('/logsheet')} className="p-1 hover:bg-gray-700 rounded text-gray-400" disabled={saving}><ArrowLeft size={20} /></button>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white">Job Details</h2>
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
                  {seasonType === 'cleaning' && (
                    <span className="bg-cyan-900/30 text-cyan-300 text-[10px] px-1.5 py-0.5 rounded border border-cyan-700 flex items-center gap-1">
                      <Droplets size={10}/> CLEANING
                    </span>
                  )}
                  {/* RC pill — sealing only, non-training. Drives Upsold field + self-both mode. */}
                  {isRampCrew && isSealingSeason && (
                    <span className="bg-amber-900/30 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-700">
                      RAMP CREW
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">{originalJob?.['Booking ID']}</p>
              </div>
              {isReadOnly && <span className="bg-blue-900/30 text-blue-300 text-xs px-2 py-0.5 rounded border border-blue-800 flex items-center gap-1"><Lock size={10}/> Completed</span>}
          </div>
          <button onClick={() => navigate('/logsheet')} className="text-gray-400 hover:text-white" disabled={saving}><X size={24}/></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-6 flex-grow custom-scrollbar">
           {/* CLIENT DETAILS */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Client Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                      <input value={routeNumber} disabled className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono opacity-50 cursor-not-allowed"/>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">First Name</label><input value={firstName} onChange={handleFirstNameChange} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Last Name</label><input value={lastName} onChange={handleLastNameChange} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                  </div>
                  <div className="md:col-span-3 grid grid-cols-4 gap-4">
                      <div className="col-span-1"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">House #</label><input value={houseNumber} onChange={e => setHouseNumber(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                      <div className="col-span-3"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Street Name</label><input value={streetName} onChange={e => setStreetName(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:col-span-3">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phone</label>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                          <input
                            value={phone}
                            onChange={handlePhoneChange}
                            disabled={isReadOnly}
                            placeholder="000 000 0000"
                            maxLength={12}
                            className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${phoneError ? 'border-red-500' : 'border-gray-700'}`}
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
                            disabled={isReadOnly}
                            placeholder="client@example.com"
                            className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${emailError ? 'border-red-500' : 'border-gray-700'}`}
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
               <ServiceToggles
                 services={services}
                 onChange={setServices}
                 disabled={isReadOnly}
               />
             </div>
           )}

           {/* SERVICES & PRICING */}
           <div className={`bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 ${isReadOnly ? 'opacity-75' : ''}`}>
               <div className="flex justify-between items-center mb-3">
                   <h3 className="text-sm font-bold text-gray-300 uppercase">
                   {(seasonType === 'lawn_rejuv' || seasonType === 'sealing' || seasonType === 'cleaning') ? 'Pricing' : 'Services & Pricing'}
                   </h3>
                   {isReadOnly && <span className="text-xs text-blue-300 flex items-center gap-1"><Lock size={10}/> Locked</span>}
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                        {asphaltEnabled ? 'Driveway Amount ($)' : 'Total Amount ($)'}
                      </label>
                      <div className="flex gap-2">
                          <input
                            type="text"
                            value={isSplitPayment ? splitTotal.toFixed(2) : price}
                            onChange={e => setPrice(e.target.value)}
                            className={`flex-grow bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400 outline-none ${(isPrepaid || isReadOnly || isSplitPayment) ? 'cursor-not-allowed opacity-50' : ''}`}
                            disabled={isPrepaid || isReadOnly || isSplitPayment}
                          />
                          {!isPrepaid && !isReadOnly && !isSplitPayment && <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>}
                      </div>
                      {isSplitPayment && <p className="text-[10px] text-gray-500 mt-1">Total calculated from split amounts</p>}
                  </div>
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Property Type</label>
                      <div className="flex bg-gray-700 rounded-md border border-gray-600 overflow-hidden">
                          {propertyTypeOptions.map(t => (
                              <button key={t} onClick={() => setPropertyType(t)} className={`flex-1 py-2 text-xs font-bold transition-colors ${propertyType === t ? 'bg-cps-blue text-white' : 'text-gray-400 hover:bg-gray-600'}`} disabled={isReadOnly}>{t}</button>
                          ))}
                      </div>
                  </div>
               </div>
           </div>

           {/* ASPHALT SECTION (Sealing only) — toggle + amount + RC-only upsold.
               Hidden outside sealing, in training mode, when read-only, or when
               the booking is already an upgrade. Toggle is DISABLED (visible) on
               prepaid bookings with an explanatory tooltip. */}
           {canShowAsphaltToggle && (
             <div className="bg-gray-900/30 p-4 rounded-lg border border-slate-700/50">
               <div className="flex items-center justify-between mb-3">
                 <div className="flex items-center gap-2">
                   <Shovel size={16} className="text-slate-300" />
                   <h3 className="text-sm font-bold text-gray-300 uppercase">Asphalt Add-On</h3>
                   {isAsphaltToggleDisabled && (
                     <span className="text-[10px] text-amber-400 font-bold" title="Asphalt cannot be added to a prepaid booking">
                       N/A — PREPAID
                     </span>
                   )}
                 </div>
                 <label className={`relative inline-flex items-center ${isAsphaltToggleDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                   <input
                     type="checkbox"
                     checked={asphaltEnabled}
                     onChange={(e) => handleAsphaltToggleChange(e.target.checked)}
                     disabled={isAsphaltToggleDisabled}
                     className="sr-only peer"
                   />
                   <div className={`w-11 h-6 bg-gray-700 rounded-full peer-checked:bg-slate-500 transition-colors relative ${isAsphaltToggleDisabled ? 'opacity-60' : ''}`}>
                     <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${asphaltEnabled ? 'translate-x-5' : ''}`}></span>
                   </div>
                 </label>
               </div>

               {isAsphaltToggleDisabled && (
                 <p className="text-[11px] text-amber-400/80 mt-1">
                   This booking is already prepaid for the driveway portion. Asphalt cannot be added here.
                   Contact your manager if asphalt is required for this address.
                 </p>
               )}

               {asphaltEnabled && (
                 <div className="space-y-3 mt-3">
                   <p className="text-[11px] text-gray-400">
                     Asphalt component added alongside the driveway sale.
                     {isRampCrew
                       ? ' You will execute the asphalt yourself (single transaction).'
                       : ' The Ramp Crew will be assigned to execute the asphalt portion later.'}
                   </p>

                   <div className={`grid gap-3 ${canShowUpsoldField ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                     <div>
                       <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">
                         Asphalt Amount ($)
                       </label>
                       <input
                         type="number"
                         value={asphaltAmount}
                         onChange={(e) => setAsphaltAmount(e.target.value)}
                         className="w-full bg-gray-800 border border-slate-700 rounded p-2 text-lg font-mono font-bold text-slate-200"
                         placeholder="0.00"
                         step="0.01"
                       />
                     </div>

                     {canShowUpsoldField && (
                       <div>
                         <label className="text-[10px] font-bold text-amber-400 uppercase mb-1 block">
                           Upsold by RC ($)
                         </label>
                         <input
                           type="number"
                           value={upsoldAsphaltAmount}
                           onChange={(e) => setUpsoldAsphaltAmount(e.target.value)}
                           className="w-full bg-gray-800 border border-amber-700/50 rounded p-2 text-lg font-mono font-bold text-amber-300"
                           placeholder="0.00"
                           step="0.01"
                         />
                         <p className="text-gray-500 text-[10px] mt-1">Additional amount added on-site (optional)</p>
                       </div>
                     )}
                   </div>

                   {/* Total Collected display — what will be recorded as collected cash this completion */}
                   {!isSplitPayment && (
                     <div className="flex justify-between items-center bg-gray-800/60 border border-slate-700/40 rounded p-2">
                       <span className="text-[10px] font-bold text-gray-400 uppercase">Total Collected (this completion)</span>
                       <span className="text-lg font-mono font-bold text-green-400">
                         ${computeAsphaltTotalCollected().toFixed(2)}
                       </span>
                     </div>
                   )}
                 </div>
               )}
             </div>
           )}

           {/* NOTES */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
               <h3 className="text-sm font-bold text-gray-300 uppercase mb-2 flex items-center gap-2"><FileText size={16}/> Office Notes (Read Only)</h3>
               <div className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-sm text-yellow-100/90 italic min-h-[3rem] whitespace-pre-wrap">{officeNotes || "No notes provided."}</div>
           </div>

           {/* COMPLETION */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
               <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Completion</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                      <select
                        value={paymentMethod}
                        onChange={handlePaymentMethodChange}
                        className={`w-full bg-gray-800 border rounded p-2 text-white outline-none ${(isPrepaid || isReadOnly) ? 'cursor-not-allowed opacity-50' : ''} ${paymentMethodError ? 'border-red-500' : 'border-gray-700'}`}
                        disabled={isPrepaid || isReadOnly}
                      >
                          {isPrepaid ? (
                            <option value="Prepaid">Prepaid</option>
                          ) : (
                            <>
                              <option value="">-- Select Payment --</option>
                              <option value="Billed">Billed</option>
                              <option value="Cash">Cash</option>
                              <option value="Cheque">Cheque</option>
                              <option value="E-Transfer">E-Transfer</option>
                              <option value="Credit Card">Credit Card</option>
                              <option value="Split Payment">Split Payment</option>
                            </>
                          )}
                      </select>
                      {paymentMethodError && <p className="text-red-400 text-[10px] mt-1">{paymentMethodError}</p>}

                      {/* DIRECT UPGRADE BUTTON - Only show if upsells enabled AND region is West AND season is Aeration */}
                      {!isReadOnly && upsellsEnabled && canShowUpgradeButton && (
                        <button
                          onClick={() => setShowUpgradeModal(true)}
                          disabled={!canUpgrade}
                          className={`w-full mt-3 py-2 px-4 rounded-md font-bold text-sm flex items-center justify-center gap-2 transition-colors ${canUpgrade ? 'bg-purple-600 hover:bg-purple-500 text-white border border-purple-500' : 'bg-gray-700 text-gray-500 border border-gray-600 cursor-not-allowed'}`}
                        >
                          <TrendingUp size={16} />
                          {isAlreadyUpgrade ? 'Already Upgraded' : 'Upgrade Instead'}
                        </button>
                      )}
                  </div>

                  {paymentMethod === 'Billed' && !isReadOnly && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Invoice #</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="INV-..." /></div>
                  )}
                  {paymentMethod === 'E-Transfer' && !isReadOnly && (
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
                          className={`w-full bg-gray-800 border rounded p-2 text-white ${etransferEmailError ? 'border-red-500' : 'border-gray-700'}`}
                          placeholder="client@bank.com"
                        />
                        {etransferEmailError && <p className="text-red-400 text-[10px] mt-1">{etransferEmailError}</p>}
                      </div>
                  )}
                  {paymentMethod === 'Cheque' && !isReadOnly && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque #</label><input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="#001" /></div>
                  )}
               </div>

               {/* SPLIT PAYMENT FIELDS */}
               {isSplitPayment && !isReadOnly && (
                <div className="mb-4 p-4 bg-gray-800/50 rounded-lg border border-gray-600 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-gray-300">Split Payment Amounts</h4>
                    <div className="text-sm font-mono font-bold text-green-400">Total: ${splitTotal.toFixed(2)}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cash</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input type="number" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white" placeholder="0.00" step="0.01"/>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input type="number" value={splitCheque} onChange={(e) => setSplitCheque(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white" placeholder="0.00" step="0.01"/>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">E-Transfer</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input type="number" value={splitEtransfer} onChange={(e) => setSplitEtransfer(e.target.value)} onBlur={handleSplitEtransferAmountBlur} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white" placeholder="0.00" step="0.01"/>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Credit Card</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input type="number" value={splitCreditCard} onChange={(e) => { setSplitCreditCard(e.target.value); if (isCreditPaid) { setIsCreditPaid(false); setCcData(null); }}} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white" placeholder="0.00" step="0.01"/>
                      </div>
                    </div>
                  </div>

                  {(parseFloat(splitCheque) || 0) > 0 && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number</label>
                      <input value={splitChequeNumber} onChange={e => setSplitChequeNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="#001"/>
                    </div>
                  )}

                  {(parseFloat(splitEtransfer) || 0) > 0 && (
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
                      <input type="email" value={splitEtransferEmail} onChange={handleSplitEtransferEmailChange} onBlur={handleSplitEtransferEmailBlur} className={`w-full bg-gray-800 border rounded p-2 text-white ${splitEtransferEmailError ? 'border-red-500' : 'border-gray-700'}`} placeholder="client@bank.com"/>
                      {splitEtransferEmailError && <p className="text-red-400 text-[10px] mt-1">{splitEtransferEmailError}</p>}
                    </div>
                  )}

                  {splitCCAmount > 0 && (
                    <div className={`p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                      <span className="text-sm font-medium">{isCreditPaid ? `Card Secured for $${splitCCAmount.toFixed(2)}` : `Process $${splitCCAmount.toFixed(2)} on Card`}</span>
                      {isCreditPaid ? <CheckCircle size={20}/> : <button type="button" onClick={() => setShowCreditModal(true)} className="text-xs underline">Open Terminal</button>}
                    </div>
                  )}
                </div>
               )}

               {paymentMethod === 'Credit Card' && !isSplitPayment && (
                   <div className={`mb-4 p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                       <span className="text-sm font-medium">{isCreditPaid ? "Secured Card Info to HQ" : "Secure Card Info"}</span>
                       {isCreditPaid ? <CheckCircle size={20}/> : <button onClick={() => setShowCreditModal(true)} className="underline text-xs">Open Terminal</button>}
                   </div>
               )}
           </div>
        </div>

        <div className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-between items-center flex-shrink-0 gap-4">
             {!isReadOnly ? (
                 <>
                     <button onClick={() => setShowCancelModal(true)} className="flex items-center gap-2 px-4 py-3 bg-red-900/20 hover:bg-red-900/40 text-red-300 border border-red-800 rounded-md font-bold transition-colors" disabled={saving}><Ban size={18} /> Cancel / Skip</button>
                     <button
                       onClick={handleSave}
                       disabled={(paymentMethod === 'Credit Card' && !isCreditPaid && !isSplitPayment) || (isSplitPayment && splitCCNeedsProcessing) || saving}
                       className="flex-1 sm:flex-none px-8 py-3 bg-green-600 hover:bg-green-500 text-white rounded-md font-bold shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                       {saving ? (<><Loader className="animate-spin" size={18} /> Processing...</>) : (<><CheckCircle2 size={18} /> Complete Job</>)}
                     </button>
                 </>
             ) : (
                 <p className="text-center w-full text-gray-500 italic text-sm">This record is finalized.</p>
             )}
        </div>
      </div>

      {/* CANCEL MODAL */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-4">Mark as Not Done?</h3>
            <p className="text-sm text-gray-400 mb-6">This will remove the job from your pending list.</p>
            <div className="space-y-3">
              <button onClick={() => handleCancel('next_time')} className="w-full py-3 bg-orange-600/20 text-orange-400 border border-orange-700/50 rounded font-bold hover:bg-orange-600/30 transition-colors">Next Time / 2nd Run</button>
              <button onClick={() => handleCancel('cancelled')} className="w-full py-3 bg-red-600/20 text-red-400 border border-red-700/50 rounded font-bold hover:bg-red-600/30 transition-colors">Cancelled</button>
              <button onClick={() => setShowCancelModal(false)} className="w-full py-3 text-gray-400 hover:text-white transition-colors">Go Back</button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Card / Bambora Live Terminal */}
      {showCreditModal && (
        liveCardEnabled ? (
          <BamboraLiveModal
            amount={isSplitPayment ? splitCreditCard : String(price)}
            clientName={`${firstName} ${lastName}`}
            onClose={() => setShowCreditModal(false)}
            onProcess={(details) => {
              setIsCreditPaid(true);
              setShowCreditModal(false);
              setCcData({
                number: `BAMBORA-${details.bamboraTransactionId}`,
                expiry: details.authCode,
                cvc: details.last4,
              });
            }}
          />
        ) : (
          <CreditCardModal
            amount={isSplitPayment ? splitCreditCard : String(price)}
            clientName={`${firstName} ${lastName}`}
            onClose={() => setShowCreditModal(false)}
            onProcess={(details) => { setIsCreditPaid(true); setShowCreditModal(false); setCcData(details); }}
          />
        )
      )}

      {/* DIRECT UPGRADE MODAL */}
      {showUpgradeModal && (
        <AddContractModal
          onClose={() => setShowUpgradeModal(false)}
          directUpgradeBooking={getUpgradeBooking()}
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

export default JobDetail;