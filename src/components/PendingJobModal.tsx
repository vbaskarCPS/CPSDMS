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
  AlertCircle
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
  const [notes, setNotes] = useState(job['Log Sheet Notes'] || '');
  const [originalNotes] = useState(job['Log Sheet Notes'] || '');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isPending = !job.Status || job.Status === 'pending';
  const isNextTime = job.Status === 'next_time';
  const isCancelled = job.Status === 'cancelled';
  const hasNotesChanged = notes !== originalNotes;

  // Get status display info
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

  // Save notes only
  const handleSaveNotes = async () => {
    if (!hasNotesChanged || saving) return;
    
    setSaving(true);
    setError(null);
    
    try {
      await sessionService.updateBookingNotes(job['Booking ID'], notes);
      onUpdate();
      onClose();
    } catch (err) {
      console.error('Failed to save notes:', err);
      setError('Failed to save notes. Please try again.');
      setSaving(false);
    }
  };

  // Update status
  const handleStatusChange = async (status: 'next_time' | 'cancelled') => {
    if (saving) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Save notes first if changed
      if (hasNotesChanged) {
        await sessionService.updateBookingNotes(job['Booking ID'], notes);
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

  // Price display
  const priceStr = String(job.Price || '');
  const displayPrice = /^[A-Z]+$/.test(priceStr) 
    ? priceStr 
    : `$${parseFloat(priceStr.replace(/[^0-9.]/g, '') || '0').toFixed(2)}`;

  const phone = job['Home Phone'] || job['Cell Phone'];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 rounded-lg w-full max-w-md border border-gray-700 shadow-2xl">
        
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-gray-700">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-800 rounded-lg border border-gray-700">
              <FileText size={20} className="text-cps-blue" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">Job Details</h3>
              <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded">{job['Route Number'] || '--'}</span>
                <span>•</span>
                <span className="truncate max-w-[180px]">{job['Booking ID']}</span>
              </div>
            </div>
          </div>
          <button 
            onClick={onClose} 
            disabled={saving}
            className="text-gray-400 hover:text-white p-1 transition-colors"
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
                <h4 className="font-bold text-white text-base">
                  {job['First Name']} {job['Last Name']}
                </h4>
                <div className="flex items-center gap-1.5 text-sm text-gray-400 mt-1">
                  <MapPin size={12} />
                  <span>{job['Full Address'] || 'No address'}</span>
                </div>
              </div>
              
              {/* Status Badge */}
              <span className={`text-[10px] font-bold px-2 py-1 rounded border ${statusBadge.color}`}>
                {statusBadge.text}
              </span>
            </div>

            {/* Phone */}
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
              
              {job.Prepaid === 'x' && (
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

          {/* Notes Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-400 uppercase flex items-center gap-1.5">
                <FileText size={12} />
                Log Notes
              </label>
              {hasNotesChanged && (
                <span className="text-[10px] text-yellow-400">Unsaved changes</span>
              )}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="Add notes about this job..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-cps-blue transition-colors min-h-[100px]"
            />
            
            {hasNotesChanged && (
              <button
                onClick={handleSaveNotes}
                disabled={saving}
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
                    Save Notes
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

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/30 rounded-b-lg">
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
        </div>
      </div>
    </div>
  );
};

export default PendingJobModal;