// src/pages/Logsheet/NewJob.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Save, AlertCircle, RefreshCw, CheckCircle, Phone, Mail } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { Worker, SessionTransaction } from '../../types';
import { sessionService } from '../../lib/sessionService'; 
import CreditCardModal from '../../components/CreditCardModal';
import { 
  formatPhoneNumber, 
  normalizeEmail,
  getPhoneValidationError, 
  getEmailValidationError 
} from '../../lib/validationUtils';

// --- HELPER: Generate Valid UUIDs ---
// Required for Supabase 'uuid' columns to prevent 500 Errors
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
  
  // Credit Card Data
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [ccData, setCcData] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);
  const [suggestedStreets, setSuggestedStreets] = useState<string[]>([]);
  const [isCustomStreetMode, setIsCustomStreetMode] = useState(false);

  // Validation Errors
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [etransferEmailError, setEtransferEmailError] = useState<string | null>(null);

  // --- HANDLERS FOR PHONE & EMAIL ---
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
    setPhoneError(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    setEmailError(null);
  };

  const handleEmailBlur = () => {
    if (email) setEmail(normalizeEmail(email));
  };

  const handleEtransferEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEtransferEmail(e.target.value);
    setEtransferEmailError(null);
  };

  const handleEtransferEmailBlur = () => {
    if (etransferEmail) setEtransferEmail(normalizeEmail(etransferEmail));
  };

  useEffect(() => {
    const init = async () => {
      // 1. Get Current Worker
      const currentWorker = getStorageItem<Worker | null>('current_user', null);
      
      if (currentWorker) {
          setWorker(currentWorker);
          
          // 2. FETCH ROUTES FROM DAILY SESSION
          try {
              const dailySession = await sessionService.getDailySession();
              let myRoutes: string[] = [];

              if (dailySession && dailySession.routes) {
                  myRoutes = dailySession.routes
                      .filter(r => r.assignedWorkerId === currentWorker.contractorId)
                      .map(r => r.routeCode);
              }

              setAssignedRoutes(myRoutes);
              
              // SAFETY CHECK: If no routes, redirect back
              if (myRoutes.length === 0) {
                  alert('You have no assigned routes. Please contact your manager to create sales.');
                  navigate('/logsheet');
                  return;
              }

              // Set first route as default
              setRouteCode(myRoutes[0]);
          } catch(err) {
              console.warn("Offline/No session found", err);
              alert('Unable to load route assignments. Please try again.');
              navigate('/logsheet');
          }
      }
    };
    init();
  }, [navigate]);

  // Street Suggestions
  useEffect(() => {
    if (routeCode) {
        sessionService.getStreetsForRoute(routeCode).then(streets => {
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

  const handleTaxClick = () => { 
      const current = parseFloat(amount) || 0; 
      const tax = current * 0.05; 
      setAmount((Math.round((current + tax) * 100) / 100).toFixed(2)); 
  };
  
  const handlePaymentMethodChange = (method: string) => { 
      setPaymentMethod(method); 
      if (method === 'Credit Card') setShowCreditModal(true); 
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!worker) { setError("No worker session."); return; }

    // --- VALIDATION ---
    const pError = getPhoneValidationError(phone);
    const eError = getEmailValidationError(email);
    const etError = paymentMethod === 'E-Transfer' ? getEmailValidationError(etransferEmail) : null;

    if (pError || eError || etError) {
      setPhoneError(pError);
      setEmailError(eError);
      setEtransferEmailError(etError);
      setError('Please fix validation errors before saving.');
      return;
    }
    
    // Ensure session exists
    let activeSession = await sessionService.getActiveLogsheetSession(worker.contractorId);
    if (!activeSession) { 
        activeSession = await sessionService.startLogsheetSession(worker.contractorId);
    }

    const rawPrice = parseFloat(amount) || 0;
    const transactionPrice = Math.round(rawPrice * 100) / 100;
    
    const newTransactionId = generateUUID();
    const placeholderJobId = `NEW-${Date.now()}`;

    // Create Transaction Record
    const transactionData: SessionTransaction = {
        id: newTransactionId,
        jobId: placeholderJobId, 
        timestamp: new Date().toISOString(),
        customerId: "WALKUP",
        customerName: `${firstName} ${lastName}`,
        address: `${houseNumber} ${streetName}`.trim(),
        customerPhone: phone,
        customerEmail: email,
        workerId: worker.contractorId,
        workerName: worker.firstName,
        
        routeManagerName: 'RM', 
        routeCode: routeCode,
        
        price: transactionPrice,
        displayPrice: amount, 
        type: 'Sale',
        items: [{ name: 'Aeration', price: transactionPrice }],
        paymentMethod: paymentMethod,
        isPaid: paymentMethod !== 'Billed',
        invoiceNumber: paymentMethod === 'Billed' ? invoiceNumber : undefined,
        etransferEmail: paymentMethod === 'E-Transfer' ? etransferEmail : undefined,
        chequeNumber: paymentMethod === 'Cheque' ? chequeNumber : undefined,
        ccFullNumber: ccData?.number,
        ccExpiry: ccData?.expiry,
        ccCVC: ccData?.cvc,
        itemDescription: 'New Sale',
        serviceType: propertyType as any, 
        region: 'West', 
        seasonId: 'west-aeration',
        isWestSplit: false
    } as any;

    try {
        await sessionService.completeJob(transactionData, placeholderJobId, worker.contractorId);

        // Optimistic Update
        const session = await sessionService.getActiveLogsheetSession(worker.contractorId);
        if (session) {
            const newStats = sessionService.recalculateStats(session.financialStore, 5);
            await sessionService.updateLogsheetSession(session.id, { stats: newStats });
        }

        navigate('/logsheet');
    } catch (err: any) {
        console.error(err);
        setError("Failed to save sale: " + err.message);
    }
  };

  // Safety: If somehow they got here with no routes, show nothing
  if (assignedRoutes.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div><h2 className="text-xl font-bold text-white">New Sale</h2></div>
          <button onClick={() => navigate('/logsheet')} className="text-gray-400 hover:text-white"><X size={24} /></button>
        </div>
        
        {error && <div className="m-4 p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
        
        <form onSubmit={handleSubmit} className="overflow-y-auto p-4 space-y-6 flex-grow custom-scrollbar">
          
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
            <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Client Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                  <select value={routeCode} onChange={(e) => setRouteCode(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono">
                      {assignedRoutes.map(r => <option key={r} value={r}>{r}</option>)}
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
                              <select value={streetName} onChange={(e) => { if (e.target.value === '__CUSTOM__') { setIsCustomStreetMode(true); setStreetName(''); } else { setStreetName(e.target.value); } }} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" required disabled={!routeCode}>
                                  <option value="">{routeCode ? '-- Select Street --' : 'Select Route First'}</option>
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
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phone</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                      <input 
                        value={phone} 
                        onChange={handlePhoneChange}
                        placeholder="000 000 0000"
                        maxLength={12}
                        className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${
                          phoneError ? 'border-red-500' : 'border-gray-700'
                        }`}
                      />
                    </div>
                    {phoneError && <p className="text-red-400 text-[10px] mt-1">{phoneError}</p>}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/>
                      <input 
                        type="email"
                        value={email} 
                        onChange={handleEmailChange}
                        onBlur={handleEmailBlur}
                        placeholder="client@example.com"
                        className={`w-full bg-gray-800 border rounded p-2 pl-9 text-white ${
                          emailError ? 'border-red-500' : 'border-gray-700'
                        }`}
                      />
                    </div>
                    {emailError && <p className="text-red-400 text-[10px] mt-1">{emailError}</p>}
                  </div>
              </div>
            </div>
          </div>

          {/* PRICING & SERVICES - FIXED UI OVERLAP */}
          <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Services & Pricing</h3>
              
              {/* CHANGED: grid-cols-1 md:grid-cols-2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Bank Email</label>
                      <input 
                        type="email" 
                        value={etransferEmail} 
                        onChange={handleEtransferEmailChange}
                        onBlur={handleEtransferEmailBlur}
                        className={`w-full bg-gray-800 border rounded p-2 text-white ${
                          etransferEmailError ? 'border-red-500' : 'border-gray-700'
                        }`}
                        placeholder="client@bank.com" 
                      />
                      {etransferEmailError && <p className="text-red-400 text-[10px] mt-1">{etransferEmailError}</p>}
                    </div>
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