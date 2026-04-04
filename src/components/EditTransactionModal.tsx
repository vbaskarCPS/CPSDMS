// src/components/EditTransactionModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { X, Trash2, Save, DollarSign, User, MapPin, Phone, Mail, AlertCircle, FileText, CreditCard, Info } from 'lucide-react';
import { sessionService } from '../lib/sessionService';
import { ServiceFlags } from '../types';
import CreditCardModal from './CreditCardModal';

// Badge mapping (matches AddContractModal and ContractorJobs)
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

// Display price prefix mapping
const PREFIX_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP',
  'Lawn Rejuvenation': 'RJ',
  'Golf Course': 'GF'
};

// Service flag definitions for UI
const SERVICE_FLAGS: { key: keyof ServiceFlags; label: string; short: string; color: string }[] = [
  { key: 'aeration',   label: 'Aeration',    short: 'A', color: 'bg-blue-600 border-blue-500' },
  { key: 'dethatch',   label: 'Dethatch',    short: 'D', color: 'bg-orange-600 border-orange-500' },
  { key: 'fertilizer', label: 'Fertilizer',  short: 'F', color: 'bg-green-600 border-green-500' },
  { key: 'seed',       label: 'Seed',        short: 'S', color: 'bg-yellow-600 border-yellow-500' },
  { key: 'lime',       label: 'Lime',        short: 'L', color: 'bg-purple-600 border-purple-500' },
];

// Flexible interface to handle both SessionTransaction and the PayoutContractor data
interface TransactionData {
  id: string;
  jobId?: string;
  customerName?: string;
  customer_name?: string;
  address?: string;
  customerAddress?: string;
  routeCode?: string;
  price: number;
  displayPrice?: string;
  paymentMethod?: string;
  payment_method?: string;
  type?: string;
  item_name?: string;
  customerPhone?: string;
  customer_phone?: string;
  customerEmail?: string;
  customer_email?: string;
  paymentBreakdown?: Record<string, number>;
  created_at?: string;
  items?: Array<{ name: string; price: number }>;
  itemDescription?: string;
  item_description?: string;
  serviceType?: string;
  service_type?: string;
  etransferEmail?: string;
  etransfer_email?: string;
  chequeNumber?: string;
  cheque_number?: string;
  invoiceNumber?: string;
  invoice_number?: string;
  isWestSplit?: boolean;
  is_west_split?: boolean;
  ccFullNumber?: string;
  cc_full_number?: string;
  ccExpiry?: string;
  cc_expiry?: string;
  ccCVC?: string;
  cc_cvc?: string;
  services?: ServiceFlags;
}

