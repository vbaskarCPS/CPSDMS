// src/components/EditTransactionModal.tsx
import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, DollarSign, User, MapPin } from 'lucide-react';
import { SessionTransaction } from '../types';
import { sessionService } from '../lib/sessionService';

interface EditTransactionModalProps {
  transaction: SessionTransaction;
  onClose: () => void;
  onUpdate: () => void; // Trigger refresh
}

const EditTransactionModal: React.FC<EditTransactionModalProps> = ({ transaction, onClose, onUpdate }) => {
  const [formData, setFormData] = useState({
    customerName: '',
    address: '',
    routeCode: '',
    price: '',
    displayPrice: '',
    paymentMethod: 'Cash',
    type: 'Production',
    paymentBreakdown: {} as Record<string, number>
  });
  
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    // Populate form with existing data
    setFormData({
      customerName: transaction.customerName || '',
      address: transaction.address || '',
      routeCode: transaction.routeCode || '',
      price: String(transaction.price),
      displayPrice: transaction.displayPrice || String(transaction.price),
      paymentMethod: transaction.paymentMethod,
      type: transaction.type,
      paymentBreakdown: transaction.paymentBreakdown || {}
    });
  }, [transaction]);

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      const updates: Partial<SessionTransaction> = {
          customerName: formData.customerName,
          address: formData.address,
          routeCode: formData.routeCode,
          price: parseFloat(formData.price),
          displayPrice: formData.displayPrice,
          paymentMethod: formData.paymentMethod,
          type: formData.type as any,
          paymentBreakdown: formData.paymentBreakdown
      };
      
      await sessionService.updateTransaction(transaction.id, updates);
      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to update transaction", error);
      alert("Error updating transaction.");
    }
  };

  const handleRevert = async () => {
      if (!confirm("Are you sure you want to revert this transaction? This will delete the record and reset the booking to pending (if applicable).")) return;
      
      setIsDeleting(true);
      try {
          await sessionService.revertTransaction(transaction.id, transaction.jobId);
          onUpdate();
          onClose();
      } catch (error) {
          console.error("Failed to revert", error);
          alert("Error reverting transaction.");
          setIsDeleting(false);
      }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 rounded-lg w-full max-w-lg border border-gray-700 shadow-2xl p-6">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6 pb-2 border-b border-gray-800">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
             Edit Transaction
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Form Body */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
            
            {/* 1. Client Details */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Customer Name</label>
                    <div className="relative">
                        <User className="absolute left-3 top-2.5 text-gray-500" size={14} />
                        <input 
                            type="text"
                            value={formData.customerName}
                            onChange={(e) => handleChange('customerName', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-cps-blue outline-none"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Route Code</label>
                    <input 
                        type="text"
                        value={formData.routeCode}
                        onChange={(e) => handleChange('routeCode', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-cps-blue outline-none font-mono"
                    />
                </div>
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Address</label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 text-gray-500" size={14} />
                    <input 
                        type="text"
                        value={formData.address}
                        onChange={(e) => handleChange('address', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-9 text-sm text-white focus:border-cps-blue outline-none"
                    />
                </div>
            </div>

            {/* 2. Financials */}
            <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Numeric Price ($)</label>
                    <div className="relative">
                        <DollarSign className="absolute left-3 top-2.5 text-gray-500" size={14} />
                        <input 
                            type="number"
                            value={formData.price}
                            onChange={(e) => handleChange('price', e.target.value)}
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 pl-8 text-sm text-white focus:border-cps-blue outline-none font-mono"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Display (e.g., $50 or RJ)</label>
                    <input 
                        type="text"
                        value={formData.displayPrice}
                        onChange={(e) => handleChange('displayPrice', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-cps-blue outline-none font-mono"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Payment Method</label>
                    <select 
                        value={formData.paymentMethod}
                        onChange={(e) => handleChange('paymentMethod', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-cps-blue outline-none"
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
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label>
                    <select 
                        value={formData.type}
                        onChange={(e) => handleChange('type', e.target.value)}
                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-cps-blue outline-none"
                    >
                        <option value="Production">Production</option>
                        <option value="Sale">New Sale</option>
                        <option value="Upgrade">Upgrade</option>
                        <option value="Add-On">Add-On</option>
                    </select>
                </div>
            </div>

            {/* Split Payment Editor (Only if 'Split' is selected) */}
            {formData.paymentMethod === 'Split' && (
                <div className="bg-gray-800 p-3 rounded border border-gray-600">
                    <p className="text-xs text-yellow-400 mb-2">Split Breakdown Editor:</p>
                    {['Cash', 'Cheque', 'Credit Card', 'Prepaid'].map(method => (
                        <div key={method} className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400 w-24">{method}</span>
                            <input 
                                type="number"
                                placeholder="0.00"
                                className="bg-gray-900 border border-gray-700 rounded p-1 text-xs text-right w-24 text-white"
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
                    ))}
                </div>
            )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex justify-between items-center pt-4 border-t border-gray-800">
            <button
                onClick={handleRevert}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 rounded bg-red-900/20 text-red-400 border border-red-900/50 hover:bg-red-900/40 transition-colors text-sm font-bold"
            >
                {isDeleting ? 'Reverting...' : <><Trash2 size={16} /> Revert / Delete</>}
            </button>

            <button
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-2 rounded bg-cps-blue text-white font-bold hover:bg-blue-600 transition-colors shadow-lg shadow-blue-900/20"
            >
                <Save size={16} /> Save Changes
            </button>
        </div>

      </div>
    </div>
  );
};

export default EditTransactionModal;