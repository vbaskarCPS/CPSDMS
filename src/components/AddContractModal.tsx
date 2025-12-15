// src/components/AddContractModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { X, ArrowLeft, Check, DollarSign, AlertCircle, User, Lock, Droplets, Mail, Plus } from 'lucide-react';
import { getStorageItem } from '../lib/localStorage';
import { MasterBooking, Worker, SessionTransaction } from '../types';
import { sessionService } from '../lib/sessionService';
import CreditCardModal from './CreditCardModal';

// Helper to generate a valid UUID for transactions
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const CONTRACT_RECIPES = [
  { id: 'star_plan_pro', name: 'Star Plan Pro', type: 'Upgrade', basePrice: 150 },
  { id: 'lawn_rejuv', name: 'Lawn Rejuvenation', type: 'Upgrade', basePrice: 200 },
  { id: 'dethatch', name: 'Dethatching', type: 'Add-On', basePrice: 100 },
  { id: 'grub', name: 'Grub Control', type: 'Add-On', basePrice: 50, 
    questions: [
      { id: 'timing', label: 'Timing', options: ['Spring', 'Fall', 'Both'] }
    ] 
  },
];

interface AddContractModalProps {
  onClose: () => void;
}

type Step = 'SELECT_CONTRACT' | 'SELECT_CLIENT' | 'ENTER_DETAILS';

const AddContractModal: React.FC<AddContractModalProps> = ({ onClose }) => {
  const [step, setStep] = useState<Step>('SELECT_CONTRACT');
  const [availableRecipes] = useState(CONTRACT_RECIPES);
  const [selectedRecipe, setSelectedRecipe] = useState<typeof CONTRACT_RECIPES[0] | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<MasterBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Data
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    address: '',
    phone: '',
    email: '',
    routeNumber: '', 
    notes: '',
    propertyType: 'FP',
    hasLockedGate: false,
    hasSprinkler: false
  });
  
  const [paymentInfo, setPaymentInfo] = useState({ amount: '', method: 'Cash' });
  const [extraPaymentInfo, setExtraPaymentInfo] = useState(''); 
  const [answers, setAnswers] = useState<Record<string, string>>({}); 
  const [worker, setWorker] = useState<Worker | null>(null);
  const [availableClients, setAvailableClients] = useState<MasterBooking[]>([]);

  // CC Data
  const [ccData, setCcData] = useState<{ number: string, expiry: string, cvc: string } | null>(null);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);

  // Territory Helpers
  const [assignedRoutes, setAssignedRoutes] = useState<string[]>([]);
  const [streetName, setStreetName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');

  useEffect(() => {
    const init = async () => {
      const w = getStorageItem<Worker | null>('current_user', null);
      if (!w) { setError("User not found."); return; }
      setWorker(w);

      const activeSession = await sessionService.getActiveLogsheetSession(w.contractorId);
      if (activeSession) {
          const clients = activeSession.financialStore.map(tx => ({
              'Booking ID': tx.jobId,
              'First Name': tx.customerName.split(' ')[0],
              'Last Name': tx.customerName.split(' ').slice(1).join(' '),
              'Full Address': tx.address,
              'Route Number': tx.routeCode,
              'Price': tx.displayPrice || tx.price.toString(),
              'Home Phone': (tx as any).customerPhone || '',
              'Email Address': (tx as any).customerEmail || '',
              'Prepaid': (tx as any).isPrepaid ? 'x' : undefined // Ensure prepaid flag is carried over
          } as MasterBooking));
          setAvailableClients(clients);
      }
    };
    init();
  }, []);

  const handleRecipeSelect = (recipe: typeof CONTRACT_RECIPES[0]) => {
    setSelectedRecipe(recipe);
    const initialAnswers: Record<string, string> = {};
    if (recipe.questions) recipe.questions.forEach(q => initialAnswers[q.id] = q.options[0]);
    setAnswers(initialAnswers);
    setPaymentInfo({ amount: '0.00', method: 'Cash' });
    setExtraPaymentInfo('');
    setIsCreditPaid(false);
    setCcData(null);
    setFormData({ 
        firstName: '', lastName: '', address: '', phone: '', email: '', 
        routeNumber: '', notes: '', propertyType: 'FP', 
        hasLockedGate: false, hasSprinkler: false 
    });
    setSelectedBooking(null);
    setStep('SELECT_CLIENT');
  };

  const handleClientSelect = (booking: MasterBooking) => {
    setSelectedBooking(booking);
    setFormData({
      firstName: booking['First Name'] || '',
      lastName: booking['Last Name'] || '',
      address: booking['Full Address'] || '',
      phone: booking['Home Phone'] || booking['Cell Phone'] || '',
      email: booking['Email Address'] || '',
      routeNumber: booking['Route Number'] || '',
      notes: '',
      propertyType: booking['FO/BO/FP'] || 'FP',
      hasLockedGate: false,
      hasSprinkler: false
    });
    setPaymentInfo(prev => ({ ...prev, amount: '0.00' }));
    setStep('ENTER_DETAILS');
  };

  const handleNewClient = () => {
    if (selectedRecipe?.type === 'Upgrade') return;
    setSelectedBooking(null);
    setFormData({ firstName: '', lastName: '', address: '', phone: '', email: '', routeNumber: '', notes: '', propertyType: 'FP', hasLockedGate: false, hasSprinkler: false });
    setPaymentInfo(prev => ({ ...prev, amount: '0.00' }));
    setStep('ENTER_DETAILS');
  };

  const handleSubmit = async () => {
    if (!selectedRecipe || !worker) return;
    setError(null);
    if (paymentInfo.method === 'Credit Card' && !isCreditPaid) { setError("Please process card first."); return; }
    if (!paymentInfo.amount) { setError("Enter amount."); return; }

    try {
      const isUpgrade = selectedRecipe.type === 'Upgrade';
      const isIOS = paymentInfo.method === 'IOS';
      const collectionAmount = parseFloat(paymentInfo.amount);

      // --- LOGIC FIX: CALCULATE TRUE TOTAL & BREAKDOWN ---
      let creditAmount = 0;
      if (isUpgrade && selectedBooking && selectedBooking.Price) {
          // Parse the original value (e.g., convert "100.00" or "SP100.00" to 100.00)
          creditAmount = parseFloat(String(selectedBooking.Price).replace(/[^0-9.]/g, '')) || 0;
      }

      const finalTotal = creditAmount + collectionAmount;

      // Construct Payment Breakdown for Backend Bucketing
      const paymentBreakdown: Record<string, number> = {};
      
      // 1. Add Credit (Original Value)
      if (creditAmount > 0) {
          // If original was marked prepaid, bucket it as 'Prepaid'. 
          // Otherwise, bucket as 'Previous' (or specific method if known, but 'Prepaid' ensures split logic works)
          const creditKey = selectedBooking?.Prepaid === 'x' ? 'Prepaid' : 'Previous Payment';
          paymentBreakdown[creditKey] = creditAmount;
      }

      // 2. Add New Collection
      const currentMethodKey = isIOS ? 'IOS' : paymentInfo.method;
      paymentBreakdown[currentMethodKey] = (paymentBreakdown[currentMethodKey] || 0) + collectionAmount;

      // --- END LOGIC FIX ---

      let finalNotes = formData.notes;
      if (answers['timing']) finalNotes += ` [${answers['timing']}]`; 
      if (formData.hasLockedGate) finalNotes += ' [LG]';

      // --- PRICE FORMATTING LOGIC ---
      let displayPricePrefix = '';
      if (selectedRecipe.name.includes('Star')) displayPricePrefix = 'SP';
      if (selectedRecipe.name.includes('Rejuv')) displayPricePrefix = 'RJ';
      
      // Use finalTotal for display string so it shows the full contract value (e.g. SP150.00)
      const formattedDisplayPrice = `${displayPricePrefix}${finalTotal.toFixed(2)}`;

      const finalAddress = selectedBooking ? selectedBooking['Full Address'] : `${houseNumber} ${streetName}`.trim();

      const tx: SessionTransaction = {
          id: generateUUID(),
          jobId: selectedBooking ? selectedBooking['Booking ID'] : `NEW-${Date.now()}`,
          timestamp: new Date().toISOString(),
          customerId: "CLIENT",
          customerName: `${formData.firstName} ${formData.lastName}`,
          address: finalAddress,
          customerPhone: formData.phone,
          customerEmail: formData.email,
          
          workerId: worker.contractorId,
          workerName: worker.firstName,
          routeManagerName: 'RM',
          routeCode: formData.routeNumber,
          
          type: selectedRecipe.type as any,
          price: finalTotal, // Store full value
          displayPrice: formattedDisplayPrice, 
          serviceName: selectedRecipe.name, 
          
          paymentMethod: isIOS ? 'IOS' : paymentInfo.method,
          paymentBreakdown: paymentBreakdown, // Pass breakdown to backend
          isPaid: !isIOS && paymentInfo.method !== 'Billed',
          
          ccFullNumber: ccData?.number,
          ccExpiry: ccData?.expiry,
          ccCVC: ccData?.cvc,
          etransferEmail: paymentInfo.method === 'E-Transfer' ? extraPaymentInfo : undefined,
          
          isWestSplit: isUpgrade, 
          refId: selectedRecipe.id,
          items: [{ name: selectedRecipe.name, price: finalTotal }],
          itemDescription: finalNotes.trim(),
          
          region: 'West', seasonId: 'west-aeration'
      } as any;

      if (isUpgrade && selectedBooking) {
          await sessionService.deleteTransactionByJobId(selectedBooking['Booking ID']);
      }

      await sessionService.completeJob(tx, tx.jobId, worker.contractorId);

      const session = await sessionService.getActiveLogsheetSession(worker.contractorId);
      if (session) {
          const newStats = sessionService.recalculateStats(session.financialStore, 5);
          await sessionService.updateLogsheetSession(session.id, { stats: newStats });
      }

      onClose();

    } catch (err) {
      console.error(err);
      setError("Failed to process sale.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            {step !== 'SELECT_CONTRACT' && (
              <button onClick={() => setStep(step === 'ENTER_DETAILS' ? 'SELECT_CLIENT' : 'SELECT_CONTRACT')} className="p-1 hover:bg-gray-800 rounded-full transition-colors">
                <ArrowLeft className="text-gray-400" />
              </button>
            )}
            <h2 className="text-xl font-bold text-white">{step === 'SELECT_CONTRACT' ? 'Select Contract' : selectedRecipe?.name}</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded-full"><X className="text-gray-400" /></button>
        </div>

        {error && <div className="bg-red-900/30 border-l-4 border-red-500 p-3 mx-4 mt-4 text-red-200 text-sm flex items-center gap-2"><AlertCircle size={16}/>{error}</div>}

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {step === 'SELECT_CONTRACT' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableRecipes.map(recipe => (
                <button key={recipe.id} onClick={() => handleRecipeSelect(recipe)} className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:bg-gray-750 hover:border-cps-blue transition-all text-left group">
                  <h3 className="font-bold text-white group-hover:text-cps-blue mb-1">{recipe.name}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${recipe.type === 'Upgrade' ? 'bg-purple-900/30 text-purple-300' : 'bg-blue-900/30 text-blue-300'}`}>{recipe.type}</span>
                </button>
              ))}
            </div>
          )}

          {step === 'SELECT_CLIENT' && (
            <div className="space-y-4">
              <h3 className="text-sm text-gray-400 font-medium">Select Client (Completed Jobs)</h3>
              <div className="max-h-[60vh] overflow-y-auto space-y-1 border border-gray-700/50 rounded-lg p-1 custom-scrollbar mt-2">
                {availableClients.length > 0 ? (
                    availableClients.map(b => (
                        <button key={b['Booking ID']} onClick={() => handleClientSelect(b)} className="w-full text-left p-3 rounded flex justify-between items-center group transition-colors border border-transparent hover:bg-gray-800 hover:border-gray-700">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 group-hover:bg-gray-600 group-hover:text-white"><User size={16} /></div>
                                <div className="min-w-0"><div className="font-bold text-gray-200 group-hover:text-white truncate">{b['Full Address']}</div><div className="text-xs text-gray-500 flex items-center gap-1 truncate">{b['First Name']} {b['Last Name']}</div></div>
                            </div>
                        </button>
                    ))
                ) : (
                    <div className="text-gray-500 text-center py-4 italic">No eligible clients found.</div>
                )}
              </div>
              {selectedRecipe?.type === 'Add-On' && (
                  <button onClick={handleNewClient} className="w-full py-3 bg-gray-800 border border-dashed border-gray-600 text-gray-300 rounded-lg mt-4 flex items-center justify-center gap-2 hover:bg-gray-750 transition-colors">
                      <Plus size={16}/> Create New Client Record
                  </button>
              )}
            </div>
          )}

          {step === 'ENTER_DETAILS' && (
            <div className="space-y-6">
              <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                <h4 className="text-sm font-medium text-gray-400 mb-2">Client Details</h4>
                {selectedBooking ? (
                   <div className="flex justify-between items-start">
                      <div><div className="font-bold text-white text-lg">{formData.firstName} {formData.lastName}</div><div className="text-gray-300">{formData.address}</div></div>
                      <div className="text-right text-sm text-gray-500"><div>{formData.phone}</div><div>{formData.email}</div></div>
                   </div>
                ) : (
                   <div className="grid grid-cols-2 gap-3">
                      <input type="text" placeholder="First Name" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="input" />
                      <input type="text" placeholder="Last Name" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="input" />
                      <input type="text" placeholder="#" value={houseNumber} onChange={e => setHouseNumber(e.target.value)} className="input col-span-1" />
                      <input type="text" value={streetName} onChange={e => setStreetName(e.target.value)} className="input w-full col-span-1" placeholder="Street Name"/>
                      <input type="text" placeholder="Phone" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="input" />
                      <input type="text" placeholder="Email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="input" />
                   </div>
                )}
                
                <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] uppercase text-gray-500 font-bold block mb-1">Property Type</label>
                        <div className="flex gap-1">
                            {['FP', 'FO', 'BO'].map(t => (
                                <button key={t} onClick={() => setFormData({...formData, propertyType: t})} className={`flex-1 py-1.5 text-xs rounded border transition-colors ${formData.propertyType === t ? 'bg-cps-blue border-cps-blue text-white' : 'bg-gray-700 border-gray-600 text-gray-400'}`}>{t}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 justify-center">
                        <button onClick={() => setFormData({...formData, hasLockedGate: !formData.hasLockedGate})} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${formData.hasLockedGate ? 'bg-orange-900/30 border-orange-600 text-orange-200' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                            <Lock size={12}/> Locked Gate {formData.hasLockedGate && <Check size={10}/>}
                        </button>
                        <button onClick={() => setFormData({...formData, hasSprinkler: !formData.hasSprinkler})} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border transition-colors ${formData.hasSprinkler ? 'bg-blue-900/30 border-blue-600 text-blue-200' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                            <Droplets size={12}/> Sprinklers {formData.hasSprinkler && <Check size={10}/>}
                        </button>
                    </div>
                </div>
              </div>

              {selectedRecipe?.questions?.map(q => (
                <div key={q.id}>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{q.label}</label>
                  <div className="flex gap-2">
                    {q.options.map(opt => (
                      <button key={opt} onClick={() => setAnswers({...answers, [q.id]: opt})} className={`flex-1 py-2 text-sm rounded-md border transition-colors ${answers[q.id] === opt ? 'bg-cps-blue border-cps-blue text-white' : 'bg-gray-800 border-gray-600 text-gray-300'}`}>{opt}</button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="space-y-3">
                 <label className="block text-sm font-medium text-gray-300">Total Price</label>
                 <div className="flex gap-3">
                    {paymentInfo.method !== 'IOS' && (
                        <div className="relative flex-1">
                           <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                           <input 
                                type="number" 
                                placeholder="0.00" 
                                value={paymentInfo.amount} 
                                onChange={e => setPaymentInfo({...paymentInfo, amount: e.target.value})}
                                onBlur={e => {
                                    const val = parseFloat(e.target.value);
                                    if(!isNaN(val)) setPaymentInfo(prev => ({...prev, amount: (Math.round(val * 100) / 100).toFixed(2) }));
                                }} 
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none" 
                           />
                        </div>
                    )}
                    <select value={paymentInfo.method} onChange={e => { setPaymentInfo({...paymentInfo, method: e.target.value}); if(e.target.value === 'Credit Card') setShowCreditModal(true); }} className="bg-gray-800 border border-gray-700 rounded-lg px-3 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none">
                       <option value="Cash">Cash</option>
                       <option value="Cheque">Cheque</option>
                       <option value="Credit Card">Credit Card</option>
                       <option value="E-Transfer">E-Transfer</option>
                       {selectedRecipe?.id === 'dethatch' && <option value="IOS">Invoice On Site</option>}
                    </select>
                 </div>
                 
                 {paymentInfo.method === 'E-Transfer' && (
                     <div className="relative animate-fade-in">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
                        <input type="email" placeholder="Customer Email for E-Transfer" value={extraPaymentInfo} onChange={e => setExtraPaymentInfo(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-white focus:ring-2 focus:ring-cps-blue focus:outline-none" />
                     </div>
                 )}

                 {paymentInfo.method === 'Credit Card' && (
                  <div className={`p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                      <span className="text-xs font-bold">{isCreditPaid ? "CARD APPROVED" : "PAYMENT REQUIRED"}</span>
                      {!isCreditPaid && <button onClick={() => setShowCreditModal(true)} className="underline text-xs">Open Terminal</button>}
                  </div>
                 )}
              </div>

              <div className="pt-4">
                 <textarea placeholder="Additional Notes..." value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none h-20 focus:ring-2 focus:ring-cps-blue focus:outline-none" />
              </div>
            </div>
          )}
        </div>

        {step === 'ENTER_DETAILS' && (
           <div className="p-4 border-t border-gray-700 flex justify-end">
              <button onClick={handleSubmit} className="bg-cps-green hover:bg-green-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg transition-all flex items-center gap-2">
                <Check size={18} /> Complete Sale
              </button>
           </div>
        )}
      </div>

      {showCreditModal && (
          <CreditCardModal 
             amount={paymentInfo.amount}
             clientName={`${formData.firstName} ${formData.lastName}`}
             onClose={() => setShowCreditModal(false)} 
             onProcess={(details) => {
                 setIsCreditPaid(true);
                 setShowCreditModal(false);
                 setCcData({
                     number: details.number,
                     expiry: details.expiry,
                     cvc: details.cvc
                 });
                 setFormData(prev => ({ ...prev, notes: `${prev.notes} [CC Paid]`.trim() }));
             }}
          />
      )}
    </div>
  );
};

export default AddContractModal;