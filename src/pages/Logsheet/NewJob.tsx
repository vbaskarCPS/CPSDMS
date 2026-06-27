// src/pages/Logsheet/NewJob.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, Save, AlertCircle, RefreshCw, CheckCircle, Phone, Mail, Loader, TrendingUp, GraduationCap, Info, Shovel, Droplets, Bookmark } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { commandCenterService, getTaxRateForRegion, Region, seasonHasTeams } from '../../lib/commandCenterService';
import { supabase } from '../../lib/supabase';
import {
  Worker,
  SessionTransaction,
  SeasonType,
  ServiceFlags,
  SERVICE_FLAG_KEYS,
  SERVICE_FLAG_LABELS,
  PendingSaleInput,
  PendingSaleUpdate,
  RAMP_CREW_TEAM_ID_PATTERN,
} from '../../types';
import { sessionService, AsphaltCompletionContext } from '../../lib/sessionService';
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

// --- HELPER: RC detection (local copy, since commandCenterService doesn't export one) ---
// commandCenterService.isRampCrewTeamId exists per sessionService imports, but its
// existence wasn't confirmed in this file's import surface — we use the type-level
// regex constant from types/index.ts to stay self-contained and case-sensitive.
function isRC(teamId: string | undefined | null): boolean {
  if (!teamId) return false;
  return RAMP_CREW_TEAM_ID_PATTERN.test(teamId);
}

// --- HELPER: Get the property type button list for a given season ---
// Aeration & Lawn Rejuv use FP/FO/BO. Sealing uses SS/SSP (Ramp stays in the
// MasterBooking enum, reserved for the asphalt child row's export propertyType
// override — never picked manually in the UI).
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
function getItemNameForSeason(seasonType: SeasonType): string {
  if (seasonType === 'lawn_rejuv') return 'Lawn Rejuvenation';
  if (seasonType === 'sealing') return 'Sealing';
  if (seasonType === 'cleaning') return 'Cleaning';
  return 'Aeration';
}

// --- HELPER: Build the seasonId stamp for a transaction ---
function buildSeasonId(region: Region, seasonType: SeasonType): string {
  const regionSlug = region.toLowerCase();
  if (seasonType === 'lawn_rejuv') return `${regionSlug}-lawn-rejuv`;
  if (seasonType === 'sealing') return `${regionSlug}-sealing`;
  if (seasonType === 'cleaning') return `${regionSlug}-cleaning`;
  return `${regionSlug}-aeration`;
}

