// src/pages/SuperAdmin/BamboraTestModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { X, CreditCard, CheckCircle, XCircle, Loader, DollarSign, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface BamboraTestModalProps {
  onClose: () => void;
}

type TestStatus = 'loading' | 'ready' | 'processing' | 'approved' | 'declined' | 'error';

const BamboraTestModal: React.FC<BamboraTestModalProps> = ({ onClose }) => {
  const [amount, setAmount] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<TestStatus>('loading');
  const [message, setMessage] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [last4, setLast4] = useState('');
  const [cardType, setCardType] = useState('');
  const checkoutRef = useRef<any>(null);

  const merchantId = import.meta.env.VITE_BAMBORA_MERCHANT_ID || '117586112';

  useEffect(() => {
    const timer = setTimeout(loadBamboraScript, 50);
    return () => clearTimeout(timer);
  }, []);

  const loadBamboraScript = () => {
    if ((window as any).customcheckout) {
      initializeCheckout();
      return;
    }
    const existingScript = document.getElementById('bambora-checkout-script');
    if (existingScript) {
      existingScript.addEventListener('load', initializeCheckout);
      return;
    }
    const script = document.createElement('script');
    script.id = 'bambora-checkout-script';
    script.src = 'https://libs.na.bambora.com/customcheckout/1/customcheckout.js';
    script.onload = initializeCheckout;
    script.onerror = () => {
      setStatus('error');
      setMessage('Failed to load the payment library. Please check your connection and try again.');
    };
    document.head.appendChild(script);
  };

  const initializeCheckout = () => {
    try {
      const style = {
        base: {
          color: '#ffffff',
          fontSize: '15px',
          fontFamily: 'ui-monospace, monospace',
          '::placeholder': { color: '#6b7280' },
        },
        complete: { color: '#34d399' },
        error: { color: '#f87171' },
      };

      const checkout = (window as any).customcheckout();
      checkoutRef.current = checkout;

      const cardNumber = checkout.create('card-number', { style, placeholder: '0000 0000 0000 0000' });
      cardNumber.mount('#bambora-card-number');

      const expiry = checkout.create('expiry', { style, placeholder: 'MM / YY' });
      expiry.mount('#bambora-expiry');

      const cvv = checkout.create('cvv', { style, placeholder: '123' });
      cvv.mount('#bambora-cvv');

      setStatus('ready');
    } catch (err: any) {
      console.error('Bambora init error:', err);
      setStatus('error');
      setMessage('Failed to initialize payment fields. Please refresh and try again.');
    }
  };

  const handleCharge = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setMessage('Please enter the cardholder first and last name.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setMessage('Please enter a valid amount greater than $0.00');
      return;
    }

    setStatus('processing');
    setMessage('');

    checkoutRef.current.createToken((result: any) => {
      if (result.error) {
        setStatus('declined');
        setMessage(result.error.message || 'Invalid card details. Please check and try again.');
        return;
      }
      processCharge(result.token);
    });
  };

  const processCharge = async (token: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('bambora-charge', {
        body: {
          token,
          amount: parseFloat(amount).toFixed(2),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || null,
        }
      });

      if (error) throw error;

      if (data.approved) {
        setStatus('approved');
        setTransactionId(data.transactionId || '');
        setAuthCode(data.authCode || '');
        setLast4(data.last4 || '');
        setCardType(data.cardType || '');
        setMessage(data.message || 'Approved');
      } else {
        setStatus('declined');
        setMessage(data.message || 'Card was declined. Please try a different card.');
      }
    } catch (err: any) {
      console.error('Charge error:', err);
      setStatus('error');
      setMessage(err.message || 'An unexpected error occurred. Please try again.');
    }
  };

  const handleReset = () => {
    setMessage('');
    setTransactionId('');
    setAuthCode('');
    setLast4('');
    setCardType('');
    setAmount('');
    setFirstName('');
    setLastName('');
    setEmail('');
    setStatus('loading');
    setTimeout(initializeCheckout, 150);
  };

  const isChargeReady = status === 'ready' && firstName.trim() && lastName.trim() && amount && parseFloat(amount) > 0;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 w-full max-w-sm rounded-xl border border-purple-700/50 shadow-2xl p-6">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <CreditCard className="text-purple-400" size={22} />
            Live Card Testing
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Warning banner */}
        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 mb-5 flex items-center gap-2">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs">This is a LIVE charge against a real card.</p>
        </div>

        {/* Loading spinner */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader className="animate-spin text-purple-400" size={32} />
            <p className="text-gray-400 text-sm">Loading secure payment fields...</p>
          </div>
        )}

        {/* Card Form */}
        <div style={{ display: (status === 'ready' || status === 'processing') ? 'block' : 'none' }}>

          {/* First + Last Name */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Jane"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={status === 'processing'}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={status === 'processing'}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              Email Address <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === 'processing'}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 px-4 text-white focus:ring-2 focus:ring-purple-500 outline-none disabled:opacity-50"
            />
          </div>

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
              Amount (CAD) <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={status === 'processing'}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-3 pl-9 pr-4 text-white focus:ring-2 focus:ring-purple-500 outline-none font-mono disabled:opacity-50"
              />
            </div>
          </div>

          {/* Card Number */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Card Number</label>
            <div id="bambora-card-number" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center" />
          </div>

          {/* Expiry + CVV */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiry</label>
              <div id="bambora-expiry" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CVV</label>
              <div id="bambora-cvv" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center" />
            </div>
          </div>

          {/* Inline error */}
          {message && <p className="text-red-400 text-sm mb-4 text-center">{message}</p>}

          <button
            onClick={handleCharge}
            disabled={!isChargeReady}
            className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'processing' ? (
              <><Loader className="animate-spin" size={20} />Processing...</>
            ) : (
              <>Process Charge<CreditCard size={20} /></>
            )}
          </button>
        </div>

        {/* Approved */}
        {status === 'approved' && (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto text-green-400 mb-3" size={52} />
            <h4 className="text-2xl font-bold text-green-400 mb-1">Approved ✅</h4>
            <p className="text-gray-400 text-sm mb-5">{message}</p>

            <div className="bg-gray-900/60 rounded-lg p-4 text-left space-y-3 mb-6 border border-gray-700">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Cardholder</span>
                <span className="text-white font-mono">{firstName} {lastName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Amount Charged</span>
                <span className="text-white font-mono font-bold">${parseFloat(amount).toFixed(2)} CAD</span>
              </div>
              {transactionId && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Transaction ID</span>
                  <span className="text-white font-mono">{transactionId}</span>
                </div>
              )}
              {authCode && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Auth Code</span>
                  <span className="text-white font-mono">{authCode}</span>
                </div>
              )}
              {last4 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Card</span>
                  <span className="text-white font-mono">{cardType && `${cardType} `}•••• {last4}</span>
                </div>
              )}
            </div>

            <button onClick={handleReset} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-all">
              Test Another
            </button>
          </div>
        )}

        {/* Declined / Error */}
        {(status === 'declined' || status === 'error') && (
          <div className="text-center py-4">
            <XCircle className="mx-auto text-red-400 mb-3" size={52} />
            <h4 className="text-2xl font-bold text-red-400 mb-1">
              {status === 'declined' ? 'Declined ❌' : 'Error ⚠️'}
            </h4>
            <p className="text-gray-400 text-sm mb-6 px-2">{message}</p>
            <button onClick={handleReset} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-all">
              Try Again
            </button>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-600 mt-5">
          Merchant {merchantId} · Powered by Worldline
        </p>
      </div>
    </div>
  );
};

export default BamboraTestModal;