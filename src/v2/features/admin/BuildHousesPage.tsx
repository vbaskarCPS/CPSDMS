// src/v2/features/admin/BuildHousesPage.tsx — Territory › Build houses: pick a master map, see which of
// its routes have houses, and build the rest ahead of time (so the first worker, or a demo, finds them
// ready). Runs in this browser: keep the tab open; it can be stopped and picked up again.
import React, { useMemo, useRef, useState } from 'react';
import { Hammer, Loader, Square } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { listAreaPrefixes } from '../../lib/territory';
import { buildRoute, mapRoutesStatus, type RouteBuildRow } from '../../lib/buildHouses';
import { Btn, Card, ErrorBox, Loading, Tag } from '../../ui';
import { TerritoryTabs } from './Territory';

const STATE: Record<RouteBuildRow['state'], { label: string; tone: 'g' | 'a' | 'r' }> = {
  ready: { label: 'Ready', tone: 'g' },
  unplaced: { label: 'Houses, not on rooftops', tone: 'a' },
  empty: { label: 'No houses', tone: 'r' },
};

export const BuildHousesPage: React.FC = () => {
  const prefixes = useLoad(listAreaPrefixes, []);
  const [area, setArea] = useState('BRIDLEWOOD');
  const status = useLoad(() => mapRoutesStatus(area), [area]);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const stop = useRef(false);

  const rows = status.data || [];
  const todo = useMemo(() => rows.filter(r => r.state !== 'ready'), [rows]);
  const counts = { ready: rows.filter(r => r.state === 'ready').length, houses: rows.reduce((t, r) => t + r.houses, 0) };

  const run = async (codes: string[]) => {
    stop.current = false; setError(null);
    try {
      for (const [i, rc] of codes.entries()) {
        if (stop.current) break;
        setRunning(rc);
        const head = codes.length > 1 ? `${rc} (${i + 1} of ${codes.length})` : rc;
        setProgress(`${head}: starting…`);
        const line = await buildRoute(rc, m => setProgress(`${head}: ${m}`));
        setResults(r => ({ ...r, [rc]: line }));
      }
    } catch (e) { setError(e); }
    finally { setRunning(null); setProgress(''); status.reload(); }
  };

  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Territory &amp; Client Data</span></div>
      <TerritoryTabs on="build" />
      <Card>
        <div className="v2-row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="v2-label" htmlFor="bh-area" style={{ margin: 0 }}>Map</label>
          <select id="bh-area" className="v2-sel" style={{ maxWidth: 320 }} value={area} disabled={!!running} onChange={e => { setArea(e.target.value); setResults({}); }}>
            {(prefixes.data || []).filter(p => !p.area_name.startsWith('DEMO ')).map(p => <option key={p.area_name} value={p.area_name}>{p.area_name}</option>)}
          </select>
          <span className="v2-spacer" />
          {!running && <Btn icon={Hammer} disabled={status.loading || !todo.length} onClick={() => run(todo.map(r => r.route_code))}>
            {todo.length ? `Build ${todo.length} route${todo.length === 1 ? '' : 's'}` : 'All built'}</Btn>}
          {running && <Btn kind="o" icon={Square} onClick={() => { stop.current = true; setProgress(p => `${p} — stopping after this route`); }}>Stop after this route</Btn>}
        </div>
        <p className="v2-small v2-mut" style={{ marginBottom: 0 }}>
          Builds each route the way a worker’s map does the first time it’s opened: houses from the address register or OpenStreetMap,
          then Mapbox puts each one on its rooftop. If OpenStreetMap has nothing for a route, Mapbox looks along each street instead.
          Keep this tab open while it runs; anything left unfinished is picked up next time. Mapbox charges roughly $4–5 per 1,000 houses, once.
        </p>
        {running && <div className="v2-note" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Loader size={14} className="animate-spin" /> {progress}</div>}
        <ErrorBox error={error || status.error} />
      </Card>

      {status.loading && !rows.length ? <Loading /> : (
        <Card title={`${counts.ready} of ${rows.length} routes ready · ${counts.houses.toLocaleString()} houses`}>
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>Route</th><th style={{ textAlign: 'right' }}>Houses</th><th>Status</th><th>Last build</th><th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.route_code}>
                  <td><code>{r.route_code}</code></td>
                  <td style={{ textAlign: 'right' }}>{r.houses.toLocaleString()}</td>
                  <td>{running === r.route_code ? <Tag tone="b">Building…</Tag> : <Tag tone={STATE[r.state].tone}>{STATE[r.state].label}</Tag>}</td>
                  <td className="v2-small v2-mut">{results[r.route_code] || r.note || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!running && <Btn size="sm" kind="o" onClick={() => run([r.route_code])}>{r.state === 'ready' ? 'Rebuild' : 'Build'}</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
};