// --- HELPER: Fetch partner session info for completer-with-phantom mode ---
// Resolves a sessionId to the shape required by the AsphaltCompleterWithPhantomContext.partner
// sub-object. Returns null on lookup failure so the caller can surface a user-facing
// error message; in normal operation this should never fail (sessions are created
// at upload time and persist for the day).
async function fetchPartnerSessionInfo(targetSessionId: string): Promise<{
  sessionId: string;
  workerId: string;
  teamWorkerIds: string[];
  workerName: string;
} | null> {
  try {
    const { data } = await supabase
      .from('logsheet_sessions')
      .select('id, worker_id, team_worker_ids')
      .eq('id', targetSessionId)
      .maybeSingle();
    if (!data) return null;

    const teamWorkerIds: string[] = (data.team_worker_ids && data.team_worker_ids.length > 0)
      ? data.team_worker_ids
      : [data.worker_id];
    const primaryWorkerId = teamWorkerIds[0];

    const { data: userData } = await supabase
      .from('users')
      .select('name')
      .eq('user_id', primaryWorkerId)
      .maybeSingle();

    return {
      sessionId: data.id,
      workerId: primaryWorkerId,
      teamWorkerIds,
      workerName: userData?.name || primaryWorkerId,
    };
  } catch (e) {
    console.warn('[NewJob] fetchPartnerSessionInfo failed:', e);
    return null;
  }
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
}> = ({ services, onChange }) => {
  const toggleService = (key: keyof ServiceFlags) => {
    onChange({ ...services, [key]: !services[key] });
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
              className={`px-3 py-1.5 rounded border-2 font-bold text-xs transition-all ${isActive ? colors.active : colors.inactive}`}
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
  // pending_sales row. On Save & Complete (non-asphalt path), we pass pendingSaleId
  // to completeJob() which deletes the row after the transaction writes.
  // On Save Pending, we update the existing row instead of creating a new one.
  // For asphalt completions, pending-row cleanup is handled by completeAsphaltJob
  // via the AsphaltCompletionContext parent/child ids — see resolveAsphaltContext.
  const [pendingSaleId, setPendingSaleId] = useState<string | null>(null);
  const [isResumingPending, setIsResumingPending] = useState(false);

  // --- ASPHALT STATE (Sealing season only) ---
  // Worker-toggled. When on, an asphalt component is being sold/completed alongside
  // the driveway. The submit flow resolves a mode from the AsphaltCompletionContext
  // union and routes through sessionService.completeJob → completeAsphaltJob.
  const [asphaltEnabled, setAsphaltEnabled] = useState(false);
  const [asphaltAmount, setAsphaltAmount] = useState('');
  const [upsoldAsphaltAmount, setUpsoldAsphaltAmount] = useState('');

  // RC detection — based on worker.teamId matching RAMP_CREW_TEAM_ID_PATTERN
  // (case-sensitive /^RC\d*$/). Drives Upsold field visibility, mode resolution,
  // and child auto-assignment.
  const [isRampCrew, setIsRampCrew] = useState(false);

  // --- RESUMED-ASPHALT TRACKING ---
  // Populated by the prefill effect when the URL points at an asphalt-bearing
  // pending row (or a regular pending that has an asphalt child).
  //
  // Two ids may be set, depending on what's being resumed:
  //   - resumedDrivewayParentId: the driveway parent's pending_sales.id, when present.
  //   - resumedAsphaltChildId: the asphalt child's pending_sales.id, when present.
  //
  // For a typical "regular driveway pending" resume: parentId set, childId null.
  // For a "parent + child" resume (cart created both): both set.
  // For a "standalone asphalt" resume (RC's solo asphalt): parentId null, childId set.
  // For a "deferred asphalt" resume (Path 3): parentId null, childId set, sharedJobKey set.
  const [resumedDrivewayParentId, setResumedDrivewayParentId] = useState<string | null>(null);
  const [resumedAsphaltChildId, setResumedAsphaltChildId] = useState<string | null>(null);
  // shared_job_key on the child, when present → identifies Path 3 deferred-asphalt resume.
  const [resumedAsphaltSharedJobKey, setResumedAsphaltSharedJobKey] = useState<string | null>(null);
  // assigned_rc_session_id on the child, when present → who's responsible for the asphalt.
  const [resumedAsphaltAssignedRcSessionId, setResumedAsphaltAssignedRcSessionId] = useState<string | null>(null);
  // session_id on the parent (cart's session), when known → used to look up the
  // cart's partner info when an RC fires completer-with-phantom from RC side.
  const [resumedParentSessionId, setResumedParentSessionId] = useState<string | null>(null);

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
    aeration: false, dethatch: false, fertilizer: false, seed: false, lime: false,
  });

  // Payment State - Default to empty string to force selection
  const [paymentMethod, setPaymentMethod] = useState('');
  const [etransferEmail, setEtransferEmail] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');

  // Split Payment State
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState({ cash: '', cheque: '', etransfer: '', creditCard: '' });
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

  // Saving state to prevent double-click. Two flavours: `saving` covers
  // Save & Complete; `savingPending` covers the Save Pending button.
  const [saving, setSaving] = useState(false);
  const [savingPending, setSavingPending] = useState(false);

  // --- COMPUTED FLAGS ---
  const canShowUpgradeButton = region === 'West' && seasonType === 'aeration';
  const propertyTypeOptions = getPropertyTypesForSeason(seasonType);
  const seasonUsesPricingOnlyLabel = seasonType === 'lawn_rejuv' || seasonType === 'sealing' || seasonType === 'cleaning';
  const isTeamSeason = seasonHasTeams(seasonType) && !isTrainingMode;
  const isSealingSeason = seasonType === 'sealing' && !isTrainingMode;

  // Asphalt toggle: locked ON whenever we're resuming an asphalt-bearing row,
  // because un-completing the asphalt portion would orphan the child or leave
  // the deferred assignment hanging.
  const isAsphaltToggleLocked = resumedAsphaltChildId !== null;
  const canShowAsphaltToggle = isSealingSeason;
  // Upsold is RC-only. Cart workers literally never enter upsold themselves.
  const canShowUpsoldField = asphaltEnabled && isRampCrew;
  // Path 3 deferred-pickup detection from resumed state. When true, RC is picking up
  // a child whose parent driveway tx is already complete elsewhere; only the upsold
  // portion (if any) is being collected this round.
  const isAsphaltExecutorOnlyResume =
    resumedAsphaltChildId !== null &&
    resumedDrivewayParentId === null &&
    resumedAsphaltSharedJobKey !== null;

  const getCustomerAddress = (): string => `${houseNumber} ${streetName}`.trim();

  // --- SPLIT PAYMENT HELPERS ---
  const getSplitTotal = () => {
    const cash = parseFloat(splitAmounts.cash) || 0;
    const cheque = parseFloat(splitAmounts.cheque) || 0;
    const etransfer = parseFloat(splitAmounts.etransfer) || 0;
    const creditCard = parseFloat(splitAmounts.creditCard) || 0;
    return Math.round((cash + cheque + etransfer + creditCard) * 100) / 100;
  };
  const hasSplitCreditCard = () => (parseFloat(splitAmounts.creditCard) || 0) > 0;
  const hasSplitEtransfer  = () => (parseFloat(splitAmounts.etransfer)  || 0) > 0;
  const hasSplitCheque     = () => (parseFloat(splitAmounts.cheque)     || 0) > 0;

  // --- ASPHALT TOTAL HELPER ---
  // Computes the cash THIS completion is collecting. Display in the asphalt
  // section header AND used as tx.price when asphalt is on and isSplitPayment is off.
  // Mode-aware so the display matches the customer-facing collected amount.
  //
  //   self-both (walk-up or resume): D + A + U
  //   driveway-deferred:              D + A         (non-RC, no upsold)
  //   completer-with-phantom (cart): D + A         (cart can't enter upsold)
  //   completer-with-phantom (RC):   D + A + U     (RC collects everything)
  //   asphalt-executor-only:         U only        (Path 3 — cart already collected D+A)
  const computeAsphaltTotalCollected = (): number => {
    if (!asphaltEnabled) return 0;
    const D = parseFloat(amount) || 0;
    const A = parseFloat(asphaltAmount) || 0;
    const U = isRampCrew ? (parseFloat(upsoldAsphaltAmount) || 0) : 0;

    if (isAsphaltExecutorOnlyResume) {
      // Path 3 deferred pickup — RC only collects upsold this round (if any).
      return Math.round(U * 100) / 100;
    }
    return Math.round((D + A + U) * 100) / 100;
  };

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
    const etransferAmount = parseFloat(splitAmounts.etransfer) || 0;
    if (etransferAmount > 0) {
      if (!splitEtransferEmail && email) setSplitEtransferEmail(email);
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
      setSplitAmounts({ cash: '', cheque: '', etransfer: '', creditCard: '' });
      setSplitEtransferEmail('');
      setSplitChequeNumber('');
      setSplitCcPaid(false);
      setSplitCcData(null);
    } else {
      setIsSplitPayment(false);
      if (value === 'Credit Card') setShowCreditModal(true);
      if (value === 'E-Transfer') {
        if (!etransferEmail && email) setEtransferEmail(email);
        setShowEtransferProtocol(true);
      }
    }
  };

  // Upgrade button enabled state
  const canUpgrade = upsellsEnabled &&
    canShowUpgradeButton &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    houseNumber.trim() !== '' &&
    streetName.trim() !== '';

  // --- INIT EFFECT ---
  useEffect(() => {
    const init = async () => {
      const trainingMode = trainingService.isTrainingMode();
      setIsTrainingMode(trainingMode);

      const currentWorker = getStorageItem<Worker | null>('current_user', null);

      if (trainingMode) {
        setRegion('West');
        setTaxRate(5);
        setSeasonType('aeration');
      } else {
        const cc = commandCenterService.getCurrentCommandCenter();
        if (cc) {
          setRegion(cc.region);
          setTaxRate(getTaxRateForRegion(cc.region));
        }

        try {
          const currentSeasonType = await sessionService.getSessionSeasonType();
          setSeasonType(currentSeasonType);
          setPropertyType(getDefaultPropertyTypeForSeason(currentSeasonType));
          if (currentSeasonType === 'lawn_rejuv' || currentSeasonType === 'sealing' || currentSeasonType === 'cleaning') {
            setAmount('0');
          }
        } catch (err) {
          console.warn('Could not get season type, defaulting to aeration');
        }

        try {
          const liveCard = await sessionService.getSessionLiveCardEnabled();
          setLiveCardEnabled(liveCard);
        } catch (err) {
          console.warn('Could not get live card status, defaulting to false');
        }
      }

      if (currentWorker) {
        setWorker(currentWorker);
        // RC detection. Training is always Aeration, so we never flag RC in training.
        if (!trainingMode) {
          setIsRampCrew(isRC(currentWorker.teamId));
        }

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

          const upsellStatus = await service.getWorkerUpsellsEnabled(currentWorker.contractorId);
          setUpsellsEnabled(upsellStatus);
        } catch (err) {
          console.warn("Offline/No session found", err);
          alert('Unable to load route assignments. Please try again.');
          navigate('/logsheet');
        }
      }
    };
    init();
  }, [navigate]);

  // --- PREFILL FROM PENDING SALE ---
  // Runs once when worker is loaded. If ?pendingSaleId= is in the URL, fetch
  // the row and copy each saved field into the corresponding form state.
  // Skipped in training mode (training is always Aeration).
  //
  // ASPHALT BRANCHES (Sealing only):
  // - If ps.saleType === 'asphalt' and ps.parentId: resuming an asphalt child
  //   whose parent driveway is a separate pending row. Fetch the parent so
  //   the driveway fields prefill from it; set the asphalt fields from ps.
  // - If ps.saleType === 'asphalt' and !ps.parentId: standalone child.
  //   Either (a) RC's own solo asphalt (no sharedJobKey) or (b) Path 3 deferred
  //   pickup (sharedJobKey set). Driveway fields stay blank; asphalt from ps.
  // - If ps.saleType is null/undefined (regular driveway parent): existing
  //   prefill, then additionally look for an asphalt child via
  //   getAsphaltChildrenForParent. If a child exists, toggle asphalt on and
  //   prefill its fields.
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

        // --- ASPHALT CHILD RESUME ---
        if (ps.saleType === 'asphalt') {
          setAsphaltEnabled(true);
          setResumedAsphaltChildId(ps.id);
          setResumedAsphaltSharedJobKey(ps.sharedJobKey || null);
          setResumedAsphaltAssignedRcSessionId(ps.assignedRcSessionId || null);
          setAsphaltAmount(String(ps.asphaltAmount ?? 0));
          if (ps.upsoldAsphaltAmount != null) {
            setUpsoldAsphaltAmount(String(ps.upsoldAsphaltAmount));
          }

          if (ps.parentId) {
            const parent = await sessionService.getPendingSaleById(ps.parentId);
            if (parent) {
              setResumedDrivewayParentId(parent.id);
              setResumedParentSessionId(parent.sessionId);
              if (parent.routeCode) setRouteCode(parent.routeCode);
              if (parent.houseNumber) setHouseNumber(parent.houseNumber);
              if (parent.streetName) {
                setStreetName(parent.streetName);
                setIsCustomStreetMode(true);
              }
              if (parent.price) setAmount(parent.price);
              if (parent.propertyType) setPropertyType(parent.propertyType);
              if (parent.services) setServices(parent.services);
            } else {
              // Parent missing — degrade to standalone shape for the mode resolver.
              console.warn('[NewJob] Asphalt child has parent_id but parent not found:', ps.parentId);
              setResumedDrivewayParentId(null);
              if (ps.routeCode) setRouteCode(ps.routeCode);
              if (ps.houseNumber) setHouseNumber(ps.houseNumber);
              if (ps.streetName) { setStreetName(ps.streetName); setIsCustomStreetMode(true); }
              if (ps.propertyType) setPropertyType(ps.propertyType);
              setAmount('0');
            }
          } else {
            // Standalone — no parent. Either RC's own solo asphalt or Path 3 deferred.
            setResumedDrivewayParentId(null);
            if (ps.routeCode) setRouteCode(ps.routeCode);
            if (ps.houseNumber) setHouseNumber(ps.houseNumber);
            if (ps.streetName) { setStreetName(ps.streetName); setIsCustomStreetMode(true); }
            if (ps.propertyType) setPropertyType(ps.propertyType);
            setAmount('0');
          }
          return;
        }

        // --- REGULAR DRIVEWAY PARENT RESUME (existing behaviour) ---
        if (ps.routeCode) setRouteCode(ps.routeCode);
        if (ps.houseNumber) setHouseNumber(ps.houseNumber);
        if (ps.streetName) {
          setStreetName(ps.streetName);
          setIsCustomStreetMode(true);
        }
        if (ps.price) setAmount(ps.price);
        if (ps.propertyType) setPropertyType(ps.propertyType);
        if (ps.services) setServices(ps.services);
        setResumedDrivewayParentId(ps.id);
        setResumedParentSessionId(ps.sessionId);

        // Check for an asphalt child (sealing-only). A stray non-sealing row
        // would simply return no children, so the call is safe either way.
        try {
          const children = await sessionService.getAsphaltChildrenForParent(ps.id);
          if (children.length > 0) {
            const child = children[0];
            setAsphaltEnabled(true);
            setResumedAsphaltChildId(child.id);
            setResumedAsphaltSharedJobKey(child.sharedJobKey || null);
            setResumedAsphaltAssignedRcSessionId(child.assignedRcSessionId || null);
            setAsphaltAmount(String(child.asphaltAmount ?? 0));
            if (child.upsoldAsphaltAmount != null) {
              setUpsoldAsphaltAmount(String(child.upsoldAsphaltAmount));
            }
          }
        } catch (err) {
          console.warn('[NewJob] asphalt child lookup failed (non-fatal):', err);
        }
      } catch (err) {
        console.warn('[NewJob] Failed to load pending sale, continuing with blank form:', err);
      }
    };
    prefillFromPending();
    // searchParams is read once; deps intentionally just worker + isTrainingMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker, isTrainingMode]);

  // --- STREET SUGGESTIONS ---
  useEffect(() => {
    if (routeCode) {
      const service = isTrainingMode ? trainingService : sessionService;
      service.getStreetsForRoute(routeCode).then(streets => {
        if (streets && streets.length > 0) {
          setSuggestedStreets(streets);
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

  // --- ASPHALT TOGGLE HANDLER ---
  // Disabled when locked (resuming an asphalt-bearing row). Off-state clears
  // the asphalt amount fields so a non-submitted toggle-on→off cycle doesn't
  // leak stale values. On-state leaves amounts alone.
  const handleAsphaltToggleChange = (next: boolean) => {
    if (isAsphaltToggleLocked) return;
    setAsphaltEnabled(next);
    if (!next) {
      setAsphaltAmount('');
      setUpsoldAsphaltAmount('');
    }
  };

  // --- GATHER CURRENT FORM STATE FOR PENDING SAVE ---
  // Builds a clean PendingSaleInput/Update from the current form fields.
  // No payment fields — pending sales are pre-payment by definition.
  //
  // ASPHALT EXTENSION:
  // When asphaltEnabled with a positive amount, includes asphaltAmount on the
  // input. createPendingSale orchestrates a parent+child row pair when
  // asphaltAmount > 0 and saleType is not 'asphalt'.
  const gatherPendingPayload = (): {
    forCreate: PendingSaleInput;
    forUpdate: PendingSaleUpdate;
  } | null => {
    if (!worker) return null;

    const base = {
      routeCode: routeCode || undefined,
      houseNumber: houseNumber.trim() || undefined,
      streetName: streetName.trim() || undefined,
      price: amount.trim() || undefined,
      propertyType: propertyType || undefined,
      services: seasonType === 'lawn_rejuv' ? services : undefined,
      notes: undefined as string | undefined,
    };

    const asphaltAmt = asphaltEnabled ? (parseFloat(asphaltAmount) || 0) : 0;
    const upsoldAmt = (asphaltEnabled && isRampCrew) ? (parseFloat(upsoldAsphaltAmount) || 0) : 0;
    const includeAsphaltFields = asphaltEnabled && asphaltAmt > 0;

    const createPayload: PendingSaleInput = {
      sessionId: '', // filled in by handleSavePending after session lookup
      workerId: worker.contractorId,
      ...base,
      ...(includeAsphaltFields ? {
        asphaltAmount: asphaltAmt,
        upsoldAsphaltAmount: upsoldAmt > 0 ? upsoldAmt : undefined,
      } : {}),
    };

    const updatePayload: PendingSaleUpdate = {
      ...base,
      ...(asphaltEnabled ? {
        asphaltAmount: asphaltAmt,
        upsoldAsphaltAmount: upsoldAmt > 0 ? upsoldAmt : undefined,
      } : {}),
    };

    return { forCreate: createPayload, forUpdate: updatePayload };
  };

  // --- SAVE PENDING (team seasons only) ---
  // Two paths:
  //   - Resuming an existing pending sale: call updatePendingSale.
  //     For asphalt: if the resumed row IS the asphalt child, asphaltAmount/upsold
  //     update on the child. If the resumed row is a PARENT with an asphalt CHILD,
  //     this only updates the parent — see the documented "re-park gap" in the
  //     project handoff (open issue, not a blocker for delivery #11).
  //   - New pending sale: look up the active session, call createPendingSale.
  //     When asphalt is on and asphaltAmount > 0, createPendingSale orchestrates
  //     parent+child rows atomically.
  //
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

    if (!payload.forUpdate.houseNumber && !payload.forUpdate.streetName) {
      setError('Please enter at least a house number or street name before parking this sale.');
      return;
    }

    setSavingPending(true);

    try {
      if (pendingSaleId) {
        // RESUMING — update the existing row in place.
        // If we're resuming an asphalt child directly (no driveway parent in scope),
        // update IT. Otherwise update the parent (which is pendingSaleId).
        const idToUpdate = (resumedAsphaltChildId && !resumedDrivewayParentId)
          ? resumedAsphaltChildId
          : pendingSaleId;
        await sessionService.updatePendingSale(idToUpdate, payload.forUpdate);
      } else {
        // NEW — need the active session id to scope the new row.
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

  // --- RESOLVE ASPHALT COMPLETION CONTEXT ---
  // Build the AsphaltCompletionContext for sessionService.completeJob based on
  // current form state + resumed pending row state + RC status. Returns undefined
  // when asphalt is off (so completeJob runs through its normal path). Throws on
  // unsupported combinations with a user-facing message so handleSubmit can surface them.
  //
  // The mode picker covers the six scenarios from the project handoff plus two
  // derived edge cases:
  //
  //   1. RC walk-up + asphalt                                  → self-both
  //   2. Non-RC walk-up + asphalt                              → driveway-deferred
  //   3. RC resuming standalone asphalt with sharedJobKey      → asphalt-executor-only (Path 3)
  //   4. RC resuming standalone asphalt without sharedJobKey   → self-both (RC's solo asphalt)
  //   5. Resuming parent+child, current session = assigned RC  → self-both
  //   6. Resuming parent+child, current = cart, RC = other     → completer-with-phantom (cart side)
  //   7. Resuming parent+child, current = RC, parent = other   → completer-with-phantom (RC side, derived)
  //   8. Resuming parent (no child), RC adds asphalt on fly    → self-both with parentSaleId, no child
  //   9. Resuming parent (no child), non-RC adds asphalt       → BLOCKED (documented constraint)
  const resolveAsphaltContext = async (currentSessionId: string): Promise<AsphaltCompletionContext | undefined> => {
    if (!asphaltEnabled) return undefined;
    if (!worker) throw new Error('No worker session.');

    const drivewayAmt = Math.round((parseFloat(amount) || 0) * 100) / 100;
    const asphaltAmt = Math.round((parseFloat(asphaltAmount) || 0) * 100) / 100;
    const upsoldAmt = isRampCrew
      ? Math.round((parseFloat(upsoldAsphaltAmount) || 0) * 100) / 100
      : 0;

    if (asphaltAmt <= 0 && !isAsphaltExecutorOnlyResume) {
      throw new Error('Asphalt amount must be greater than zero.');
    }

    // --- Case 1/2: Walk-up (no resume) ---
    if (!pendingSaleId) {
      if (isRampCrew) {
        return {
          mode: 'self-both',
          completerRole: 'self-both',
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
        };
      } else {
        return {
          mode: 'driveway-deferred',
          completerRole: 'driveway-seller',
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          upsoldAmount: 0,
          childPending: {
            sessionId: currentSessionId,
            workerId: worker.contractorId,
            routeCode: routeCode || undefined,
            houseNumber: houseNumber.trim() || undefined,
            streetName: streetName.trim() || undefined,
            propertyType: propertyType || undefined,
            notes: undefined,
          },
        };
      }
    }

    // --- Case 3/4: Resuming a standalone asphalt child (no parent) ---
    if (resumedAsphaltChildId && !resumedDrivewayParentId) {
      if (!isRampCrew) {
        // Only RCs should ever reach completion on a standalone asphalt assignment.
        throw new Error('Only Ramp Crew can complete an asphalt-only assignment.');
      }
      if (resumedAsphaltSharedJobKey) {
        // Case 3 — Path 3 deferred pickup. Cart already wrote its driveway tx.
        return {
          mode: 'asphalt-executor-only',
          completerRole: 'asphalt-executor',
          childSaleId: resumedAsphaltChildId,
          existingParentSharedJobKey: resumedAsphaltSharedJobKey,
          drivewayAmount: 0,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
        };
      } else {
        // Case 4 — RC's own solo asphalt (no parent, no sharedJobKey).
        return {
          mode: 'self-both',
          completerRole: 'self-both',
          parentSaleId: null,
          childSaleId: resumedAsphaltChildId,
          drivewayAmount: 0,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
        };
      }
    }

    // --- Case 5/6/7: Resuming a driveway parent that has an asphalt child ---
    if (resumedDrivewayParentId && resumedAsphaltChildId) {
      if (!resumedAsphaltAssignedRcSessionId) {
        throw new Error(
          'No Ramp Crew is assigned to the asphalt portion yet. ' +
          'Ask your manager to assign one before completing.'
        );
      }

      const isMyParent  = resumedParentSessionId === currentSessionId;
      const isMyAsphalt = resumedAsphaltAssignedRcSessionId === currentSessionId;

      if (isMyParent && isMyAsphalt) {
        // Case 5 — I own both sides (RC who self-assigned during QuickPending).
        return {
          mode: 'self-both',
          completerRole: 'self-both',
          parentSaleId: resumedDrivewayParentId,
          childSaleId: resumedAsphaltChildId,
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
        };
      }

      if (isMyParent && !isMyAsphalt) {
        // Case 6 — I'm the selling cart, a different RC owns the asphalt.
        // Cart fires completer-with-phantom from the driveway-seller side.
        const partnerInfo = await fetchPartnerSessionInfo(resumedAsphaltAssignedRcSessionId);
        if (!partnerInfo) {
          throw new Error('Could not load the assigned Ramp Crew\'s info. Please retry.');
        }
        return {
          mode: 'completer-with-phantom',
          completerRole: 'driveway-seller',
          parentSaleId: resumedDrivewayParentId,
          childSaleId: resumedAsphaltChildId,
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          // Cart cannot record upsold — RC-only field is hidden for non-RC.
          upsoldAmount: 0,
          partner: partnerInfo,
        };
      }

      if (!isMyParent && isMyAsphalt) {
        // Case 7 (derived) — I'm the assigned RC, someone else's cart created the parent.
        // RC fires completer-with-phantom from the asphalt-executor side.
        if (!resumedParentSessionId) {
          throw new Error('Driveway parent session info missing. Please retry.');
        }
        const partnerInfo = await fetchPartnerSessionInfo(resumedParentSessionId);
        if (!partnerInfo) {
          throw new Error('Could not load the selling cart\'s info. Please retry.');
        }
        return {
          mode: 'completer-with-phantom',
          completerRole: 'asphalt-executor',
          parentSaleId: resumedDrivewayParentId,
          childSaleId: resumedAsphaltChildId,
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
          partner: partnerInfo,
        };
      }

      // Neither side belongs to me — shouldn't be reachable via the dashboard,
      // but block defensively rather than silently miscompleting.
      throw new Error('You are not authorised to complete this asphalt job.');
    }

    // --- Case 8/9: Resuming a driveway parent without an asphalt child, asphalt toggled on ---
    if (resumedDrivewayParentId && !resumedAsphaltChildId) {
      if (isRampCrew) {
        // Case 8 — RC adding asphalt on the fly to their pending. self-both handles
        // it; parentSaleId is set so cleanup deletes the parent, childSaleId is null.
        return {
          mode: 'self-both',
          completerRole: 'self-both',
          parentSaleId: resumedDrivewayParentId,
          childSaleId: null,
          drivewayAmount: drivewayAmt,
          asphaltAmount: asphaltAmt,
          upsoldAmount: upsoldAmt,
        };
      } else {
        // Case 9 — non-RC. Blocked. driveway-deferred mode in the current
        // completeAsphaltJob doesn't consume a pre-existing pending parent row,
        // so completing here would orphan it. Documented constraint.
        throw new Error(
          'Cannot add asphalt to an existing pending sale. Either complete this driveway sale now, ' +
          'or delete the pending and re-create it with asphalt included.'
        );
      }
    }

    // Defensive default — shouldn't reach here under any documented combination.
    throw new Error('Unable to determine asphalt completion mode for the current form state.');
  };

  // --- HANDLE SUBMIT ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (saving) return;

    setError(null);

    if (!worker) { setError("No worker session."); return; }

    // --- VALIDATION ---
    const pError = getPhoneValidationError(phone);
    const eError = getEmailValidationError(email);

    if (isSplitPayment) {
      const splitTotal = getSplitTotal();
      if (splitTotal <= 0) {
        setError('Please enter at least one payment amount.');
        return;
      }
      if (hasSplitEtransfer()) {
        const etError = getEmailValidationError(splitEtransferEmail);
        if (etError) {
          setSplitEtransferEmailError(etError);
          setError('Please fix validation errors before saving.');
          return;
        }
      }
      if (hasSplitCreditCard() && !splitCcPaid) {
        setError('Please process the credit card payment before saving.');
        return;
      }
    } else {
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

    if (pError || eError) {
      setPhoneError(pError);
      setEmailError(eError);
      setError('Please fix validation errors before saving.');
      return;
    }

    if (seasonType === 'lawn_rejuv') {
      const hasService = SERVICE_FLAG_KEYS.some(k => services[k]);
      if (!hasService) {
        setError('Please select at least one service');
        return;
      }
    }

    // Asphalt-specific validation: amount must be > 0 unless we're in
    // asphalt-executor-only (where only upsold is being collected).
    if (asphaltEnabled && !isAsphaltExecutorOnlyResume) {
      const asphaltVal = parseFloat(asphaltAmount) || 0;
      if (asphaltVal <= 0) {
        setError('Please enter an asphalt amount greater than zero.');
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

      // --- ASPHALT MODE RESOLUTION ---
      // Compute the completion context BEFORE building the transaction so we know
      // how to size price and breakdown. resolveAsphaltContext returns undefined
      // when asphalt is off (normal flow) or throws on unsupported combinations.
      let asphaltContext: AsphaltCompletionContext | undefined;
      try {
        asphaltContext = await resolveAsphaltContext(activeSession.id);
      } catch (resolveErr: any) {
        setError(resolveErr?.message || 'Could not determine asphalt mode.');
        setSaving(false);
        return;
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
        // Non-split: price from the amount field for non-asphalt completions,
        // or from the asphalt total helper when asphalt is on.
        if (asphaltContext) {
          transactionPrice = computeAsphaltTotalCollected();
        } else {
          const rawPrice = parseFloat(amount) || 0;
          transactionPrice = Math.round(rawPrice * 100) / 100;
        }
        finalPaymentMethod = paymentMethod;
        finalEtransferEmail = paymentMethod === 'E-Transfer' ? etransferEmail : undefined;
        finalChequeNumber = paymentMethod === 'Cheque' ? chequeNumber : undefined;
        finalCcData = ccData;

        // For asphalt completions, materialise paymentBreakdown explicitly so
        // exportService's Path 3 dual-breakdown branch reliably uses it.
        if (asphaltContext) {
          paymentBreakdown = { [paymentMethod]: transactionPrice };
        }
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
        displayPrice: (isSplitPayment || asphaltContext)
          ? transactionPrice.toFixed(2)
          : amount,
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

        services: seasonType === 'lawn_rejuv' ? services : undefined,
      } as any;

      // PENDING SALE CLEANUP — legacy non-asphalt path uses the 5th arg.
      // Asphalt path: completeAsphaltJob handles cleanup via ctx.parentSaleId /
      // ctx.childSaleId based on mode. Pass undefined for the 5th arg so we
      // don't double-delete.
      if (isTrainingMode) {
        await service.completeJob(transactionData, placeholderJobId, worker.contractorId);
      } else {
        await sessionService.completeJob(
          transactionData,
          placeholderJobId,
          worker.contractorId,
          undefined,                                                  // teamWorkerIds — unchanged
          asphaltContext ? undefined : (pendingSaleId || undefined),  // legacy cleanup only when no asphalt ctx
          asphaltContext,                                             // 4-mode union for asphalt completions
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
    firstName, lastName, houseNumber, streetName, phone, email, routeCode, propertyType,
  });

  if (assignedRoutes.length === 0) {
    return null;
  }

  // --- ASPHALT SECTION HEADER SUBTITLE ---
  // Shifts wording depending on whether driveway is still being collected
  // (walk-up / regular parent resume) vs. an asphalt-executor-only resume
  // where only upsold is being collected this round.
  const asphaltSectionSubtitle = isAsphaltExecutorOnlyResume
    ? "Picking up a deferred asphalt assignment — driveway already collected by the selling cart."
    : "Asphalt component added alongside the driveway sale.";

  // === JSX RENDER (appended below via cat) ===
  // The render block continues in a separate concatenation step — see file end.
  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white">New Sale</h2>
            {isTrainingMode && (
              <span className="bg-yellow-900/30 text-yellow-400 text-[10px] px-1.5 py-0.5 rounded border border-yellow-700 flex items-center gap-1">
                <GraduationCap size={10}/> Training
              </span>
            )}
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
            {/* RC pill — shows when worker is on a Ramp Crew cart (sealing only) */}
            {isRampCrew && isSealingSeason && (
              <span className="bg-amber-900/30 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-700">
                RAMP CREW
              </span>
            )}
            {/* RESUMING PENDING pill — only when prefilled from a pending sale */}
            {isResumingPending && !isAsphaltExecutorOnlyResume && (
              <span className="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-0.5 rounded border border-slate-500 flex items-center gap-1">
                <Bookmark size={10}/> RESUMING PENDING
              </span>
            )}
            {/* DEFERRED ASPHALT PICKUP pill — Path 3 RC pickup */}
            {isAsphaltExecutorOnlyResume && (
              <span className="bg-amber-900/30 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-700 flex items-center gap-1">
                <Shovel size={10}/> ASPHALT PICKUP
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
                    {asphaltEnabled && !isAsphaltExecutorOnlyResume ? 'Driveway Amount ($)' : 'Total Amount ($)'}
                    {seasonUsesPricingOnlyLabel && !isAsphaltExecutorOnlyResume && (
                      <span className="text-gray-600 font-normal ml-1">(Default: $0 for manual)</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={isSplitPayment ? getSplitTotal().toFixed(2) : amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className={`flex-grow bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400 ${isSplitPayment || isAsphaltExecutorOnlyResume ? 'opacity-50 cursor-not-allowed' : ''}`}
                      placeholder="0.00"
                      step="0.01"
                      disabled={isSplitPayment || isAsphaltExecutorOnlyResume}
                      readOnly={isSplitPayment || isAsphaltExecutorOnlyResume}
                    />
                    {!isSplitPayment && !isAsphaltExecutorOnlyResume && (
                      <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>
                    )}
                  </div>
                  {isSplitPayment && (
                    <p className="text-gray-500 text-[10px] mt-1">Total calculated from split amounts</p>
                  )}
                  {isAsphaltExecutorOnlyResume && (
                    <p className="text-amber-400 text-[10px] mt-1">Driveway was already collected by the selling cart. No driveway cash is collected on this completion.</p>
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

            {/* ASPHALT SECTION (Sealing only) — toggle + amount + RC-only upsold */}
            {canShowAsphaltToggle && (
              <div className="bg-gray-900/30 p-4 rounded-lg border border-slate-700/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shovel size={16} className="text-slate-300" />
                    <h3 className="text-sm font-bold text-gray-300 uppercase">Asphalt Add-On</h3>
                    {isAsphaltToggleLocked && (
                      <span className="text-[10px] text-amber-400 font-bold">LOCKED (resuming)</span>
                    )}
                  </div>
                  <label className={`relative inline-flex items-center ${isAsphaltToggleLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={asphaltEnabled}
                      onChange={(e) => handleAsphaltToggleChange(e.target.checked)}
                      disabled={isAsphaltToggleLocked}
                      className="sr-only peer"
                    />
                    <div className={`w-11 h-6 bg-gray-700 rounded-full peer-checked:bg-slate-500 transition-colors relative ${isAsphaltToggleLocked ? 'opacity-60' : ''}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${asphaltEnabled ? 'translate-x-5' : ''}`}></span>
                    </div>
                  </label>
                </div>

                {asphaltEnabled && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-gray-400">{asphaltSectionSubtitle}</p>

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
                          disabled={isAsphaltExecutorOnlyResume}
                          readOnly={isAsphaltExecutorOnlyResume}
                        />
                        {isAsphaltExecutorOnlyResume && (
                          <p className="text-amber-400 text-[10px] mt-1">Already collected by the selling cart.</p>
                        )}
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
                          <p className="text-gray-500 text-[10px] mt-1">Additional amount RC added on-site (optional)</p>
                        </div>
                      )}
                    </div>

                    {/* Asphalt total display — what will be collected this completion */}
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

            <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Payment & Completion</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={handlePaymentMethodChange}
                    className={`w-full bg-gray-800 border rounded p-2 text-white ${paymentMethodError ? 'border-red-500' : 'border-gray-700'}`}
                  >
                    <option value="">-- Select Payment --</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                    <option value="E-Transfer">E-Transfer</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Split Payment">Split Payment</option>
                  </select>
                  {paymentMethodError && <p className="text-red-400 text-[10px] mt-1">{paymentMethodError}</p>}

                  {/* DIRECT UPGRADE BUTTON - West + Aeration only */}
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
                      className={`w-full bg-gray-800 border rounded p-2 text-white ${etransferEmailError ? 'border-red-500' : 'border-gray-700'}`}
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
                      <input type="number" value={splitAmounts.cash} onChange={e => setSplitAmounts({...splitAmounts, cash: e.target.value})} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" placeholder="0.00" step="0.01" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque</label>
                      <input type="number" value={splitAmounts.cheque} onChange={e => setSplitAmounts({...splitAmounts, cheque: e.target.value})} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" placeholder="0.00" step="0.01" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">E-Transfer</label>
                      <input type="number" value={splitAmounts.etransfer} onChange={e => setSplitAmounts({...splitAmounts, etransfer: e.target.value})} onBlur={handleSplitEtransferAmountBlur} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" placeholder="0.00" step="0.01" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Credit Card</label>
                      <input type="number" value={splitAmounts.creditCard} onChange={e => setSplitAmounts({...splitAmounts, creditCard: e.target.value})} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white font-mono" placeholder="0.00" step="0.01" />
                    </div>
                  </div>

                  {hasSplitCheque() && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number</label>
                      <input value={splitChequeNumber} onChange={e => setSplitChequeNumber(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded p-2 text-white" placeholder="#001" />
                    </div>
                  )}

                  {hasSplitEtransfer() && (
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block flex items-center gap-1">
                        E-Transfer Email *
                        <button type="button" onClick={() => setShowEtransferProtocol(true)} className="text-gray-400 hover:text-cps-blue transition-colors" title="View E-Transfer Protocol">
                          <Info size={12} />
                        </button>
                      </label>
                      <input
                        type="email"
                        value={splitEtransferEmail}
                        onChange={handleSplitEtransferEmailChange}
                        onBlur={handleSplitEtransferEmailBlur}
                        className={`w-full bg-gray-700 border rounded p-2 text-white ${splitEtransferEmailError ? 'border-red-500' : 'border-gray-600'}`}
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
                        <button type="button" onClick={() => setShowCreditModal(true)} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white text-xs font-bold">
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

            {/* SAVE PENDING BUTTON — team seasons only */}
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