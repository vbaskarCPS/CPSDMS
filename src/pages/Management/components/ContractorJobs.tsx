// src/pages/Management/components/ContractorJobs.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Phone, Mail, Undo } from 'lucide-react';
import { MasterBooking, SessionTransaction } from '../../../types';

interface ContractorJobsProps {
  bookings: MasterBooking[];
  financialStore: SessionTransaction[];
  onRevert?: (job: MasterBooking) => void;
}

const ContractorJobs: React.FC<ContractorJobsProps> = ({ bookings, financialStore, onRevert }) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
              setActiveMenuId(null);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // --- Merge Bookings & Transactions ---
  const allJobs = useMemo(() => {
      const combined = [...bookings];
      const existingIds = new Set(combined.map(b => b['Booking ID']));

      // Merge in transactions from financialStore that aren't already in bookings
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
                       paymentBreakdown: tx.paymentBreakdown
                   } as any)
               };
               combined.push(convertedJob);
          }
      });
      return combined;
  }, [bookings, financialStore]);

  // --- Sort & Filter ---
  // Sort Logic: Pending -> Not Done -> Completed
  const sortedBookings = [...allJobs].sort((a, b) => {
      const getScore = (job: MasterBooking) => {
          if (job.Completed === 'x') return 3;
          if (job.Status && job.Status !== 'pending') return 2; // Not Done / Cancelled
          return 1; // Pending
      };
      // Primary Sort: Status Score
      const scoreDiff = getScore(a) - getScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      
      // Secondary Sort: Route Number
      return (a['Route Number'] || '').localeCompare(b['Route Number'] || '');
  });

  const pendingJobs = sortedBookings.filter(b => (!b.Completed && (!b.Status || b.Status === 'pending')));
  const notDoneJobs = sortedBookings.filter(b => b.Status && b.Status !== 'pending' && b.Status !== 'completed' && b.Completed !== 'x');
  const completedJobs = sortedBookings.filter(b => b.Completed === 'x' || b.Status === 'completed');

  // --- Helper Functions ---

  const getStatusBadge = (job: MasterBooking) => {
      // 1. Completed Status Logic
      if (job.Completed === 'x' || job.Status === 'completed') {
          // Check flags mapped from Supabase (isUpgrade, isNewSale, etc.)
          if ((job as any).isUpgrade) {
              return { text: 'UPGRADE', color: 'bg-orange-900/30 text-orange-400 border-orange-800' };
          }
          if ((job as any).isAddOn) {
               return { text: 'ADD-ON', color: 'bg-blue-900/30 text-blue-400 border-blue-800' };
          }
          if ((job as any).isNewSale) {
              return { text: 'SALE', color: 'bg-yellow-900/30 text-yellow-400 border-yellow-800' };
          }
          // Standard Completed
          return { text: 'DONE', color: 'bg-green-900/30 text-green-400 border-green-800' };
      }

      // 2. Not Done Logic
      if (job.Status && job.Status !== 'pending') {
          return { text: job.Status.toUpperCase().substring(0, 8), color: 'bg-red-900/30 text-red-400 border-red-800' };
      }

      // 3. Pending Logic
      if (job.Prepaid === 'x') return { text: 'PREPAID', color: 'bg-indigo-900/30 text-indigo-400 border-indigo-800' };
      return { text: 'PENDING', color: 'bg-gray-700 text-gray-400 border-gray-600' };
  };

  const renderJobRow = (job: MasterBooking) => {
      const badge = getStatusBadge(job);
      const isPaid = job.Completed === 'x' || job.Status === 'completed';
      
      // --- PAYMENT DISPLAY LOGIC ---
      const breakdownObj = (job as any).paymentBreakdown;
      const simpleMethod = job['Payment Method'];
      
      let paymentDisplay = '';
      if (breakdownObj && typeof breakdownObj === 'object') {
          // Format object like {Cash: 50, Cheque: 100} -> "Cash: $50.00, Cheque: $100.00"
          paymentDisplay = Object.entries(breakdownObj)
              .map(([k, v]) => `${k}: $${Number(v).toFixed(2)}`)
              .join(', ');
      } else if (simpleMethod) {
          paymentDisplay = simpleMethod;
      }

      // Safe Price Display with 2 Decimal Places
      const priceStr = String(job.Price || '');
      // If price is just text (like "RJ"), keep it. If it has numbers, format to $0.00
      const displayPrice = /^[A-Z]+$/.test(priceStr) 
          ? priceStr 
          : `$${parseFloat(priceStr.replace(/[^0-9.]/g, '') || '0').toFixed(2)}`;

      const handleBadgeClick = (e: React.MouseEvent) => {
          if (isPaid && onRevert) {
              e.stopPropagation();
              setActiveMenuId(activeMenuId === job['Booking ID'] ? null : job['Booking ID']);
          }
      };

      return (
          <div key={job['Booking ID']} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 flex flex-col gap-1 relative mb-1">
              {/* Main Line */}
              <div className="flex items-center justify-between gap-2 text-xs">
                  
                  {/* Left: ID & Name */}
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
                      {job['Cell Phone'] || job['Home Phone'] ? (
                          <Phone size={14} className="text-green-500" strokeWidth={2.5} />
                      ) : (
                          <Phone size={14} className="text-gray-600 opacity-30" />
                      )}
                      {job['Email Address'] ? (
                          <Mail size={14} className="text-blue-500" strokeWidth={2.5} />
                      ) : (
                          <Mail size={14} className="text-gray-600 opacity-30" />
                      )}
                  </div>

                  {/* Payment Breakdown (Always visible for completed jobs) */}
                  {isPaid && paymentDisplay && (
                      <div className="flex items-center justify-end text-[10px] text-gray-400 italic truncate flex-shrink text-right px-2 min-w-0 max-w-[120px]" title={paymentDisplay}>
                          {paymentDisplay}
                      </div>
                  )}

                  {/* Right: Price & Badge */}
                  <div className="flex items-center gap-2 flex-shrink-0 text-right relative">
                      {job['FO/BO/FP'] && job['FO/BO/FP'] !== 'FP' && (
                          <span className="text-[9px] font-bold text-gray-500 border border-gray-600 px-1 rounded">
                              {job['FO/BO/FP']}
                          </span>
                      )}
                      <span className="font-mono font-bold text-gray-300 w-16 text-right">
                          {displayPrice}
                      </span>
                      
                      {/* Interactive Badge */}
                      <button 
                          onClick={handleBadgeClick}
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border min-w-[55px] text-center transition-opacity ${badge.color} ${isPaid ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                      >
                          {badge.text}
                      </button>

                      {/* Revert Menu Popover */}
                      {activeMenuId === job['Booking ID'] && (
                          <div ref={menuRef} className="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-600 rounded shadow-xl z-50 w-32 overflow-hidden animate-fade-in">
                              <button 
                                  onClick={(e) => { e.stopPropagation(); onRevert?.(job); setActiveMenuId(null); }}
                                  className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/20 flex items-center gap-2 font-bold"
                              >
                                  <Undo size={12} /> Revert / Delete
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  };

  if (sortedBookings.length === 0) return <div className="text-gray-500 text-xs mt-2 px-2 italic text-center">No jobs assigned.</div>;

  return (
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
  );
};

export default ContractorJobs;