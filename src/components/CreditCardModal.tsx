// src/components/CreditCardModal.tsx
import React, { useState } from 'react';
import { X, CreditCard, Lock, CheckCircle } from 'lucide-react';

interface CreditCardModalProps {
  amount: string;
  clientName: string;
  onClose: () => void;
  onProcess: (details: { number: string; expiry: string; cvc: string }) => void;
}

const CreditCardModal: React.FC<CreditCardModalProps> = ({ amount, clientName, onClose, onProcess }) => {
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    
    // Simulate API delay
    setTimeout(() => {
        setProcessing(false);
        onProcess({ number, expiry, cvc });
    }, 1500);
  };

  // Basic formatting helpers
  const formatCC = (val: string) => val.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const formatExpiry = (val: string) => val.replace(/\D/g, '').replace(/(.{2})/, '$1/').slice(0, 5);

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 w-full max-w-sm rounded-xl border border-gray-700 shadow-2xl p-6">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <CreditCard className="text-cps-blue"/> Virtual Terminal
            </h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full text-gray-400">
                <X size={20} />
            </button>
        </div>

        {/* Amount Display */}
        <div className="bg-gray-900/50 p-4 rounded-lg mb-6 flex justify-between items-center border border-gray-700/50">
            <div className="text-sm">
                <p className="text-gray-400">Total Charge</p>
                <p className="text-white font-bold truncate max-w-[150px]">{clientName}</p>
            </div>
            <div className="text-2xl font-mono font-bold text-green-400">{amount}</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Card Number</label>
                <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                    <input 
                        type="text" 
                        placeholder="0000 0000 0000 0000" 
                        value={number} 
                        onChange={(e) => setNumber(formatCC(e.target.value))}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cps-blue outline-none font-mono"
                        required
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiry</label>
                    <input 
                        type="text" 
                        placeholder="MM/YY" 
                        value={expiry}
                        onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-cps-blue outline-none font-mono text-center"
                        required
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CVC</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                        <input 
                            type="text" 
                            placeholder="123" 
                            maxLength={3}
                            value={cvc}
                            onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 pl-9 pr-4 text-white focus:ring-2 focus:ring-cps-blue outline-none font-mono text-center"
                            required
                        />
                    </div>
                </div>
            </div>

            <button 
                type="submit" 
                disabled={processing || number.length < 15}
                className="w-full py-4 mt-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {processing ? (
                    <span className="animate-pulse">Processing...</span>
                ) : (
                    <>Process Charge <CheckCircle size={20} /></>
                )}
            </button>
        </form>
      </div>
    </div>
  );
};

export default CreditCardModal;