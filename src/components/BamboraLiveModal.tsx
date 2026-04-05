// src/components/BamboraLiveModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { X, CreditCard, CheckCircle, XCircle, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface BamboraLiveModalProps {
  amount: string;
  clientName: string;
  onClose: () => void;
  onProcess: (details: {
    bamboraTransactionId: string;
    last4: string;
    authCode: string;
  }) => void;
}

type ModalStatus = 'loading' | 'ready' | 'processing' | 'approved' | 'declined' | 'error';

const BamboraLiveModal: React.FC<BamboraLiveModalProps> = ({
  amount,
  clientName,
  onClose,
  onProcess,
}) => {
  const [status, setStatus] = useState<ModalStatus>('loading');
  const [message, setMessage] = useState('');
  const [last4, setLast4] = useState('');
  const [authCode, setAuthCode] = useState('');
  const checkoutRef = useRef<any>(null);

  const displayAmount = parseFloat(amount || '0').toFixed(2);
  const merchantId = (import.meta as any).env?.VITE_BAMBORA_MERCHANT_ID || '117586112';

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
      cardNumber.mount('#bambora-live-card-number');

      const expiry = checkout.create('expiry', { style, placeholder: 'MM / YY' });
      expiry.mount('#bambora-live-expiry');

      const cvv = checkout.create('cvv', { style, placeholder: '123' });
      cvv.mount('#bambora-live-cvv');

      setStatus('ready');
    } catch (err: any) {
      console.error('Bambora live init error:', err);
      setStatus('error');
      setMessage('Failed to initialize payment fields. Please close and try again.');
    }
  };

  const handleCharge = () => {
    if (!checkoutRef.current) return;
    if (status === 'processing' || status === 'approved') return; // Guard against double-click
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
    const nameParts = clientName.trim().split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || '';

    try {
      const { data, error } = await supabase.functions.invoke('bambora-charge', {
        body: {
          token,
          amount: displayAmount,
          firstName,
          lastName,
        },
      });

      if (error) throw error;

      if (data?.approved) {
        setLast4(data.last4 || '');
        setAuthCode(data.authCode || '');
        setStatus('approved');

        // Brief green screen, then auto-complete
        setTimeout(() => {
          onProcess({
            bamboraTransactionId: data.transactionId || '',
            last4: data.last4 || '',
            authCode: data.authCode || '',
          });
        }, 1500);
      } else {
        setStatus('declined');
        setMessage(data?.message || 'Card was declined. Please try a different payment method.');
      }
    } catch (err: any) {
      console.error('Bambora charge error:', err);
      setStatus('error');
      setMessage(err.message || 'An unexpected error occurred. Please close and try again.');
    }
  };

  const isDeclinedOrError = status === 'declined' || status === 'error';

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-gray-800 w-full max-w-sm rounded-xl border border-blue-700/40 shadow-2xl p-6">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <CreditCard className="text-cps-blue" size={20} />
            Live Card Terminal
          </h3>
          <button
            onClick={onClose}
            disabled={status === 'processing' || status === 'approved'}
            className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X size={18} />
          </button>
        </div>

        {/* Amount + Client */}
        <div className="bg-gray-900/70 rounded-xl p-5 mb-6 text-center border border-gray-700">
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-1">Charging</p>
          <p className="text-white font-semibold text-base truncate mb-2">{clientName}</p>
          <p className="text-green-400 font-mono font-bold text-5xl">${displayAmount}</p>
        </div>

        {/* Loading state */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader className="animate-spin text-cps-blue" size={32} />
            <p className="text-gray-400 text-sm">Loading secure payment fields…</p>
          </div>
        )}

        {/* Card form — visible while ready or processing */}
        <div style={{ display: (status === 'ready' || status === 'processing') ? 'block' : 'none' }}>
          <div className="mb-4">
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
              Card Number
            </label>
            <div
              id="bambora-live-card-number"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Expiry
              </label>
              <div
                id="bambora-live-expiry"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                CVV
              </label>
              <div
                id="bambora-live-cvv"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 min-h-[48px] flex items-center"
              />
            </div>
          </div>

          <button
            onClick={handleCharge}
            disabled={status === 'processing'}
            className="w-full py-4 bg-cps-blue hover:bg-blue-600 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === 'processing' ? (
              <><Loader className="animate-spin" size={20} /> Processing…</>
            ) : (
              <><CreditCard size={20} /> Charge ${displayAmount}</>
            )}
          </button>
        </div>

        {/* Approved screen */}
        {status === 'approved' && (
          <div className="text-center py-4">
            <CheckCircle className="mx-auto text-green-400 mb-3" size={56} />
            <h4 className="text-2xl font-bold text-green-400 mb-1">Approved ✅</h4>
            <p className="text-gray-400 text-sm mb-4">Card charged successfully</p>
            <div className="bg-gray-900/60 rounded-lg p-3 text-sm border border-gray-700 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Card</span>
                <span className="text-white font-mono">•••• {last4}</span>
              </div>
              {authCode && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Auth</span>
                  <span className="text-white font-mono">{authCode}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-4 animate-pulse">Completing transaction…</p>
          </div>
        )}

        {/* Declined / Error screen */}
        {isDeclinedOrError && (
          <div className="text-center py-2">
            <XCircle className="mx-auto text-red-400 mb-3" size={56} />
            <h4 className="text-2xl font-bold text-red-400 mb-2">
              {status === 'declined' ? 'Declined ❌' : 'Error ⚠️'}
            </h4>
            <p className="text-gray-300 text-sm mb-5 px-2 leading-relaxed">{message}</p>
            <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 mb-5">
              <p className="text-red-300 text-xs leading-relaxed">
                This card could not be charged. Please close this window and select a different payment method.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-all"
            >
              Close &amp; Change Payment Method
            </button>
          </div>
        )}

        <p className="text-center text-[10px] text-gray-600 mt-5">
          Secured by Worldline · Merchant {merchantId}
        </p>
      </div>
    </div>
  );
};

export default BamboraLiveModal;