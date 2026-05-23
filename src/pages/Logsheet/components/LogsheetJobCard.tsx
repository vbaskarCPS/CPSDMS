// src/pages/Logsheet/components/LogsheetJobCard.tsx
import React from 'react';
import { MapPin, ChevronRight, Check, FileText, Phone, Mail, Clock, X as XIcon, Bookmark, Shovel } from 'lucide-react';
import { MasterBooking, ServiceFlags, SERVICE_FLAG_KEYS } from '../../../types';

interface LogsheetJobCardProps {
  job: MasterBooking;
  onClick: () => void;
}

// Warning keyword pattern - case insensitive
const WARNING_PATTERN = /2nd\s*run|mbh|march/i;

// Service badge colors
const SERVICE_BADGE_COLORS: Record<keyof ServiceFlags, { bg: string; text: string; border: string }> = {
  aeration: { bg: 'bg-blue-900/40', text: 'text-blue-300', border: 'border-blue-600' },
  dethatch: { bg: 'bg-orange-900/40', text: 'text-orange-300', border: 'border-orange-600' },
  fertilizer: { bg: 'bg-green-900/40', text: 'text-green-300', border: 'border-green-600' },
  seed: { bg: 'bg-yellow-900/40', text: 'text-yellow-300', border: 'border-yellow-600' },
  lime: { bg: 'bg-purple-900/40', text: 'text-purple-300', border: 'border-purple-600' },
};

const SERVICE_BADGE_LABELS: Record<keyof ServiceFlags, string> = {
  aeration: 'A',
  dethatch: 'D',
  fertilizer: 'F',
  seed: 'S',
  lime: 'L',
};

// Helper: Format price to always show 2 decimal places while preserving prefixes
const formatPrice = (rawPrice: string | number | undefined): string => {
  if (!rawPrice) return '$0.00';
  
  const priceStr = String(rawPrice).trim();
  
  // If price is just letters (RJ, SP, FSL), return as-is
  if (/^[A-Za-z]+$/.test(priceStr)) {
    return priceStr;
  }
  
  // Extract prefix (letters at the start) and numeric portion
  const prefixMatch = priceStr.match(/^([A-Za-z]+)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  
  // Extract numeric portion (everything after prefix)
  const numericPortion = priceStr.replace(/^[A-Za-z]+/, '').replace(/[^0-9.]/g, '');
  const numValue = parseFloat(numericPortion) || 0;
  
  // Format with 2 decimal places
  const formatted = numValue.toFixed(2);
  
  // If there was a prefix (like RJ, SP, FSL), return with prefix
  if (prefix) {
    return `${prefix}${formatted}`;
  }
  
  // Otherwise return with dollar sign
  return `$${formatted}`;
};

// Helper: Format a numeric asphalt-side amount as a compact dollar string.
// Asphalt amounts always come in as plain numbers (no flat-code prefixes), so
// this is simpler than formatPrice. Returns e.g. "$300" or "$0" — no decimals
// because the pills are tight on horizontal space and amounts are typically
// whole dollars on the cart side.
const formatAsphaltAmount = (n: number | undefined | null): string => {
  if (!n || n <= 0) return '$0';
  // Round-half-up to nearest dollar for the badge; keep cents only if non-trivial.
  const rounded = Math.round(n * 100) / 100;
  if (rounded === Math.floor(rounded)) return `$${Math.floor(rounded)}`;
  return `$${rounded.toFixed(2)}`;
};

// Helper: Format payment breakdown for display
const formatPaymentDisplay = (job: MasterBooking): string => {
  const breakdown = (job as any).paymentBreakdown as Record<string, number> | undefined;
  const simpleMethod = job['Payment Method'] as string | undefined;
  
  // If we have a breakdown object with entries
  if (breakdown && typeof breakdown === 'object' && Object.keys(breakdown).length > 0) {
    const entries = Object.entries(breakdown);
    
    // Single payment method in breakdown
    if (entries.length === 1) {
      return entries[0][0]; // Just return the method name
    }
    
    // Multiple payment methods - show compact breakdown
    return entries
      .map(([method, amount]) => {
        // Shorten method names for compactness
        const shortMethod = method
          .replace('Credit Card', 'CC')
          .replace('E-Transfer', 'E-Tr')
          .replace('Prepaid', 'PP');
        return `${shortMethod}: $${Number(amount).toFixed(0)}`;
      })
      .join(', ');
  }
  
  // Fall back to simple payment method
  if (simpleMethod) {
    return simpleMethod;
  }
  
  return 'Paid';
};

// Warning Watermark - absolutely positioned, no layout impact
const WarningWatermark: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-end pointer-events-none overflow-hidden rounded-xl">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="80"
      height="80"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-orange-500/15 mr-4"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  </div>
);

