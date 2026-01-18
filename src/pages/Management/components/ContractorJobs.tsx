// src/pages/Contractor/components/ContractorJobs.tsx
import React, { useState, useMemo } from 'react';
import {
  MapPin,
  Phone,
  Check,
  Clock,
  ChevronRight,
  AlertCircle,
  Calendar,
  DollarSign,
  Copy,
  Navigation,
} from 'lucide-react';
import { MasterBooking, SeasonType } from '../../../types';

interface ContractorJobsProps {
  jobs: MasterBooking[];
  onJobClick: (job: MasterBooking) => void;
  seasonType?: SeasonType;
}

type FilterOption = 'all' | 'pending' | 'completed';
type SortOption = 'default' | 'price' | 'address';

// Service badge component for Lawn Rejuv
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
    <div className="flex gap-1 mt-1">
      {activeBadges.map(badge => (
        <span
          key={badge.key}
          className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${badge.color}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
};

const ContractorJobs: React.FC<ContractorJobsProps> = ({ 
  jobs, 
  onJobClick,
  seasonType = 'aeration' 
}) => {
  const [filter, setFilter] = useState<FilterOption>('all');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isLawnRejuv = seasonType === 'lawn_rejuv';

  // Filter and sort jobs
  const displayJobs = useMemo(() => {
    let filtered = [...jobs];

    // Apply filter
    if (filter === 'pending') {
      filtered = filtered.filter(
        (j) => j.Status !== 'completed' && j.Status !== 'cancelled' && j.Status !== 'next_time'
      );
    } else if (filter === 'completed') {
      filtered = filtered.filter(
        (j) => j.Status === 'completed' || j.Completed === 'x'
      );
    }

    // Apply sort
    if (sortBy === 'price') {
      filtered.sort((a, b) => {
        const priceA = parseFloat(String(a.Price).replace(/[^0-9.]/g, '')) || 0;
        const priceB = parseFloat(String(b.Price).replace(/[^0-9.]/g, '')) || 0;
        return priceB - priceA;
      });
    } else if (sortBy === 'address') {
      filtered.sort((a, b) => {
        const addrA = a['Full Address'] || '';
        const addrB = b['Full Address'] || '';
        return addrA.localeCompare(addrB);
      });
    }

    return filtered;
  }, [jobs, filter, sortBy]);

  const pendingCount = jobs.filter(
    (j) => j.Status !== 'completed' && j.Status !== 'cancelled' && j.Status !== 'next_time'
  ).length;
  const completedCount = jobs.filter(
    (j) => j.Status === 'completed' || j.Completed === 'x'
  ).length;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const openNavigation = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const encoded = encodeURIComponent(address);
    // Try Apple Maps first on iOS, fall back to Google Maps
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `maps://maps.apple.com/?q=${encoded}`
      : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    window.open(url, '_blank');
  };

  const getStatusBadge = (job: MasterBooking) => {
    if (job.Status === 'completed' || job.Completed === 'x') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold bg-green-900/20 px-2 py-1 rounded border border-green-900/30">
          <Check size={10} /> Done
        </span>
      );
    }
    if (job.Status === 'cancelled') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-red-400 font-bold bg-red-900/20 px-2 py-1 rounded border border-red-900/30">
          <AlertCircle size={10} /> Cancelled
        </span>
      );
    }
    if (job.Status === 'next_time') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-yellow-400 font-bold bg-yellow-900/20 px-2 py-1 rounded border border-yellow-900/30">
          <Calendar size={10} /> Next Time
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] text-blue-400 font-bold bg-blue-900/20 px-2 py-1 rounded border border-blue-900/30">
        <Clock size={10} /> Pending
      </span>
    );
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg border border-gray-700/50">
        <AlertCircle size={48} className="mx-auto mb-2 opacity-20" />
        <p>No jobs assigned yet.</p>
        <p className="text-sm">Jobs will appear here when assigned by your Route Manager.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter & Sort Row */}
      <div className="flex flex-wrap gap-2 justify-between items-center bg-gray-800 p-2 rounded-lg border border-gray-700">
        {/* Filter Buttons */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            All ({jobs.length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              filter === 'pending'
                ? 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              filter === 'completed'
                ? 'bg-green-900/50 text-green-300 border border-green-700/50'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Done ({completedCount})
          </button>
        </div>

        {/* Sort Dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cps-blue cursor-pointer"
        >
          <option value="default">Default Order</option>
          <option value="price">By Price</option>
          <option value="address">By Address</option>
        </select>
      </div>

      {/* Job Cards */}
      <div className="space-y-2">
        {displayJobs.map((job) => {
          const isCompleted = job.Status === 'completed' || job.Completed === 'x';
          const isPrepaid = job.Prepaid === 'x';
          const notes = job['Log Sheet Notes'] || '';

          return (
            <div
              key={job['Booking ID']}
              onClick={() => onJobClick(job)}
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                isCompleted
                  ? 'bg-green-900/10 border-green-900/30 opacity-75'
                  : 'bg-gray-800 border-gray-700 hover:border-gray-600 active:scale-[0.99]'
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                {/* Left: Customer Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white text-sm truncate">
                    {job['First Name']} {job['Last Name']}
                  </div>

                  {/* Address */}
                  <div className="flex items-start gap-1 text-xs text-gray-400 mt-1">
                    <MapPin size={12} className="flex-shrink-0 mt-0.5" />
                    <span className="truncate">{job['Full Address']}</span>
                  </div>

                  {/* Service Badges (Lawn Rejuv) */}
                  {isLawnRejuv && <ServiceBadges services={job.services} />}

                  {/* Phone */}
                  {job['Home Phone'] && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(job['Home Phone']!, `ph-${job['Booking ID']}`);
                      }}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors"
                    >
                      <Phone size={10} />
                      <span className="font-mono">{job['Home Phone']}</span>
                      {copiedId === `ph-${job['Booking ID']}` ? (
                        <Check size={10} className="text-green-400" />
                      ) : (
                        <Copy size={10} className="opacity-50" />
                      )}
                    </button>
                  )}
                </div>

                {/* Right: Price & Status */}
                <div className="flex flex-col items-end gap-2">
                  {/* Price Row */}
                  <div className="flex items-center gap-2">
                    {isPrepaid && (
                      <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800 font-bold">
                        PP
                      </span>
                    )}
                    <span className="font-mono text-sm font-bold text-gray-200">
                      {job.Price}
                    </span>
                  </div>

                  {/* Status Badge */}
                  {getStatusBadge(job)}

                  {/* Navigate Button */}
                  {!isCompleted && (
                    <button
                      onClick={(e) => openNavigation(job['Full Address'] || '', e)}
                      className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors"
                    >
                      <Navigation size={10} />
                      Navigate
                    </button>
                  )}
                </div>
              </div>

              {/* Notes */}
              {notes && (
                <div className="bg-gray-900/50 border border-gray-700/50 rounded px-2 py-1.5 text-[10px] text-gray-400 font-mono italic mt-2">
                  📝 {notes}
                </div>
              )}

              {/* Tap Hint */}
              {!isCompleted && (
                <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-gray-500">
                  <span>Tap to open</span>
                  <ChevronRight size={12} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State for Filter */}
      {displayJobs.length === 0 && (
        <div className="text-center text-gray-500 py-6 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <p className="text-sm">No jobs match the current filter.</p>
        </div>
      )}
    </div>
  );
};

export default ContractorJobs;