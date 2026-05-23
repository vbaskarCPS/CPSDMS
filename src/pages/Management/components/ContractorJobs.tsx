// src/pages/Management/components/ContractorJobs.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { Phone, Mail, Loader, Clock, X as XIcon, FileText, Bookmark, Shovel } from 'lucide-react';
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

// Compact asphalt $ formatter — matches LogsheetJobCard, RMTeamTab, RMAsphaltModal.
// Whole numbers drop the cents to keep the single-row layout tight.
const formatAsphaltDollars = (n: number | undefined | null): string => {
  if (!n || n <= 0) return '$0';
  const rounded = Math.round(n * 100) / 100;
  if (rounded === Math.floor(rounded)) return `$${Math.floor(rounded)}`;
  return `$${rounded.toFixed(2)}`;
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
    return (
      <span title="No email sent">
        <Mail size={14} className="text-gray-600 opacity-30" strokeWidth={2.5} />
      </span>
    );
  }

  if (status.bounced) {
    return (
      <span title={`Email bounced: ${status.reason || 'Unknown reason'}`}>
        <Mail size={14} className="text-red-500" strokeWidth={2.5} />
      </span>
    );
  }

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
      // PendingJobModal detects isPendingSale (and asphalt sub-types) and adjusts
      // its action buttons accordingly.
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
  // Asphalt-aware. Three visual states beyond the existing pending/completed/etc:
  //
  //   MERGED PARENT (saleType undefined, asphaltAmount > 0):
  //     Driveway parent with a paired asphalt child collapsed onto it by the
  //     upstream merge in RMTeamTab. Keeps the regular driveway price & badge;
  //     adds an amber `+ASPH $X` pill (and `+UP $Y` when upsold > 0) inline
  //     next to the price. Slate border preserved (this is still a pending sale).
  //
  //   STANDALONE ASPHALT (saleType === 'asphalt', no sharedJobKey):
  //     Asphalt-only row. The MasterBooking 'Price' field is the asphalt $.
  //     Badge swaps from SALE-PEND to ASPHALT (unassigned) or ASSIGNED (has
  //     assignedRcSessionId). Border swaps slate → amber. Shovel icon next to
  //     the badge for fast visual recognition.
  //
  //   PATH 3 DEFERRED (saleType === 'asphalt', sharedJobKey set):
  //     Driveway already collected via the selling cart's completed transaction;
  //     only asphalt remains pending. Stronger amber tint, RC PICKUP badge.
  //
  // Click behaviour is unchanged. Modal logic (PendingJobModal) handles the
  // asphalt-specific actions if needed; the row itself is a presentation surface.
  // ============================================================================
  const renderJobRow = (job: MasterBooking) => {
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      const isCancelled = job.Status === 'cancelled';
      const isNextTime = job.Status === 'next_time';
      const isLoading = loadingId === job['Booking ID'];
      const notes = job['Log Sheet Notes'] || '';
      const isPendingSale = (job as any).isPendingSale === true;

      // --- ASPHALT FIELD DETECTION (5-field LogsheetJobCard contract) ---
      const asphaltAmount: number = Number((job as any).asphaltAmount) || 0;
      const upsoldAsphaltAmount: number = Number((job as any).upsoldAsphaltAmount) || 0;
      const saleType: string | undefined = (job as any).saleType;
      const sharedJobKey: string | undefined = (job as any).sharedJobKey;
      const assignedRcSessionId: string | undefined = (job as any).assignedRcSessionId;

      const isStandaloneAsphalt = isPendingSale && saleType === 'asphalt';
      const isDeferredAsphalt = isStandaloneAsphalt && typeof sharedJobKey === 'string' && sharedJobKey.length > 0;
      const isAssignedAsphalt = isStandaloneAsphalt && !isDeferredAsphalt && !!assignedRcSessionId;
      const isMergedAsphalt = isPendingSale && !isStandaloneAsphalt && asphaltAmount > 0;
      const isAnyAsphalt = isStandaloneAsphalt || isMergedAsphalt;

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
      // ASPHALT BADGE OVERRIDES — must come BEFORE the generic SALE-PEND branch
      // so standalone asphalt rows get asphalt-specific badges, not SALE-PEND.
      else if (isDeferredAsphalt) {
          // Path 3: driveway already collected, only the asphalt portion remains.
          // Strong amber to signal "executor needs to act on this".
          badge = { text: 'RC PICKUP', color: 'bg-amber-900/50 text-amber-300 border-amber-600' };
      }
      else if (isAssignedAsphalt) {
          // Assigned to a specific RC session but not yet picked up.
          badge = { text: 'ASSIGNED', color: 'bg-amber-900/30 text-amber-400 border-amber-700' };
      }
      else if (isStandaloneAsphalt) {
          // Standalone asphalt child with no RC assignment yet — sits in the
          // unassigned queue (RMAsphaltModal surfaces these for assignment).
          badge = { text: 'ASPHALT', color: 'bg-amber-900/20 text-amber-400 border-amber-800' };
      }
      else if (isPendingSale) {
          // Generic worker-parked sale (drivewey-only or pre-asphalt-flag).
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
      // For standalone asphalt, the row's main $ IS the asphalt amount.
      // For everything else, parse the stored Price field as before.
      let displayPrice: string;
      if (isStandaloneAsphalt) {
          displayPrice = formatAsphaltDollars(asphaltAmount);
      } else {
          const priceStr = String(job.Price || '');
          displayPrice = /^[A-Z]+$/.test(priceStr)
              ? priceStr
              : `$${parseFloat(priceStr.replace(/[^0-9.]/g, '') || '0').toFixed(2)}`;
      }

      // --- Address & Name Fallbacks (pending sales might be partial) ---
      const assembledAddress = job['Full Address']
        || `${job['House Number'] || ''} ${job['Street Name'] || ''}`.trim()
        || '— address pending —';
      const hasName = (job['First Name'] || job['Last Name']);
      const displayName = hasName
        ? `${job['First Name'] || ''} ${job['Last Name']?.charAt(0) || ''}.`.trim()
        : (isStandaloneAsphalt
            ? 'Asphalt job'
            : isPendingSale ? 'Pending sale' : 'Unknown');

      // --- Border / hover treatment ---
      // Border colour ladder, weakest to strongest amber:
      //   plain pending  → gray
      //   pending sale   → slate (existing worker-parked treatment)
      //   merged asphalt → slate + amber accent (parent is still a driveway sale)
      //   standalone     → amber
      //   deferred (P3)  → amber, stronger via shadow on row
      let baseBorder = 'border-gray-700';
      let hoverBorder = 'hover:border-yellow-600';
      if (isDeferredAsphalt) {
          baseBorder = 'border-amber-600';
          hoverBorder = 'hover:border-amber-400';
      } else if (isStandaloneAsphalt) {
          baseBorder = 'border-amber-700/70';
          hoverBorder = 'hover:border-amber-500';
      } else if (isMergedAsphalt) {
          // Slate-with-amber-tinted hover signals "this driveway has asphalt attached".
          baseBorder = 'border-slate-600';
          hoverBorder = 'hover:border-amber-500';
      } else if (isPendingSale) {
          baseBorder = 'border-slate-600';
          hoverBorder = 'hover:border-slate-400';
      } else if (isPaid) {
          hoverBorder = 'hover:border-cps-blue';
      }

      return (
          <div
            key={job['Booking ID']}
            onClick={() => handleJobClick(job)}
            className={`bg-gray-800 border rounded px-2 py-1.5 relative mb-1 transition-colors cursor-pointer group ${baseBorder} ${hoverBorder}`}
          >
              <div className="flex items-center justify-between gap-2 text-xs">
                  {/* Left Section: Route, Name, Services, Address, Notes */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold bg-gray-700 text-gray-300 px-1.5 rounded text-[10px] min-w-[32px] text-center flex-shrink-0">
                          {job['Route Number'] || '--'}
                      </span>
                      <span className={`font-bold truncate ${isCancelled ? 'text-gray-500 line-through' : isStandaloneAsphalt && !hasName ? 'text-amber-200 italic' : isPendingSale && !hasName ? 'text-slate-300 italic' : 'text-gray-200'}`} title={`${job['First Name'] || ''} ${job['Last Name'] || ''}`.trim() || (isStandaloneAsphalt ? 'Asphalt job (no name yet)' : isPendingSale ? 'Pending sale (no name yet)' : 'Unknown')}>
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

                      {/* Notes - inline after address (md+ screens only) */}
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

                  {/* Right Section: FO/BO, Asphalt pill (merged), Price, Badge */}
                  <div className="flex items-center gap-2 flex-shrink-0 text-right">
                      {job['FO/BO/FP'] && job['FO/BO/FP'] !== 'FP' && (
                          <span className="text-[9px] font-bold text-gray-500 border border-gray-600 px-1 rounded">
                              {job['FO/BO/FP']}
                          </span>
                      )}

                      {/* ASPHALT INLINE PILL — merged case only. Sits between FO/BO
                          and Price so it reads as "addition to this driveway price".
                          Compresses Up to a second segment when upsoldAsphaltAmount > 0. */}
                      {isMergedAsphalt && (
                          <span
                            className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-900/30 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap"
                            title={`Asphalt component: ${formatAsphaltDollars(asphaltAmount)}${upsoldAsphaltAmount > 0 ? ` (upsold ${formatAsphaltDollars(upsoldAsphaltAmount)})` : ''}`}
                          >
                              <Shovel size={9} strokeWidth={2.5} />
                              +ASPH {formatAsphaltDollars(asphaltAmount)}
                              {upsoldAsphaltAmount > 0 && (
                                  <span className="text-amber-200/90 ml-0.5">
                                      +UP {formatAsphaltDollars(upsoldAsphaltAmount)}
                                  </span>
                              )}
                          </span>
                      )}

                      <span className={`font-mono font-bold w-16 text-right ${isCancelled ? 'text-gray-500 line-through' : isStandaloneAsphalt ? 'text-amber-200' : isPendingSale ? 'text-slate-300' : 'text-gray-300'}`}>
                          {displayPrice}
                      </span>

                      <button className={`text-[9px] font-bold px-1.5 py-0.5 rounded border min-w-[55px] text-center flex items-center justify-center gap-1 ${badge.color}`}>
                          {isLoading ? <Loader size={8} className="animate-spin" /> : (
                            <>
                              {isStandaloneAsphalt && <Shovel size={8} strokeWidth={2.5} />}
                              {!isStandaloneAsphalt && isPendingSale && <Bookmark size={8} strokeWidth={2.5}/>}
                              {badge.text}
                            </>
                          )}
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
            buttons for a Delete button. Asphalt sub-types (standalone, deferred,
            assigned) are handled by PendingJobModal's own asphalt-aware logic. */}
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