// src/v2/features/admin/ClientLists.tsx — Super Admin › Territory & Client Data › Client lists.
// Bring in a client list (file or Google Sheet link) → The Benny reads its layout → clean and
// match each address to its route → review the counts → approve. Every import can be undone,
// and each layout is saved as a recipe so the same kind of file reads the same way next time.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Link2, Sparkles, Undo2, Upload } from 'lucide-react';
import { useLoad } from '../../lib/data';
import {
  applyMapping, cell, FIELDS, findHeaderRow, fingerprint, guessMapping, formatPhone,
  type Applied, type ClientRow, type ColumnRule, type Field, type Mapping,
} from '../../lib/clientImport';
import {
  bennyFixAddresses, bennyMap, commitImport, fetchSheetCsv, findRecipe, finishStuckImport, geocode, listImports, listRecipes,
  matchClients, parseCsv, readWorkbook, undoImport, updateRecipe, type ImportRecord, type ImportRow, type MatchResult, type Recipe, type Sheet,
} from '../../lib/clients';
import { Btn, ErrorBox, Loading, Tabs, Tag, Toggle } from '../../ui';
import { TerritoryTabs } from './Territory';

type Step = 'source' | 'columns' | 'review' | 'done';
interface Source { fileName: string; kind: 'file' | 'sheet'; sheetUrl: string | null; sheets: Sheet[]; sheet: number }
interface Matched { client: ClientRow; match: MatchResult | null }

