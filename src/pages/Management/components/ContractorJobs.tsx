// src/pages/Management/components/ContractorJobs.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { Phone, Mail, Loader, Clock, X as XIcon, FileText, Bookmark } from 'lucide-react';
import { MasterBooking, SessionTransaction, SeasonType } from '../../../types';
import EditTransactionModal from '../../../components/EditTransactionModal';
import PendingJobModal from '../../../components/PendingJobModal';
import { sessionService } from '../../../lib/sessionService';
import { supabase } from '../../../lib/supabase';

interface ContractorJobsProps {
  bookings: MasterBooking[];
  financialStore: SessionTransaction[];
  onRefresh?: () => void;
  seasonType?: SeasonType;
}

// Map the full service names (from AddContractModal) to short badge text
const BADGE_MAP: Record<string, string> = {
  'Star Plan Pro': 'SP PRO',
  'Lawn Rejuvenation': 'REJUV',
  'Dethatching': 'DET',
  'Grub Control': 'GRUB',
  'Golf Course': 'GOLF',
  'Rejuvenation After Care': 'AC',
  // Central Add-Ons
  'Window Washing': 'WW',
  // East Add-Ons
  'Driveway Sealing': 'DWS',
  'Hot Asphalt': 'RAMP'
};

// --- EMAIL STATUS COMPONENT ---
const EmailStatusIcon: React.FC<{ email: string }> = ({ email }) => {
  const [status, setStatus] = useState<{ sent: boolean; bounced: boolean; reason?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data } = await supabase
          .from('email_logs')
          .select('status, bounce_reason')
          .eq('recipient_email', email)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (data) {
          setStatus({
            sent: data.status === 'sent' || data.status === 'bounced',
            bounced: data.status === 'bounced',
            reason: data.bounce_reason
          });
        } else {
          setStatus(null);
        }
      } catch (err) {
        console.error('Error fetching email status:', err);
        setStatus(null);
      } finally {
        setLoading(false);
      }
    };
    
    if (email) {
      fetchStatus();
    } else {
      setLoading(false);
    }
  }, [email]);
  
  if (loading) {
    return <Mail size={14} className="text-gray-500 opacity-50 animate-pulse" strokeWidth={2.5} />;
  }
  
  if (!status || !status.sent) {
    // No email sent (grey)
    return (
      <span title="No email sent">
        <Mail size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
      </span>
    );
  }
  
  if (status.bounced) {
    // Email bounced (red)
    return (
      <span title={`Email bounced: ${status.reason || 'Unknown reason'}`}>
        <Mail size={14} className="text-red-500" strokeWidth={2.5} />
      </span>
    );
  }
  
  // Email sent successfully (green)
  return (
    <span title={`Email sent to ${email}`}>
      <Mail size={14} className="text-green-500" strokeWidth={2.5} />
    </span>
  );
};

