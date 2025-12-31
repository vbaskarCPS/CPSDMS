// src/components/EditTransactionModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, DollarSign, User, MapPin, Phone, Mail, Tag, AlertCircle } from 'lucide-react';
import { sessionService } from '../lib/sessionService';

// Flexible interface to handle both SessionTransaction and the PayoutContractor data
interface TransactionData {
  id: string;
  jobId?: string;
  customerName?: string;
  customer_name?: string; // Handle snake_case variant
  address?: string;
  customerAddress?: string;
  routeCode?: string;
  price: number;
  displayPrice?: string;
  paymentMethod?: string;
  payment_method?: string;
  type?: string;
  item_name?: string; // Crucial for Badges
  customerPhone?: string;
  customer_phone?: string;
  customerEmail?: string;
  customer_email?: string;
  paymentBreakdown?: Record<string, number>;
  created_at?: string;
}

interface EditTransactionModalProps {
  transaction: TransactionData;
  isOpen: boolean; // Added for compatibility with PayoutContractor
  onClose: () => void;
  onUpdate?: () => void; // Optional trigger refresh
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ 
  transaction, 
  isOpen, 
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
    paymentBreakdown: {} as Record<string, number>
  });
  
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (transaction && isOpen) {
      // Map incoming data (handling both snake_case and camelCase variations)
      setFormData({
        customerName: transaction.customerName || transaction.customer_name || '',
        address: transaction.address || transaction.customerAddress || '',
        phone: transaction.customerPhone || transaction.customer_phone || '',
        email: transaction.customerEmail || transaction.customer_email || '',
        routeCode: transaction.routeCode || '',
        price: String(transaction.price || 0),
        displayPrice: transaction.displayPrice || String(transaction.price || 0),
        paymentMethod: transaction.paymentMethod || transaction.payment_method || 'Cash',
        itemName: transaction.item_name || transaction.type || '',
        type: transaction.type || 'Production',
        paymentBreakdown: transaction.paymentBreakdown || {}
      });
    }
  }, [transaction, isOpen]);

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
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
          item_name: formData.itemName, // Important for Badges
          type: formData.type,
          paymentBreakdown: formData.paymentBreakdown
      };
      
      // Call service update
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
      if (!confirm("Are you sure you want to revert this transaction? This will delete the record and reset the booking to pending (if applicable).")) return;
      
      setIsDeleting(true);
      try {
          // If jobId exists, use revert, otherwise use standard delete
          if (transaction.jobId) {
             await sessionService.revertTransaction(transaction.id, transaction.jobId);
          } else {
             // Fallback for standalone transactions
             // await sessionService.deleteTransaction(transaction.id); 
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-gray-900 rounded-lg w-full max-w-lg border border-gray-700 shadow-2xl p-6 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-800">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
             Edit Transaction
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

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

                {/* Contact Info (New) */}
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
            </div>

            {/* 2. Transaction Details */}
            <div className="border-t border-gray-800 pt-4 space-y-4">
                
                {/* Item Name (Crucial for Badges) */}
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Item / Service Name</label>
                    <div className="relative">
                        <Tag className="absolute left-3 top-2.5 text-gray-500" size={14} />
                        <input 
                            type="text"
                            value={formData.itemName}
                            onChange={(e) => handleChange('itemName', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="e.g. SP Pro, Rejuv, Det"
                        />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                        * Use keywords <strong>SP Pro, Rejuv, Det, Grub</strong> to auto-apply badges.
                    </p>
                </div>

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
                </div>
            </div>

            {/* Split Payment Editor (Only if 'Split' is selected) */}
            {formData.paymentMethod === 'Split' && (
                <div className="bg-gray-800 p-3 rounded border border-gray-600 animate-in slide-in-from-top-2">
                    <p className="text-xs text-yellow-400 mb-2 font-bold flex items-center gap-1">
                        <AlertCircle size={12}/> Split Breakdown:
                    </p>
                    {['Cash', 'Cheque', 'Credit Card', 'Prepaid'].map(method => (
                        <div key={method} className="flex items-center justify-between mb-2 last:mb-0">
                            <span className="text-xs text-gray-400 w-24">{method}</span>
                            <div className="relative">
                                <DollarSign size={10} className="absolute left-2 top-2 text-gray-500"/>
                                <input 
                                    type="number"
                                    placeholder="0.00"
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
                </div>
            )}
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