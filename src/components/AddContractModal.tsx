// src/components/AddContractModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeft, Check, DollarSign, AlertCircle, User, Lock, Droplets, Mail, Plus, Loader, Phone, CheckCircle, Leaf } from 'lucide-react';
import { getStorageItem } from '../lib/localStorage';
import { commandCenterService, getTaxRateForRegion, Region, getAvailableAddOns } from '../lib/commandCenterService';
import { MasterBooking, Worker, SessionTransaction, SeasonType, ServiceFlags, SERVICE_FLAG_KEYS, SERVICE_FLAG_LABELS } from '../types';
import { sessionService } from '../lib/sessionService';
import { trainingService } from '../lib/trainingService';
import CreditCardModal from './CreditCardModal';
import { 
  formatPhoneNumber, 
  normalizeEmail,
  getPhoneValidationError, 
  getEmailValidationError 
} from '../lib/validationUtils';

// Helper to generate a valid UUID for transactions
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

// --- REGION-AWARE CONTRACT RECIPES ---
interface ContractRecipe {
  id: string;
  name: string;
  type: 'Upgrade' | 'Add-On';
  region: Region;
  propertyTypes: string[];
  hasIOS: boolean;
  displayPrefix?: string;
  badge?: string;
  questions?: { id: string; label: string; options: string[] }[];
  // Season restriction - if set, only available in this season
  seasonOnly?: SeasonType;
}

const CONTRACT_RECIPES: ContractRecipe[] = [
  // West Upgrades (Aeration only)
  { id: 'star_plan_pro', name: 'Star Plan Pro', type: 'Upgrade', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: false, displayPrefix: 'SP', seasonOnly: 'aeration' },
  { id: 'lawn_rejuv', name: 'Lawn Rejuvenation', type: 'Upgrade', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: false, displayPrefix: 'RJ', seasonOnly: 'aeration' },
  { id: 'golf_course', name: 'Golf Course', type: 'Upgrade', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: false, displayPrefix: 'GF', seasonOnly: 'aeration' },
  
  // West Add-Ons (Aeration only)
  { id: 'dethatch', name: 'Dethatching', type: 'Add-On', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: true, seasonOnly: 'aeration' },
  
  // West Add-Ons (Both seasons)
  { id: 'rejuv_after_care', name: 'Rejuvenation After Care', type: 'Add-On', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: false },
  { id: 'grub', name: 'Grub Control', type: 'Add-On', region: 'West', propertyTypes: ['FP', 'FO', 'BO'], hasIOS: false, 
    questions: [{ id: 'timing', label: 'Timing', options: ['Spring', 'Fall', 'Both'] }] 
  },
  
  // Central Add-Ons
  { id: 'window_washing', name: 'Window Washing', type: 'Add-On', region: 'Central', propertyTypes: [], hasIOS: true, badge: 'WW' },
  
  // East Add-Ons
  { id: 'driveway_sealing', name: 'Driveway Sealing', type: 'Add-On', region: 'East', propertyTypes: ['SS', 'SSP'], hasIOS: true, badge: 'DWS' },
  { id: 'hot_asphalt', name: 'Hot Asphalt', type: 'Add-On', region: 'East', propertyTypes: [], hasIOS: true, badge: 'RAMP' },
];

// Direct upgrade client data (for NewJob - no existing booking)
interface DirectUpgradeClient {
  firstName: string;
  lastName: string;
  houseNumber: string;
  streetName: string;
  phone: string;
  email: string;
  routeCode: string;
  propertyType: string;
}

interface AddContractModalProps {
  onClose: () => void;
  directUpgradeBooking?: MasterBooking;
  directUpgradeClient?: DirectUpgradeClient;
  onSuccess?: () => void;
}

type Step = 'SELECT_CONTRACT' | 'SELECT_CLIENT' | 'ENTER_DETAILS';

