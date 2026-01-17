// src/components/EditTransactionModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, DollarSign, User, MapPin, Phone, Mail, AlertCircle, FileText } from 'lucide-react';
import { sessionService } from '../lib/sessionService';

// Badge mapping (matches AddContractModal and ContractorJobs)
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC'
};

// Display price prefix mapping
const PREFIX_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP',
  'Lawn Rejuvenation': 'RJ',
  'Golf Course': 'GF'
};

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
    isWestSplit: false
  });
  
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Extract display price prefix from existing displayPrice
  const getDisplayPricePrefix = (displayPrice: string | undefined, items: Array<{ name: string; price: number }> | undefined): string => {
    // First check if displayPrice has a prefix
    if (displayPrice) {
      const prefixMatch = displayPrice.match(/^([A-Z]+)/);
      if (prefixMatch) {
        return prefixMatch[1];
      }
    }
    
    // Fall back to items[0].name mapping
    if (items && items.length > 0 && items[0].name) {
      return PREFIX_MAP[items[0].name] || '';
    }
    
    return '';
  };

  // Get badge info for display
  const getBadgeInfo = () => {
    const itemName = formData.items?.[0]?.name || '';
    const type = formData.type || '';

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
    return { label: 'DONE', className: 'bg-green-900/30 text-green-400 border-green-800' };
  };

  useEffect(() => {
    if (transaction && isOpen) {
      const price = String(transaction.price || 0);
      const method = transaction.paymentMethod || transaction.payment_method || 'Cash';
      const existingBreakdown = transaction.paymentBreakdown || {};
      const items = transaction.items || [];
      
      // If no breakdown exists, create one from the payment method and price
      const breakdown = Object.keys(existingBreakdown).length > 0 
        ? existingBreakdown 
        : { [method]: parseFloat(price) || 0 };
      
      // Map incoming data (handling both snake_case and camelCase variations)
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
        isWestSplit: transaction.isWestSplit || transaction.is_west_split || false
      });
    }
  }, [transaction, isOpen]);

  const handleChange = (field: string, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // When payment method changes to a non-Split value, update the breakdown
      if (field === 'paymentMethod' && value !== 'Split') {
        const price = parseFloat(prev.price) || 0;
        updated.paymentBreakdown = { [value]: price };
      }
      
      // When price changes, update displayPrice with prefix and sync items[0].price
      if (field === 'price') {
        const newPrice = parseFloat(value) || 0;
        const prefix = getDisplayPricePrefix(prev.displayPrice, prev.items);
        
        // Update displayPrice with prefix
        if (prefix) {
          updated.displayPrice = `${prefix}${newPrice.toFixed(2)}`;
        } else {
          updated.displayPrice = newPrice.toFixed(2);
        }
        
        // Update items[0].price if items exist
        if (prev.items && prev.items.length > 0) {
          updated.items = [{ ...prev.items[0], price: newPrice }];
        }
        
        // Update breakdown if not split
        if (prev.paymentMethod !== 'Split') {
          updated.paymentBreakdown = { [prev.paymentMethod]: newPrice };
        }
      }
      
      return updated;
    });
  };

  const handleSave = async () => {
    if (!transaction) return;

    setIsSaving(true);
    try {
      const updates = {
        customerName: formData.customerName,
        customerPhone: formData.phone,
        customerEmail: formData.email,
        address: formData.address,
        routeCode: formData.routeCode,
        price: parseFloat(formData.price) || 0,
        displayPrice: formData.displayPrice,
        paymentMethod: formData.paymentMethod,
        type: formData.type as 'Production' | 'Sale' | 'Upgrade' | 'Add-On',
        paymentBreakdown: formData.paymentBreakdown,
        items: formData.items,
        itemDescription: formData.itemDescription,
        serviceType: formData.serviceType,
        etransferEmail: formData.etransferEmail,
        chequeNumber: formData.chequeNumber,
        invoiceNumber: formData.invoiceNumber,
        isWestSplit: formData.isWestSplit,
        // Pass service name from items for customer_snapshot
        serviceName: formData.items?.[0]?.name || ''
      };
      
      await sessionService.updateTransaction(transaction.id, updates);
      
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

  if (!isOpen || !transaction) return null;

  const badge = getBadgeInfo();
  const serviceName = formData.items?.[0]?.name || '';

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
                                className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
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
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Property Type</label>
                    <div className="flex gap-1">
                        {['FP', 'FO', 'BO'].map(t => (
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
            </div>

            {/* 2. Transaction Details */}
            <div className="border-t border-gray-800 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Numeric Price ($)</label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-2.5 text-gray-500" size={14} />
                            <input 
                                type="number"
                                value={formData.price}
                                onChange={(e) => handleChange('price', e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-8 text-sm text-white focus:border-blue-500 outline-none font-mono"
                                step="0.01"
                            />
                        </div>
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

                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Method</label>
                    <select 
                        value={formData.paymentMethod}
                        onChange={(e) => handleChange('paymentMethod', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                    >
                        <option value="Cash">Cash</option>
                        <option value="Cheque">Cheque</option>
                        <option value="E-Transfer">E-Transfer</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Billed">Billed</option>
                        <option value="Prepaid">Prepaid</option>
                        <option value="IOS">IOS (Internal)</option>
                        <option value="Split">Split Payment</option>
                    </select>
                </div>

                {/* Conditional: E-Transfer Email */}
                {formData.paymentMethod === 'E-Transfer' && (
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
                {formData.paymentMethod === 'Cheque' && (
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
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Invoice Number</label>
                        <input 
                            type="text"
                            value={formData.invoiceNumber}
                            onChange={(e) => handleChange('invoiceNumber', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="INV-001"
                        />
                    </div>
                )}
            </div>

            {/* Split Payment Editor */}
            {formData.paymentMethod === 'Split' && (
                <div className="bg-gray-800 p-3 rounded border border-gray-600 animate-in slide-in-from-top-2">
                    <p className="text-xs text-yellow-400 mb-3 font-bold flex items-center gap-1">
                        <AlertCircle size={12}/> Split Breakdown:
                    </p>
                    {['Cash', 'Cheque', 'E-Transfer', 'Credit Card', 'Prepaid'].map(method => (
                        <div key={method} className="flex items-center justify-between mb-2 last:mb-0">
                            <span className="text-xs text-gray-400 w-24">{method}</span>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2 text-gray-500"/>
                                <input 
                                    type="number"
                                    placeholder="0.00"
                                    step="0.01"
                                    className="bg-gray-900 border border-gray-700 rounded p-1 pl-5 text-xs text-right w-28 text-white focus:border-yellow-500 outline-none"
                                    value={formData.paymentBreakdown?.[method] || ''}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        const newBreakdown = { ...formData.paymentBreakdown };
                                        if (val > 0) newBreakdown[method] = val;
                                        else delete newBreakdown[method];
                                        handleChange('paymentBreakdown', newBreakdown);
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                    
                    {/* Split total display */}
                    <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                        <span className="text-xs text-gray-400">Total</span>
                        <span className="text-sm font-mono font-bold text-green-400">
                            ${Object.values(formData.paymentBreakdown).reduce((sum, val) => sum + (Number(val) || 0), 0).toFixed(2)}
                        </span>
                    </div>

                    {/* E-Transfer email for split */}
                    {(formData.paymentBreakdown?.['E-Transfer'] || 0) > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-700">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-Transfer Email</label>
                            <input 
                                type="email"
                                value={formData.etransferEmail}
                                onChange={(e) => handleChange('etransferEmail', e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white focus:border-yellow-500 outline-none"
                                placeholder="client@bank.com"
                            />
                        </div>
                    )}

                    {/* Cheque number for split */}
                    {(formData.paymentBreakdown?.['Cheque'] || 0) > 0 && (
                        <div className="mt-3 pt-2 border-t border-gray-700">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cheque Number</label>
                            <input 
                                type="text"
                                value={formData.chequeNumber}
                                onChange={(e) => handleChange('chequeNumber', e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-xs text-white focus:border-yellow-500 outline-none"
                                placeholder="#001"
                            />
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
                disabled={isSaving || isDeleting}
                className="flex items-center gap-2 px-6 py-2 rounded bg-green-600 text-white font-bold hover:bg-green-500 transition-colors shadow-lg shadow-green-900/20 disabled:opacity-50"
            >
                <Save size={16} /> {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
        </div>

      </div>
    </div>
  );
};

export default EditTransactionModal;