const HISTORY: Field[] = ['year', 'service', 'price', 'contractor', 'payment', 'serviced'];
const HOW: Record<string, string> = { house: 'House on route', address_point: 'Address point', geocode: 'Map search', street: 'Only route on street', given: 'List’s route code' };
const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const ClientLists: React.FC = () => {
  const [step, setStep] = useState<Step>('source');
  const [src, setSrc] = useState<Source | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [recipeName, setRecipeName] = useState('');
  const [lookupFp, setLookupFp] = useState('');
  const [bennyNote, setBennyNote] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [matched, setMatched] = useState<Matched[]>([]);
  const [fixed, setFixed] = useState<Map<number, { house_no: string; street: string; unit?: string; city?: string; province?: string; postal_code?: string }>>(new Map());
  const [includeUnrouted, setIncludeUnrouted] = useState(true);
  const [result, setResult] = useState<{ id: string; inserted: number; merged: number } | null>(null);
  const imports = useLoad(listImports, []);
  const recipes = useLoad(listRecipes, []);

  const rows = src ? src.sheets[src.sheet].rows : [];
  const headers = useMemo(() => mapping ? (rows[mapping.headerRow] || []).map(cell) : [], [rows, mapping]);
  const preview = useMemo(() => mapping && rows.length ? applyMapping(rows, mapping, { fixedAddresses: fixed }) : null, [rows, mapping, fixed]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  /** Use a saved recipe for this layout if there is one, otherwise ask The Benny. */
  const readLayout = async (s: Source, forceBenny = false) => {
    const r = s.sheets[s.sheet].rows;
    const guessRow = findHeaderRow(r);
    const fp = fingerprint((r[guessRow] || []).map(cell));
    setLookupFp(fp);
    const known = forceBenny ? null : await findRecipe(fp).catch(() => null);
    setFixed(new Map()); setBennyNote(null);
    if (known) {
      setRecipe(known); setRecipeName(known.name); setMapping(known.mapping);
    } else {
      setRecipe(null); setRecipeName(s.fileName.replace(/\.[^.]+$/, ''));
      try { setMapping(await bennyMap(s.fileName, r, guessRow)); }
      catch (e) {
        setMapping(guessMapping(r, guessRow));
        setBennyNote(`The Benny couldn’t read this one (${e instanceof Error ? e.message : String(e)}). The columns below were guessed from their titles; check them before going on.`);
      }
    }
    setStep('columns');
  };

  const onFile = (f: File | undefined) => f && run('Reading the file…', async () => {
    const sheets = /\.csv$/i.test(f.name) ? [{ name: f.name, rows: await parseCsv(await f.text()) }] : await readWorkbook(f);
    if (!sheets.length) throw new Error('That file has no rows.');
    const s: Source = { fileName: f.name, kind: 'file', sheetUrl: null, sheets, sheet: 0 };
    setSrc(s); await readLayout(s);
  });
  const onLink = () => run('Opening the sheet…', async () => {
    const csv = await fetchSheetCsv(link.trim());
    const r = await parseCsv(csv);
    if (!r.length) throw new Error('That sheet has no rows.');
    const s: Source = { fileName: `Google Sheet ${link.match(/\/d\/([\w-]{6})/)?.[1] || ''}`.trim(), kind: 'sheet', sheetUrl: link.trim(), sheets: [{ name: 'Sheet', rows: r }], sheet: 0 };
    setSrc(s); await readLayout(s);
  });

  const setRule = (i: number, patch: Partial<ColumnRule>) => setMapping(m => m ? { ...m, columns: { ...m.columns, [i]: { ...(m.columns[i] || { field: 'ignore' }), ...patch } } } : m);

  const fixWithBenny = () => preview && run('The Benny is reading addresses…', async () => {
    const items = preview.skipped.filter(s => s.reason !== 'No address' && s.text).map(s => ({ i: s.row, text: s.text }));
    const got = await bennyFixAddresses(items);
    setFixed(prev => { const n = new Map(prev); for (const g of got) n.set(g.i, g); return n; });
  });

  /** Match every address to a route: the map's own address data first, then a map search. */
  const matchAll = () => preview && mapping && run('Matching addresses to routes…', async () => {
    const list = preview.clients;
    const ask = (idx: number[], extra?: Map<number, { lat: number; lng: number }>) => idx.map(i => {
      const c = list[i]; const g = extra?.get(i);
      return { i, house_no: c.house_no, street: c.street_name, unit: c.unit, city: c.city, route: c.route_given, lat: g?.lat ?? null, lng: g?.lng ?? null };
    });
    const all = list.map((_, i) => i);
    const res = await matchClients(ask(all), n => setBusy(`Matching addresses to routes… ${n} of ${list.length}`));
    const missing = all.filter(i => !res.get(i)?.route_code).slice(0, 600);
    if (missing.length) {
      const found = new Map<number, { lat: number; lng: number }>();
      let done = 0;
      for (let k = 0; k < missing.length; k += 6) {
        await Promise.all(missing.slice(k, k + 6).map(async i => { const g = await geocode(list[i]); if (g) found.set(i, g); }));
        done = Math.min(missing.length, k + 6);
        setBusy(`Looking up addresses on the map… ${done} of ${missing.length}`);
      }
      if (found.size) {
        const again = await matchClients(ask([...found.keys()], found));
        for (const [i, r] of again) if (r.route_code || r.lat) res.set(i, { ...r, lat: r.lat ?? found.get(i)!.lat, lng: r.lng ?? found.get(i)!.lng });
      }
    }
    setApplied(preview);
    setMatched(list.map((client, i) => ({ client, match: res.get(i) || null })));
    setStep('review');
  });

  const counts = useMemo(() => {
    const n = { rowsRead: applied?.rowsRead || 0, clients: matched.length, skipped: applied?.skipped.length || 0, combined: 0, fresh: 0, merge: 0, routed: 0, unrouted: 0 };
    n.combined = Math.max(0, n.rowsRead - n.skipped - n.clients);
    for (const m of matched) {
      if (m.match?.client_id) n.merge++; else n.fresh++;
      if (m.match?.route_code) n.routed++; else n.unrouted++;
    }
    return n;
  }, [applied, matched]);

  const approve = () => src && mapping && run('Saving…', async () => {
    const chosen = matched.filter(m => includeUnrouted || m.match?.route_code);
    const toRow = ({ client: c, match: m }: Matched): ImportRow => ({
      house_no: c.house_no, street_name: c.street_name, unit: c.unit, city: c.city, province: c.province, postal_code: c.postal_code,
      lat: m?.lat ?? null, lng: m?.lng ?? null, route_code: m?.route_code ?? null, match_how: m?.how ?? null,
      people: c.people, phones: c.phones, emails: c.emails, history: c.history, tags: c.tags, notes: c.notes, call_first: c.call_first,
      do_not_call: c.do_not_call, do_not_text: c.do_not_text,
    });
    const res = await commitImport({
      fileName: src.fileName, source: src.kind, sheetUrl: src.sheetUrl, fingerprint: lookupFp || fingerprint(headers), recipeName: recipeName || src.fileName,
      headers, mapping, rows: chosen.map(toRow),
      counts: { rows_read: counts.rowsRead, clients_in_file: counts.clients, rows_combined: counts.combined, rows_skipped: counts.skipped, on_route: counts.routed, needs_attention: counts.unrouted, left_out: matched.length - chosen.length },
    }, n => setBusy(`Saving… ${n} of ${chosen.length}`));
    setResult(res); setStep('done'); imports.reload(); recipes.reload();
  });

  const reset = () => { setStep('source'); setSrc(null); setMapping(null); setRecipe(null); setApplied(null); setMatched([]); setResult(null); setFixed(new Map()); setLink(''); setBennyNote(null); };

  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Territory & Client Data</span><span className="v2-spacer" />
        <Link className="v2-link" to="/app/clients">Open clients ›</Link></div>
      <TerritoryTabs on="clients" />
      <ErrorBox error={error} />
      {busy && <div className="v2-card v2-row" style={{ marginBottom: 12 }}><Sparkles size={16} color="#7c3aed" /><b>{busy}</b></div>}

      {step === 'source' && (
        <div className="v2-grid2" style={{ marginBottom: 14 }}>
          <div className="v2-card">
            <div className="v2-card-h"><FileSpreadsheet size={14} /> Upload a file</div>
            <p className="v2-mut v2-small" style={{ marginTop: 0 }}>Excel (.xlsx, .xls) or CSV: a callbook, a CRM export, any list of clients.</p>
            <label className="v2-btn" style={{ cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}>
              <Upload size={15} />Choose file
              <input type="file" accept=".xlsx,.xls,.csv" hidden disabled={!!busy} onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <div className="v2-card">
            <div className="v2-card-h"><Link2 size={14} /> Google Sheet link</div>
            <p className="v2-mut v2-small" style={{ marginTop: 0 }}>Paste the link to the tab you want. The sheet must be shared as “Anyone with the link can view”.</p>
            <div className="v2-row" style={{ flexWrap: 'nowrap' }}>
              <input className="v2-input" placeholder="https://docs.google.com/spreadsheets/d/…" value={link} onChange={e => setLink(e.target.value)} aria-label="Google Sheet link" />
              <Btn disabled={!link.includes('/spreadsheets/d/') || !!busy} onClick={onLink}>Read</Btn>
            </div>
          </div>
        </div>
      )}

      {step === 'columns' && src && mapping && preview && (
        <div className="v2-stack">
          <div className="v2-card">
            <div className="v2-row">
              <b>{src.fileName}</b>
              {src.sheets.length > 1 && (
                <select className="v2-sel" style={{ width: 200 }} value={src.sheet} aria-label="Tab"
                  onChange={e => { const s = { ...src, sheet: Number(e.target.value) }; setSrc(s); run('Reading the tab…', () => readLayout(s)); }}>
                  {src.sheets.map((s, i) => <option key={i} value={i}>{s.name} ({s.rows.length} rows)</option>)}
                </select>
              )}
              {recipe ? <Tag tone="g">Known layout · {recipe.name} · used {recipe.times_used}×</Tag> : !bennyNote ? <Tag tone="v">Read by The Benny</Tag> : <Tag tone="a">Guessed</Tag>}
              <span className="v2-spacer" />
              <Btn kind="o" size="sm" icon={Sparkles} disabled={!!busy} onClick={() => run('The Benny is reading the file…', () => readLayout(src, true))}>Ask The Benny again</Btn>
              <Btn kind="o" size="sm" onClick={reset}>Start over</Btn>
            </div>
            {(bennyNote || mapping.notes) && <div className="v2-note" style={{ whiteSpace: 'pre-wrap' }}>{bennyNote || mapping.notes}</div>}
            <div className="v2-grid4" style={{ marginTop: 12 }}>
              <label className="v2-small"><span className="v2-label">Title row</span>
                <input className="v2-input" type="number" min={1} value={mapping.headerRow + 1} onChange={e => setMapping({ ...mapping, headerRow: Math.max(0, Number(e.target.value) - 1) })} /></label>
              <label className="v2-small"><span className="v2-label">Year (if the list has none)</span>
                <input className="v2-input" type="number" placeholder="e.g. 2026" value={mapping.defaultYear ?? ''} onChange={e => setMapping({ ...mapping, defaultYear: e.target.value ? Number(e.target.value) : null })} /></label>
              <label className="v2-small"><span className="v2-label">Service (if all one)</span>
                <input className="v2-input" placeholder="AER, SS, RJ, WW" value={mapping.defaultService ?? ''} onChange={e => setMapping({ ...mapping, defaultService: e.target.value || null })} /></label>
              <label className="v2-small"><span className="v2-label">City (if the list has none)</span>
                <input className="v2-input" value={mapping.defaultCity ?? ''} onChange={e => setMapping({ ...mapping, defaultCity: e.target.value || null })} /></label>
            </div>
          </div>

          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-table-wrap" style={{ maxHeight: 'calc(100vh - 380px)', overflow: 'auto' }}>
              <table className="v2-table">
                <thead><tr><th>Column</th><th>Examples</th><th style={{ width: 260 }}>Means</th><th style={{ width: 170 }}>Year / name</th></tr></thead>
                <tbody>
                  {headers.map((h, i) => {
                    const rule = mapping.columns[i] || { field: 'ignore' as Field };
                    const samples = rows.slice(mapping.headerRow + 1).map(r => cell((r || [])[i])).filter(Boolean).slice(0, 3);
                    return (
                      <tr key={i} style={{ opacity: rule.field === 'ignore' ? 0.55 : 1 }}>
                        <td><b>{h || `(column ${i + 1})`}</b></td>
                        <td className="v2-small v2-mut" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{samples.join(' · ') || '—'}</td>
                        <td>
                          <select className="v2-sel" value={rule.field} aria-label={`What ${h || `column ${i + 1}`} means`} onChange={e => setRule(i, { field: e.target.value as Field })}>
                            {['', 'Person', 'Address', 'Contact', 'Flags', 'History'].map(g => (
                              <optgroup key={g || 'none'} label={g || 'Skip'}>
                                {FIELDS.filter(f => f.group === g).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td>
                          {HISTORY.includes(rule.field) && rule.field !== 'year' && (
                            <input className="v2-input" type="number" placeholder="row’s year" value={rule.year ?? ''} aria-label="Year this column is for"
                              onChange={e => setRule(i, { year: e.target.value ? Number(e.target.value) : null })} />
                          )}
                          {rule.field === 'tag' && <input className="v2-input" value={rule.tag ?? h} aria-label="Tag name" onChange={e => setRule(i, { tag: e.target.value })} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="v2-card v2-row">
            <span><b>{preview.rowsRead}</b> rows → <b>{preview.clients.length}</b> addresses</span>
            {preview.skipped.length > 0 && <span className="v2-mut">· {preview.skipped.length} rows without a usable address</span>}
            {preview.skipped.some(s => s.reason !== 'No address' && s.text) && (
              <Btn kind="o" size="sm" icon={Sparkles} disabled={!!busy} onClick={fixWithBenny}>Ask The Benny to read {preview.skipped.filter(s => s.reason !== 'No address' && s.text).length} addresses</Btn>
            )}
            <span className="v2-spacer" />
            <Btn disabled={!!busy || preview.clients.length === 0} onClick={matchAll}>Next: match to routes</Btn>
          </div>
        </div>
      )}

      {step === 'review' && src && (
        <Review counts={counts} matched={matched} skipped={applied?.skipped || []} busy={!!busy}
          recipeName={recipeName} setRecipeName={setRecipeName} includeUnrouted={includeUnrouted} setIncludeUnrouted={setIncludeUnrouted}
          onBack={() => setStep('columns')} onApprove={approve} />
      )}

      {step === 'done' && result && (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30, marginBottom: 14 }}>
          <div className="v2-h2" style={{ marginBottom: 6 }}>Imported</div>
          <div><b>{result.inserted}</b> new clients · <b>{result.merged}</b> merged into existing clients</div>
          <div className="v2-note">Clients on a route now show in the past-client layer of the RM map and worker logsheet.</div>
          <div className="v2-row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <Btn kind="o" icon={Undo2} disabled={!!busy} onClick={() => run('Undoing…', async () => { await undoImport(result.id); imports.reload(); reset(); })}>Undo this import</Btn>
            <Link className="v2-btn o" to="/app/clients">Open clients</Link>
            <Btn onClick={reset}>Import another list</Btn>
          </div>
        </div>
      )}

      {step === 'source' && <History imports={imports} recipes={recipes} run={run} busy={!!busy} />}
    </div>
  );
};

const Review: React.FC<{
  counts: { rowsRead: number; clients: number; skipped: number; combined: number; fresh: number; merge: number; routed: number; unrouted: number };
  matched: Matched[]; skipped: Applied['skipped']; busy: boolean; recipeName: string; setRecipeName: (s: string) => void;
  includeUnrouted: boolean; setIncludeUnrouted: (b: boolean) => void; onBack: () => void; onApprove: () => void;
}> = ({ counts, matched, skipped, busy, recipeName, setRecipeName, includeUnrouted, setIncludeUnrouted, onBack, onApprove }) => {
  const [tab, setTab] = useState<'new' | 'merge' | 'attention' | 'skipped'>('new');
  const list = tab === 'new' ? matched.filter(m => !m.match?.client_id) : tab === 'merge' ? matched.filter(m => m.match?.client_id)
    : tab === 'attention' ? matched.filter(m => !m.match?.route_code) : [];
  const willImport = includeUnrouted ? counts.clients : counts.routed;
  return (
    <div className="v2-stack">
      <div className="v2-grid4">
        {[['Rows read', counts.rowsRead, ''], ['Clients (one per address)', counts.clients, `${counts.combined} duplicate rows combined`],
          ['New', counts.fresh, ''], ['Merge into existing', counts.merge, ''],
          ['On a route', counts.routed, ''], ['Needs attention', counts.unrouted, 'no route found'], ['Rows skipped', counts.skipped, 'no usable address'],
          ['Will be imported', willImport, '']].map(([label, n, sub]) => (
          <div key={String(label)} className="v2-card"><div className="v2-card-h">{label}</div><div className="v2-kpi">{n}</div>{sub && <div className="v2-note" style={{ marginTop: 0 }}>{sub}</div>}</div>
        ))}
      </div>
      <div className="v2-card" style={{ padding: 0 }}>
        <div style={{ padding: '10px 12px 0' }}>
          <Tabs value={tab} onChange={setTab} items={[{ key: 'new', label: 'New', count: counts.fresh }, { key: 'merge', label: 'Merging', count: counts.merge },
            { key: 'attention', label: 'Needs attention', count: counts.unrouted }, { key: 'skipped', label: 'Skipped rows', count: counts.skipped }]} />
        </div>
        <div className="v2-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
          {tab === 'skipped' ? (
            <table className="v2-table"><thead><tr><th>Row</th><th>Why</th><th>What it said</th></tr></thead>
              <tbody>{skipped.slice(0, 300).map(s => <tr key={s.row}><td>{s.row}</td><td>{s.reason}</td><td className="v2-mut">{s.text || '—'}</td></tr>)}</tbody></table>
          ) : (
            <table className="v2-table">
              <thead><tr><th>Address</th><th>Route</th><th>People</th><th>Phones</th><th>History</th><th>Flags</th><th>Rows</th></tr></thead>
              <tbody>{list.slice(0, 300).map(({ client: c, match: m }) => (
                <tr key={c.key}>
                  <td><b>{c.house_no} {c.street_name}</b>{c.unit && ` Unit ${c.unit}`}<div className="v2-small v2-mut">{[c.city, c.province, c.postal_code].filter(Boolean).join(', ')}</div></td>
                  <td>{m?.route_code ? <><b>{m.route_code}</b><div className="v2-small v2-mut">{HOW[m.how || ''] || ''}</div></> : <Tag tone="a">No route</Tag>}</td>
                  <td className="v2-small">{c.people.map(p => `${p.first} ${p.last}`.trim()).join(', ') || '—'}</td>
                  <td className="v2-small">{c.phones.map(formatPhone).join(', ') || '—'}</td>
                  <td className="v2-small">{c.history.map(h => [h.year, h.service, h.price && `$${h.price}`].filter(Boolean).join(' ')).join(' · ') || '—'}</td>
                  <td>{c.do_not_call && <Tag tone="r">DNC</Tag>} {c.do_not_text && <Tag tone="r">No text</Tag>} {c.tags.map(t => <Tag key={t}>{t}</Tag>)}</td>
                  <td className="v2-small v2-mut">{c.rows.join(', ')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {(tab === 'skipped' ? skipped.length : list.length) > 300 && <div className="v2-note" style={{ padding: '0 12px 10px' }}>Showing the first 300.</div>}
        </div>
      </div>
      <div className="v2-card v2-row">
        <label className="v2-row" style={{ gap: 8 }}><Toggle on={includeUnrouted} onChange={setIncludeUnrouted} label="Import addresses with no route" />Also import the {counts.unrouted} addresses with no route yet</label>
        <label className="v2-row" style={{ gap: 8 }}>Save this layout as
          <input className="v2-input" style={{ width: 240 }} value={recipeName} onChange={e => setRecipeName(e.target.value)} aria-label="Recipe name" /></label>
        <span className="v2-spacer" />
        <Btn kind="o" onClick={onBack} disabled={busy}>Back</Btn>
        <Btn kind="g" onClick={onApprove} disabled={busy || willImport === 0}>Approve and import {willImport}</Btn>
      </div>
    </div>
  );
};

interface Loaded<T> { data: T | null; loading: boolean; reload: () => void }
const History: React.FC<{ imports: Loaded<ImportRecord[]>; recipes: Loaded<Recipe[]>;
  run: (label: string, fn: () => Promise<void>) => void; busy: boolean }> = ({ imports, recipes, run, busy }) => {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="v2-grid2" style={{ alignItems: 'start' }}>
      <div className="v2-card">
        <div className="v2-card-h">Past imports</div>
        {imports.loading ? <Loading /> : (imports.data || []).length === 0 ? <div className="v2-mut v2-small">No client lists imported yet.</div> : (
          <table className="v2-table"><tbody>
            {(imports.data || []).map(i => (
              <tr key={i.id}>
                <td><b>{i.file_name}</b><div className="v2-small v2-mut">{fmtDate(i.created_at)}{i.recipe ? ` · ${i.recipe.name}` : ''}</div></td>
                <td className="v2-small">{i.counts?.inserted ?? 0} new · {i.counts?.merged ?? 0} merged{i.counts?.needs_attention ? ` · ${i.counts.needs_attention} no route` : ''}</td>
                <td style={{ textAlign: 'right' }}>
                  {i.status === 'undone' ? <Tag>Undone</Tag> : i.status === 'running' ? (
                    <span className="v2-row" style={{ justifyContent: 'flex-end', gap: 6 }}><Tag tone="a">Interrupted</Tag>
                      <Btn size="sm" kind="o" disabled={busy} onClick={() => run('Finishing…', async () => { await finishStuckImport(i.id); imports.reload(); })}>Keep</Btn>
                      <Btn size="sm" kind="r" disabled={busy} onClick={() => run('Undoing…', async () => { await undoImport(i.id); imports.reload(); })}>Undo</Btn></span>
                  ) : confirm === i.id ? (
                    <span className="v2-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Btn size="sm" kind="r" disabled={busy} onClick={() => run('Undoing…', async () => { await undoImport(i.id); setConfirm(null); imports.reload(); })}>Yes, undo</Btn>
                      <Btn size="sm" kind="o" onClick={() => setConfirm(null)}>Keep</Btn></span>
                  ) : <Btn size="sm" kind="o" icon={Undo2} disabled={busy} onClick={() => setConfirm(i.id)}>Undo</Btn>}
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      <div className="v2-card">
        <div className="v2-card-h">Recipes · layouts The Benny has learned</div>
        {recipes.loading ? <Loading /> : (recipes.data || []).length === 0 ? <div className="v2-mut v2-small">Each approved import saves its layout here, so the same kind of file reads the same way next time.</div> : (
          <table className="v2-table"><tbody>
            {(recipes.data || []).map(r => (
              <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                <td><input className="v2-input" style={{ padding: '5px 8px' }} defaultValue={r.name} aria-label="Recipe name"
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.name) run('Saving…', async () => { await updateRecipe(r.id, v, null); recipes.reload(); }); }} />
                  <div className="v2-small v2-mut">{r.headers.length} columns · used {r.times_used}×{r.last_used_at ? ` · last ${fmtDate(r.last_used_at)}` : ''}</div></td>
                <td style={{ textAlign: 'right' }}><Btn size="sm" kind="o" disabled={busy} onClick={() => run('Saving…', async () => { await updateRecipe(r.id, null, !r.active); recipes.reload(); })}>{r.active ? 'Retire' : 'Restore'}</Btn></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </div>
  );
};