// --- SERVICE BADGES FOR LAWN REJUV ---
const ServiceBadges: React.FC<{ services?: MasterBooking['services'] }> = ({ services }) => {
  if (!services) return null;

  const badges = [
    { key: 'aeration', label: 'A', color: 'bg-blue-900/50 text-blue-300 border-blue-700/50', active: services.aeration },
    { key: 'dethatch', label: 'D', color: 'bg-orange-900/50 text-orange-300 border-orange-700/50', active: services.dethatch },
    { key: 'fertilizer', label: 'F', color: 'bg-green-900/50 text-green-300 border-green-700/50', active: services.fertilizer },
    { key: 'seed', label: 'S', color: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/50', active: services.seed },
    { key: 'lime', label: 'L', color: 'bg-purple-900/50 text-purple-300 border-purple-700/50', active: services.lime },
  ];

  const activeBadges = badges.filter(b => b.active);
  if (activeBadges.length === 0) return null;

  return (
    <div className="flex gap-0.5">
      {activeBadges.map(badge => (
        <span
          key={badge.key}
          className={`text-[8px] px-1 py-0.5 rounded border font-bold ${badge.color}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
};

const ContractorJobs: React.FC<ContractorJobsProps> = ({ 
  bookings, 
  financialStore, 
  onRefresh,
  seasonType = 'aeration'
}) => {
  const [editingTransaction, setEditingTransaction] = useState<SessionTransaction | null>(null);
  const [pendingJob, setPendingJob] = useState<MasterBooking | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const isLawnRejuv = seasonType === 'lawn_rejuv';

  // --- Merge Bookings & Transactions ---
  const allJobs = useMemo(() => {
      // Create a map of transactions for quick lookup
      const txMap = new Map<string, SessionTransaction>();
      financialStore.forEach(tx => txMap.set(tx.jobId, tx));

      // 1. Process Existing Bookings (Augment with Transaction Data if available)
      const augmentedBookings = bookings.map(b => {
          const tx = txMap.get(b['Booking ID']);
          if (tx) {
              return {
                  ...b,
                  ...({
                      isUpgrade: tx.type === 'Upgrade',
                      isAddOn: tx.type === 'Add-On',
                      isNewSale: tx.type === 'Sale',
                      items: tx.items,
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
                   services: tx.services,
                   ...({
                       isUpgrade: tx.type === 'Upgrade',
                       isAddOn: tx.type === 'Add-On',
                       isNewSale: tx.type === 'Sale',
                       items: tx.items,
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
          if (job.Completed === 'x' || job.Status === 'completed') return 4;
          if (job.Status === 'cancelled') return 3;
          if (job.Status === 'next_time') return 2;
          return 1; // Pending
      };
      const scoreDiff = getScore(a) - getScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      return (a['Route Number'] || '').localeCompare(b['Route Number'] || '');
  });

  const pendingJobs = sortedBookings.filter(b => (
    !b.Completed && 
    (!b.Status || b.Status === 'pending')
  ));
  
  const nextTimeJobs = sortedBookings.filter(b => b.Status === 'next_time');
  const cancelledJobs = sortedBookings.filter(b => b.Status === 'cancelled');
  const completedJobs = sortedBookings.filter(b => b.Completed === 'x' || b.Status === 'completed');

  // --- Handlers ---
  const handleJobClick = async (job: MasterBooking) => {
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      const jobId = job['Booking ID'];
      
      if (!jobId) {
          console.error("Critical Error: Job missing Booking ID", job);
          return;
      }

      // For completed jobs, open EditTransactionModal
      if (isPaid) {
          setLoadingId(jobId);

          try {
              const tx = await sessionService.getTransactionByJobId(jobId);
              
              if (tx) {
                  setEditingTransaction(tx);
              } else {
                  alert("Transaction record not found in database.");
              }
          } catch (err) {
              console.error("Error fetching transaction:", err);
              alert("Failed to load transaction details.");
          } finally {
              setLoadingId(null);
          }
          return;
      }

      // For pending, cancelled, next_time, or pending-sale jobs, open PendingJobModal.
      // PendingJobModal (file 9) detects isPendingSale and renders a Delete
      // button instead of the Next Time / Cancelled buttons.
      setPendingJob(job);
  };

  const handleEditModalClose = () => {
      setEditingTransaction(null);
  };

  const handleEditModalUpdate = () => {
      setEditingTransaction(null);
      if (onRefresh) {
          onRefresh();
      }
  };

  const handlePendingModalClose = () => {
      setPendingJob(null);
  };

  const handlePendingModalUpdate = () => {
      setPendingJob(null);
      if (onRefresh) {
          onRefresh();
      }
  };

  // ============================================================================
  // RENDER JOB ROW
  // ============================================================================
  // CHANGE: Notes are now displayed INLINE on the same row after address (md+ screens only)
  // Previously: Notes were on a separate second row below the main content
  // Now: [Route] Name [Services] Address 📝Notes... 📞 ✉️ Payment Price [Badge]
  // ============================================================================
  // NEW: Pending sales (isPendingSale flag set by RMTeamTab via convertPendingSaleToBooking)
  // get a yellow SALE-PEND badge + slate-gray border accent. Worker-created
  // parked sales, distinct from office prebooks.
  // ============================================================================
  const renderJobRow = (job: MasterBooking) => {
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      const isCancelled = job.Status === 'cancelled';
      const isNextTime = job.Status === 'next_time';
      const isLoading = loadingId === job['Booking ID'];
      const notes = job['Log Sheet Notes'] || '';
      // PENDING SALE DETECTION — flag set upstream in RMTeamTab.
      // Drives badge text/color and the slate-gray border treatment below.
      const isPendingSale = (job as any).isPendingSale === true;

      // --- Badges ---
      let badge = { text: 'PENDING', color: 'bg-gray-700 text-gray-400 border-gray-600' };
      
      if (isPaid) {
          const extra = job as any;
          
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
      else if (isCancelled) {
          badge = { text: 'CANCELLED', color: 'bg-red-900/30 text-red-400 border-red-800' };
      }
      else if (isNextTime) {
          badge = { text: 'NEXT TIME', color: 'bg-orange-900/30 text-orange-400 border-orange-800' };
      }
      else if (isPendingSale) {
          // SALE-PEND badge — yellow because pending sales sit in the "new sale"
          // colour family. Distinct from PENDING (generic gray, office prebooks).
          badge = { text: 'SALE-PEND', color: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
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

      // --- Address & Name Fallbacks (pending sales might be partial) ---
      const assembledAddress = job['Full Address']
        || `${job['House Number'] || ''} ${job['Street Name'] || ''}`.trim()
        || '— address pending —';
      const hasName = (job['First Name'] || job['Last Name']);
      const displayName = hasName
        ? `${job['First Name'] || ''} ${job['Last Name']?.charAt(0) || ''}.`.trim()
        : (isPendingSale ? 'Pending sale' : 'Unknown');

      // --- Border / hover treatment ---
      // Pending sales get a slate-gray border accent to visually mark them as
      // worker-parked work. Everything else uses the default gray border with
      // hover-colour driven by paid vs pending status.
      const baseBorder = isPendingSale ? 'border-slate-600' : 'border-gray-700';
      const hoverBorder = isPaid ? 'hover:border-cps-blue' : isPendingSale ? 'hover:border-slate-400' : 'hover:border-yellow-600';

      return (
          <div 
            key={job['Booking ID']} 
            onClick={() => handleJobClick(job)}
            className={`bg-gray-800 border rounded px-2 py-1.5 relative mb-1 transition-colors cursor-pointer group ${baseBorder} ${hoverBorder}`}
          >
              {/* Single Row - All content on one line */}
              <div className="flex items-center justify-between gap-2 text-xs">
                  {/* Left Section: Route, Name, Services, Address, Notes */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold bg-gray-700 text-gray-300 px-1.5 rounded text-[10px] min-w-[32px] text-center flex-shrink-0">
                          {job['Route Number'] || '--'}
                      </span>
                      <span className={`font-bold truncate ${isCancelled ? 'text-gray-500 line-through' : isPendingSale && !hasName ? 'text-slate-300 italic' : 'text-gray-200'}`} title={`${job['First Name'] || ''} ${job['Last Name'] || ''}`.trim() || (isPendingSale ? 'Pending sale (no name yet)' : 'Unknown')}>
                          {displayName}
                      </span>
                      
                      {/* Service Badges for Lawn Rejuv - inline after name */}
                      {isLawnRejuv && job.services && (
                        <ServiceBadges services={job.services} />
                      )}
                      
                      {/* Address - hidden on mobile */}
                      <span className="text-gray-500 truncate text-[10px] hidden sm:inline flex-shrink">
                          {assembledAddress}
                      </span>

                      {/* CHANGED: Notes now inline after address (md+ screens only) */}
                      {notes && (
                        <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-gray-500 italic truncate max-w-[200px] flex-shrink" title={notes}>
                          <FileText size={10} className="flex-shrink-0 text-gray-600" />
                          <span className="truncate">{notes}</span>
                        </span>
                      )}
                  </div>

                  {/* Icons with Email Status */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                      <Phone size={14} className={job['Cell Phone'] || job['Home Phone'] ? "text-green-500" : "text-gray-600 opacity-30"} strokeWidth={2.5} />
                      
                      {/* Email Icon with Status */}
                      {isPaid && job['Email Address'] ? (
                        <EmailStatusIcon email={job['Email Address']} />
                      ) : (
                        <Mail size={14} className={job['Email Address'] ? "text-blue-500" : "text-gray-600 opacity-30"} strokeWidth={2.5} />
                      )}
                  </div>

                  {/* Payment Info */}
                  {isPaid && paymentDisplay && (
                      <div className="flex items-center justify-end text-[10px] text-gray-400 italic truncate flex-shrink text-right px-2 min-w-0 max-w-[120px]">
                          {paymentDisplay}
                      </div>
                  )}

                  {/* Right Section: FO/BO, Price, Badge */}
                  <div className="flex items-center gap-2 flex-shrink-0 text-right">
                      {job['FO/BO/FP'] && job['FO/BO/FP'] !== 'FP' && (
                          <span className="text-[9px] font-bold text-gray-500 border border-gray-600 px-1 rounded">
                              {job['FO/BO/FP']}
                          </span>
                      )}
                      <span className={`font-mono font-bold w-16 text-right ${isCancelled ? 'text-gray-500 line-through' : isPendingSale ? 'text-slate-300' : 'text-gray-300'}`}>
                          {displayPrice}
                      </span>
                      
                      <button className={`text-[9px] font-bold px-1.5 py-0.5 rounded border min-w-[55px] text-center flex items-center justify-center gap-1 ${badge.color}`}>
                          {isLoading ? <Loader size={8} className="animate-spin" /> : (
                            <>
                              {isPendingSale && <Bookmark size={8} strokeWidth={2.5}/>}
                              {badge.text}
                            </>
                          )}
                      </button>
                  </div>
              </div>

              {/* REMOVED: Previous separate notes row that was here */}
              {/* Notes are now inline above in the left section */}
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
            {nextTimeJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-orange-400 uppercase px-1 mb-1 flex items-center gap-1">
                        <Clock size={10} /> Next Time
                    </h4>
                    {nextTimeJobs.map(renderJobRow)}
                </div>
            )}
            {cancelledJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-red-400 uppercase px-1 mb-1 flex items-center gap-1">
                        <XIcon size={10} /> Cancelled
                    </h4>
                    {cancelledJobs.map(renderJobRow)}
                </div>
            )}
            {completedJobs.length > 0 && (
                <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-green-400 uppercase px-1 mb-1">Completed</h4>
                    {completedJobs.map(renderJobRow)}
                </div>
            )}
        </div>

        {/* --- EDIT TRANSACTION MODAL (Completed Jobs) --- */}
        {editingTransaction && (
            <EditTransactionModal 
                transaction={editingTransaction}
                onClose={handleEditModalClose}
                onUpdate={handleEditModalUpdate}
            />
        )}

        {/* --- PENDING JOB MODAL (Pending/NextTime/Cancelled/PendingSale Jobs) ---
            PendingJobModal detects isPendingSale and swaps Next Time/Cancelled
            buttons for a Delete button (file 9). */}
        {pendingJob && (
            <PendingJobModal
                job={pendingJob}
                onClose={handlePendingModalClose}
                onUpdate={handlePendingModalUpdate}
                seasonType={seasonType}
            />
        )}
    </>
  );
};

export default ContractorJobs;