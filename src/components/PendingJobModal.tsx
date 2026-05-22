// src/components/PendingJobModal.tsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  MapPin, 
  Phone, 
  Check, 
  Clock, 
  Ban, 
  FileText,
  Copy,
  Loader,
  AlertCircle,
  Route,
  Bookmark,
  Trash2
} from 'lucide-react';
import { MasterBooking, SeasonType, ServiceFlags } from '../types';
import { sessionService } from '../lib/sessionService';

interface PendingJobModalProps {
  job: MasterBooking;
  onClose: () => void;
  onUpdate: () => void;
  seasonType?: SeasonType;
}

// Service badges component for Lawn Rejuv
const ServiceBadges: React.FC<{ services?: ServiceFlags }> = ({ services }) => {
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
    <div className="flex gap-1">
      {activeBadges.map(badge => (
        <span
          key={badge.key}
          className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${badge.color}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
};

const PendingJobModal: React.FC<PendingJobModalProps> = ({
  job,
  onClose,
  onUpdate,
  seasonType = 'aeration',
}) => {
  // --- PENDING SALE DETECTION ---
  // Flag set upstream (Dashboard.tsx + RMTeamTab.tsx via convertPendingSaleToBooking).
  // Pending sales get a different footer (delete-only) instead of the Next Time
  // / Cancelled buttons, and the save path writes through updatePendingSale
  // instead of updateBookingRoute / updateBookingNotes.
  const isPendingSale = (job as any).isPendingSale === true;
  const pendingSaleId: string | undefined = (job as any).pendingSaleId;

  const [notes, setNotes] = useState(job['Log Sheet Notes'] || '');
  const [originalNotes] = useState(job['Log Sheet Notes'] || '');

  // Route code state — lets the user correct misfiled prebooks without re-exporting.
  // For pending sales, edits flow through updatePendingSale instead.
  const originalRouteCode = job['Route Number'] || '';
  const [routeCode, setRouteCode] = useState(originalRouteCode);

  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delete confirmation state (pending sales only)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset route code state if the underlying job changes (e.g. modal reused for a different booking)
  useEffect(() => {
    setRouteCode(job['Route Number'] || '');
  }, [job]);

  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isPending = !job.Status || job.Status === 'pending';
  const isNextTime = job.Status === 'next_time';
  const isCancelled = job.Status === 'cancelled';
  const hasNotesChanged = notes !== originalNotes;
  const hasRouteChanged = routeCode.trim() !== originalRouteCode.trim() && routeCode.trim() !== '';
  const hasAnyChange = hasNotesChanged || hasRouteChanged;

  // Get status display info.
  // Pending sales get their own slate-gray SALE-PEND pill instead — see header below.
  const getStatusBadge = () => {
    if (isCancelled) {
      return { text: 'CANCELLED', color: 'bg-red-900/30 text-red-400 border-red-800' };
    }
    if (isNextTime) {
      return { text: 'NEXT TIME', color: 'bg-orange-900/30 text-orange-400 border-orange-800' };
    }
    return { text: 'PENDING', color: 'bg-gray-700 text-gray-300 border-gray-600' };
  };

  const statusBadge = getStatusBadge();

  // Copy phone to clipboard
  const handleCopyPhone = async () => {
    const phone = job['Home Phone'] || job['Cell Phone'];
    if (!phone) return;
    
    try {
      const digitsOnly = phone.replace(/\D/g, '');
      await navigator.clipboard.writeText(digitsOnly);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // --- SAVE PATH: OFFICE BOOKING (existing behaviour, unchanged) ---
  // Writes through updateBookingRoute / updateBookingNotes against the bookings table.
  const saveFieldChanges = async (): Promise<boolean> => {
    try {
      if (hasNotesChanged) {
        await sessionService.updateBookingNotes(job['Booking ID'], notes);
      }
      if (hasRouteChanged) {
        await sessionService.updateBookingRoute(job['Booking ID'], routeCode.trim().toUpperCase());
      }
      return true;
    } catch (err) {
      console.error('[PendingJob] saveFieldChanges FAILED:', err);
      setError('Failed to save changes. Please try again.');
      return false;
    }
  };

  // --- SAVE PATH: PENDING SALE (new) ---
  // Writes through updatePendingSale against the pending_sales table.
  // Builds a PendingSaleUpdate payload with only the changed fields.
  const saveFieldChangesForPendingSale = async (): Promise<boolean> => {
    if (!pendingSaleId) {
      setError('Missing pending sale id. Please refresh and try again.');
      return false;
    }
    try {
      const payload: { routeCode?: string; notes?: string } = {};
      if (hasRouteChanged) payload.routeCode = routeCode.trim().toUpperCase();
      if (hasNotesChanged) payload.notes = notes;
      await sessionService.updatePendingSale(pendingSaleId, payload);
      return true;
    } catch (err) {
      console.error('[PendingJob] saveFieldChangesForPendingSale FAILED:', err);
      setError('Failed to save changes. Please try again.');
      return false;
    }
  };

  // Save notes and/or route code (no status change).
  // Branches on isPendingSale to pick the right write path.
  const handleSaveChanges = async () => {
    if (!hasAnyChange || saving) return;
    
    setSaving(true);
    setError(null);
    
    const ok = isPendingSale
      ? await saveFieldChangesForPendingSale()
      : await saveFieldChanges();

    if (ok) {
      onUpdate();
      onClose();
    } else {
      setSaving(false);
    }
  };

  // Update status (also saves pending notes/route changes first).
  // Office bookings only — pending sales don't support next_time/cancelled status changes.
  const handleStatusChange = async (status: 'next_time' | 'cancelled') => {
    if (saving) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Save field edits first so they aren't lost
      if (hasAnyChange) {
        const ok = await saveFieldChanges();
        if (!ok) {
          setSaving(false);
          return;
        }
      }
      
      await sessionService.updateBookingStatus(job['Booking ID'], status);
      onUpdate();
      onClose();
    } catch (err) {
      console.error('Failed to update status:', err);
      setError('Failed to update status. Please try again.');
      setSaving(false);
    }
  };

  // --- DELETE PENDING SALE ---
  // Permanently removes the pending_sales row. Triggered by the destructive
  // button in the pending-sale footer. Gated behind a confirmation step.
  const handleDelete = async () => {
    if (!pendingSaleId) {
      setError('Missing pending sale id. Please refresh and try again.');
      return;
    }
    if (deleting) return;

    setDeleting(true);
    setError(null);

    try {
      await sessionService.deletePendingSale(pendingSaleId);
      onUpdate();
      onClose();
    } catch (err) {
      console.error('[PendingJob] deletePendingSale FAILED:', err);
      setError('Failed to delete pending sale. Please try again.');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Price display
  const priceStr = String(job.Price || '');
  const displayPrice = /^[A-Z]+$/.test(priceStr) 
    ? priceStr 
    : `$${parseFloat(priceStr.replace(/[^0-9.]/g, '') || '0').toFixed(2)}`;

  const phone = job['Home Phone'] || job['Cell Phone'];

  // Name fallback for pending sales (which often have no customer name yet)
  const hasName = job['First Name'] || job['Last Name'];
  const displayName = hasName
    ? `${job['First Name'] || ''} ${job['Last Name'] || ''}`.trim()
    : (isPendingSale ? 'Pending sale (no name yet)' : 'Unknown');

  // Address fallback
  const assembledAddress = job['Full Address']
    || `${job['House Number'] || ''} ${job['Street Name'] || ''}`.trim()
    || '— address pending —';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 rounded-lg w-full max-w-md border border-gray-700 shadow-2xl">
        
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-gray-700">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg border ${isPendingSale ? 'bg-slate-800 border-slate-600' : 'bg-gray-800 border-gray-700'}`}>
              {isPendingSale ? <Bookmark size={20} className="text-slate-300" /> : <FileText size={20} className="text-cps-blue" />}
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">
                {isPendingSale ? 'Pending Sale' : 'Job Details'}
              </h3>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">{originalRouteCode || '--'}</span>
                <span>•</span>
                <span className="truncate max-w-[180px]">{job['Booking ID']}</span>
              </div>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={saving || deleting}
            className="text-gray-400 hover:text-white p-1 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          
          {/* Customer Info Section */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700/50 p-3 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h4 className={`font-bold text-base ${hasName ? 'text-white' : 'text-slate-300 italic'}`}>
                  {displayName}
                </h4>
                <div className="flex items-center gap-1.5 text-sm text-gray-400 mt-1">
                  <MapPin size={12} />
                  <span>{assembledAddress}</span>
                </div>
              </div>
              
              {/* Status Badge — swaps to slate-gray SALE-PEND pill for pending sales */}
              {isPendingSale ? (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border bg-slate-800 text-slate-300 border-slate-600">
                  <Bookmark size={10}/> SALE-PEND
                </span>
              ) : (
                <span className={`text-[10px] font-bold px-2 py-1 rounded border ${statusBadge.color}`}>
                  {statusBadge.text}
                </span>
              )}
            </div>

            {/* Phone — pending sales typically don't have one yet */}
            {phone && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Phone size={14} className="text-green-500" />
                  <span className="font-mono">{phone}</span>
                </div>
                <button
                  onClick={handleCopyPhone}
                  className="flex items-center gap-1.5 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 transition-colors border border-gray-600"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-green-400" />
                      <span className="text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Price, Prepaid, Services Row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-green-400 bg-gray-900/50 px-2 py-1 rounded border border-gray-700">
                {displayPrice}
              </span>
              
              {/* PREPAID pill — never shown for pending sales (no payment yet) */}
              {!isPendingSale && job.Prepaid === 'x' && (
                <span className="text-[10px] font-bold bg-green-900/30 text-green-400 px-2 py-1 rounded border border-green-800">
                  PREPAID
                </span>
              )}
              
              {job['FO/BO/FP'] && job['FO/BO/FP'] !== 'FP' && (
                <span className="text-[10px] font-bold text-gray-400 border border-gray-600 px-2 py-1 rounded">
                  {job['FO/BO/FP']}
                </span>
              )}
              
              {isLawnRejuv && job.services && (
                <ServiceBadges services={job.services} />
              )}
            </div>
          </div>

          {/* Route Code Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1.5">
                <Route size={12} />
                Route Code
              </label>
              {hasRouteChanged && (
                <span className="text-[10px] text-yellow-400">Unsaved change</span>
              )}
            </div>
            <input
              type="text"
              value={routeCode}
              onChange={(e) => setRouteCode(e.target.value.toUpperCase())}
              disabled={saving || deleting}
              placeholder="e.g. WIN01"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-cps-blue transition-colors disabled:opacity-50"
            />
            {hasRouteChanged && (
              <p className="text-[10px] text-gray-500 italic">
                {isPendingSale 
                  ? <>Moves this pending sale to route <span className="text-yellow-400 font-bold font-mono">{routeCode}</span>.</>
                  : <>Moves this prebook to route <span className="text-yellow-400 font-bold font-mono">{routeCode}</span>. Worker assignment is not changed.</>
                }
              </p>
            )}
          </div>

          {/* Notes Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1.5">
                <FileText size={12} />
                {isPendingSale ? 'Notes' : 'Log Notes'}
              </label>
              {hasNotesChanged && (
                <span className="text-[10px] text-yellow-400">Unsaved changes</span>
              )}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving || deleting}
              placeholder={isPendingSale ? 'Notes added by the worker...' : 'Add notes about this job...'}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-cps-blue transition-colors min-h-[100px] disabled:opacity-50"
            />
            
            {hasAnyChange && (
              <button
                onClick={handleSaveChanges}
                disabled={saving || deleting}
                className="w-full py-2 bg-cps-blue hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader size={14} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    Save Changes
                  </>
                )}
              </button>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg p-3">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions — branches on isPendingSale.
            Pending sales: single destructive Delete button (with confirmation step).
            Office bookings: existing Next Time / Cancelled button pair. */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/30 rounded-b-lg">
          {isPendingSale ? (
            // ────────── PENDING SALE FOOTER ──────────
            showDeleteConfirm ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-300">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>This will permanently delete the pending sale. The worker will no longer see it on their logsheet.</span>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors border bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors border bg-red-600 hover:bg-red-500 text-white border-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleting ? (
                      <>
                        <Loader size={14} className="animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} />
                        Confirm Delete
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
                className="w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors border bg-red-900/20 hover:bg-red-900/40 text-red-400 border-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} />
                Delete Pending Sale
              </button>
            )
          ) : (
            // ────────── OFFICE BOOKING FOOTER (existing behaviour, unchanged) ──────────
            <div className="flex gap-3">
              <button
                onClick={() => handleStatusChange('next_time')}
                disabled={saving || isNextTime}
                className={`flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors border ${
                  isNextTime
                    ? 'bg-orange-900/20 text-orange-400/50 border-orange-800/50 cursor-not-allowed'
                    : 'bg-orange-900/20 hover:bg-orange-900/40 text-orange-400 border-orange-800'
                }`}
              >
                <Clock size={16} />
                Next Time
              </button>
              
              <button
                onClick={() => handleStatusChange('cancelled')}
                disabled={saving || isCancelled}
                className={`flex-1 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors border ${
                  isCancelled
                    ? 'bg-red-900/20 text-red-400/50 border-red-800/50 cursor-not-allowed'
                    : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 border-red-800'
                }`}
              >
                <Ban size={16} />
                Cancelled
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PendingJobModal;