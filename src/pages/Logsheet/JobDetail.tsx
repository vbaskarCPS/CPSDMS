// src/pages/Logsheet/JobDetail.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, X, CheckCircle2, Ban, Lock,
  AlertTriangle, Loader, CheckCircle, FileText
} from 'lucide-react';
import { sessionService } from '../../lib/sessionService';
import { getStorageItem } from '../../lib/localStorage';
import { Worker, MasterBooking, SessionTransaction } from '../../types';
import CreditCardModal from '../../components/CreditCardModal';

const JobDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  // --- STATE ---
  const [loading, setLoading] = useState(true);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [originalJob, setOriginalJob] = useState<MasterBooking | null>(null);

  // Form Fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [officeNotes, setOfficeNotes] = useState('');
  const [price, setPrice] = useState<string | number>('0.00');
  const [propertyType, setPropertyType] = useState('FP');
  const [routeNumber, setRouteNumber] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState('Billed');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [etransferEmail, setEtransferEmail] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [ccData, setCcData] = useState<any>(null);

  // Modals
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [isCreditPaid, setIsCreditPaid] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    const init = async () => {
      const w = getStorageItem<Worker | null>('current_user', null);
      if (!w || !jobId) {
        navigate('/');
        return;
      }
      setWorker(w);

      const decodedId = decodeURIComponent(jobId);
      // Fetch assignments from Supabase
      const allJobs = await sessionService.getWorkerAssignments(w.contractorId);
      const foundJob = allJobs.find((j) => j['Booking ID'] === decodedId);

      if (foundJob) {
        setOriginalJob(foundJob);
        setIsReadOnly(foundJob.Status === 'completed');
        loadFormData(foundJob);
      } else {
        alert('Job not found.');
        navigate('/logsheet');
      }
      setLoading(false);
    };
    init();
  }, [jobId, navigate]);

  const loadFormData = (job: MasterBooking) => {
    const fullAddr = job['Full Address'] || '';
    let hNum = job['House Number'] || '';
    let sName = job['Street Name'] || '';

    if (!hNum || !sName) {
      const parts = fullAddr.split(' ');
      if (parts.length > 1 && /^\d+$/.test(parts[0])) {
        hNum = parts[0];
        sName = parts.slice(1).join(' ');
      } else {
        sName = fullAddr;
      }
    }

    setFirstName(job['First Name'] || '');
    setLastName(job['Last Name'] || '');
    setHouseNumber(hNum);
    setStreetName(sName);
    setPhone(job['Home Phone'] || job['Cell Phone'] || '');
    setEmail(job['Email Address'] || '');
    setRouteNumber(job['Route Number'] || '');
    setOfficeNotes(job['Log Sheet Notes'] || '');
    setPrice(job.Price || '0.00');
    setPaymentMethod(
      job['Payment Method'] || (job.Prepaid === 'x' ? 'Prepaid' : 'Billed')
    );
    setPropertyType(job['FO/BO/FP'] || 'FP');

    // Load restored fields if available
    if ((job as any).invoiceNumber) setInvoiceNumber((job as any).invoiceNumber);
    if ((job as any).chequeNumber) setChequeNumber((job as any).chequeNumber);
    if ((job as any).etransferEmail) setEtransferEmail((job as any).etransferEmail);
  };

  const isPrepaid = originalJob?.Prepaid === 'x';

  const handleTaxClick = () => {
    if (isPrepaid || isReadOnly) return;
    const current = parseFloat(price.toString());
    if (isNaN(current)) return;
    const total = Math.round(current * 1.05 * 100) / 100;
    setPrice(total.toFixed(2));
  };

  const handleSave = async () => {
    if (!worker || !originalJob) return;
    setLoading(true);

    const rawPrice = (price || '').toString().trim().toUpperCase();
    let priceVal = parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0;

    if (rawPrice.startsWith('RJ') || rawPrice.startsWith('SP')) {
      priceVal = 52.5;
    }

    const fullAddress = `${houseNumber} ${streetName}`.trim();

    // 1. Prepare Transaction Record with ALL fields
    const tx: SessionTransaction = {
      id: `tx_${originalJob['Booking ID']}_${Date.now()}`,
      jobId: originalJob['Booking ID'],
      timestamp: new Date().toISOString(),
      customerId: originalJob['Booking ID'],
      customerName: `${firstName} ${lastName}`,
      address: fullAddress,
      customerPhone: phone,
      customerEmail: email,
      workerId: worker.contractorId,
      workerName: worker.firstName,
      routeManagerName: 'RM',
      routeCode: routeNumber,
      type: 'Production',
      price: priceVal,
      displayPrice: rawPrice,
      isPaid: paymentMethod !== 'Billed',
      paymentMethod: isPrepaid ? 'Prepaid' : paymentMethod,
      
      // Restored Logic for extended fields
      invoiceNumber: paymentMethod === 'Billed' ? invoiceNumber : undefined,
      etransferEmail: paymentMethod === 'E-Transfer' ? etransferEmail : undefined,
      chequeNumber: paymentMethod === 'Cheque' ? chequeNumber : undefined,
      
      ccFullNumber: ccData?.number,
      ccExpiry: ccData?.expiry,
      ccCVC: ccData?.cvc,
      items: [{ name: 'Aeration', price: priceVal }],
      itemDescription: officeNotes,
      region: 'West',
      seasonId: 'west-aeration',
      isWestSplit: false,
      serviceType: propertyType as any,
    } as any;

    try {
      // 2. Commit to Database
      await sessionService.completeJob(
        tx,
        originalJob['Booking ID'],
        worker.contractorId
      );

      // 3. Update Local Stats
      const session = await sessionService.getActiveLogsheetSession(
        worker.contractorId
      );
      if (session) {
        const newStats = sessionService.recalculateStats(
          session.financialStore,
          5
        );
        await sessionService.updateLogsheetSession(session.id, {
          stats: newStats,
        });
      }

      navigate('/logsheet');
    } catch (err) {
      console.error(err);
      alert('Failed to save job. Please try again.');
      setLoading(false);
    }
  };

  const handleCancel = (status: 'next_time' | 'cancelled') => {
    alert('Status update pending implementation in LIVE backend.');
    navigate('/logsheet');
  };

  if (loading) return <div className="h-screen bg-black flex items-center justify-center"><Loader className="text-cps-blue animate-spin" /></div>;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col border border-gray-700 shadow-2xl">
        
        {/* HEADER */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-3">
              <button onClick={() => navigate('/logsheet')} className="p-1 hover:bg-gray-700 rounded text-gray-400"><ArrowLeft size={20} /></button>
              <div><h2 className="text-xl font-bold text-white">Job Details</h2><p className="text-xs text-gray-400">{originalJob?.['Booking ID']}</p></div>
              {isReadOnly && <span className="bg-blue-900/30 text-blue-300 text-xs px-2 py-0.5 rounded border border-blue-800 flex items-center gap-1"><Lock size={10}/> Completed</span>}
          </div>
          <button onClick={() => navigate('/logsheet')} className="text-gray-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-6 flex-grow custom-scrollbar">
           {/* CLIENT DETAILS */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Client Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Route Code</label>
                      <input value={routeNumber} disabled className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono opacity-50 cursor-not-allowed"/>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">First Name</label><input value={firstName} onChange={e => setFirstName(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Last Name</label><input value={lastName} onChange={e => setLastName(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                  </div>
                  <div className="md:col-span-3 grid grid-cols-4 gap-4">
                      <div className="col-span-1"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">House #</label><input value={houseNumber} onChange={e => setHouseNumber(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                      <div className="col-span-3"><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Street Name</label><input value={streetName} onChange={e => setStreetName(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:col-span-3">
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Phone</label><div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/><input value={phone} onChange={e => setPhone(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-9 text-white" /></div></div>
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Email</label><div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14}/><input value={email} onChange={e => setEmail(e.target.value)} disabled={isReadOnly} className="w-full bg-gray-800 border border-gray-700 rounded p-2 pl-9 text-white" /></div></div>
                  </div>
              </div>
           </div>

           {/* SERVICES & PRICING */}
           <div className={`bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 ${isReadOnly ? 'opacity-75' : ''}`}>
               <div className="flex justify-between items-center mb-3">
                   <h3 className="text-sm font-bold text-gray-300 uppercase">Services & Pricing</h3>
                   {isReadOnly && <span className="text-xs text-blue-300 flex items-center gap-1"><Lock size={10}/> Locked</span>}
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Total Amount ($)</label>
                      <div className="flex gap-2">
                          <input type="text" value={price} onChange={e => setPrice(e.target.value)} className={`flex-grow bg-gray-800 border border-gray-700 rounded p-2 text-xl font-mono font-bold text-green-400 outline-none ${(isPrepaid || isReadOnly) ? 'cursor-not-allowed opacity-50' : ''}`} disabled={isPrepaid || isReadOnly}/>
                          {!isPrepaid && !isReadOnly && <button type="button" onClick={handleTaxClick} className="px-3 bg-gray-700 text-gray-300 rounded border border-gray-600 hover:bg-gray-600 font-bold text-xs">+ Tax</button>}
                      </div>
                  </div>
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Property Type</label>
                      <div className="flex bg-gray-700 rounded-md border border-gray-600 overflow-hidden">
                          {['FP', 'FO', 'BO'].map(t => (
                              <button key={t} onClick={() => setPropertyType(t)} className={`flex-1 py-2 text-xs font-bold transition-colors ${propertyType === t ? 'bg-cps-blue text-white' : 'text-gray-400 hover:bg-gray-600'}`} disabled={isReadOnly}>{t}</button>
                          ))}
                      </div>
                  </div>
               </div>
           </div>

           {/* NOTES */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
               <h3 className="text-sm font-bold text-gray-300 uppercase mb-2 flex items-center gap-2"><FileText size={16}/> Office Notes (Read Only)</h3>
               <div className="w-full bg-gray-800 border border-gray-700 rounded p-3 text-sm text-yellow-100/90 italic min-h-[3rem] whitespace-pre-wrap">{officeNotes || "No notes provided."}</div>
           </div>

           {/* COMPLETION */}
           <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700/50">
               <h3 className="text-sm font-bold text-gray-300 uppercase mb-3">Completion</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Payment Method</label>
                      <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); if(e.target.value==='Credit Card') setShowCreditModal(true); }} className={`w-full bg-gray-800 border border-gray-700 rounded p-2 text-white outline-none ${(isPrepaid || isReadOnly) ? 'cursor-not-allowed opacity-50' : ''}`} disabled={isPrepaid || isReadOnly}>
                          {isPrepaid ? <option value="Prepaid">Prepaid</option> : <><option value="Billed">Billed</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option><option value="E-Transfer">E-Transfer</option><option value="Credit Card">Credit Card</option></>}
                      </select>
                  </div>
                  
                  {/* Restored Conditional Fields */}
                  {paymentMethod === 'Billed' && !isReadOnly && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Invoice #</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="INV-..." /></div>
                  )}
                  {paymentMethod === 'E-Transfer' && !isReadOnly && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Bank Email</label><input type="email" value={etransferEmail} onChange={e => setEtransferEmail(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="client@bank.com" /></div>
                  )}
                  {paymentMethod === 'Cheque' && !isReadOnly && (
                      <div><label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Cheque #</label><input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white" placeholder="#001" /></div>
                  )}
               </div>

               {paymentMethod === 'Credit Card' && (
                   <div className={`mb-4 p-3 rounded border flex items-center justify-between ${isCreditPaid ? 'bg-green-900/20 border-green-600 text-green-400' : 'bg-blue-900/20 border-blue-600 text-blue-300'}`}>
                       <span className="text-sm font-medium">{isCreditPaid ? "Card Processed" : "Payment Required"}</span>
                       {isCreditPaid ? <CheckCircle size={20}/> : <button onClick={() => setShowCreditModal(true)} className="underline text-xs">Open Terminal</button>}
                   </div>
               )}
           </div>
        </div>

        <div className="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-between items-center flex-shrink-0 gap-4">
             {!isReadOnly ? (
                 <>
                     <button onClick={() => setShowCancelModal(true)} className="flex items-center gap-2 px-4 py-3 bg-red-900/20 hover:bg-red-900/40 text-red-300 border border-red-800 rounded-md font-bold transition-colors"><Ban size={18} /> Cancel / Skip</button>
                     <button onClick={handleSave} disabled={paymentMethod === 'Credit Card' && !isCreditPaid} className="flex-1 sm:flex-none px-8 py-3 bg-green-600 hover:bg-green-500 text-white rounded-md font-bold shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"><CheckCircle2 size={18} /> Complete Job</button>
                 </>
             ) : (
                 <p className="text-center w-full text-gray-500 italic text-sm">This record is finalized.</p>
             )}
        </div>
      </div>
      {showCancelModal && <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"><div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm text-center border border-gray-700 shadow-xl"><h3 className="text-lg font-bold text-white mb-2">Mark as Not Done?</h3><div className="space-y-3"><button onClick={() => handleCancel('next_time')} className="w-full py-3 bg-yellow-600/20 text-yellow-400 border border-yellow-700/50 rounded font-bold">Next Time / 2nd Run</button><button onClick={() => handleCancel('cancelled')} className="w-full py-3 bg-red-600/20 text-red-400 border border-red-700/50 rounded font-bold">Cancelled</button><button onClick={() => setShowCancelModal(false)} className="w-full py-3 text-gray-400 hover:text-white">Go Back</button></div></div></div>}
      {showCreditModal && <CreditCardModal amount={price} clientName={`${firstName} ${lastName}`} onClose={() => setShowCreditModal(false)} onProcess={(details) => { setIsCreditPaid(true); setShowCreditModal(false); setCcData(details); }} />}
    </div>
  );
};

export default JobDetail;