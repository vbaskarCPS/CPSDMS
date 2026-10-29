// src/v2/features/admin/WestPclImport.tsx — The Benny's West past-client import: the BC call book
// (every tab but CCD) or the 2026 Logsheets, as one lime-green lawn list.
//
//   1. read   each row → a customer (town from the route prefix) with its past jobs; the same
//             address on several rows or tabs is one customer with every job
//   2. find   points from the map search (a batch of 1,000 at a time), then placed on the built maps
//             by location: on a route, waiting on a map (attaches by itself later), or no location
//   3. save   through the safe import (held, saved, undoable from Recent imports)
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MapPin, Upload, X } from 'lucide-react';
import { findPoint } from '../../lib/bookings';
import { db, must } from '../../lib/client';
import { saveImport, stageImport, type StagedRow } from '../../lib/clients';
import { batchFind, mergeRows, parseCallBookTab, parseLogsheets, placePoints, toImportRow, type Point } from '../../lib/westPcl';
import { Btn, ErrorBox, Tag } from '../../ui';

export interface WestSource { kind: 'callbook' | 'logsheets'; fileName: string; tabs: { name: string; rows: unknown[][] }[] }

type Placed = { pt: Point | null; route: string | null; area: string | null };

export const WestPclImport: React.FC<{ src: WestSource; onClose: () => void }> = ({ src, onClose }) => {
  const parsed = useMemo(() => src.kind === 'callbook'
    ? src.tabs.flatMap(t => parseCallBookTab(t.name, t.rows))
    : src.tabs.flatMap(t => parseLogsheets(t.rows)), [src]);
  const customers = useMemo(() => mergeRows(parsed), [parsed]);
  const stats = useMemo(() => {
    const byTab: Record<string, number> = {}; for (const r of parsed) byTab[r.tab] = (byTab[r.tab] || 0) + 1;
    const years: Record<string, number> = {}; let aer = 0, rj = 0, sold = 0;
    for (const c of customers) {
      for (const h of c.history) { years[h.year || '?'] = (years[h.year || '?'] || 0) + 1; if (h.line === 'aeration') aer++; else rj++; }
      sold += c.tags.length;
    }
    return { byTab, years, aer, rj, sold, noRoute: customers.filter(c => !c.sheet_route).length, noJobs: customers.filter(c => !c.history.length && !c.tags.length).length };
  }, [parsed, customers]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [placed, setPlaced] = useState<Map<number, Placed> | null>(null);
  const [missed, setMissed] = useState<number[]>([]);
  const [done, setDone] = useState<{ inserted: number; merged: number } | null>(null);
  const run = async (fn: () => Promise<void>) => { setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); } };

  const place = async (pts: Map<number, Point>, prev?: Map<number, Placed>) => {
    const items = [...pts.entries()].map(([i, p]) => ({ i, lat: p.lat, lng: p.lng, street: customers[i].street, house_no: customers[i].house_no }));
    const where = await placePoints(items, n => setBusy(`Placing them on the digital maps… ${n.toLocaleString()} of ${items.length.toLocaleString()}`));
    const m = new Map(prev || []);
    for (const [i, p] of pts) { const w = where.get(i); m.set(i, { pt: p, route: w?.route_code || null, area: w?.area_name || null }); }
    return m;
  };
  const find = () => run(async () => {
    setBusy('Finding the addresses on the map…');
    const pts = await batchFind(customers, n => setBusy(`Finding the addresses on the map… ${n.toLocaleString()} of ${customers.length.toLocaleString()}`));
    let miss = customers.map((_, i) => i).filter(i => !pts.has(i));
    // a small remainder (or no batch search on this account): one at a time, with the street tidied
    if (miss.length && miss.length <= 2500) {
      let k = 0;
      for (let a = 0; a < miss.length; a += 8) {
        await Promise.all(miss.slice(a, a + 8).map(async i => {
          const c = customers[i];
          const r = await findPoint({ house_no: c.house_no, street: c.street, city: c.city, route: c.sheet_route });
          if (r.found) pts.set(i, { lat: r.found.lat, lng: r.found.lng });
        }));
        k = Math.min(miss.length, a + 8);
        setBusy(`Looking harder for ${miss.length.toLocaleString()} addresses… ${k.toLocaleString()} done`);
      }
      miss = miss.filter(i => !pts.has(i));
    }
    setMissed(miss);
    setPlaced(await place(pts));
  });
  const lookHarder = () => run(async () => {
    const pts = new Map<number, Point>(); let k = 0;
    for (let a = 0; a < missed.length; a += 8) {
      await Promise.all(missed.slice(a, a + 8).map(async i => {
        const c = customers[i];
        const r = await findPoint({ house_no: c.house_no, street: c.street, city: c.city, route: c.sheet_route });
        if (r.found) pts.set(i, { lat: r.found.lat, lng: r.found.lng });
      }));
      k = Math.min(missed.length, a + 8);
      setBusy(`Looking harder… ${k.toLocaleString()} of ${missed.length.toLocaleString()}`);
    }
    setMissed(missed.filter(i => !pts.has(i)));
    setPlaced(await place(pts, placed || undefined));
  });

  const counts = useMemo(() => {
    const c = { on: 0, waiting: 0, none: 0 }; const areas: Record<string, number> = {}; const wait: Record<string, number> = {};
    customers.forEach((x, i) => {
      const p = placed?.get(i);
      if (p?.route) { c.on++; areas[p.area || '?'] = (areas[p.area || '?'] || 0) + 1; }
      else if (p?.pt) { c.waiting++; const pre = x.sheet_route.match(/^[A-Z]+/)?.[0] || '—'; wait[pre] = (wait[pre] || 0) + 1; }
      else c.none++;
    });
    return { ...c, areas, wait };
  }, [placed, customers]);

  const save = () => run(async () => {
    const rows = customers.map((c, i) => { const p = placed?.get(i); return toImportRow(c, p?.pt || null, p?.route || null); }) as unknown as StagedRow[];
    setBusy('Opening the import…');
    const id = must(await db.rpc('app_client_import_open', {
      p_file: src.fileName, p_source: 'file', p_sheet_url: null, p_fingerprint: null, p_recipe_name: null,
      p_headers: [], p_mapping: null, p_notes: src.kind === 'callbook' ? 'West call book (past lawn clients)' : 'West 2026 Logsheets (spring jobs)',
      p_file_hash: null, p_checks: [], p_audit: null, p_counts: { customers: rows.length, on_map: counts.on, waiting: counts.waiting, no_location: counts.none },
    })) as string;
    await stageImport(id, rows, n => setBusy(`Holding the rows… ${n.toLocaleString()} of ${rows.length.toLocaleString()}`));
    const res = await saveImport(id, { customers: rows.length, on_map: counts.on, waiting: counts.waiting, no_location: counts.none },
      left => setBusy(`Saving… ${(rows.length - left).toLocaleString()} of ${rows.length.toLocaleString()}`),
      left => setBusy(`Refreshing the maps’ past clients… ${left} routes left`));
    setDone(res);
  });

  const top = (o: Record<string, number>, n = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  return (
    <div className="v2-card" style={{ display: 'grid', gap: 12 }}>
      <div className="v2-row" style={{ gap: 8 }}>
        <Upload size={18} /><b style={{ fontSize: 17 }}>West past clients · {src.kind === 'callbook' ? 'call book' : '2026 Logsheets'}</b>
        <span className="v2-spacer" />
        <button type="button" className="v2-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="v2-note" style={{ margin: 0 }}>
        {src.kind === 'callbook'
          ? <>The Benny recognised the BC call book ({src.fileName}). Each tab’s <b>Service History</b> becomes past jobs by year (A = aeration, any D/F/S/L = rejuv); this year’s calling columns are left out.</>
          : <>The Benny recognised the 2026 <b>Logsheets</b> ({src.fileName}). Visits become <b>Spring 2026</b> jobs: a row ending in marks like “(ADFSL)” was a Rejuv visit with those services, the rest Aeration (A). Upsell rows are recorded as sales only.</>}
        {' '}Every West past client shows lime green. Read: {src.tabs.map(t => t.name).join(', ')}.
      </div>
      <ErrorBox error={error} />
      <div className="v2-mb-nums">
        <span><b>{parsed.length.toLocaleString()}</b> rows</span>
        <span><b>{customers.length.toLocaleString()}</b> customers</span>
        <span><b>{(parsed.length - customers.length).toLocaleString()}</b> doubles merged</span>
        <span><b>{stats.aer.toLocaleString()}</b> aeration jobs</span>
        <span><b>{stats.rj.toLocaleString()}</b> rejuv jobs</span>
        {stats.sold > 0 && <span><b>{stats.sold.toLocaleString()}</b> upsells (sales)</span>}
        {stats.noRoute > 0 && <span><b>{stats.noRoute}</b> without a route</span>}
      </div>
      <div className="v2-small v2-mut">
        {Object.entries(stats.byTab).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(' · ')} — jobs by year: {Object.entries(stats.years).sort().map(([y, n]) => `${y} ${n.toLocaleString()}`).join(' · ')}
      </div>
      {busy && <div className="v2-mut">{busy}</div>}

      {done ? (
        <div className="v2-card" style={{ background: '#f0fdf4' }}>
          <div className="v2-row" style={{ gap: 8 }}><CheckCircle2 size={18} color="#16a34a" /><b>{(done.inserted + done.merged).toLocaleString()} customers saved</b></div>
          <div className="v2-small" style={{ marginTop: 6 }}>{done.inserted.toLocaleString()} new · {done.merged.toLocaleString()} merged into customers already on file · {counts.on.toLocaleString()} on a built map · {counts.waiting.toLocaleString()} waiting on a map · {counts.none.toLocaleString()} with no location. It can be undone from Recent imports.</div>
          <div className="v2-row" style={{ gap: 8, marginTop: 10 }}><Link className="v2-btn" to="/app/clients">Open customers</Link><Btn kind="o" onClick={onClose}>Done</Btn></div>
        </div>
      ) : !placed ? (
        <div className="v2-row" style={{ gap: 8 }}>
          <Btn icon={MapPin} onClick={find} disabled={!!busy || !customers.length}>Find the addresses</Btn>
          <span className="v2-mut v2-small">Nothing is saved until you load. {customers.length > 5000 ? 'A big list takes a few minutes; keep this page open.' : ''}</span>
        </div>
      ) : (
        <>
          <div className="v2-mb-states">
            <div className="v2-card v2-mb-state"><Tag tone="g">On a built map</Tag><b>{counts.on.toLocaleString()}</b></div>
            <div className="v2-card v2-mb-state"><Tag tone="a">Waiting on a map</Tag><b>{counts.waiting.toLocaleString()}</b></div>
            <div className="v2-card v2-mb-state"><Tag tone="r">No location</Tag><b>{counts.none.toLocaleString()}</b></div>
          </div>
          <div className="v2-grid2">
            <div className="v2-small"><b>On maps:</b> {top(counts.areas).map(([a, n]) => `${a} ${n}`).join(' · ') || 'none yet'}</div>
            <div className="v2-small"><b>Waiting (by route prefix):</b> {top(counts.wait, 16).map(([a, n]) => `${a} ${n}`).join(' · ') || 'none'}</div>
          </div>
          {missed.length > 0 && (
            <div className="v2-row" style={{ gap: 8 }}>
              <span className="v2-small">{missed.length.toLocaleString()} addresses weren’t found. They load with no location (fixable later on the customer page).</span>
              <Btn size="sm" kind="o" onClick={lookHarder} disabled={!!busy}>Look harder ({Math.ceil(missed.length / 400)} min)</Btn>
            </div>
          )}
          <div className="v2-row" style={{ gap: 8 }}>
            <Btn icon={Upload} onClick={save} disabled={!!busy}>Load {customers.length.toLocaleString()} customers</Btn>
          </div>
          <div className="v2-note" style={{ margin: 0 }}>Waiting customers attach by themselves when their area’s map is approved, and show up lime green on its routes.</div>
        </>
      )}
    </div>
  );
};