const AddContractModal: React.FC<AddContractModalProps> = ({ 
  onClose, 
  directUpgradeBooking, 
  directUpgradeClient,
  onSuccess 
}) => {
  // Check if in training mode
  const isTrainingMode = trainingService.isTrainingMode();
  
  // Determine if we're in direct upgrade mode
  const isDirectUpgrade = !!(directUpgradeBooking || directUpgradeClient);
  
  const [step, setStep] = useState<Step>('SELECT_CONTRACT');
  const [selectedRecipe, setSelectedRecipe] = useState<ContractRecipe | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<MasterBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Region, Tax Rate, and Season Type
  const [region, setRegion] = useState<Region>(isTrainingMode ? 'West' : 'West');
  const [taxRate, setTaxRate] = useState(5);
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  
  // Data
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    address: '',
    phone: '',
    email: '',
    routeNumber: '', 
    notes: '',
    propertyType: 'FP',
    hasLockedGate: false,
    hasSprinkler: false
  });
  
  // Payment - Default to empty string to force selection
  const [paymentInfo, setPaymentInfo] = useState({ amount: '', method: '' });
  const [extraPaymentInfo, setExtraPaymentInfo] = useState(''); 
  const [answers, setAnswers] = useState<Record<string, string>>({}); 
  const [worker, setWorker] = useState<Worker | null>(null);
  const [availableClients, setAvailableClients] = useState<MasterBooking[]>([]);
  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);

  // CC Data
  const [ccData, setCcData] = useState<{ number: string, expiry: string, cvc: string } | null>(null);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);

  // Saving State
  const [saving, setSaving] = useState(false);

  // Territory Helpers
  const [streetName, setStreetName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');

  // Split Payment State
  const [splitCash, setSplitCash] = useState('');
  const [splitCheque, setSplitCheque] = useState('');
  const [splitEtransfer, setSplitEtransfer] = useState('');
  const [splitCreditCard, setSplitCreditCard] = useState('');
  const [splitEtransferEmail, setSplitEtransferEmail] = useState('');
  const [splitChequeNumber, setSplitChequeNumber] = useState('');

  // Validation Errors
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [etransferEmailError, setEtransferEmailError] = useState<string | null>(null);
  const [splitEtransferEmailError, setSplitEtransferEmailError] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  // --- COMPUTED VALUES ---
  const isSplitPayment = paymentInfo.method === 'Split Payment';
  const isLawnRejuvSeason = seasonType === 'lawn_rejuv';

  const splitTotal = 
    (parseFloat(splitCash) || 0) + 
    (parseFloat(splitCheque) || 0) + 
    (parseFloat(splitEtransfer) || 0) + 
    (parseFloat(splitCreditCard) || 0);

  const splitCCAmount = parseFloat(splitCreditCard) || 0;
  const splitCCNeedsProcessing = splitCCAmount > 0 && !isCreditPaid;

  // Filter recipes based on region AND season type
  const availableRecipes = useMemo(() => {
    return CONTRACT_RECIPES.filter(r => {
      // Must match region
      if (r.region !== region) return false;
      
      // Check season restriction
      if (r.seasonOnly && r.seasonOnly !== seasonType) return false;
      
      // For lawn_rejuv, only allow grub and rejuv_after_care
      if (seasonType === 'lawn_rejuv') {
        const allowedAddOns = getAvailableAddOns(seasonType);
        if (r.type === 'Upgrade') return false; // No upgrades in lawn_rejuv
        if (r.type === 'Add-On' && !allowedAddOns.includes(r.id)) return false;
      }
      
      return true;
    });
  }, [region, seasonType]);

  const hasPropertyTypes = selectedRecipe && selectedRecipe.propertyTypes.length > 0;
  const supportsIOS = selectedRecipe?.hasIOS || false;
  const showGateAndSprinkler = selectedRecipe?.region === 'West';

  // --- HANDLERS ---
  const handleFirstNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({...formData, firstName: capitalizeWords(e.target.value)});
  };

  const handleLastNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({...formData, lastName: capitalizeWords(e.target.value)});
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setFormData({...formData, phone: formatted});
    setPhoneError(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({...formData, email: e.target.value});
    setEmailError(null);
  };

  const handleEmailBlur = () => {
    if (formData.email) {
      setFormData({...formData, email: normalizeEmail(formData.email)});
    }
  };

  const handleEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExtraPaymentInfo(e.target.value);
    setEtransferEmailError(null);
  };

  const handleEtransferEmailBlur = () => {
    if (extraPaymentInfo) {
      setExtraPaymentInfo(normalizeEmail(extraPaymentInfo));
    }
  };

  const handleSplitEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSplitEtransferEmail(e.target.value);
    setSplitEtransferEmailError(null);
  };

  const handleSplitEtransferEmailBlur = () => {
    if (splitEtransferEmail) {
      setSplitEtransferEmail(normalizeEmail(splitEtransferEmail));
    }
  };

  const handlePaymentMethodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setPaymentInfo({...paymentInfo, method: value});
    setPaymentMethodError(null);
    
    if (value !== 'Split Payment') {
      setSplitCash('');
      setSplitCheque('');
      setSplitEtransfer('');
      setSplitCreditCard('');
      setSplitEtransferEmail('');
      setSplitChequeNumber('');
    }
    
    if (value !== 'Credit Card' && value !== 'Split Payment') {
      setIsCreditPaid(false);
      setCcData(null);
    }
    
    if (value === 'Credit Card') setShowCreditModal(true);
  };

  const handleTaxClick = () => {
    const current = parseFloat(paymentInfo.amount) || 0;
    const tax = current * (taxRate / 100);
    setPaymentInfo({...paymentInfo, amount: (Math.round((current + tax) * 100) / 100).toFixed(2)});
  };

  useEffect(() => {
    const init = async () => {
      const w = getStorageItem<Worker | null>('current_user', null);
      if (!w) { setError("User not found."); return; }
      setWorker(w);

      // Training mode: Always use West region with 5% tax, aeration season
      if (isTrainingMode) {
        setRegion('West');
        setTaxRate(5);
        setSeasonType('aeration');
        
        // Get routes from training service
        const dailySession = await trainingService.getDailySession();
        if (dailySession && dailySession.routes) {
          const myRoutes = dailySession.routes
            .filter((r: any) => r.assignedWorkerIds && r.assignedWorkerIds.includes(w.contractorId))
            .map((r: any) => r.routeCode);
          myRoutes.sort((a: string, b: string) => a.localeCompare(b));
          setAssignedRoutes(myRoutes);
        }

        // Load available clients for training mode (only if not direct upgrade)
        if (!isDirectUpgrade) {
          const activeSession = await trainingService.getActiveLogsheetSession(w.contractorId);
          if (activeSession) {
            const clients = activeSession.financialStore.map(tx => ({
              'Booking ID': tx.jobId,
              'First Name': tx.customerName.split(' ')[0],
              'Last Name': tx.customerName.split(' ').slice(1).join(' '),
              'Full Address': tx.address,
              'Route Number': tx.routeCode,
              'Price': tx.displayPrice || tx.price.toString(),
              'Home Phone': tx.customerPhone || '',
              'Email Address': tx.customerEmail || '',
              'Prepaid': tx.isPrepaid ? 'x' : undefined,
              'Status': 'completed',
              'FO/BO/FP': tx.serviceType,
              isContract: ['Upgrade'].includes(tx.type) || (tx.displayPrice && (tx.displayPrice.startsWith('SP') || tx.displayPrice.startsWith('RJ') || tx.displayPrice.startsWith('GF'))),
              'Gate': (tx.itemDescription && tx.itemDescription.includes('[LG]')) ? 'x' : undefined
            } as MasterBooking));
            setAvailableClients(clients);
          }
        }
      } else {
        // Production mode: Get region from command center
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
          console.warn("Could not get season type, defaulting to aeration");
        }

        try {
          const dailySession = await sessionService.getDailySession();
          
          if (dailySession && dailySession.routes) {
            const myRoutes = dailySession.routes
              .filter(r => r.assignedWorkerIds && r.assignedWorkerIds.includes(w.contractorId))
              .map(r => r.routeCode);
            
            myRoutes.sort((a, b) => a.localeCompare(b));
            setAssignedRoutes(myRoutes);
          }
        } catch (err) {
          console.warn("Could not load routes", err);
        }

        // Only load available clients if NOT in direct upgrade mode
        if (!isDirectUpgrade) {
          const activeSession = await sessionService.getActiveLogsheetSession(w.contractorId);
          if (activeSession) {
            const clients = activeSession.financialStore.map(tx => ({
              'Booking ID': tx.jobId,
              'First Name': tx.customerName.split(' ')[0],
              'Last Name': tx.customerName.split(' ').slice(1).join(' '),
              'Full Address': tx.address,
              'Route Number': tx.routeCode,
              'Price': tx.displayPrice || tx.price.toString(),
              'Home Phone': (tx as any).customerPhone || '',
              'Email Address': (tx as any).customerEmail || '',
              'Prepaid': (tx as any).isPrepaid ? 'x' : undefined,
              'Status': 'completed',
              'FO/BO/FP': (tx as any).serviceType,
              isContract: ['Upgrade'].includes(tx.type) || (tx.displayPrice && (tx.displayPrice.startsWith('SP') || tx.displayPrice.startsWith('RJ') || tx.displayPrice.startsWith('GF') || tx.displayPrice.startsWith('FSL'))),
              'Gate': (tx.itemDescription && tx.itemDescription.includes('[LG]')) ? 'x' : undefined
            } as MasterBooking));
            setAvailableClients(clients);
          }
        }
      }
    };
    init();
  }, [isDirectUpgrade, isTrainingMode]);

  // Filter recipes based on mode - for lawn_rejuv, no upgrades available
  const displayedRecipes = useMemo(() => {
    if (isDirectUpgrade) {
      // In lawn_rejuv, no upgrades available at all
      if (isLawnRejuvSeason) {
        return []; // No direct upgrades in lawn_rejuv
      }
      return availableRecipes.filter(r => r.type === 'Upgrade');
    }
    return availableRecipes;
  }, [availableRecipes, isDirectUpgrade, isLawnRejuvSeason]);

  const filteredClients = useMemo(() => {
    if (!selectedRecipe) return [];
    if (selectedRecipe.type === 'Upgrade') {
      return availableClients.filter(c => !c.isContract);
    } else {
      return availableClients;
    }
  }, [availableClients, selectedRecipe]);

  const handleRecipeSelect = (recipe: ContractRecipe) => {
    setSelectedRecipe(recipe);
    const initialAnswers: Record<string, string> = {};
    if (recipe.questions) recipe.questions.forEach(q => initialAnswers[q.id] = q.options[0]);
    setAnswers(initialAnswers);
    setPaymentInfo({ amount: '', method: '' });
    setExtraPaymentInfo('');
    setIsCreditPaid(false);
    setCcData(null);
    
    setSplitCash('');
    setSplitCheque('');
    setSplitEtransfer('');
    setSplitCreditCard('');
    setSplitEtransferEmail('');
    setSplitChequeNumber('');
    
    setPhoneError(null);
    setEmailError(null);
    setEtransferEmailError(null);
    setSplitEtransferEmailError(null);
    setPaymentMethodError(null);

    const defaultPropertyType = recipe.propertyTypes.length > 0 ? recipe.propertyTypes[0] : '';

    if (directUpgradeBooking) {
      setSelectedBooking(directUpgradeBooking);
      setFormData({
        firstName: directUpgradeBooking['First Name'] || '',
        lastName: directUpgradeBooking['Last Name'] || '',
        address: directUpgradeBooking['Full Address'] || '',
        phone: formatPhoneNumber(directUpgradeBooking['Home Phone'] || directUpgradeBooking['Cell Phone'] || ''),
        email: normalizeEmail(directUpgradeBooking['Email Address'] || ''),
        routeNumber: directUpgradeBooking['Route Number'] || '',
        notes: '',
        propertyType: directUpgradeBooking['FO/BO/FP'] || defaultPropertyType,
        hasLockedGate: directUpgradeBooking['Gate'] === 'x',
        hasSprinkler: false
      });
      setStep('ENTER_DETAILS');
    } else if (directUpgradeClient) {
      setSelectedBooking(null);
      setFormData({
        firstName: directUpgradeClient.firstName,
        lastName: directUpgradeClient.lastName,
        address: `${directUpgradeClient.houseNumber} ${directUpgradeClient.streetName}`.trim(),
        phone: directUpgradeClient.phone,
        email: directUpgradeClient.email,
        routeNumber: directUpgradeClient.routeCode,
        notes: '',
        propertyType: directUpgradeClient.propertyType || defaultPropertyType,
        hasLockedGate: false,
        hasSprinkler: false
      });
      setHouseNumber(directUpgradeClient.houseNumber);
      setStreetName(directUpgradeClient.streetName);
      setStep('ENTER_DETAILS');
    } else {
      setFormData({ 
        firstName: '', lastName: '', address: '', phone: '', email: '', 
        routeNumber: '', notes: '', propertyType: defaultPropertyType, 
        hasLockedGate: false, hasSprinkler: false 
      });
      setSelectedBooking(null);
      setStep('SELECT_CLIENT');
    }
  };

  const handleClientSelect = (booking: MasterBooking) => {
    setSelectedBooking(booking);
    const defaultPropertyType = selectedRecipe?.propertyTypes.length ? selectedRecipe.propertyTypes[0] : '';
    setFormData({
      firstName: booking['First Name'] || '',
      lastName: booking['Last Name'] || '',
      address: booking['Full Address'] || '',
      phone: formatPhoneNumber(booking['Home Phone'] || booking['Cell Phone'] || ''),
      email: normalizeEmail(booking['Email Address'] || ''),
      routeNumber: booking['Route Number'] || '',
      notes: '',
      propertyType: booking['FO/BO/FP'] || defaultPropertyType,
      hasLockedGate: booking['Gate'] === 'x',
      hasSprinkler: false
    });
    setPaymentInfo(prev => ({ ...prev, amount: '' }));
    setPhoneError(null);
    setEmailError(null);
    setEtransferEmailError(null);
    setSplitEtransferEmailError(null);
    setPaymentMethodError(null);
    setStep('ENTER_DETAILS');
  };

  const handleNewClient = () => {
    if (selectedRecipe?.type === 'Upgrade') return;
    setSelectedBooking(null);
    const defaultPropertyType = selectedRecipe?.propertyTypes.length ? selectedRecipe.propertyTypes[0] : '';
    setFormData({ 
      firstName: '', 
      lastName: '', 
      address: '', 
      phone: '', 
      email: '', 
      routeNumber: assignedRoutes.length > 0 ? assignedRoutes[0] : '', 
      notes: '', 
      propertyType: defaultPropertyType, 
      hasLockedGate: false, 
      hasSprinkler: false 
    });
    setPaymentInfo(prev => ({ ...prev, amount: '' }));
    setPhoneError(null);
    setEmailError(null);
    setEtransferEmailError(null);
    setSplitEtransferEmailError(null);
    setPaymentMethodError(null);
    setStep('ENTER_DETAILS');
  };

  const handleBack = () => {
    if (step === 'ENTER_DETAILS') {
      if (isDirectUpgrade) {
        setStep('SELECT_CONTRACT');
        setSelectedRecipe(null);
      } else {
        setStep('SELECT_CLIENT');
      }
    } else if (step === 'SELECT_CLIENT') {
      setStep('SELECT_CONTRACT');
      setSelectedRecipe(null);
    }
  };

  const handleSubmit = async () => {
    if (!selectedRecipe || !worker) return;
    if (saving) return;
    
    setError(null);

    // --- VALIDATION ---
    const pError = getPhoneValidationError(formData.phone);
    const eError = getEmailValidationError(formData.email);
    
    let etError: string | null = null;
    let splitEtError: string | null = null;
    
    if (isSplitPayment) {
      if ((parseFloat(splitEtransfer) || 0) > 0) {
        splitEtError = getEmailValidationError(splitEtransferEmail);
      }
    } else {
      etError = paymentInfo.method === 'E-Transfer' ? getEmailValidationError(extraPaymentInfo) : null;
    }
    
    const pmError = !paymentInfo.method ? 'Please select a payment method' : null;

    if (isSplitPayment && splitTotal <= 0) {
      setPhoneError(pError);
      setEmailError(eError);
      setPaymentMethodError('Please enter at least one split payment amount.');
      setError('Please enter at least one split payment amount.');
      return;
    }

    if (pError || eError || etError || splitEtError || pmError) {
      setPhoneError(pError);
      setEmailError(eError);
      setEtransferEmailError(etError);
      setSplitEtransferEmailError(splitEtError);
      setPaymentMethodError(pmError);
      setError('Please fix validation errors before saving.');
      return;
    }

    if (paymentInfo.method === 'Credit Card' && !isCreditPaid && !isSplitPayment) { 
      setError("Please process card first."); 
      return; 
    }
    
    if (isSplitPayment && splitCCNeedsProcessing) {
      setError("Please process credit card first.");
      return;
    }
    
    if (!isSplitPayment && !paymentInfo.amount) { 
      setError("Enter amount."); 
      return; 
    }

    setSaving(true);

    try {
      const isUpgrade = selectedRecipe.type === 'Upgrade';
      const isIOS = paymentInfo.method === 'IOS';

      let finalTotal: number;
      let creditAmount = 0;
      let isPrepaidSplit = false; 
      let finalPaymentMethod: string;
      let paymentBreakdown: Record<string, number> = {};

      const bookingForPrepaidCheck = directUpgradeBooking || selectedBooking;
      const isPrepaid = bookingForPrepaidCheck?.Prepaid === 'x';

      if (isSplitPayment) {
        finalTotal = Math.round(splitTotal * 100) / 100;
        finalPaymentMethod = 'Split';
        
        if ((parseFloat(splitCash) || 0) > 0) paymentBreakdown['Cash'] = parseFloat(splitCash);
        if ((parseFloat(splitCheque) || 0) > 0) paymentBreakdown['Cheque'] = parseFloat(splitCheque);
        if ((parseFloat(splitEtransfer) || 0) > 0) paymentBreakdown['E-Transfer'] = parseFloat(splitEtransfer);
        if ((parseFloat(splitCreditCard) || 0) > 0) paymentBreakdown['Credit Card'] = parseFloat(splitCreditCard);
        
        if (isUpgrade && bookingForPrepaidCheck && isPrepaid) {
          creditAmount = parseFloat(String(bookingForPrepaidCheck.Price).replace(/[^0-9.]/g, '')) || 0;
          finalTotal = creditAmount + splitTotal;
          paymentBreakdown['Prepaid'] = creditAmount;
          isPrepaidSplit = true;
        }
      } else {
        const inputAmount = parseFloat(paymentInfo.amount);
        finalPaymentMethod = isIOS ? 'IOS' : paymentInfo.method;

        if (isUpgrade && bookingForPrepaidCheck && isPrepaid) {
          creditAmount = parseFloat(String(bookingForPrepaidCheck.Price).replace(/[^0-9.]/g, '')) || 0;
          finalTotal = creditAmount + inputAmount;
          
          paymentBreakdown['Prepaid'] = creditAmount;
          const currentMethodKey = isIOS ? 'IOS' : paymentInfo.method;
          paymentBreakdown[currentMethodKey] = inputAmount;
          
          isPrepaidSplit = true; 
        } 
        else if (isUpgrade && bookingForPrepaidCheck) {
          finalTotal = inputAmount;
          const currentMethodKey = isIOS ? 'IOS' : paymentInfo.method;
          paymentBreakdown[currentMethodKey] = inputAmount;
          
          isPrepaidSplit = true;
        }
        else {
          finalTotal = inputAmount;
          const currentMethodKey = isIOS ? 'IOS' : paymentInfo.method;
          paymentBreakdown[currentMethodKey] = inputAmount;
          isPrepaidSplit = false;
        }
      }

      let finalNotes = formData.notes;
      if (answers['timing']) finalNotes += ` [${answers['timing']}]`; 
      if (formData.hasLockedGate) finalNotes += ' [LG]';

      let formattedDisplayPrice: string;
      if (selectedRecipe.displayPrefix) {
        formattedDisplayPrice = `${selectedRecipe.displayPrefix}${finalTotal.toFixed(2)}`;
      } else {
        formattedDisplayPrice = finalTotal.toFixed(2);
      }
      
      let finalAddress: string;
      if (directUpgradeBooking) {
        finalAddress = directUpgradeBooking['Full Address'] || '';
      } else if (directUpgradeClient) {
        finalAddress = `${houseNumber} ${streetName}`.trim();
      } else if (selectedBooking) {
        finalAddress = selectedBooking['Full Address'] || '';
      } else {
        finalAddress = `${houseNumber} ${streetName}`.trim();
      }

      let transactionId: string;
      if (isUpgrade && directUpgradeBooking) {
        transactionId = directUpgradeBooking['Booking ID'];
      } else if (isUpgrade && selectedBooking) {
        transactionId = selectedBooking['Booking ID'];
      } else {
        transactionId = `NEW-${generateUUID()}`;
      }

      const tx: SessionTransaction = {
        id: generateUUID(),
        jobId: transactionId,
        timestamp: new Date().toISOString(),
        customerId: "CLIENT",
        customerName: `${formData.firstName} ${formData.lastName}`,
        address: finalAddress,
        customerPhone: formData.phone,
        customerEmail: formData.email,
        
        workerId: worker.contractorId,
        workerName: worker.firstName,
        routeManagerName: 'RM',
        routeCode: formData.routeNumber,
        
        type: selectedRecipe.type as any,
        price: finalTotal, 
        displayPrice: formattedDisplayPrice, 
        serviceName: selectedRecipe.name, 
        
        paymentMethod: finalPaymentMethod,
        paymentBreakdown: paymentBreakdown, 
        isPaid: !isIOS && finalPaymentMethod !== 'Billed',
        
        ccFullNumber: ccData?.number,
        ccExpiry: ccData?.expiry,
        ccCVC: ccData?.cvc,
        
        etransferEmail: isSplitPayment 
          ? ((parseFloat(splitEtransfer) || 0) > 0 ? splitEtransferEmail : undefined)
          : (paymentInfo.method === 'E-Transfer' ? extraPaymentInfo : undefined),
        
        chequeNumber: isSplitPayment
          ? ((parseFloat(splitCheque) || 0) > 0 ? splitChequeNumber : undefined)
          : undefined,
        
        isWestSplit: isPrepaidSplit, 
        
        refId: selectedRecipe.id,
        items: [{ name: selectedRecipe.name, price: finalTotal }],
        itemDescription: finalNotes.trim(),
        serviceType: hasPropertyTypes ? formData.propertyType as any : undefined,
        
        region: region, 
        seasonId: `${region.toLowerCase()}-${seasonType}`
      } as any;

      // Use appropriate service based on training mode
      if (isTrainingMode) {
        await trainingService.completeJob(tx, tx.jobId, worker.contractorId);

        const session = await trainingService.getActiveLogsheetSession(worker.contractorId);
        if (session) {
          const newStats = trainingService.recalculateStats(session.financialStore, taxRate);
          await trainingService.updateLogsheetSession(session.id, { stats: newStats });
        }
      } else {
        await sessionService.completeJob(tx, tx.jobId, worker.contractorId);

        const session = await sessionService.getActiveLogsheetSession(worker.contractorId);
        if (session) {
          const newStats = sessionService.recalculateStats(session.financialStore, taxRate, seasonType);
          await sessionService.updateLogsheetSession(session.id, { stats: newStats });
        }
      }

      if (onSuccess) {
        onSuccess();
      }
      onClose();

    } catch (err) {
      console.error(err);
      setError("Failed to process sale.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            {step !== 'SELECT_CONTRACT' && (
              <button onClick={handleBack} className="p-1 hover:bg-gray-800 rounded-full transition-colors" disabled={saving}>
                <ArrowLeft className="text-gray-400" />
              </button>
            )}
            <h2 className="text-xl font-bold text-white">
              {step === 'SELECT_CONTRACT' 
                ? (isDirectUpgrade ? 'Select Upgrade Type' : 'Add Contract') 
                : selectedRecipe?.name}
            </h2>
            {isTrainingMode && (
              <span className="ml-2 px-2 py-0.5 bg-yellow-900/50 border border-yellow-600 rounded text-yellow-400 text-[10px] font-bold">
                TRAINING
              </span>
            )}
            {isLawnRejuvSeason && !isTrainingMode && (
              <span className="ml-2 px-2 py-0.5 bg-green-900/50 border border-green-600 rounded text-green-400 text-[10px] font-bold flex items-center gap-1">
                <Leaf size={10} /> LAWN REJUV
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded-full" disabled={saving}><X className="text-gray-400" /></button>
        </div>

        {error && <div className="bg-red-900/30 border-l-4 border-red-500 p-3 mx-4 mt-4 text-red-200 text-sm flex items-center gap-2"><AlertCircle size={16}/>{error}</div>}

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {step === 'SELECT_CONTRACT' && (
            <div className="space-y-4">
              {/* Season info banner for lawn_rejuv */}
              {isLawnRejuvSeason && (
                <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 text-sm text-green-300 flex items-center gap-2">
                  <Leaf size={16} />
                  <span>
                    <strong>Lawn Rejuvenation Season:</strong> Only Grub Control and After Care add-ons are available. No upgrades.
                  </span>
                </div>
              )}
              
              {/* Show message if direct upgrade but no upgrades available */}
              {isDirectUpgrade && displayedRecipes.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
                  <p>Upgrades are not available during Lawn Rejuvenation season.</p>
                  <button 
                    onClick={onClose}
                    className="mt-4 px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {displayedRecipes.length === 0 && !isDirectUpgrade ? (
                  <div className="col-span-2 text-center text-gray-500 py-8">
                    <p>No contracts available for your region/season.</p>
                  </div>
                ) : (
                  displayedRecipes.map(recipe => (
                    <button key={recipe.id} onClick={() => handleRecipeSelect(recipe)} className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:bg-gray-750 hover:border-cps-blue transition-all text-left group">
                      <h3 className="font-bold text-white group-hover:text-cps-blue mb-1">{recipe.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${recipe.type === 'Upgrade' ? 'bg-purple-900/30 text-purple-300' : 'bg-blue-900/30 text-blue-300'}`}>{recipe.type}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {step === 'SELECT_CLIENT' && (
            <div className="space-y-4">
              <h3 className="text-sm text-gray-400 font-medium">Select Client</h3>
              <div className="max-h-[60vh] overflow-y-auto space-y-1 border border-gray-700/50 rounded-lg p-1 custom-scrollbar mt-2">
                {filteredClients.length > 0 ? (
                  filteredClients.map(b => (
                    <button key={b['Booking ID']} onClick={() => handleClientSelect(b)} className="w-full text-left p-3 rounded flex justify-between items-center group transition-colors border border-transparent hover:bg-gray-800 hover:border-gray-700">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 group-hover:bg-gray-600 group-hover:text-white"><User size={16} /></div>
                        <div className="min-w-0"><div className="font-bold text-gray-200 group-hover:text-white truncate">{b['Full Address']}</div><div className="text-xs text-gray-500 flex items-center gap-1 truncate">{b['First Name']} {b['Last Name']}</div></div>
                      </div>
                      {b.isContract && <span className="text-[9px] bg-purple-900 text-purple-200 px-1 rounded border border-purple-700">Package</span>}
                    </button>
                  ))
                ) : (
                  <div className="text-gray-500 text-center py-4 italic">No eligible clients found.</div>
                )}
              </div>
              {selectedRecipe?.type === 'Add-On' && assignedRoutes.length > 0 && (
                <button onClick={handleNewClient} className="w-full py-3 bg-gray-800 border border-dashed border-gray-600 text-gray-300 rounded-lg mt-4 flex items-center justify-center gap-2 hover:bg-gray-750 transition-colors">
                  <Plus size={16}/> Create New Client Record
                </button>
              )}
            </div>
          )}

          {step === 'ENTER_DETAILS' && (
            <div className="space-y-6">
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Client Details</h4>
                {(selectedBooking || directUpgradeBooking) ? (
                  <div className="flex justify-between items-start">
                    <div><div className="font-bold text-white text-lg">{formData.firstName} {formData.lastName}</div><div className="text-gray-300">{formData.address}</div></div>
                    <div className="text-right text-sm text-gray-500"><div>{formData.phone}</div><div>{formData.email}</div></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" placeholder="First Name" value={formData.firstName} onChange={handleFirstNameChange} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" />
                    <input type="text" placeholder="Last Name" value={formData.lastName} onChange={handleLastNameChange} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" />
                    <input type="text" placeholder="#" value={houseNumber} onChange={e => setHouseNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white col-span-1" />
                    <input type="text" value={streetName} onChange={e => setStreetName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white col-span-1" placeholder="Street Name"/>
                    <div className="col-span-1">
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input 
                          type="text" 
                          placeholder="000 000 0000" 
                          value={formData.phone} 
                          onChange={handlePhoneChange}
                          maxLength={12}
                          className={`w-full bg-gray-800 border border-gray-700 rounded p-2 pl-9 text-white ${phoneError ? 'border-red-500' : ''}`}
                        />
                      </div>
                      {phoneError && <p className="text-red-400 text-[10px] mt-1">{phoneError}</p>}
                    </div>
                    <div className="col-span-1">
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                        <input 
                          type="email" 
                          placeholder="client@example.com" 
                          value={formData.email} 
                          onChange={handleEmailChange}
                          onBlur={handleEmailBlur}
                          className={`w-full bg-gray-800 border border-gray-700 rounded p-2 pl-9 text-white ${emailError ? 'border-red-500' : ''}`}
                        />
                      </div>
                      {emailError && <p className="text-red-400 text-[10px] mt-1">{emailError}</p>}
                    </div>
                  </div>
                )}
                
                {!selectedBooking && !directUpgradeBooking && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                    <select 
                      value={formData.routeNumber} 
                      onChange={e => setFormData({...formData, routeNumber: e.target.value})} 
                      className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono"
                    >
                      {assignedRoutes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                
                {(hasPropertyTypes || showGateAndSprinkler) && (
                  <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
                    {hasPropertyTypes && (
                      <div className={!showGateAndSprinkler ? 'col-span-2' : ''}>
                        <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Property Type</label>
                        <div className="flex gap-1">
                          {selectedRecipe!.propertyTypes.map(t => (
                            <button key={t} onClick={() => setFormData({...formData, propertyType: t})} className={`flex-1 py-1.5 text-xs rounded border transition-colors ${formData.propertyType === t ? 'bg-cps-blue border-cps-blue text-white' : 'bg-gray-700 border-gray-600 text-gray-400'}`}>{t}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {showGateAndSprinkler && (
                      <div className={`flex flex-col gap-2 justify-center ${!hasPropertyTypes ? 'col-span-2' : ''}`}>
                        <button onClick={() => setFormData({...formData, hasLockedGate: !formData.hasLockedGate})} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${formData.hasLockedGate ? 'bg-orange-900/30 border-orange-600 text-orange-200' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                          <Lock size={12}/> Locked Gate {formData.hasLockedGate && <Check size={10}/>}
                        </button>
                        <button onClick={() => setFormData({...formData, hasSprinkler: !formData.hasSprinkler})} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${formData.hasSprinkler ? 'bg-blue-900/30 border-blue-600 text-blue-200' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                          <Droplets size={12}/> Sprinklers {formData.hasSprinkler && <Check size={10}/>}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedRecipe?.questions?.map(q => (
                <div key={q.id}>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{q.label}</label>
                  <div className="flex gap-2">
                    {q.options.map(opt => (
                      <button key={opt} onClick={() => setAnswers({...answers, [q.id]: opt})} className={`flex-1 py-2 text-sm rounded-md border transition-colors ${answers[q.id] === opt ? 'bg-cps-blue border-cps-blue text-white' : 'bg-gray-800 border-gray-600 text-gray-300'}`}>{opt}</button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-300">Total Price</label>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      value={isSplitPayment ? splitTotal.toFixed(2) : paymentInfo.amount} 
                      onChange={e => setPaymentInfo({...paymentInfo, amount: e.target.value})}
                      onBlur={e => {
                        if (!isSplitPayment) {
                          const val = parseFloat(e.target.value);
                          if(!isNaN(val)) setPaymentInfo(prev => ({...prev, amount: (Math.round(val * 100) / 100).toFixed(2) }));
                        }
                      }} 
                      className={`w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none ${isSplitPayment ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={isSplitPayment}
                    />
                  </div>
                  
                  {!isSplitPayment && (
                    <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded-lg border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>
                  )}
                  
                  <div>
                    <select 
                      value={paymentInfo.method} 
                      onChange={handlePaymentMethodChange} 
                      className={`bg-gray-800 border rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none h-full ${
                        paymentMethodError ? 'border-red-500' : 'border-gray-700'
                      }`}
                    >
                      <option value="">-- Select --</option>
                      <option value="Cash">Cash</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="E-Transfer">E-Transfer</option>
                      <option value="Split Payment">Split Payment</option>
                      {supportsIOS && <option value="IOS">Invoice On Site</option>}
                    </select>
                  </div>
                </div>
                {paymentMethodError && <p className="text-red-400 text-[10px] mt-1">{paymentMethodError}</p>}
                {isSplitPayment && (
                  <p className="text-[10px] text-gray-500">Total calculated from split amounts</p>
                )}
                
                {paymentInfo.method === 'E-Transfer' && !isSplitPayment && (
                  <div className="relative animate-fade-in">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                    <input 
                      type="email" 
                      placeholder="Customer Email for E-Transfer" 
                      value={extraPaymentInfo} 
                      onChange={handleEtransferEmailChange}
                      onBlur={handleEtransferEmailBlur}
                      className={`w-full bg-gray-800 border rounded-lg py-2 pl-9 pr-4 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none ${
                        etransferEmailError ? 'border-red-500' : 'border-gray-700'
                      }`}
                    />
                    {etransferEmailError && <p className="text-red-400 text-[10px] mt-1">{etransferEmailError}</p>}
                  </div>
                )}

                {paymentInfo.method === 'Credit Card' && !isSplitPayment && (
                  <div className={`p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                    <span className="text-xs font-bold">{isCreditPaid ? "SECURED" : "SECURE CARD"}</span>
                    {!isCreditPaid && <button onClick={() => setShowCreditModal(true)} className="underline text-xs">Open Terminal</button>}
                  </div>
                )}

                {/* SPLIT PAYMENT FIELDS */}
                {isSplitPayment && (
                  <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-600 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-bold text-gray-300">Split Payment Amounts</h4>
                      <div className="text-sm font-mono font-bold text-green-400">
                        Total: ${splitTotal.toFixed(2)}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cash</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                          <input 
                            type="number" 
                            value={splitCash} 
                            onChange={(e) => setSplitCash(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white"
                            placeholder="0.00"
                            step="0.01"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                          <input 
                            type="number" 
                            value={splitCheque} 
                            onChange={(e) => setSplitCheque(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white"
                            placeholder="0.00"
                            step="0.01"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">E-Transfer</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                          <input 
                            type="number" 
                            value={splitEtransfer} 
                            onChange={(e) => setSplitEtransfer(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white"
                            placeholder="0.00"
                            step="0.01"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Credit Card</label>
                        <div className="relative">
                          <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                          <input 
                            type="number" 
                            value={splitCreditCard} 
                            onChange={(e) => {
                              setSplitCreditCard(e.target.value);
                              if (isCreditPaid) {
                                setIsCreditPaid(false);
                                setCcData(null);
                              }
                            }}
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-8 text-white"
                            placeholder="0.00"
                            step="0.01"
                          />
                        </div>
                      </div>
                    </div>

                    {(parseFloat(splitCheque) || 0) > 0 && (
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number</label>
                        <input 
                          value={splitChequeNumber} 
                          onChange={e => setSplitChequeNumber(e.target.value)} 
                          className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" 
                          placeholder="#001" 
                        />
                      </div>
                    )}
                    
                    {(parseFloat(splitEtransfer) || 0) > 0 && (
                      <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">E-Transfer Email *</label>
                        <input 
                          type="email" 
                          value={splitEtransferEmail} 
                          onChange={handleSplitEtransferEmailChange}
                          onBlur={handleSplitEtransferEmailBlur}
                          className={`w-full bg-gray-800 border rounded p-2 text-white ${
                            splitEtransferEmailError ? 'border-red-500' : 'border-gray-700'
                          }`}
                          placeholder="client@bank.com" 
                        />
                        {splitEtransferEmailError && <p className="text-red-400 text-[10px] mt-1">{splitEtransferEmailError}</p>}
                      </div>
                    )}
                    
                    {splitCCAmount > 0 && (
                      <div className={`p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                        <span className="text-sm font-medium">
                          {isCreditPaid ? `Card Secured for $${splitCCAmount.toFixed(2)}` : `Process $${splitCCAmount.toFixed(2)} on Card`}
                        </span>
                        {isCreditPaid ? (
                          <CheckCircle size={20}/>
                        ) : (
                          <button type="button" onClick={() => setShowCreditModal(true)} className="text-xs underline">Open Terminal</button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-4">
                <textarea placeholder="Additional Notes..." value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none h-20 focus:ring-2 focus:ring-cps-blue focus:outline-none" />
              </div>
            </div>
          )}
        </div>

        {step === 'ENTER_DETAILS' && (
          <div className="p-4 border-t border-gray-700 flex justify-end">
            <button 
              onClick={handleSubmit} 
              disabled={saving || (paymentInfo.method === 'Credit Card' && !isCreditPaid && !isSplitPayment) || (isSplitPayment && splitCCNeedsProcessing)}
              className="bg-cps-green hover:bg-green-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader size={18} className="animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <Check size={18} /> Complete Sale
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {showCreditModal && (
        <CreditCardModal 
          amount={isSplitPayment ? splitCreditCard : paymentInfo.amount}
          clientName={`${formData.firstName} ${formData.lastName}`}
          onClose={() => setShowCreditModal(false)} 
          onProcess={(details) => {
            setIsCreditPaid(true);
            setShowCreditModal(false);
            setCcData({
              number: details.number,
              expiry: details.expiry,
              cvc: details.cvc
            });
            if (!isSplitPayment) {
              setFormData(prev => ({ ...prev, notes: `${prev.notes} [CC Paid]`.trim() }));
            }
          }}
        />
      )}
    </div>
  );
};

export default AddContractModal;