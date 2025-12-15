// src/pages/Logsheet/NewJob.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Save, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { Worker, SessionTransaction } from '../../types';
import { sessionService } from '../../lib/sessionService';
import CreditCardModal from '../../components/CreditCardModal';

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

const NewJob: React.FC = () => {
  const navigate = useNavigate();

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

  // Payment State
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [etransferEmail, setEtransferEmail] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [ccData, setCcData] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);
  const [suggestedStreets, setSuggestedStreets] = useState<string[]>([]);
  const [isCustomStreetMode, setIsCustomStreetMode] = useState(false);

  // --- 1. Initialize Worker & Session ---
  useEffect(() => {
    const init = async () => {
      const currentWorker = getStorageItem<Worker | null>('current_user', null);
      if (currentWorker) {
        setWorker(currentWorker);
        try {
          const dailySession = await sessionService.getDailySession();
          let myRoutes: string[] = [];

          if (dailySession && dailySession.routes) {
            myRoutes = dailySession.routes
              .filter((r) => r.assignedWorkerId === currentWorker.contractorId)
              .map((r) => r.routeCode);
          }
          setAssignedRoutes(myRoutes);
          if (myRoutes.length > 0) setRouteCode(myRoutes[0]);
          else setRouteCode('SALES');
        } catch (err) {
          console.warn("Could not load daily session (might be offline or no session):", err);
          setAssignedRoutes([]);
          setRouteCode('SALES');
        }
      }
    };
    init();
  }, []);

  // --- 2. Load Streets for Route ---
  useEffect(() => {
    if (routeCode && routeCode !== 'SALES') {
      sessionService.getStreetsForRoute(routeCode).then((streets) => {
        if (streets && streets.length > 0) {
          setSuggestedStreets(streets);
          setIsCustomStreetMode(false);
          setStreetName('');
        } else {
          setSuggestedStreets([]);
          setIsCustomStreetMode(true);
        }
      });
    } else {
      setSuggestedStreets([]);
      setIsCustomStreetMode(true);
    }
  }, [routeCode]);

  // --- Handlers ---
  const handleTaxClick = () => {
    const current = parseFloat(amount) || 0;
    const tax = current * 0.05;
    setAmount((Math.round((current + tax) * 100) / 100).toFixed(2));
  };

  const handlePaymentMethodChange = (method: string) => {
    setPaymentMethod(method);
    if (method === 'Credit Card') setShowCreditModal(true);
  };

  // --- MAIN SUBMIT FUNCTION ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!worker) { setError('No worker session.'); return; }

    const transactionPrice = parseFloat(amount) || 0;
    const newTransactionId = generateUUID();

    // Construct Payload using SNAKE_CASE keys to match Supabase columns
    // We treat this as 'any' to bypass strict TS checks for the old interface if needed
    const dbPayload: any = {
      id: newTransactionId,
      created_at: new Date().toISOString(),
      
      // LINKING
      job_id: null, // NULL because this is a walk-up sale, not a pre-scheduled job
      
      // CUSTOMER DETAILS (New Columns)
      customer_name: `${firstName} ${lastName}`,
      address: `${houseNumber} ${streetName}`.trim(),
      customer_phone: phone,
      customer_email: email,
      
      // WORKER DETAILS
      worker_id: worker.contractorId,
      worker_name: worker.firstName,
      route_code: routeCode,
      
      // TRANSACTION DETAILS
      price: transactionPrice,
      payment_method: paymentMethod,
      items: [{ name: 'Aeration', price: transactionPrice }], // JSONB Column
      service_type: propertyType,
      region: 'West', // Adjust if you have dynamic regions
      
      // OPTIONAL PAYMENT DETAILS
      invoice_number: paymentMethod === 'Billed' ? invoiceNumber : null,
      cheque_number: paymentMethod === 'Cheque' ? chequeNumber : null,
      
      // CREDIT CARD DATA (If you store this securely, otherwise omit)
      // cc_last4: ccData?.number?.slice(-4) || null,
    };

    try {
      // Send to Supabase
      // 2nd arg is null because we are not updating a job status
      await sessionService.completeJob(dbPayload, null, worker.contractorId);

      // Update Local Logsheet Stats for immediate UI feedback
      const session = await sessionService.getActiveLogsheetSession(worker.contractorId);
      if (session) {
        const newStats = sessionService.recalculateStats(session.financialStore, 5);
        await sessionService.updateLogsheetSession(session.id, { stats: newStats });
      }

      navigate('/logsheet');
    } catch (err: any) {
      console.error("Failed to save sale:", err);
      const message = err.message || err.error_description || JSON.stringify(err);
      setError('Failed to save sale: ' + message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div><h2 className="text-xl font-bold text-white">New Sale</h2></div>
          <button onClick={() => navigate('/logsheet')} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>
        
        {error && <div className="m-4 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        
        <form onSubmit={handleSubmit} className="overflow-y-auto p-4 space-y-6 flex-grow custom-scrollbar">
          {/* CLIENT DETAILS */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
            <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Client Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                  <select value={routeCode} onChange={(e) => setRouteCode(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono">
                      {assignedRoutes.map(r => <option key={r} value={r}>{r}</option>)}
                      <option value="SALES">SALES</option>
                  </select>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">First Name *</label><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Last Name *</label><input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
              </div>
              <div className="md:col-span-3 grid grid-cols-4 gap-4">
                  <div className="col-span-1"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">House # *</label><input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required /></div>
                  <div className="col-span-3">
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Street Name *</label>
                      <div className="flex gap-2">
                          {!isCustomStreetMode ? (
                              <select value={streetName} onChange={(e) => { if (e.target.value === '__CUSTOM__') { setIsCustomStreetMode(true); setStreetName(''); } else { setStreetName(e.target.value); } }} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required disabled={!routeCode || routeCode === 'SALES'}>
                                  <option value="">{routeCode && routeCode !== 'SALES' ? '-- Select Street --' : 'Select Route First'}</option>
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
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                  <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
              </div>
            </div>
          </div>

          {/* PRICING & SERVICES */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Services & Pricing</h3>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Total Amount ($)</label>
                      <div className="flex gap-2">
                          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-grow bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400" placeholder="0.00" step="0.01"/>
                          <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>
                      </div>
                  </div>
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Property Type</label>
                      <div className="flex bg-gray-700 rounded-md border border-gray-600 overflow-hidden">
                          {['FP', 'FO', 'BO'].map(type => (
                              <button key={type} type="button" onClick={() => setPropertyType(type)} className={`flex-1 py-2 text-xs font-bold transition-colors ${propertyType === type ? 'bg-cps-blue text-white' : 'text-gray-400 hover:bg-gray-600'}`}>{type}</button>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
          
          {/* PAYMENT */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
            <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Payment & Completion</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                    <select value={paymentMethod} onChange={(e) => handlePaymentMethodChange(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white">
                        <option value="Cash">Cash</option>
                        <option value="Cheque">Cheque</option>
                        <option value="E-Transfer">E-Transfer</option>
                        <option value="Credit Card">Credit Card</option>
                        <option value="Billed">Billed (Invoice)</option>
                    </select>
                </div>
                {paymentMethod === 'Billed' && (
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Invoice Number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="INV-..." /></div>
                )}
                {paymentMethod === 'E-Transfer' && (
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Bank Email</label><input type="email" value={etransferEmail} onChange={e => setEtransferEmail(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="client@bank.com" /></div>
                )}
                {paymentMethod === 'Cheque' && (
                    <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque Number (Optional)</label><input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="#001" /></div>
                )}
            </div>

            {paymentMethod === 'Credit Card' && (
                <div className={`mt-3 p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                    <span className="text-sm font-medium">{isCreditPaid ? "Credit Card Processed Successfully" : "Click Save to Process Card"}</span>
                    {isCreditPaid ? <CheckCircle size={20}/> : <button type="button" onClick={() => setShowCreditModal(true)} className="text-xs underline">Re-open Card Entry</button>}
                </div>
            )}
          </div>

        </form>
        <div className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-end gap-3 flex-shrink-0">
            <button onClick={() => navigate('/logsheet')} className="px-4 py-3 text-gray-400 hover:text-white font-medium">Cancel</button>
            <button onClick={handleSubmit} className="px-8 py-3 bg-cps-green hover:bg-green-600 text-white rounded-md font-bold shadow-lg flex items-center gap-2"><Save size={18} /> Save & Complete</button>
        </div>
      </div>

      {showCreditModal && (
          <CreditCardModal 
              amount={amount} 
              clientName={`${firstName} ${lastName}`} 
              onClose={() => setShowCreditModal(false)} 
              onProcess={(details) => { 
                  setIsCreditPaid(true); 
                  setShowCreditModal(false); 
                  setCcData({
                      number: details.number,
                      expiry: details.expiry,
                      cvc: details.cvc
                  });
              }} 
          />
      )}
    </div>
  );
};

export default NewJob;