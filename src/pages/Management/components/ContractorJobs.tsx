// src/pages/Management/components/ContractorJobs.tsx
import React, { useState, useMemo } from 'react';
import { Phone, Mail, Loader } from 'lucide-react';
import { MasterBooking, SessionTransaction } from '../../../types';
import EditTransactionModal from '../../../components/EditTransactionModal';
import { sessionService } from '../../../lib/sessionService';

interface ContractorJobsProps {
  bookings: MasterBooking[];
  financialStore: SessionTransaction[];
  onRevert?: (job: MasterBooking) => void;
}

// Map the full service names (from AddContractModal) to short badge text
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB'
};

const ContractorJobs: React.FC<ContractorJobsProps> = ({ bookings, financialStore, onRevert }) => {
  const [editingTransaction, setEditingTransaction] = useState<SessionTransaction | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // --- Merge Bookings & Transactions ---
  const allJobs = useMemo(() => {
      // Create a map of transactions for quick lookup
      const txMap = new Map<string, SessionTransaction>();
      financialStore.forEach(tx => txMap.set(tx.jobId, tx));

      // 1. Process Existing Bookings (Augment with Transaction Data if available)
      const augmentedBookings = bookings.map(b => {
          const tx = txMap.get(b['Booking ID']);
          if (tx) {
              // If we have a transaction, attach the specific metadata we need for badges
              return {
                  ...b,
                  // Attach these properties strictly for display logic
                  ...({
                      isUpgrade: tx.type === 'Upgrade',
                      isAddOn: tx.type === 'Add-On',
                      isNewSale: tx.type === 'Sale',
                      items: tx.items, // <--- Capture the items array to read the service name
                      paymentBreakdown: tx.paymentBreakdown
                  } as any)
              };
          }
          return b;
      });

      const existingIds = new Set(augmentedBookings.map(b => b['Booking ID']));
      const combined = [...augmentedBookings];

      // 2. Add New Transactions (that aren't in bookings)
      financialStore.forEach(tx => {
          if (!existingIds.has(tx.jobId)) {
               const nameParts = (tx.customerName || '').split(' ');
               const convertedJob: MasterBooking = {
                   'Booking ID': tx.jobId,
                   'First Name': nameParts[0] || '',
                   'Last Name': nameParts.slice(1).join(' ') || '',
                   'Full Address': tx.address || '',
                   'Route Number': tx.routeCode || '',
                   'Price': tx.displayPrice || String(tx.price),
                   'Status': 'completed',
                   'Completed': 'x',
                   'Payment Method': tx.paymentMethod,
                   'Email Address': tx.customerEmail,
                   'Cell Phone': tx.customerPhone,
                   // Attach extra metadata for badging
                   ...({
                       isUpgrade: tx.type === 'Upgrade',
                       isAddOn: tx.type === 'Add-On',
                       isNewSale: tx.type === 'Sale',
                       items: tx.items, // <--- Capture the items array here too
                       paymentBreakdown: tx.paymentBreakdown
                   } as any)
               };
               combined.push(convertedJob);
          }
      });
      return combined;
  }, [bookings, financialStore]);

  // --- Sort & Filter ---
  const sortedBookings = [...allJobs].sort((a, b) => {
      const getScore = (job: MasterBooking) => {
          if (job.Completed === 'x') return 3;
          if (job.Status && job.Status !== 'pending') return 2; // Not Done
          return 1; // Pending
      };
      const scoreDiff = getScore(a) - getScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      return (a['Route Number'] || '').localeCompare(b['Route Number'] || '');
  });

  const pendingJobs = sortedBookings.filter(b => (!b.Completed && (!b.Status || b.Status === 'pending')));
  const notDoneJobs = sortedBookings.filter(b => b.Status && b.Status !== 'pending' && b.Status !== 'completed' && b.Completed !== 'x');
  const completedJobs = sortedBookings.filter(b => b.Completed === 'x' || b.Status === 'completed');

  // --- Handlers ---
  const handleJobClick = async (job: MasterBooking) => {
      // 1. Validate Job status
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      
      // DEBUG: Log click event
      console.log(`Job Clicked: ${job['First Name']} ${job['Last Name']} (ID: ${job['Booking ID']}) - Paid: ${isPaid}`);

      if (!isPaid) return;

      const jobId = job['Booking ID'];
      if (!jobId) {
          console.error("Critical Error: Job missing Booking ID", job);
          return;
      }

      setLoadingId(jobId);

      try {
          // 2. Fetch Transaction
          console.log(`Fetching transaction details for Job ID: ${jobId}`);
          const tx = await sessionService.getTransactionByJobId(jobId);
          
          // 3. Open Modal
          if (tx) {
              console.log("Transaction found, opening modal:", tx);
              setEditingTransaction(tx);
          } else {
              console.warn(`No transaction record found in DB for Job ID: ${jobId}`);
              alert("Transaction record not found in database (it might have been deleted or not synced).");
          }
      } catch (err) {
          console.error("Error fetching transaction:", err);
          alert("Failed to load transaction details. Please check your connection.");
      } finally {
          setLoadingId(null);
      }
  };

  const renderJobRow = (job: MasterBooking) => {
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      const isLoading = loadingId === job['Booking ID'];

      // --- Badges ---
      let badge = { text: 'PENDING', color: 'bg-gray-700 text-gray-400 border-gray-600' };
      
      if (isPaid) {
          const extra = job as any;
          
          // Helper: Check items[0].name against our map
          const getLabel = (generic: string) => {
             if (extra.items && extra.items.length > 0) {
                 const name = extra.items[0].name;
                 if (BADGE_MAP[name]) return BADGE_MAP[name];
             }
             return generic;
          };

          if (extra.isUpgrade) {
              badge = { text: getLabel('UPGRADE'), color: 'bg-orange-900/30 text-orange-400 border-orange-800' };
          } 
          else if (extra.isAddOn) {
              badge = { text: getLabel('ADD-ON'), color: 'bg-blue-900/30 text-blue-400 border-blue-800' };
          } 
          else if (extra.isNewSale) {
              badge = { text: 'SALE', color: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
          } 
          else {
              badge = { text: 'DONE', color: 'bg-green-900/30 text-green-400 border-green-800' };
          }
      } 
      else if (job.Status && job.Status !== 'pending') {
          badge = { text: job.Status.toUpperCase().substring(0, 8), color: 'bg-red-900/30 text-red-400 border-red-800' };
      } 
      else if (job.Prepaid === 'x') {
          badge = { text: 'PREPAID', color: 'bg-indigo-900/30 text-indigo-400 border-indigo-800' };
      }

      // --- Payment Display ---
      const breakdownObj = (job as any).paymentBreakdown;
      const simpleMethod = job['Payment Method'];
      let paymentDisplay = '';
      if (breakdownObj && typeof breakdownObj === 'object') {
          paymentDisplay = Object.entries(breakdownObj)
              .map(([k, v]) => `${k}: $${Number(v).toFixed(2)}`)
              .join(', ');
      } else if (simpleMethod) {
          paymentDisplay = simpleMethod;
      }

      // --- Price Display ---
      const priceStr = String(job.Price || '');
      const displayPrice = /^[A-Z]+$/.test(priceStr) 
          ? priceStr 
          : `$${parseFloat(priceStr.replace(/[^0-9.]/g, '') || '0').toFixed(2)}`;

      return (
          <div 
            key={job['Booking ID']} 
            onClick={() => handleJobClick(job)}
            className={`bg-gray-800 border border-gray-700 rounded px-2 py-1.5 flex flex-col gap-1 relative mb-1 transition-colors ${isPaid ? 'hover:border-cps-blue cursor-pointer group' : ''}`}
          >
              <div className="flex items-center justify-between gap-2 text-xs">
                  {/* Left */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold bg-gray-700 text-gray-300 px-1.5 rounded text-[10px] min-w-[32px] text-center">
                          {job['Route Number'] || '--'}
                      </span>
                      <span className="font-bold text-gray-200 truncate" title={`${job['First Name']} ${job['Last Name']}`}>
                          {job['First Name']} {job['Last Name']?.charAt(0) || ''}.
                      </span>
                      <span className="text-gray-500 truncate text-[10px] hidden sm:block">
                          {job['Full Address']}
                      </span>
                  </div>

                  {/* Icons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                      <Phone size={14} className={job['Cell Phone'] || job['Home Phone'] ? "text-green-500" : "text-gray-600 opacity-30"} strokeWidth={2.5} />
                      <Mail size={14} className={job['Email Address'] ? "text-blue-500" : "text-gray-600 opacity-30"} strokeWidth={2.5} />
                  </div>

                  {/* Payment Info */}
                  {isPaid && paymentDisplay && (
                      <div className="flex items-center justify-end text-[10px] text-gray-400 italic truncate flex-shrink text-right px-2 min-w-0 max-w-[120px]">
                          {paymentDisplay}
                      </div>
                  )}

                  {/* Right */}
                  <div className="flex items-center gap-2 flex-shrink-0 text-right">
                      {job['FO/BO/FP'] && job['FO/BO/FP'] !== 'FP' && (
                          <span className="text-[9px] font-bold text-gray-500 border border-gray-600 px-1 rounded">
                              {job['FO/BO/FP']}
                          </span>
                      )}
                      <span className="font-mono font-bold text-gray-300 w-16 text-right">
                          {displayPrice}
                      </span>
                      
                      <button className={`text-[9px] font-bold px-1.5 py-0.5 rounded border min-w-[55px] text-center flex items-center justify-center gap-1 ${badge.color}`}>
                          {isLoading ? <Loader size={8} className="animate-spin" /> : badge.text}
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  if (sortedBookings.length === 0) return <div className="text-gray-500 text-xs mt-2 px-2 italic text-center">No jobs assigned.</div>;

  return (
    <>
        <div className="mt-2 space-y-3 px-1 pb-2">
            {pendingJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase px-1 mb-1">Pending</h4>
                    {pendingJobs.map(renderJobRow)}
                </div>
            )}
            {notDoneJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-red-400 uppercase px-1 mb-1">Not Done</h4>
                    {notDoneJobs.map(renderJobRow)}
                </div>
            )}
            {completedJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-green-400 uppercase px-1 mb-1">Completed</h4>
                    {completedJobs.map(renderJobRow)}
                </div>
            )}
        </div>

        {/* --- EDIT MODAL --- */}
        {editingTransaction && (
            <EditTransactionModal 
                transaction={editingTransaction}
                onClose={() => setEditingTransaction(null)}
                onUpdate={() => {
                    setEditingTransaction(null);
                    // Optionally trigger a refresh here if you have a refresh prop
                    // e.g., if props.onRefresh() exists
                }}
            />
        )}
    </>
  );
};

export default ContractorJobs;