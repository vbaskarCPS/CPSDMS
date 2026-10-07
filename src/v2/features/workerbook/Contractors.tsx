// src/v2/features/workerbook/Contractors.tsx — every contractor hired this year, their status lists, profile and import.
import React, { useMemo, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Search, Upload, UserPlus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useCurrentSeason, useLoad } from '../../lib/data';
import {
  listHires, showedCounts, STATUS_LISTS, statusLabel, fullName, HAT_CODES,
  type StatusCode,
} from '../../lib/workerbook';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';
import { useContractorCard } from './ContractorCard';
import { getCenterType } from '../../lib/crew';
import { ImportContractors } from './ImportContractors';
import { AddContractor } from './AddContractor';

type Filter = 'active' | StatusCode | 'all' | 'inactive';
const tone = (s: StatusCode) => s === 'active' ? 'g' : s === 'WL' || s === 'F' ? 'r' : 'a';

export const Contractors: React.FC = () => {
  const { center, centers } = useAuth();
  const loc = useLocation();
  const season = useCurrentSeason(center?.id || null);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const seasonYear = season?.year;
  React.useEffect(() => { if (seasonYear) setYear(seasonYear); }, [seasonYear]);
  // ?status=WDR opens a bucket straight from the Workerbook calendar
  const [filter, setFilter] = useState<Filter>(() => {
    const want = new URLSearchParams(loc.search).get('status');
    if (want && (want === 'active' || want === 'all' || want === 'inactive' || STATUS_LISTS.some(s => s.code === want))) return want as Filter;
    return loc.pathname.endsWith('/status') ? 'NS' : 'active';
  });
  const [allCenters, setAllCenters] = useState(false);
  const [q, setQ] = useState('');
  const openCard = useContractorCard();
  const ctype = useLoad(() => center ? getCenterType(center.id) : Promise.resolve('in_city' as const), [center?.id]);
  const rt = ctype.data === 'road_trip' && !allCenters;
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const hires = useLoad(() => listHires(year), [year]);
  const counts = useLoad(async () => showedCounts((hires.data || []).map(h => h.id)), [hires.data]);

  const scoped = useMemo(() => (hires.data || []).filter(h => allCenters || !center || h.center_id === center.id), [hires.data, allCenters, center]);
  const byStatus = useMemo(() => {
    const m: Record<string, number> = { all: scoped.length };
    for (const h of scoped) m[h.status] = (m[h.status] || 0) + 1;
    return m;
  }, [scoped]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter(h => (filter === 'all' || h.status === filter || (filter === 'inactive' && h.status !== 'active'))
      && (!needle || h.cn.toLowerCase().includes(needle) || fullName(h.person).toLowerCase().includes(needle)
        || (h.person.cell_phone || '').replace(/\D/g, '').includes(needle.replace(/\D/g, '') || '~')));
  }, [scoped, filter, q]);
  const centerName = (id: string) => centers.find(c => c.id === id)?.display_name || '—';

  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to="/app/workerbook/days" className="v2-link">‹ Calendar</Link>
        <span className="v2-h1">Contractors</span>
        <select className="v2-select-pill" value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Year">
          {[year + 1, year, year - 1, year - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="v2-spacer" />
        <Btn kind="o" icon={Upload} onClick={() => setShowImport(true)} disabled={!center}>Import from Workerbook</Btn>
        <Btn icon={UserPlus} onClick={() => setShowAdd(true)} disabled={!center}>Add contractor</Btn>
      </div>

      <div className="v2-row" style={{ marginBottom: 12 }}>
        <button className={`v2-chip${filter === 'active' ? ' on' : ''}`} onClick={() => setFilter('active')}>Active · {byStatus.active || 0}</button>
        {rt && <button className={`v2-chip${filter === 'inactive' ? ' on' : ''}`} onClick={() => setFilter('inactive')}>Inactive · {(byStatus.all || 0) - (byStatus.active || 0)}</button>}
        {!rt && STATUS_LISTS.map(s => (
          <button key={s.code} className={`v2-chip${filter === s.code ? ' on' : ''}`} onClick={() => setFilter(s.code)} title={s.label}>
            {s.code} · {byStatus[s.code] || 0}
          </button>
        ))}
        <button className={`v2-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All · {byStatus.all || 0}</button>
        <span className="v2-spacer" />
        <label className="v2-row v2-small" style={{ gap: 6 }}>
          <input type="checkbox" checked={allCenters} onChange={e => setAllCenters(e.target.checked)} /> All centers
        </label>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30, width: 220 }} placeholder="Name, CN # or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Search contractors" />
        </div>
      </div>

      {filter !== 'active' && filter !== 'all' && (
        <div className="v2-note" style={{ marginTop: -4, marginBottom: 10 }}>
          {filter === 'inactive' ? 'Inactive' : statusLabel(filter)}. Open someone to move them back to Active.{filter === 'WL' ? ' People on the waitlist can’t be booked.' : ''}
        </div>
      )}
      <ErrorBox error={hires.error} />
      {hires.loading ? <Loading /> : (
        <div className="v2-card" style={{ padding: 0 }}>
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr>
                <th>CN #</th><th>Name</th><th>Cell</th><th>Shuttle</th>{allCenters && <th>Home center</th>}
                <th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>NS</th><th>Silver Hats</th><th>Status</th><th>PIN</th>
              </tr></thead>
              <tbody>
                {shown.map(h => {
                  const days = h.person.lifetime_days + (counts.data?.[h.id] || 0);
                  const hats = HAT_CODES.filter(c => (h.person.hats?.[c] || 0) > 0).map(c => `${c} ${h.person.hats[c]}`).join(' · ');
                  return (
                    <tr key={h.id} className="click" onClick={() => openCard?.(h.id, hires.reload)}>
                      <td><b>{h.cn}</b></td>
                      <td><b>{fullName(h.person)}</b>{days === 0 && <> <Tag tone="v">ROOKIE</Tag></>}</td>
                      <td>{h.person.cell_phone || '—'}</td>
                      <td>{h.shuttle || '—'}</td>
                      {allCenters && <td>{centerName(h.center_id)}</td>}
                      <td style={{ textAlign: 'right' }}>{days}</td>
                      <td style={{ textAlign: 'right', color: h.ns_count ? '#b91c1c' : undefined, fontWeight: h.ns_count ? 700 : undefined }}>{h.ns_count}</td>
                      <td className="v2-small">{hats || '—'}</td>
                      <td><Tag tone={tone(h.status)}>{h.status === 'active' ? 'Active' : h.status}</Tag></td>
                      <td className="v2-small">{h.pin_set_at ? 'Set' : <span className="v2-mut">Not set</span>}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={allCenters ? 10 : 9} className="v2-mut" style={{ padding: 20, textAlign: 'center' }}>
                    {(hires.data || []).length === 0 ? `No contractors for ${year} yet. Use Import from Workerbook to load the Contractors tab.` : 'Nobody matches.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showImport && center && <ImportContractors centerId={center.id} centerName={center.display_name} year={year}
        onClose={() => setShowImport(false)} onDone={() => hires.reload()} />}
      {showAdd && center && <AddContractor centerId={center.id} year={year} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); hires.reload(); }} />}
    </div>
  );
};
