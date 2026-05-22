// src/pages/Logsheet/components/LogsheetJobCard.tsx
import React from 'react';
import { MapPin, ChevronRight, Check, FileText, Phone, Mail, Clock, X as XIcon, Bookmark } from 'lucide-react';
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

  const isCompleted = job.Completed === 'x' || job.Status === 'completed';
  const isCancelled = job.Status === 'cancelled';
  const isNextTime = job.Status === 'next_time';
  const isPending = !isCompleted && !isCancelled && !isNextTime;
  const isPrepaid = job.Prepaid === 'x';
  
  // Warning detection - only for pending OFFICE jobs (never pending sales)
  const notes = job['Log Sheet Notes']; 
  const isWarning = isPending && !isPendingSale && WARNING_PATTERN.test(notes || '');
  
  // Data Extraction
  const propertyType = job['FO/BO/FP'] || 'FP'; 
  const phone = job['Home Phone'] || job['Cell Phone'];
  const email = job['Email Address'];
  const services = job.services;
  
  // Upsell Info
  const isContract = (job as any).isContract;
  const contractTitle = (job as any)['Contract Title'];
  
  // --- COLOR LOGIC ---
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
  } else if (isPendingSale) {
      // Pending sales get slate-gray treatment — distinct from prebooks (default
      // gray), completed (green/yellow/blue/orange), cancelled (red), and warning
      // (orange-tinted). Reads as "worker's own parked work."
      borderColor = 'border-slate-500';
      bgColor = 'bg-slate-800/40';
  } else if (isWarning) {
      borderColor = 'border-orange-500';
      bgColor = 'bg-yellow-900/25';
  }

  const displayNotes = isContract && contractTitle ? contractTitle : notes;
  
  // Format the price
  const formattedPrice = formatPrice(job.Price);
  
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
        <span className="text-[9px] font-bold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded border border-gray-600 uppercase">{propertyType}</span>
        
        <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
               {/* PP prepaid pill — only for office bookings, never pending sales (no payment state yet) */}
               {isPrepaid && !isCompleted && !isCancelled && !isNextTime && !isPendingSale && <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800 font-bold">PP</span>}
               <span className={`font-mono font-bold text-lg ${isCompleted ? 'text-gray-300' : isCancelled ? 'text-red-300 line-through' : isNextTime ? 'text-orange-300' : isPendingSale ? 'text-slate-200' : (isPrepaid ? 'text-green-300' : 'text-white')}`}>
                 {formattedPrice}
               </span>
            </div>
        </div>
        
        {isCompleted ? (
          <div className="flex items-center gap-1 text-green-500 text-xs font-bold mt-1">
            <Check size={14} strokeWidth={3} /> 
            <span className="text-[10px] text-green-400 max-w-[100px] truncate">{paymentDisplay}</span>
          </div>
        ) : (isCancelled || isNextTime) ? (
          getStatusBadge()
        ) : isPendingSale ? (
          // Yellow SALE-PEND badge for pending sales, with bookmark icon and chevron.
          // The chevron stays so the affordance still reads "tap to continue."
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