// Service Badges Component
const ServiceBadges: React.FC<{ services?: ServiceFlags }> = ({ services }) => {
  if (!services) return null;
  
  const activeServices = SERVICE_FLAG_KEYS.filter(key => services[key]);
  if (activeServices.length === 0) return null;
  
  return (
    <div className="flex items-center gap-1 mt-1">
      {activeServices.map(key => {
        const colors = SERVICE_BADGE_COLORS[key];
        return (
          <span
            key={key}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border}`}
          >
            {SERVICE_BADGE_LABELS[key]}
          </span>
        );
      })}
    </div>
  );
};

const LogsheetJobCard: React.FC<LogsheetJobCardProps> = ({ job, onClick }) => {
  // --- PENDING SALE DETECTION ---
  // Pending sales are worker-initiated, half-collected sale rows. They're not
  // office bookings, not yet completed transactions — a third state that gets
  // its own visual treatment so workers don't confuse them with prebooks.
  const isPendingSale = (job as any).isPendingSale === true;

  // --- ASPHALT DETECTION (Sealing only — but the logic is season-agnostic so
  // an accidental non-sealing setter wouldn't break the display) ---
  //
  // CONTRACT FOR CALLERS (Dashboard.tsx / RMTeamTab.tsx convertPendingSaleToBooking):
  // When converting a PendingSale row to a MasterBooking-shaped object for this
  // component, propagate the following fields onto the booking (they ride on
  // MasterBooking's `[key: string]: any` index signature — no type changes needed):
  //
  //   asphaltAmount        — $ for the asphalt portion (from PendingSale.asphaltAmount)
  //   upsoldAsphaltAmount  — $ for RC's upsold portion (typically 0 in pending state)
  //   saleType             — 'asphalt' marks a STANDALONE asphalt child row
  //   sharedJobKey         — Path 3 deferred state on a standalone asphalt child
  //   assignedRcSessionId  — set when an RC owns the asphalt portion (subtle UI cue)
  //
  // For the MERGED parent+child case (driveway parent has a linked asphalt child):
  //   - Caller should drop the child from the list it passes to the card grid
  //     and stamp the parent's row with asphaltAmount (and upsoldAsphaltAmount
  //     if any). The card then renders the merged display by reading those.
  //   - The standalone child rows for the same address must NOT also be passed
  //     — the contract is "one card per parent or per orphan child."
  //
  // For the STANDALONE asphalt child case (RC solo asphalt, or Path 3 deferred):
  //   - Caller passes the child row directly with saleType='asphalt'.
  //   - sharedJobKey when set → Path 3 deferred pickup mode display.
  //
  // For non-sealing seasons or pending sales without asphalt: leave all five
  // fields off — card renders identically to its pre-asphalt behaviour.
  const asphaltAmount = Number((job as any).asphaltAmount || 0);
  const upsoldAsphaltAmount = Number((job as any).upsoldAsphaltAmount || 0);
  const isAsphaltStandalone = (job as any).saleType === 'asphalt';
  const hasAsphaltSharedKey = typeof (job as any).sharedJobKey === 'string' && (job as any).sharedJobKey.length > 0;
  const isAsphaltAssigned = typeof (job as any).assignedRcSessionId === 'string' && (job as any).assignedRcSessionId.length > 0;

  // Merged-card detection: card represents a driveway parent that has a paired
  // asphalt child. Caller has stamped asphaltAmount onto the parent row.
  const isMergedWithAsphalt = !isAsphaltStandalone && asphaltAmount > 0;

  // Path 3 deferred pickup detection: standalone asphalt child where the
  // sharedJobKey is set. Visual cue tells the worker "driveway already done by
  // selling cart; you're collecting only your share."
  const isAsphaltDeferredPickup = isAsphaltStandalone && hasAsphaltSharedKey;

  // Overall "card has asphalt" boolean used for several layout decisions.
  const hasAsphalt = isAsphaltStandalone || isMergedWithAsphalt;

  const isCompleted = job.Completed === 'x' || job.Status === 'completed';
  const isCancelled = job.Status === 'cancelled';
  const isNextTime = job.Status === 'next_time';
  const isPending = !isCompleted && !isCancelled && !isNextTime;
  const isPrepaid = job.Prepaid === 'x';
  
  // Warning detection - only for pending OFFICE jobs (never pending sales)
  const notes = job['Log Sheet Notes']; 
  const isWarning = isPending && !isPendingSale && WARNING_PATTERN.test(notes || '');
  
  // Data Extraction
  // For standalone asphalt cards, override the displayed property type with a
  // Shovel-themed "RAMP" label (which matches the 'Ramp' enum value reserved in
  // types/index.ts for the asphalt child row's export propertyType). For merged
  // cards we keep the driveway's property type (SS/SSP).
  const rawPropertyType = job['FO/BO/FP'] || 'FP';
  const phone = job['Home Phone'] || job['Cell Phone'];
  const email = job['Email Address'];
  const services = job.services;
  
  // Upsell Info
  const isContract = (job as any).isContract;
  const contractTitle = (job as any)['Contract Title'];
  
  // --- COLOR LOGIC ---
  // Asphalt cards get amber accents layered on top of the base slate-gray
  // pending-sale colours, so the worker can scan and pick out asphalt rows at a
  // glance without losing the "this is a pending sale" cue.
  let borderColor = 'border-gray-700';
  let bgColor = 'bg-gray-800';
  
  if (isCompleted) {
      if ((job as any).isUpgrade) {
          borderColor = 'border-orange-600';
          bgColor = 'bg-orange-900/20';
      } else if ((job as any).isAddOn) {
          borderColor = 'border-blue-600';
          bgColor = 'bg-blue-900/20';
      } else if ((job as any).isNewSale) {
          borderColor = 'border-yellow-600';
          bgColor = 'bg-yellow-900/20';
      } else {
          borderColor = 'border-green-600';
          bgColor = 'bg-green-900/20';
      }
  } else if (isCancelled) {
      borderColor = 'border-red-600';
      bgColor = 'bg-red-900/20';
  } else if (isNextTime) {
      borderColor = 'border-orange-500';
      bgColor = 'bg-orange-900/20';
  } else if (isAsphaltStandalone) {
      // Standalone asphalt — distinct amber-tinted card so RCs can spot their
      // asphalt queue at a glance. Slightly stronger amber for Path 3 deferred
      // pickups (where the cart already collected driveway cash and RC is just
      // executing the asphalt portion).
      if (isAsphaltDeferredPickup) {
        borderColor = 'border-amber-600';
        bgColor = 'bg-amber-900/25';
      } else {
        borderColor = 'border-amber-700';
        bgColor = 'bg-amber-900/15';
      }
  } else if (isMergedWithAsphalt) {
      // Merged driveway-parent-with-asphalt-child — keep the slate-gray
      // pending-sale base but lift the border to amber to flag the asphalt
      // attachment. Reads as "pending sale, but bigger than it looks."
      borderColor = 'border-amber-700';
      bgColor = 'bg-slate-800/40';
  } else if (isPendingSale) {
      // Plain pending sale (no asphalt) — slate-gray, distinct from prebooks,
      // completed, cancelled, and warning. Reads as "worker's own parked work."
      borderColor = 'border-slate-500';
      bgColor = 'bg-slate-800/40';
  } else if (isWarning) {
      borderColor = 'border-orange-500';
      bgColor = 'bg-yellow-900/25';
  }

  const displayNotes = isContract && contractTitle ? contractTitle : notes;
  
  // --- PRICE FORMATTING (asphalt-aware) ---
  // For STANDALONE asphalt cards the main price is the asphalt amount itself —
  // no separate driveway portion exists on this row. For MERGED cards the main
  // price stays the driveway parent's price (from job.Price), and the asphalt
  // portion is shown as a separate pill below. For everything else, unchanged.
  const formattedPrice = isAsphaltStandalone
    ? formatAsphaltAmount(asphaltAmount)
    : formatPrice(job.Price);
  
  // Format payment info for completed jobs
  const paymentDisplay = isCompleted ? formatPaymentDisplay(job) : '';

  // Status badge for not-done jobs
  const getStatusBadge = () => {
    if (isCancelled) {
      return (
        <div className="flex items-center gap-1 text-red-500 text-xs font-bold mt-1">
          <XIcon size={14} strokeWidth={3} /> 
          <span className="text-[10px] text-red-400">CANCELLED</span>
        </div>
      );
    }
    if (isNextTime) {
      return (
        <div className="flex items-center gap-1 text-orange-500 text-xs font-bold mt-1">
          <Clock size={14} strokeWidth={3} /> 
          <span className="text-[10px] text-orange-400">NEXT TIME</span>
        </div>
      );
    }
    return null;
  };

  // --- ADDRESS ASSEMBLY ---
  // Office bookings always have Full Address. Pending sales might only have a
  // house number, only a street name, or both — assemble from parts if needed.
  const assembledAddress = job['Full Address'] 
    || `${job['House Number'] || ''} ${job['Street Name'] || ''}`.trim()
    || '— address pending —';

  // --- NAME DISPLAY ---
  // Pending sales typically don't have a customer name yet. Show a placeholder
  // so the card doesn't look broken with an empty header.
  const displayName = (job['First Name'] || job['Last Name']) 
    ? `${job['First Name'] || ''} ${job['Last Name'] || ''}`.trim()
    : (isPendingSale ? 'New pending sale' : 'Unknown');

  // --- ASPHALT PILL BUILDER ---
  // Builds the "+ASPH $X" or "+ASPH $X +UP $Y" pill content for merged cards,
  // and the bare amount for standalone cards (the surrounding label handles
  // the "ASPHALT" prefix for standalone). Returns null when nothing to show.
  const buildAsphaltPillContent = (): string | null => {
    if (!hasAsphalt) return null;
    if (isAsphaltStandalone) {
      // Standalone: only show upsold if it's present and positive.
      if (upsoldAsphaltAmount > 0) {
        return `${formatAsphaltAmount(asphaltAmount)} +UP ${formatAsphaltAmount(upsoldAsphaltAmount)}`;
      }
      return formatAsphaltAmount(asphaltAmount);
    }
    // Merged: "+ASPH $X" plus optional "+UP $Y" when RC has logged upsold.
    if (upsoldAsphaltAmount > 0) {
      return `+ASPH ${formatAsphaltAmount(asphaltAmount)} +UP ${formatAsphaltAmount(upsoldAsphaltAmount)}`;
    }
    return `+ASPH ${formatAsphaltAmount(asphaltAmount)}`;
  };
  const asphaltPillContent = buildAsphaltPillContent();

  return (
    <div 
      onClick={onClick}
      className={`relative p-4 rounded-xl border shadow-sm transition-all active:scale-[0.98] flex items-center justify-between cursor-pointer mb-2 ${bgColor} ${borderColor} ${isCompleted ? '' : 'hover:border-gray-600'}`}
    >
      {/* Warning watermark - no layout impact */}
      {isWarning && <WarningWatermark />}

      <div className="flex-1 min-w-0 pr-2 relative z-10">
        <div className="flex items-center gap-2 mb-1">
          <span className="bg-gray-700 text-gray-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-600">{job['Route Number'] || '--'}</span>
          <h3 className="font-bold text-gray-100 text-sm truncate">{displayName}</h3>
        </div>

        <div className="flex items-center gap-1 text-gray-400 text-xs mb-1">
           <MapPin size={10} className="shrink-0" />
           <span className="truncate">{assembledAddress}</span>
        </div>

        {/* Service Badges */}
        <ServiceBadges services={services} />

        <div className="flex flex-col gap-0.5 mb-1.5 mt-1">
            {phone && <div className="flex items-center gap-1 text-gray-500 text-[10px]"><Phone size={10} className="shrink-0"/> <span>{phone}</span></div>}
            {email && <div className="flex items-center gap-1 text-gray-500 text-[10px]"><Mail size={10} className="shrink-0"/> <span className="truncate max-w-[180px]">{email}</span></div>}
        </div>

        {displayNotes && (
            <div className={`text-[10px] rounded p-1.5 flex items-start gap-2 mt-1 leading-tight ${isCompleted ? 'text-gray-300 italic' : (isCancelled || isNextTime) ? 'text-gray-400 italic' : isPendingSale ? 'bg-slate-900/30 border border-slate-700/40 text-slate-300' : 'bg-yellow-900/20 border border-yellow-700/30 text-yellow-200'}`}>
                {isCompleted ? <Check size={10}/> : (isCancelled || isNextTime) ? null : <FileText size={10} className="shrink-0 mt-0.5"/>}
                {displayNotes}
            </div>
        )}
      </div>

      <div className="text-right shrink-0 flex flex-col items-end justify-center gap-1 relative z-10">
        {/* Property-type pill. For STANDALONE asphalt cards we swap in a
            Shovel-themed pill to reinforce "this is an asphalt-only job."
            Merged cards keep the driveway property type — the asphalt pill
            below provides the secondary signal. */}
        {isAsphaltStandalone ? (
          <span className="text-[9px] font-bold bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700 uppercase flex items-center gap-1">
            <Shovel size={9} strokeWidth={2.5} />
            ASPHALT
          </span>
        ) : (
          <span className="text-[9px] font-bold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded border border-gray-600 uppercase">
            {rawPropertyType}
          </span>
        )}
        
        <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
               {/* PP prepaid pill — only for office bookings, never pending sales (no payment state yet) */}
               {isPrepaid && !isCompleted && !isCancelled && !isNextTime && !isPendingSale && <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800 font-bold">PP</span>}
               <span className={`font-mono font-bold text-lg ${isCompleted ? 'text-gray-300' : isCancelled ? 'text-red-300 line-through' : isNextTime ? 'text-orange-300' : isAsphaltStandalone ? 'text-amber-200' : isPendingSale ? 'text-slate-200' : (isPrepaid ? 'text-green-300' : 'text-white')}`}>
                 {formattedPrice}
               </span>
            </div>
            {/* ASPHALT PILL — visible on merged cards (and as a redundant clarity
                signal on standalone-with-upsold cards). Merged shows "+ASPH $X
                +UP $Y". Standalone-with-upsold shows "+UP $Y" alongside the
                main asphalt price. For plain standalone (asphalt only, no
                upsold) the main price already says it all — no pill needed. */}
            {asphaltPillContent && (isMergedWithAsphalt || upsoldAsphaltAmount > 0) && (
              <span className="text-[9px] font-bold bg-amber-900/40 text-amber-300 px-1.5 py-0.5 mt-1 rounded border border-amber-700 flex items-center gap-1 max-w-full">
                <Shovel size={9} strokeWidth={2.5} className="shrink-0" />
                <span className="truncate">{isMergedWithAsphalt ? asphaltPillContent : `+UP ${formatAsphaltAmount(upsoldAsphaltAmount)}`}</span>
              </span>
            )}
        </div>
        
        {isCompleted ? (
          <div className="flex items-center gap-1 text-green-500 text-xs font-bold mt-1">
            <Check size={14} strokeWidth={3} /> 
            <span className="text-[10px] text-green-400 max-w-[100px] truncate">{paymentDisplay}</span>
          </div>
        ) : (isCancelled || isNextTime) ? (
          getStatusBadge()
        ) : isAsphaltStandalone ? (
          // STANDALONE ASPHALT: Shovel-themed badge replaces the SALE-PEND
          // bookmark. Variant for Path 3 deferred pickup gets a distinct label
          // so RC knows the cart has already collected driveway cash.
          <div className="flex items-center gap-1 mt-1">
            <span className="flex items-center gap-1 text-[9px] font-bold bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700">
              <Shovel size={9} strokeWidth={2.5} />
              {isAsphaltDeferredPickup ? 'RC PICKUP' : (isAsphaltAssigned ? 'ASSIGNED' : 'ASPHALT')}
            </span>
            <ChevronRight size={14} className="text-gray-500" />
          </div>
        ) : isPendingSale ? (
          // SALE-PEND badge for ordinary (and merged) pending sales — keep
          // the Bookmark icon and slate styling so workers recognise it as
          // "their own parked work." Merged cards already got the amber pill
          // above to flag the asphalt attachment.
          <div className="flex items-center gap-1 mt-1">
            <span className="flex items-center gap-1 text-[9px] font-bold bg-yellow-900/40 text-yellow-300 px-1.5 py-0.5 rounded border border-yellow-700">
              <Bookmark size={9} strokeWidth={2.5} /> SALE-PEND
            </span>
            <ChevronRight size={14} className="text-gray-500" />
          </div>
        ) : (
          <ChevronRight size={16} className="text-gray-500 mt-1" />
        )}
      </div>
    </div>
  );
};

export default LogsheetJobCard;