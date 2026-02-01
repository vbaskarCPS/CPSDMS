// src/components/CreditCardModal.tsx
import React, { useState, useMemo } from 'react';
import { X, CreditCard, Lock, CheckCircle } from 'lucide-react';

interface CreditCardModalProps {
  amount: string;
  clientName: string;
  onClose: () => void;
  onProcess: (details: { number: string; expiry: string; cvc: string }) => void;
}

// Card type detection based on prefix
type CardType = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';

interface CardConfig {
  type: CardType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  maxDigits: number;
  cvcLength: number;
  cvcPlaceholder: string;
  format: (val: string) => string;
}

const detectCardType = (number: string): CardType => {
  const digits = number.replace(/\D/g, '');
  if (!digits) return 'unknown';
  
  const firstDigit = digits[0];
  const firstTwo = digits.slice(0, 2);
  
  // AMEX: starts with 34 or 37
  if (firstTwo === '34' || firstTwo === '37') return 'amex';
  
  // Visa: starts with 4
  if (firstDigit === '4') return 'visa';
  
  // Mastercard: starts with 51-55 or 2221-2720
  if (firstDigit === '5') {
    const secondDigit = parseInt(digits[1]);
    if (secondDigit >= 1 && secondDigit <= 5) return 'mastercard';
  }
  if (firstDigit === '2') {
    const firstFour = parseInt(digits.slice(0, 4));
    if (firstFour >= 2221 && firstFour <= 2720) return 'mastercard';
  }
  
  // Discover: starts with 6
  if (firstDigit === '6') return 'discover';
  
  return 'unknown';
};

// Format for standard 16-digit cards (4-4-4-4)
const formatStandard = (val: string): string => {
  const digits = val.replace(/\D/g, '').slice(0, 16);
  const groups = digits.match(/.{1,4}/g) || [];
  return groups.join(' ');
};

// Format for AMEX 15-digit cards (4-6-5)
const formatAmex = (val: string): string => {
  const digits = val.replace(/\D/g, '').slice(0, 15);
  if (digits.length <= 4) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 10)} ${digits.slice(10)}`;
};

const CARD_CONFIGS: Record<CardType, CardConfig> = {
  visa: {
    type: 'visa',
    label: 'VISA',
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/30',
    borderColor: 'border-blue-600',
    maxDigits: 16,
    cvcLength: 3,
    cvcPlaceholder: '123',
    format: formatStandard,
  },
  mastercard: {
    type: 'mastercard',
    label: 'MC',
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/30',
    borderColor: 'border-orange-600',
    maxDigits: 16,
    cvcLength: 3,
    cvcPlaceholder: '123',
    format: formatStandard,
  },
  amex: {
    type: 'amex',
    label: 'AMEX',
    color: 'text-green-400',
    bgColor: 'bg-green-900/30',
    borderColor: 'border-green-600',
    maxDigits: 15,
    cvcLength: 4,
    cvcPlaceholder: '1234',
    format: formatAmex,
  },
  discover: {
    type: 'discover',
    label: 'DISC',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-900/30',
    borderColor: 'border-yellow-600',
    maxDigits: 16,
    cvcLength: 3,
    cvcPlaceholder: '123',
    format: formatStandard,
  },
  unknown: {
    type: 'unknown',
    label: '',
    color: 'text-gray-400',
    bgColor: 'bg-gray-700',
    borderColor: 'border-gray-600',
    maxDigits: 16,
    cvcLength: 3,
    cvcPlaceholder: '123',
    format: formatStandard,
  },
};

const CreditCardModal: React.FC<CreditCardModalProps> = ({ amount, clientName, onClose, onProcess }) => {
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [processing, setProcessing] = useState(false);

  // Detect card type based on current number
  const cardType = useMemo(() => detectCardType(number), [number]);
  const cardConfig = CARD_CONFIGS[cardType];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    
    // Simulate API delay
    setTimeout(() => {
        setProcessing(false);
        onProcess({ number, expiry, cvc });
    }, 1500);
  };

  // Handle card number input with dynamic formatting
  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const digits = rawValue.replace(/\D/g, '');
    
    // Detect card type from digits to get correct formatting
    const detectedType = detectCardType(digits);
    const config = CARD_CONFIGS[detectedType];
    
    // Format according to card type
    const formatted = config.format(digits);
    setNumber(formatted);
    
    // If CVC is too long for new card type, trim it
    if (cvc.length > config.cvcLength) {
      setCvc(cvc.slice(0, config.cvcLength));
    }
  };

  // Format expiry as MM/YY
  const formatExpiry = (val: string) => val.replace(/\D/g, '').replace(/(.{2})/, '$1/').slice(0, 5);

  // Get raw digit count for validation
  const digitCount = number.replace(/\D/g, '').length;
  const minDigits = cardType === 'amex' ? 15 : 15; // Allow 15+ for all types

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
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase">Card Number</label>
                  {cardType !== 'unknown' && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${cardConfig.bgColor} ${cardConfig.color} border ${cardConfig.borderColor}`}>
                      {cardConfig.label}
                    </span>
                  )}
                </div>
                <div className="relative">
                    <CreditCard className={`absolute left-3 top-1/2 -translate-y-1/2 ${cardType !== 'unknown' ? cardConfig.color : 'text-gray-500'}`} size={18} />
                    <input 
                        type="text" 
                        placeholder={cardType === 'amex' ? '0000 000000 00000' : '0000 0000 0000 0000'}
                        value={number} 
                        onChange={handleNumberChange}
                        className={`w-full bg-gray-700 border rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cps-blue outline-none font-mono ${cardType !== 'unknown' ? cardConfig.borderColor : 'border-gray-600'}`}
                        required
                    />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  {cardType === 'amex' ? '15 digits' : '16 digits'} • {digitCount} entered
                </p>
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
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                      {cardType === 'amex' ? 'CID' : 'CVC'}
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                        <input 
                            type="text" 
                            placeholder={cardConfig.cvcPlaceholder}
                            maxLength={cardConfig.cvcLength}
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
                disabled={processing || digitCount < minDigits || cvc.length < cardConfig.cvcLength}
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