interface EditTransactionModalProps {
  transaction: TransactionData | null;
  isOpen?: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ 
  transaction, 
  isOpen = true,
  onClose, 
  onUpdate 
}) => {
  const [formData, setFormData] = useState({
    customerName: '',
    address: '',
    phone: '',
    email: '',
    routeCode: '',
    price: '',
    displayPrice: '',
    paymentMethod: 'Cash',
    itemName: '',
    type: 'Production',
    paymentBreakdown: {} as Record<string, number>,
    items: [] as Array<{ name: string; price: number }>,
    itemDescription: '',
    serviceType: 'FP',
    etransferEmail: '',
    chequeNumber: '',
    invoiceNumber: '',
    isWestSplit: false,
    ccFullNumber: '',
    ccExpiry: '',
    ccCVC: '',
    services: undefined as ServiceFlags | undefined,
  });
  
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Credit Card Modal state
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [ccData, setCcData] = useState<{ number: string; expiry: string; cvc: string } | null>(null);

  // Split Payment state
  const [splitCash, setSplitCash] = useState('');
  const [splitCheque, setSplitCheque] = useState('');
  const [splitEtransfer, setSplitEtransfer] = useState('');
  const [splitCreditCard, setSplitCreditCard] = useState('');
  const [splitEtransferEmail, setSplitEtransferEmail] = useState('');
  const [splitChequeNumber, setSplitChequeNumber] = useState('');
  const [splitCcPaid, setSplitCcPaid] = useState(false);
  const [splitCcData, setSplitCcData] = useState<{ number: string; expiry: string; cvc: string } | null>(null);

  // Check if transaction is currently prepaid (uses live form state)
  const isPrepaid = useMemo(() => {
    const method = formData.paymentMethod;
    const breakdown = formData.paymentBreakdown || {};
    return method === 'Prepaid' || 'Prepaid' in breakdown;
  }, [formData.paymentMethod, formData.paymentBreakdown]);

  // Check if this is an imported prepaid (from spreadsheet) — informational only, no longer locks
  const isImportedPrepaid = useMemo((): boolean => {
    if (!transaction) return false;
    const originalMethod = transaction.paymentMethod || transaction.payment_method || '';
    const originalBreakdown = transaction.paymentBreakdown || {};
    const originalIsPrepaid = originalMethod === 'Prepaid' || 'Prepaid' in originalBreakdown;
    const isFromImport = Boolean(transaction.jobId && !transaction.jobId.startsWith('NEW-'));
    return originalIsPrepaid && isFromImport;
  }, [transaction]);

  // Determine if this is a split payment
  const isSplitPayment = formData.paymentMethod === 'Split';

  // Calculate split total
  const splitTotal = useMemo(() => {
    return (parseFloat(splitCash) || 0) + 
           (parseFloat(splitCheque) || 0) + 
           (parseFloat(splitEtransfer) || 0) + 
           (parseFloat(splitCreditCard) || 0);
  }, [splitCash, splitCheque, splitEtransfer, splitCreditCard]);

  // Check if split CC needs processing
  const splitCCAmount = parseFloat(splitCreditCard) || 0;
  const splitCCNeedsProcessing = splitCCAmount > 0 && !splitCcPaid;

  // Whether to show the service flags section
  const showServiceFlags = formData.services !== undefined;

  // Get allowed payment methods based on transaction type
  const allowedPaymentMethods = useMemo(() => {
    const type = formData.type;
    const itemName = formData.items?.[0]?.name || '';
    
    const baseMethods = ['Cash', 'Cheque', 'E-Transfer', 'Credit Card', 'Split'];
    const methodsWithPrepaid = [...baseMethods, 'Prepaid'];
    
    if (type === 'Production') {
      return [...methodsWithPrepaid, 'Billed'];
    }
    if (type === 'Sale') {
      return methodsWithPrepaid;
    }
    if (type === 'Add-On') {
      const iosEligible = ['Dethatching', 'Window Washing', 'Driveway Sealing', 'Hot Asphalt'];
      if (iosEligible.includes(itemName)) {
        return [...baseMethods, 'IOS'];
      }
      return baseMethods;
    }
    return baseMethods;
  }, [formData.type, formData.items]);

  // Get property type options based on service name
  const propertyTypeOptions = useMemo(() => {
    const serviceName = formData.items?.[0]?.name || '';
    if (serviceName === 'Driveway Sealing') return ['SS', 'SSP'];
    if (serviceName === 'Window Washing' || serviceName === 'Hot Asphalt') return [];
    return ['FP', 'FO', 'BO'];
  }, [formData.items]);

  const showPropertyType = propertyTypeOptions.length > 0;

  // Extract display price prefix from existing displayPrice
  const getDisplayPricePrefix = (displayPrice: string | undefined, items: Array<{ name: string; price: number }> | undefined): string => {
    if (displayPrice) {
      const prefixMatch = displayPrice.match(/^([A-Z]+)/);
      if (prefixMatch) return prefixMatch[1];
    }
    if (items && items.length > 0 && items[0].name) {
      return PREFIX_MAP[items[0].name] || '';
    }
    return '';
  };

  // Get badge info for display
  const getBadgeInfo = () => {
    const itemName = formData.items?.[0]?.name || '';
    const type = formData.type || '';

    if (BADGE_MAP[itemName]) {
      const label = BADGE_MAP[itemName];
      if (type === 'Upgrade') return { label, className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
      if (type === 'Add-On') return { label, className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
    }
    if (type === 'Upgrade') return { label: 'UPGRADE', className: 'bg-orange-900/30 text-orange-400 border-orange-800' };
    if (type === 'Add-On') return { label: 'ADD-ON', className: 'bg-blue-900/30 text-blue-400 border-blue-800' };
    if (type === 'Sale') return { label: 'SALE', className: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
    return { label: 'DONE', className: 'bg-green-900/30 text-green-400 border-green-800' };
  };

  // Mask card number for display
  const getMaskedCard = (fullNumber: string | undefined): string => {
    if (!fullNumber) return '';
    const cleaned = fullNumber.replace(/\s/g, '');
    if (cleaned.length < 4) return cleaned;
    return `****${cleaned.slice(-4)}`;
  };

  useEffect(() => {
    if (transaction && isOpen) {
      const price = String(transaction.price || 0);
      const method = transaction.paymentMethod || transaction.payment_method || 'Cash';
      const existingBreakdown = transaction.paymentBreakdown || {};
      const items = transaction.items || [];
      const existingCcNumber = transaction.ccFullNumber || transaction.cc_full_number || '';
      
      const breakdown = Object.keys(existingBreakdown).length > 0 
        ? existingBreakdown 
        : { [method]: parseFloat(price) || 0 };
      
      setFormData({
        customerName: transaction.customerName || transaction.customer_name || '',
        address: transaction.address || transaction.customerAddress || '',
        phone: transaction.customerPhone || transaction.customer_phone || '',
        email: transaction.customerEmail || transaction.customer_email || '',
        routeCode: transaction.routeCode || '',
        price: price,
        displayPrice: transaction.displayPrice || price,
        paymentMethod: method,
        itemName: transaction.item_name || transaction.type || '',
        type: transaction.type || 'Production',
        paymentBreakdown: breakdown,
        items: items,
        itemDescription: transaction.itemDescription || transaction.item_description || '',
        serviceType: transaction.serviceType || transaction.service_type || 'FP',
        etransferEmail: transaction.etransferEmail || transaction.etransfer_email || '',
        chequeNumber: transaction.chequeNumber || transaction.cheque_number || '',
        invoiceNumber: transaction.invoiceNumber || transaction.invoice_number || '',
        isWestSplit: transaction.isWestSplit || transaction.is_west_split || false,
        ccFullNumber: existingCcNumber,
        ccExpiry: transaction.ccExpiry || transaction.cc_expiry || '',
        ccCVC: transaction.ccCVC || transaction.cc_cvc || '',
        services: transaction.services,
      });

      if (existingCcNumber) {
        setIsCreditPaid(true);
        setCcData({
          number: existingCcNumber,
          expiry: transaction.ccExpiry || transaction.cc_expiry || '',
          cvc: transaction.ccCVC || transaction.cc_cvc || ''
        });
      }

      if (method === 'Split' && Object.keys(existingBreakdown).length > 0) {
        setSplitCash(String(existingBreakdown['Cash'] || ''));
        setSplitCheque(String(existingBreakdown['Cheque'] || ''));
        setSplitEtransfer(String(existingBreakdown['E-Transfer'] || ''));
        setSplitCreditCard(String(existingBreakdown['Credit Card'] || ''));
        setSplitEtransferEmail(transaction.etransferEmail || transaction.etransfer_email || '');
        setSplitChequeNumber(transaction.chequeNumber || transaction.cheque_number || '');
        
        if (existingBreakdown['Credit Card'] && existingCcNumber) {
          setSplitCcPaid(true);
          setSplitCcData({
            number: existingCcNumber,
            expiry: transaction.ccExpiry || transaction.cc_expiry || '',
            cvc: transaction.ccCVC || transaction.cc_cvc || ''
          });
        }
      }
    }
  }, [transaction, isOpen]);

  const handleChange = (field: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      if (field === 'price') {
        const newPrice = parseFloat(value) || 0;
        const prefix = getDisplayPricePrefix(prev.displayPrice, prev.items);
        updated.displayPrice = prefix ? `${prefix}${newPrice.toFixed(2)}` : newPrice.toFixed(2);
        if (prev.items && prev.items.length > 0) {
          updated.items = [{ ...prev.items[0], price: newPrice }];
        }
        if (prev.paymentMethod !== 'Split') {
          updated.paymentBreakdown = { [prev.paymentMethod]: newPrice };
        }
      }
      
      return updated;
    });
  };

  const handleServiceFlagToggle = (key: keyof ServiceFlags) => {
    setFormData(prev => ({
      ...prev,
      services: {
        ...prev.services,
        [key]: !prev.services?.[key],
      }
    }));
  };

  const handlePaymentMethodChange = (newMethod: string) => {
    const price = parseFloat(formData.price) || 0;
    
    if (newMethod !== 'Split') {
      setSplitCash('');
      setSplitCheque('');
      setSplitEtransfer('');
      setSplitCreditCard('');
      setSplitEtransferEmail('');
      setSplitChequeNumber('');
      setSplitCcPaid(false);
      setSplitCcData(null);
    }
    
    if (newMethod !== 'Credit Card' && newMethod !== 'Split') {
      setIsCreditPaid(false);
      setCcData(null);
    }
    
    setFormData(prev => ({
      ...prev,
      paymentMethod: newMethod,
      paymentBreakdown: newMethod === 'Split' ? {} : { [newMethod]: price }
    }));
    
    if (newMethod === 'Credit Card') {
      setShowCreditModal(true);
    }
  };

  const handleCreditCardProcess = (details: { number: string; expiry: string; cvc: string }) => {
    setIsCreditPaid(true);
    setCcData(details);
    setShowCreditModal(false);
  };

  const handleSplitCreditCardProcess = (details: { number: string; expiry: string; cvc: string }) => {
    setSplitCcPaid(true);
    setSplitCcData(details);
    setShowCreditModal(false);
  };

  const handleSave = async () => {
    if (!transaction) return;
    if (isSaving) return;

    setIsSaving(true);
    try {
      let finalPrice: number;
      let finalPaymentMethod: string;
      let finalBreakdown: Record<string, number>;
      let finalEtransferEmail: string | undefined;
      let finalChequeNumber: string | undefined;
      let finalCcData: { number: string; expiry: string; cvc: string } | null = null;

      if (isSplitPayment) {
        finalPrice = Math.round(splitTotal * 100) / 100;
        finalPaymentMethod = 'Split';
        finalBreakdown = {};
        if ((parseFloat(splitCash) || 0) > 0) finalBreakdown['Cash'] = parseFloat(splitCash);
        if ((parseFloat(splitCheque) || 0) > 0) finalBreakdown['Cheque'] = parseFloat(splitCheque);
        if ((parseFloat(splitEtransfer) || 0) > 0) finalBreakdown['E-Transfer'] = parseFloat(splitEtransfer);
        if ((parseFloat(splitCreditCard) || 0) > 0) finalBreakdown['Credit Card'] = parseFloat(splitCreditCard);
        finalEtransferEmail = (parseFloat(splitEtransfer) || 0) > 0 ? splitEtransferEmail : undefined;
        finalChequeNumber = (parseFloat(splitCheque) || 0) > 0 ? splitChequeNumber : undefined;
        finalCcData = splitCcPaid ? splitCcData : null;
      } else {
        finalPrice = parseFloat(formData.price) || 0;
        finalPaymentMethod = formData.paymentMethod;
        finalBreakdown = { [formData.paymentMethod]: finalPrice };
        finalEtransferEmail = formData.paymentMethod === 'E-Transfer' ? formData.etransferEmail : undefined;
        finalChequeNumber = formData.paymentMethod === 'Cheque' ? formData.chequeNumber : undefined;
        finalCcData = (formData.paymentMethod === 'Credit Card' && isCreditPaid) ? ccData : null;
      }

      const prefix = getDisplayPricePrefix(formData.displayPrice, formData.items);
      const finalDisplayPrice = prefix ? `${prefix}${finalPrice.toFixed(2)}` : finalPrice.toFixed(2);

      const updates = {
        customerName: formData.customerName,
        customerPhone: formData.phone,
        customerEmail: formData.email,
        address: formData.address,
        routeCode: formData.routeCode,
        price: finalPrice,
        displayPrice: finalDisplayPrice,
        paymentMethod: finalPaymentMethod,
        type: formData.type as 'Production' | 'Sale' | 'Upgrade' | 'Add-On',
        paymentBreakdown: finalBreakdown,
        items: formData.items.length > 0 ? [{ ...formData.items[0], price: finalPrice }] : formData.items,
        itemDescription: formData.itemDescription,
        serviceType: formData.serviceType,
        etransferEmail: finalEtransferEmail,
        chequeNumber: finalChequeNumber,
        invoiceNumber: formData.paymentMethod === 'Billed' ? formData.invoiceNumber : undefined,
        isWestSplit: formData.isWestSplit,
        serviceName: formData.items?.[0]?.name || '',
        ccFullNumber: finalCcData?.number,
        ccExpiry: finalCcData?.expiry,
        ccCVC: finalCcData?.cvc,
        services: formData.services,
      };
      
      await sessionService.updateTransaction(transaction.id, updates as any);
      
      if (onUpdate) onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to update transaction", error);
      alert("Error updating transaction.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevert = async () => {
    if (!transaction) return;
    if (!confirm("Are you sure you want to revert this transaction? This will delete the record and reset the booking to pending (if applicable).")) return;
    
    setIsDeleting(true);
    try {
      if (transaction.jobId) {
        await sessionService.revertTransaction(transaction.id, transaction.jobId);
      } else {
        console.log("Delete logic here if no jobId");
      }
      if (onUpdate) onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to revert", error);
      alert("Error reverting transaction.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Validation: Can save?
  const canSave = useMemo(() => {
    if (isSaving || isDeleting) return false;
    if (formData.paymentMethod === 'Credit Card' && !isCreditPaid) return false;
    if (isSplitPayment && splitCCNeedsProcessing) return false;
    if (isSplitPayment && splitTotal <= 0) return false;
    return true;
  }, [isSaving, isDeleting, formData.paymentMethod, isCreditPaid, isSplitPayment, splitCCNeedsProcessing, splitTotal]);

  if (!isOpen || !transaction) return null;

  const badge = getBadgeInfo();
  const serviceName = formData.items?.[0]?.name || '';
  const maskedCard = getMaskedCard(formData.ccFullNumber);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gray-900 rounded-lg w-full max-w-lg border border-gray-700 shadow-2xl p-6 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-white">Edit Transaction</h3>
            <span className={`text-[10px] font-bold px-2 py-1 rounded border ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Imported Prepaid Info Banner — informational only, no longer locks */}
        {isImportedPrepaid && (
          <div className="mb-4 p-3 bg-indigo-900/20 border border-indigo-700 rounded-lg flex items-center gap-2">
            <Info size={16} className="text-indigo-400" />
            <span className="text-sm text-indigo-300">This is an imported prepaid transaction.</span>
          </div>
        )}

        {/* Non-imported Prepaid Info Banner */}
        {isPrepaid && !isImportedPrepaid && (
          <div className="mb-4 p-3 bg-indigo-900/20 border border-indigo-700 rounded-lg flex items-center gap-2">
            <Info size={16} className="text-indigo-400" />
            <span className="text-sm text-indigo-300">This is a Prepaid Transaction</span>
          </div>
        )}

        {/* Service Name Display (Read-only) */}
        {serviceName && (
          <div className="mb-4 p-2 bg-gray-800/50 rounded border border-gray-700">
            <span className="text-[10px] font-bold text-gray-500 uppercase">Service</span>
            <p className="text-sm text-white font-medium">{serviceName}</p>
          </div>
        )}

        {/* Form Body */}
        <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 flex-1">
            
            {/* 1. Client Details */}
            <div className="space-y-4">
                {/* Name & Route */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Customer Name</label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 text-gray-500" size={14} />
                            <input 
                                type="text"
                                value={formData.customerName}
                                onChange={(e) => handleChange('customerName', e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 outline-none transition-all"
                                placeholder="John Doe"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Route Code</label>
                        <input 
                            type="text"
                            value={formData.routeCode}
                            onChange={(e) => handleChange('routeCode', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none font-mono"
                            placeholder="A1"
                        />
                    </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone Number</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-2.5 text-gray-500" size={14} />
                            <input 
                                type="text"
                                value={formData.phone}
                                onChange={(e) => handleChange('phone', e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 outline-none"
                                placeholder="(555) 123-4567"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 text-gray-500" size={14} />
                            <input 
                                type="email"
                                value={formData.email}
                                onChange={(e) => handleChange('email', e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 outline-none"
                                placeholder="client@example.com"
                            />
                        </div>
                    </div>
                </div>

                {/* Address */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Address</label>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-2.5 text-gray-500" size={14} />
                        <input 
                            type="text"
                            value={formData.address}
                            onChange={(e) => handleChange('address', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="123 Main St"
                        />
                    </div>
                </div>

                {/* Property Type */}
                {showPropertyType && (
                  <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Property Type</label>
                      <div className="flex gap-1">
                          {propertyTypeOptions.map(t => (
                              <button 
                                  key={t} 
                                  type="button"
                                  onClick={() => handleChange('serviceType', t)} 
                                  className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                                      formData.serviceType === t 
                                          ? 'bg-blue-600 border-blue-500 text-white' 
                                          : 'bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600'
                                  }`}
                              >
                                  {t}
                              </button>
                          ))}
                      </div>
                  </div>
                )}

                {/* Service Flags (A/D/F/S/L) — only shown for lawn rejuv transactions */}
                {showServiceFlags && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Services</label>
                    <div className="flex gap-1">
                      {SERVICE_FLAGS.map(flag => {
                        const isActive = formData.services?.[flag.key] === true;
                        return (
                          <button
                            key={flag.key}
                            type="button"
                            onClick={() => handleServiceFlagToggle(flag.key)}
                            title={flag.label}
                            className={`flex-1 py-1.5 text-xs font-bold rounded border transition-colors ${
                              isActive
                                ? `${flag.color} text-white`
                                : 'bg-gray-700 border-gray-600 text-gray-400 hover:bg-gray-600'
                            }`}
                          >
                            {flag.short}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-gray-600 mt-1">
                      {SERVICE_FLAGS.map(f => `${f.short}=${f.label}`).join(' · ')}
                    </p>
                  </div>
                )}
            </div>

            {/* 2. Transaction Details */}
            <div className="border-t border-gray-800 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Price ($)</label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 text-gray-500" size={14} />
                            <input 
                                type="number"
                                value={isSplitPayment ? splitTotal.toFixed(2) : formData.price}
                                onChange={(e) => handleChange('price', e.target.value)}
                                disabled={isSplitPayment}
                                className={`w-full bg-gray-800 border border-gray-600 rounded p-2 pl-8 text-sm text-white focus:border-blue-500 outline-none font-mono ${isSplitPayment ? 'opacity-50 cursor-not-allowed' : ''}`}
                                step="0.01"
                            />
                        </div>
                        {isSplitPayment && <p className="text-[9px] text-gray-500 mt-1">Calculated from split</p>}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Display Price</label>
                        <input 
                            type="text"
                            value={formData.displayPrice}
                            disabled
                            className="w-full bg-gray-800/50 border border-gray-700 rounded p-2 text-sm text-gray-400 font-mono cursor-not-allowed"
                            title="Auto-calculated from price"
                        />
                    </div>
                </div>

                {/* Payment Method */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Method</label>
                    <select 
                        value={formData.paymentMethod}
                        onChange={(e) => handlePaymentMethodChange(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                    >
                        {allowedPaymentMethods.map(method => (
                            <option key={method} value={method}>{method}</option>
                        ))}
                    </select>
                </div>

                {/* Conditional: E-Transfer Email */}
                {formData.paymentMethod === 'E-Transfer' && !isSplitPayment && (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-Transfer Email</label>
                        <input 
                            type="email"
                            value={formData.etransferEmail}
                            onChange={(e) => handleChange('etransferEmail', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="client@bank.com"
                        />
                    </div>
                )}

                {/* Conditional: Cheque Number */}
                {formData.paymentMethod === 'Cheque' && !isSplitPayment && (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cheque Number</label>
                        <input 
                            type="text"
                            value={formData.chequeNumber}
                            onChange={(e) => handleChange('chequeNumber', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="#001"
                        />
                    </div>
                )}

                {/* Conditional: Invoice Number */}
                {formData.paymentMethod === 'Billed' && (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Invoice Number (Optional)</label>
                        <input 
                            type="text"
                            value={formData.invoiceNumber}
                            onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="INV-001"
                        />
                    </div>
                )}

                {/* Conditional: Credit Card Status */}
                {formData.paymentMethod === 'Credit Card' && !isSplitPayment && (
                    <div className={`p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600' : 'bg-blue-900/20 border-blue-600'}`}>
                        <div className="flex items-center gap-2">
                            <CreditCard size={16} className={isCreditPaid ? 'text-green-400' : 'text-blue-300'} />
                            <span className={`text-sm font-medium ${isCreditPaid ? 'text-green-400' : 'text-blue-300'}`}>
                                {isCreditPaid ? `Card on file: ${maskedCard || '****'}` : 'No card on file'}
                            </span>
                        </div>
                        <button 
                            type="button" 
                            onClick={() => setShowCreditModal(true)}
                            className="text-xs underline text-blue-300 hover:text-blue-200"
                        >
                            {isCreditPaid ? 'Re-enter' : 'Add Card'}
                        </button>
                    </div>
                )}
            </div>

            {/* Split Payment Editor */}
            {isSplitPayment && (
                <div className="bg-gray-800 p-3 rounded border border-gray-600">
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-yellow-400 font-bold flex items-center gap-1">
                            <AlertCircle size={12}/> Split Breakdown
                        </p>
                        <span className="text-sm font-mono font-bold text-green-400">
                            Total: ${splitTotal.toFixed(2)}
                        </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        {/* Cash */}
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">Cash</label>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2.5 text-gray-500"/>
                                <input 
                                    type="number" placeholder="0.00" step="0.01"
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 pl-5 text-xs text-white focus:border-yellow-500 outline-none"
                                    value={splitCash} onChange={(e) => setSplitCash(e.target.value)}
                                />
                            </div>
                        </div>
                        {/* Cheque */}
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">Cheque</label>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2.5 text-gray-500"/>
                                <input 
                                    type="number" placeholder="0.00" step="0.01"
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 pl-5 text-xs text-white focus:border-yellow-500 outline-none"
                                    value={splitCheque} onChange={(e) => setSplitCheque(e.target.value)}
                                />
                            </div>
                        </div>
                        {/* E-Transfer */}
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">E-Transfer</label>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2.5 text-gray-500"/>
                                <input 
                                    type="number" placeholder="0.00" step="0.01"
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 pl-5 text-xs text-white focus:border-yellow-500 outline-none"
                                    value={splitEtransfer} onChange={(e) => setSplitEtransfer(e.target.value)}
                                />
                            </div>
                        </div>
                        {/* Credit Card */}
                        <div>
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">Credit Card</label>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2.5 text-gray-500"/>
                                <input 
                                    type="number" placeholder="0.00" step="0.01"
                                    className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 pl-5 text-xs text-white focus:border-yellow-500 outline-none"
                                    value={splitCreditCard}
                                    onChange={(e) => {
                                        setSplitCreditCard(e.target.value);
                                        if (splitCcPaid) { setSplitCcPaid(false); setSplitCcData(null); }
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {(parseFloat(splitCheque) || 0) > 0 && (
                        <div className="mb-3">
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">Cheque Number</label>
                            <input type="text" value={splitChequeNumber} onChange={(e) => setSplitChequeNumber(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-yellow-500 outline-none" placeholder="#001" />
                        </div>
                    )}

                    {(parseFloat(splitEtransfer) || 0) > 0 && (
                        <div className="mb-3">
                            <label className="text-[10px] text-gray-500 uppercase mb-1 block">E-Transfer Email</label>
                            <input type="email" value={splitEtransferEmail} onChange={(e) => setSplitEtransferEmail(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white focus:border-yellow-500 outline-none" placeholder="client@bank.com" />
                        </div>
                    )}

                    {splitCCAmount > 0 && (
                        <div className={`p-2 rounded border flex items-center justify-between ${splitCcPaid ? 'bg-green-900/20 border-green-600' : 'bg-blue-900/20 border-blue-600'}`}>
                            <div className="flex items-center gap-2">
                                <CreditCard size={14} className={splitCcPaid ? 'text-green-400' : 'text-blue-300'} />
                                <span className={`text-xs font-medium ${splitCcPaid ? 'text-green-400' : 'text-blue-300'}`}>
                                    {splitCcPaid ? `Card secured: $${splitCCAmount.toFixed(2)}` : `Process $${splitCCAmount.toFixed(2)} on card`}
                                </span>
                            </div>
                            {!splitCcPaid && (
                                <button type="button" onClick={() => setShowCreditModal(true)} className="text-[10px] underline text-blue-300 hover:text-blue-200">Open Terminal</button>
                            )}
                            {splitCcPaid && (
                                <button type="button" onClick={() => setShowCreditModal(true)} className="text-[10px] underline text-green-300 hover:text-green-200">Re-enter</button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Notes / Item Description */}
            <div className="border-t border-gray-800 pt-4">
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                    <FileText size={12} /> Notes / Description
                </label>
                <textarea 
                    value={formData.itemDescription}
                    onChange={(e) => handleChange('itemDescription', e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none resize-none h-20"
                    placeholder="Additional notes, flags like [LG], [Spring], etc."
                />
            </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex justify-between items-center pt-4 border-t border-gray-800">
            <button
                onClick={handleRevert}
                disabled={isDeleting || isSaving}
                className="flex items-center gap-2 px-4 py-2 rounded bg-red-900/20 text-red-400 border border-red-900/50 hover:bg-red-900/40 transition-colors text-sm font-bold disabled:opacity-50"
            >
                {isDeleting ? 'Processing...' : <><Trash2 size={16} /> Delete / Revert</>}
            </button>

            <button
                onClick={handleSave}
                disabled={!canSave}
                className="flex items-center gap-2 px-6 py-2 rounded bg-green-600 text-white font-bold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Save size={16} /> {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
        </div>
      </div>

      {/* Credit Card Modal */}
      {showCreditModal && (
        <CreditCardModal 
          amount={isSplitPayment ? splitCreditCard : formData.price}
          clientName={formData.customerName}
          onClose={() => setShowCreditModal(false)}
          onProcess={isSplitPayment ? handleSplitCreditCardProcess : handleCreditCardProcess}
        />
      )}
    </div>
  );
};

export default EditTransactionModal;