// src/pages/Public/ShuttlePage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  MapPin,
  Clock,
  Phone,
  Bus,
} from 'lucide-react';
import {
  getCommandCenterByUsername,
  getShuttlePointsPublic,
  getShuttleRoster,
  getLatestDateTab,
  toggleShowed,
  ShuttleRosterEntry,
  PublicShuttlePoint,
  CommandCenterPublic,
} from '../../lib/shuttleRosterService';

// ─── NUMERIC SORT HELPER ──────────────────────────────────────────────────────

function numericShuttleSort(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;   // empty goes last
  if (!b) return -1;
  const numA = parseInt(a, 10);
  const numB = parseInt(b, 10);
  if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b);
  if (isNaN(numA)) return 1;
  if (isNaN(numB)) return -1;
  return numA - numB;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const ShuttlePage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const username = slug?.replace(/-shuttle$/, '') || '';

  const [cc, setCC]                     = useState<CommandCenterPublic | null>(null);
  const [dateTab, setDateTab]           = useState<string | null>(null);
  const [roster, setRoster]             = useState<ShuttleRosterEntry[]>([]);
  const [shuttlePoints, setShuttlePoints] = useState<PublicShuttlePoint[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [togglingId, setTogglingId]     = useState<string | null>(null);
  const [refreshing, setRefreshing]     = useState(false);

  // ─── LOAD ────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!username) return;
    try {
      const ccData = await getCommandCenterByUsername(username);
      if (!ccData) {
        setError('Command center not found');
        setLoading(false);
        return;
      }
      setCC(ccData);

      const latestTab = await getLatestDateTab(ccData.id);
      if (!latestTab) {
        setDateTab(null);
        setRoster([]);
        setShuttlePoints([]);
        setLoading(false);
        return;
      }
      setDateTab(latestTab);

      const [points, rosterData] = await Promise.all([
        getShuttlePointsPublic(ccData.id),
        getShuttleRoster(ccData.id, latestTab),
      ]);

      setShuttlePoints(points);
      setRoster(rosterData);
    } catch (err: any) {
      setError(err.message || 'Failed to load shuttle data');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ─── TOGGLE SHOWED ───────────────────────────────────────────────────────

  const handleToggleShowed = async (entry: ShuttleRosterEntry) => {
    setTogglingId(entry.id);
    const newVal = !entry.showed;

    // Optimistic update
    setRoster(prev => prev.map(r => (r.id === entry.id ? { ...r, showed: newVal } : r)));

    try {
      await toggleShowed(entry.id, newVal);
    } catch {
      // Revert on failure
      setRoster(prev => prev.map(r => (r.id === entry.id ? { ...r, showed: !newVal } : r)));
    } finally {
      setTogglingId(null);
    }
  };

  // ─── GROUPING ────────────────────────────────────────────────────────────

  const shuttlePointMap = new Map(shuttlePoints.map(p => [p.shuttleNumber, p]));

  const shuttleNumbers = [...new Set(roster.map(r => r.shuttleNumber))];
  shuttleNumbers.sort(numericShuttleSort);

  const groups = shuttleNumbers.map(num => ({
    shuttleNumber: num,
    point: shuttlePointMap.get(num) || null,
    contractors: roster
      .filter(r => r.shuttleNumber === num)
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
  }));

  // ─── STATS ───────────────────────────────────────────────────────────────

  const totalContractors = roster.length;
  const showedCount      = roster.filter(r => r.showed).length;
  const confirmedCount   = roster.filter(r => r.confirmed).length;

  // ─── LOADING / ERROR ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader className="animate-spin text-blue-400" size={40} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertCircle size={40} className="text-red-400 opacity-60" />
        <p className="text-red-400 font-medium">{error}</p>
        <p className="text-gray-500 text-sm">Check the URL and try again.</p>
      </div>
    );
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Bus size={20} className="text-yellow-400" />
                <h1 className="text-lg font-bold">{cc?.displayName || 'Shuttles'}</h1>
              </div>
              {dateTab && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {dateTab} · {showedCount}/{totalContractors} showed · {confirmedCount} confirmed
                </p>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {!dateTab || roster.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Bus size={48} className="mb-3 opacity-20" />
            <p className="font-medium">No shuttle roster pushed yet</p>
            <p className="text-sm mt-1">Push from the Workerbook to populate this page.</p>
          </div>
        ) : (
          groups.map(group => {
            const groupShowed = group.contractors.filter(c => c.showed).length;

            return (
              <div key={group.shuttleNumber || '_unassigned'}>

                {/* ── Group Header ── */}
                <div className="bg-gray-800 rounded-t-xl border border-gray-700 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-yellow-900/30 border border-yellow-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-yellow-400 font-bold text-sm">
                          {group.shuttleNumber || '?'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-white text-sm truncate">
                          {group.point?.description || (group.shuttleNumber ? 'Shuttle #' + group.shuttleNumber : 'No Shuttle Assigned')}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {group.point?.pickupTime && (
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock size={10} /> {group.point.pickupTime}
                            </span>
                          )}
                          {group.point?.googleMapsUrl && (
                            <a
                              href={group.point.googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                            >
                              <MapPin size={10} /> Google Maps ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                      {groupShowed}/{group.contractors.length}
                    </span>
                  </div>
                </div>

                {/* ── Contractor Cards ── */}
                <div className="border-x border-b border-gray-700 rounded-b-xl divide-y divide-gray-700/50">
                  {group.contractors.map(entry => (
                    <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3">

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white text-sm truncate">
                            {entry.firstName} {entry.lastName}
                          </span>
                          <span className="text-[11px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                            {entry.contractorId}
                          </span>
                          {entry.confirmed && (
                            <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded border border-green-700/50 flex-shrink-0">
                              CONFIRMED
                            </span>
                          )}
                        </div>
                        {entry.cellPhone && (
                          <a
                            href={'tel:' + entry.cellPhone}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 mt-0.5 transition-colors"
                          >
                            <Phone size={10} /> {entry.cellPhone}
                          </a>
                        )}
                      </div>

                      {/* Showed Button */}
                      <button
                        onClick={() => handleToggleShowed(entry)}
                        disabled={togglingId === entry.id}
                        className={
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-shrink-0 ' +
                          (entry.showed
                            ? 'bg-green-600 text-white hover:bg-green-500'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white')
                        }
                      >
                        {togglingId === entry.id ? (
                          <Loader size={12} className="animate-spin" />
                        ) : entry.showed ? (
                          <CheckCircle size={12} />
                        ) : null}
                        {entry.showed ? 'Showed' : 'Mark Showed'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ShuttlePage;