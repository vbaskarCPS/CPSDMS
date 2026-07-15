// src/pages/SuperAdmin/LeagueLeadersView.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Trophy, Filter, Wrench, X, Loader, Check, Users, UserX, RotateCcw, AlertTriangle, EyeOff, Eye } from 'lucide-react';
import { LoadedWorkbook } from '../../lib/reportDataLoader';
import { reportingService, ContractorOverride, MergeOverridePayload, SplitOverridePayload } from '../../lib/reportingService';
import { computeLeagueLeaders, LeagueFilter, BoardUnit } from '../../lib/leagueLeaders';
import { SeasonType } from '../../types';

interface Props {
  workbooks: LoadedWorkbook[];
}

const SEASON_LABELS: Record<SeasonType, string> = {
  aeration: 'Aeration',
  lawn_rejuv: 'Lawn Rejuv',
  sealing: 'Sealing',
  cleaning: 'Window Cleaning',
};

const fmt = (n: number, unit: BoardUnit) => {
  if (unit === 'money') return '$' + Math.round(n).toLocaleString();
  if (unit === 'eq') return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return Math.round(n).toLocaleString();
};

const filterEq = (a: LeagueFilter, b: LeagueFilter) => JSON.stringify(a) === JSON.stringify(b);

const LeagueLeadersView: React.FC<Props> = ({ workbooks }) => {
  const [overrides, setOverrides] = useState<ContractorOverride[]>([]);
  const [filter, setFilter] = useState<LeagueFilter>({ type: 'all' });
  const [showCleanup, setShowCleanup] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggleHidden = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const reloadOverrides = async () => {
    try { setOverrides(await reportingService.getContractorOverrides()); } catch { /* ignore */ }
  };
  useEffect(() => { reloadOverrides(); }, []);

  const result = useMemo(
    () => computeLeagueLeaders(workbooks, overrides, filter),
    [workbooks, overrides, filter]
  );

  const detectionCount = result.detections.merges.length + result.detections.splits.length;

  const chip = (active: boolean, onClick: () => void, label: string, key: string) => (
    <button
      key={key}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? 'bg-teal-900/40 text-teal-300 border-teal-700'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">League Leaders</h2>
          <p className="text-sm text-gray-400">
            Contractor leaderboards across every workbook. {result.contractorCount} contractors in view.
          </p>
        </div>
        <button
          onClick={() => setShowCleanup(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
        >
          <Wrench size={16} />
          Data cleanup
          {detectionCount > 0 && (
            <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-300">{detectionCount}</span>
          )}
        </button>
      </div>

      {/* FILTERS */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
          <Filter size={13} /> Filter
        </div>
        <div className="flex flex-wrap gap-2">
          {chip(filter.type === 'all', () => setFilter({ type: 'all' }), 'All', 'all')}
          {result.regionSeasons.map((rs) => {
            const f: LeagueFilter = { type: 'regionSeason', region: rs.region, season: rs.season };
            return chip(filterEq(filter, f), () => setFilter(f), `${rs.region} ${SEASON_LABELS[rs.season] || rs.season}`, `rs-${rs.region}-${rs.season}`);
          })}
          {result.nicknames.map((n) => {
            const f: LeagueFilter = { type: 'nickname', nickname: n };
            return chip(filterEq(filter, f), () => setFilter(f), n, `nk-${n}`);
          })}
        </div>
      </div>

      {/* HIDDEN BOARDS — restore row */}
      {result.boards.some((b) => hidden.has(b.key)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 flex items-center gap-1"><Eye size={13} /> Hidden:</span>
          {result.boards.filter((b) => hidden.has(b.key)).map((b) => (
            <button
              key={b.key}
              onClick={() => toggleHidden(b.key)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700 hover:text-white hover:border-gray-600 transition-colors"
            >
              {b.title}
            </button>
          ))}
        </div>
      )}

      {/* BOARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {result.boards.filter((b) => !hidden.has(b.key)).map((b) => (
          <div key={b.key} className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-gray-200">{b.title}</h4>
              <button
                onClick={() => toggleHidden(b.key)}
                className="text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0"
                title="Hide this category"
              >
                <EyeOff size={14} />
              </button>
            </div>
            {b.rows.length === 0 ? (
              <p className="text-xs text-gray-600">No data in this filter.</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                {b.rows.map((r) => (
                  <div key={r.identity} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right text-gray-500 text-xs flex-shrink-0">{r.rank}</span>
                    <span className="text-gray-200 truncate flex-1 min-w-0">
                      {r.name}
                      {r.ids.length > 1 && (
                        <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-blue-900/40 text-blue-300 align-middle" title={r.ids.join(', ')}>merged</span>
                      )}
                    </span>
                    {r.detail && <span className="text-[10px] text-gray-600 flex-shrink-0">{r.detail}</span>}
                    <span className="text-teal-300 font-semibold flex-shrink-0">{fmt(r.value, b.unit)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {showCleanup && (
        <CleanupModal
          merges={result.detections.merges}
          splits={result.detections.splits}
          overrides={overrides}
          onChanged={reloadOverrides}
          onClose={() => setShowCleanup(false)}
        />
      )}
    </div>
  );
};

// ============================================================================
// CLEANUP MODAL
// ============================================================================

interface CleanupProps {
  merges: { name: string; ids: string[] }[];
  splits: { id: string; names: string[] }[];
  overrides: ContractorOverride[];
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}

const CleanupModal: React.FC<CleanupProps> = ({ merges, splits, overrides, onChanged, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (tag: string, fn: () => Promise<void>) => {
    setBusy(tag); setError(null);
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message || 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const approveMerge = (name: string, ids: string[]) =>
    run('merge-' + ids.join('-'), () =>
      reportingService.createContractorOverride({ kind: 'merge', payload: { members: ids, canonicalName: name } }).then(() => {}));

  const approveSplit = (id: string) =>
    run('split-' + id, () =>
      reportingService.createContractorOverride({ kind: 'split', payload: { id } }).then(() => {}));

  const undo = (o: ContractorOverride) =>
    run('undo-' + o.id, () => reportingService.deleteContractorOverride(o.id));

  const describe = (o: ContractorOverride) => {
    if (o.kind === 'merge') {
      const p = o.payload as MergeOverridePayload;
      return `Merged ${(p.members || []).join(', ')} → ${p.canonicalName || '?'}`;
    }
    const p = o.payload as SplitOverridePayload;
    return `Split ${p.id} apart by name`;
  };

  const nothing = merges.length === 0 && splits.length === 0 && overrides.length === 0;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-[60]">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-800 z-10">
          <div className="flex items-center gap-2">
            <Wrench size={18} className="text-teal-400" />
            <h2 className="text-lg font-bold text-white">Data cleanup</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-6">
          {error && (
            <div className="bg-red-950/40 border border-red-900/60 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {nothing && (
            <div className="text-center py-8 text-sm text-gray-500">
              <Check size={24} className="mx-auto mb-2 text-green-400" />
              Nothing to clean up. No name or ID conflicts found.
            </div>
          )}

          {/* MERGES */}
          {merges.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users size={15} className="text-blue-400" />
                <h3 className="text-sm font-bold text-gray-200">Same person, different IDs</h3>
              </div>
              <p className="text-xs text-gray-500 mb-3">Approve to treat these IDs as one contractor.</p>
              <div className="space-y-2">
                {merges.map((m) => (
                  <div key={m.ids.join('-')} className="bg-gray-900 rounded-lg border border-gray-700 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 font-medium">{m.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{m.ids.join(' · ')}</div>
                    </div>
                    <button
                      onClick={() => approveMerge(m.name, m.ids)}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-800 hover:bg-blue-900/60 disabled:opacity-50 flex-shrink-0"
                    >
                      {busy === 'merge-' + m.ids.join('-') ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                      Merge
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SPLITS */}
          {splits.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <UserX size={15} className="text-orange-400" />
                <h3 className="text-sm font-bold text-gray-200">Same ID, different people</h3>
              </div>
              <p className="text-xs text-gray-500 mb-3">Approve to split this ID's rows apart by name.</p>
              <div className="space-y-2">
                {splits.map((s) => (
                  <div key={s.id} className="bg-gray-900 rounded-lg border border-gray-700 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 font-medium">{s.id}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{s.names.join(' · ')}</div>
                    </div>
                    <button
                      onClick={() => approveSplit(s.id)}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-900/40 text-orange-300 border border-orange-800 hover:bg-orange-900/60 disabled:opacity-50 flex-shrink-0"
                    >
                      {busy === 'split-' + s.id ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                      Split
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* APPLIED */}
          {overrides.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-200 mb-3">Applied fixes</h3>
              <div className="space-y-2">
                {overrides.map((o) => (
                  <div key={o.id} className="bg-gray-900 rounded-lg border border-gray-700 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0 text-sm text-gray-300 truncate">{describe(o)}</div>
                    <button
                      onClick={() => undo(o)}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 border border-gray-700 hover:text-white hover:border-gray-600 disabled:opacity-50 flex-shrink-0"
                    >
                      {busy === 'undo-' + o.id ? <Loader size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      Undo
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeagueLeadersView;