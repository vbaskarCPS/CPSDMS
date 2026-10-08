// src/v2/features/admin/ClientLists.tsx — Super Admin › Territory & Client Data › Client lists.
// Bring in a client list (file or Google Sheet link) → The Benny reads its layout → clean and
// match each address to its route → review the counts → approve. Every import can be undone,
// and each layout is saved as a recipe so the same kind of file reads the same way next time.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Link2, Sparkles, Undo2, Upload } from 'lucide-react';
import { useLoad } from '../../lib/data';
import {
  applyMapping, cell, FIELDS, findHeaderRow, fingerprint, guessMapping, formatPhone, lineLabel, profileColumns, SERVICE_LINES, titleCase,
  type Applied, type ClientRow, type ColumnRule, type Field, type Mapping, type ServiceLine,
} from '../../lib/clientImport';
import {
  bennyChat, bennyFixAddresses, bennyMap, bennyPlace, commitImport, streetCandidates, fetchSheetCsv, findRecipe, finishStuckImport, geocode, listImports, listRecipes,
  matchClients, parseCsv, readWorkbook, undoImport, updateRecipe, type ImportRecord, type ImportRow, type MatchResult, type Recipe, type Sheet,
} from '../../lib/clients';
import { Btn, ErrorBox, Loading, Tabs, Tag, Toggle } from '../../ui';
import { TerritoryTabs } from './Territory';
import { BennyChat, type ChatMessage } from './BennyChat';
import { applyChatActions, openingMessage, REVIEW_PROMPT } from '../../lib/bennyChat';

type Step = 'source' | 'columns' | 'review' | 'done';
interface Source { fileName: string; kind: 'file' | 'sheet'; sheetUrl: string | null; sheets: Sheet[]; sheet: number }
/** The Benny's correction of an address that couldn't be placed as written. */
interface Fix { house_no: string; street: string; confidence: 'high' | 'medium' | 'low'; reason: string; match: MatchResult | null; on: boolean }
interface Matched { client: ClientRow; match: MatchResult | null; fix?: Fix }
/** The address and route an import row will actually use (the correction, when it's switched on). */
const effective = (m: Matched): { client: ClientRow; match: MatchResult | null; fixed: boolean } =>
  m.fix?.on ? { client: { ...m.client, house_no: m.fix.house_no, street_name: m.fix.street }, match: m.fix.match, fixed: true } : { client: m.client, match: m.match, fixed: false };

/** How many unplaced addresses The Benny takes on at a time. */
const BENNY_BATCH = 2000;
/** Map searches for addresses the map's own data doesn't know, and for map points of placed ones. */
const GEOCODE_MISSING = 3000;
const GEOCODE_POINTS = 3000;
const GEOCODE_PARALLEL = 8;

const HISTORY: Field[] = ['year', 'service', 'price', 'contractor', 'payment', 'serviced'];
const HOW: Record<string, string> = { house_benny: 'House on route', address_point_benny: 'Address point', geocode_benny: 'Map search', street_benny: 'Only route on street', house: 'House on route', address_point: 'Address point', geocode: 'Map search', street: 'Only route on street', given: 'List’s route code' };
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
  const [bennyTried, setBennyTried] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ id: string; inserted: number; merged: number } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
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
      setChat([{ role: 'assistant', text: openingMessage([], true) }]);
    } else {
      setRecipe(null); setRecipeName(s.fileName.replace(/\.[^.]+$/, ''));
      setChat([]);
      try {
        const { questions, ...m } = await bennyMap(s.fileName, r, guessRow, { names: s.sheets.map(x => x.name), current: s.sheets[s.sheet].name });
        setMapping(m);
        setChat([{ role: 'assistant', text: openingMessage(questions, false) }]);
      } catch (e) {
        setMapping(guessMapping(r, guessRow));
        setBennyNote(`The Benny couldn’t read this one (${e instanceof Error ? e.message : String(e)}). The columns below were guessed from their titles; check them before going on.`);
        setChat([{ role: 'assistant', text: 'I couldn’t read this file just now, so the columns were guessed from their titles. You can still ask me about it.', error: true }]);
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

  /**
   * The Benny places addresses that couldn't be found: it looks up the real streets each one most
   * likely meant, picks one, and the corrected address is matched to its route. Returns the fixes,
   * and which addresses it got to look at (a batch that failed isn't counted, so it can be retried).
   */
  const placeWithBenny = async (list: ClientRow[], idx: number[], routes: string[]): Promise<{ fixes: Map<number, Fix>; tried: Set<number> }> => {
    const fixes = new Map<number, Fix>(); const tried = new Set<number>();
    try {
      setBusy(`The Benny is placing ${idx.length} addresses that couldn’t be found…`);
      const got = await streetCandidates(idx.map(i => ({ i, house_no: list[i].house_no, street: list[i].street_name, city: list[i].city })), routes,
        n => setBusy(`The Benny is looking for the streets ${idx.length} addresses meant… ${n} of ${idx.length}`));
      const cands = got.found;
      for (const i of cands.keys()) tried.add(i);
      if (got.failed) setBennyNote(`The Benny couldn’t look at ${got.failed} of the ${idx.length} missing addresses (${got.error}). They are listed under Needs attention; run The Benny again there.`);
      const asks = idx.filter(i => (cands.get(i) || []).length).map(i => ({
        i, house_no: list[i].house_no, street: list[i].street_name, city: list[i].city, text: list[i].raw_address, candidates: cands.get(i)!,
      }));
      const placed = (await bennyPlace(asks, n => setBusy(`The Benny is placing addresses… ${n} of ${asks.length}`))).filter(p => p.street);
      if (placed.length) {
        const fixedAddr = (p: typeof placed[number]) => ({ i: p.i, house_no: p.house_no || list[p.i].house_no, street: titleCase(p.street!), unit: list[p.i].unit, city: list[p.i].city, route: list[p.i].route_given });
        const again = await matchClients(placed.map(fixedAddr));
        // a corrected address the map's own data doesn't know: one map search, then match again
        const look = placed.filter(p => !again.get(p.i)?.route_code).slice(0, 200);
        const pts = new Map<number, { lat: number; lng: number }>();
        for (let k = 0; k < look.length; k += 6) {
          await Promise.all(look.slice(k, k + 6).map(async p => {
            const a = fixedAddr(p); const g = await geocode({ ...list[p.i], house_no: a.house_no, street_name: a.street });
            if (g) pts.set(p.i, g);
          }));
        }
        if (pts.size) {
          const third = await matchClients(look.filter(p => pts.has(p.i)).map(p => ({ ...fixedAddr(p), ...pts.get(p.i)! })));
          for (const [i, r] of third) if (r.route_code) again.set(i, r);
        }
        for (const p of placed) {
          const m = again.get(p.i) || null;
          fixes.set(p.i, { house_no: (p.house_no || list[p.i].house_no).toUpperCase(), street: titleCase(p.street!), confidence: p.confidence, reason: p.reason, match: m,
            on: p.confidence !== 'low' && !!m?.route_code });
        }
      }
    } catch (e) {
      setBennyNote(`The Benny couldn’t place the missing addresses (${e instanceof Error ? e.message : String(e)}). They are listed under Needs attention; run The Benny again there.`);
    }
    return { fixes, tried };
  };

  /** Needs attention › Run The Benny again: the next addresses it hasn't looked at yet (then the rest again). */
  const rerunBenny = () => run('The Benny is placing addresses…', async () => {
    const list = matched.map(m => m.client);
    const open = matched.map((m, i) => ({ m, i })).filter(({ m }) => !effective(m).match?.route_code && !m.fix?.match?.route_code);
    const fresh = open.filter(({ m }) => !bennyTried.has(m.client.key));
    const pick = (fresh.length ? fresh : open).slice(0, BENNY_BATCH).map(({ i }) => i);
    if (!pick.length) return;
    setBennyNote(null);
    const routes = [...new Set(matched.map(m => effective(m).match?.route_code).filter((r): r is string => !!r))];
    const { fixes, tried } = await placeWithBenny(list, pick, routes);
    setBennyTried(prev => { const n = new Set(prev); for (const i of tried) n.add(list[i].key); return n; });
    setMatched(ms => ms.map((m, i) => fixes.has(i) ? { ...m, fix: fixes.get(i) } : m));
    const placedOnRoute = [...fixes.values()].filter(f => f.on).length;
    setBennyNote(n => n || `The Benny looked at ${tried.size} more address${tried.size === 1 ? '' : 'es'} and placed ${placedOnRoute} on a route${fixes.size > placedOnRoute ? ` (${fixes.size - placedOnRoute} more readings to check under Placed by The Benny)` : ''}.`);
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
    const missing = all.filter(i => !res.get(i)?.route_code).slice(0, GEOCODE_MISSING);
    if (missing.length) {
      const found = new Map<number, { lat: number; lng: number }>();
      let done = 0;
      for (let k = 0; k < missing.length; k += GEOCODE_PARALLEL) {
        await Promise.all(missing.slice(k, k + GEOCODE_PARALLEL).map(async i => { const g = await geocode(list[i]); if (g) found.set(i, g); }));
        done = Math.min(missing.length, k + GEOCODE_PARALLEL);
        setBusy(`Looking up addresses on the map… ${done} of ${missing.length}`);
      }
      if (found.size) {
        const again = await matchClients(ask([...found.keys()], found));
        for (const [i, r] of again) if (r.route_code || r.lat) res.set(i, { ...r, lat: r.lat ?? found.get(i)!.lat, lng: r.lng ?? found.get(i)!.lng });
      }
    }
    // A map point for every placed address that doesn't have one yet (placed by its street or by
    // the list's route code), so each customer shows on the map, not just on its route.
    const pointless = all.filter(i => res.get(i)?.route_code && res.get(i)?.lat == null).slice(0, GEOCODE_POINTS);
    for (let k = 0; k < pointless.length; k += GEOCODE_PARALLEL) {
      await Promise.all(pointless.slice(k, k + GEOCODE_PARALLEL).map(async i => {
        const g = await geocode(list[i]);
        if (g) res.set(i, { ...res.get(i)!, lat: g.lat, lng: g.lng });
      }));
      setBusy(`Finding map points… ${Math.min(pointless.length, k + GEOCODE_PARALLEL)} of ${pointless.length}`);
    }
    // The Benny places what's still missing: it picks which real street a misspelled address meant
    const unplaced = all.filter(i => !res.get(i)?.route_code).slice(0, BENNY_BATCH);
    setBennyNote(null);
    const routes = [...new Set([...res.values()].map(r => r.route_code).filter((r): r is string => !!r))];
    const { fixes, tried } = unplaced.length ? await placeWithBenny(list, unplaced, routes) : { fixes: new Map<number, Fix>(), tried: new Set<number>() };
    setBennyTried(new Set([...tried].map(i => list[i].key)));
    setApplied(preview);
    const nextMatched = list.map((client, i) => ({ client, match: res.get(i) || null, fix: fixes.get(i) }));
    setMatched(nextMatched);
    setStep('review');
    // The Benny looks over the results and says what stands out
    void talk(REVIEW_PROMPT, { hidden: true, stage: 'review', matchedNow: nextMatched, appliedNow: preview });
  });

  /** What The Benny is told about the upload as it stands. */
  const chatContext = (stage: string, matchedNow: Matched[] = matched, appliedNow: Applied | null = applied): Record<string, unknown> => {
    if (!src || !mapping) return {};
    const r = src.sheets[src.sheet].rows;
    const hs = (r[mapping.headerRow] || []).map(cell);
    const p = preview;
    const ctx: Record<string, unknown> = {
      file: src.fileName, tab: src.sheets[src.sheet].name, tabs: src.sheets.map(x => `${x.name} (${x.rows.length} rows)`), stage,
      columns: hs.map((h, i) => ({ i, title: h, means: mapping.columns[i]?.field || 'ignore', year: mapping.columns[i]?.year ?? undefined,
        tag: mapping.columns[i]?.tag ?? undefined, service: mapping.columns[i]?.service ?? undefined })),
      settings: { titleRow: mapping.headerRow + 1, defaultYear: mapping.defaultYear ?? null, defaultService: mapping.defaultService ?? null,
        serviceLine: mapping.serviceLine ?? null, defaultCity: mapping.defaultCity ?? null, defaultProvince: mapping.defaultProvince ?? null,
        yesValues: mapping.yesValues || [], rowsLeftOut: mapping.skipRows || [] },
      profile: profileColumns(r, mapping.headerRow).map(c => ({ i: c.i, filled: c.filled, distinct: c.distinct, top: c.top.slice(0, 5), samples: c.samples, looks: c.looks })),
      topRows: r.slice(mapping.headerRow + 1, mapping.headerRow + 13).map((row, k) => ({ row: mapping.headerRow + 2 + k, cells: (row || []).map(cell).slice(0, 40) })),
    };
    if (p) ctx.read = { rowsRead: p.rowsRead, addresses: p.clients.length, rowsWithoutAddress: p.skipped.length,
      examplesWithoutAddress: p.skipped.slice(0, 12), firstAddresses: p.clients.slice(0, 8).map(c => ({ rows: c.rows, address: `${c.house_no} ${c.street_name}`, people: c.people.length, phones: c.phones.length, history: c.history })) };
    if (stage === 'review' && matchedNow.length) {
      const eff = matchedNow.map(effective);
      const byRoute = new Map<string, number>();
      for (const m of eff) if (m.match?.route_code) byRoute.set(m.match.route_code, (byRoute.get(m.match.route_code) || 0) + 1);
      const phoneAt = new Map<string, Set<string>>();
      for (const m of eff) for (const ph of m.client.phones) { const set = phoneAt.get(ph) || new Set(); set.add(m.client.key); phoneAt.set(ph, set); }
      const how = new Map<string, number>();
      for (const m of eff) { const k = m.match?.how || 'none'; how.set(k, (how.get(k) || 0) + 1); }
      ctx.results = {
        addresses: eff.length, onRoute: eff.filter(m => m.match?.route_code).length, noRoute: eff.filter(m => !m.match?.route_code).length,
        newCustomers: eff.filter(m => !m.match?.client_id).length, existingCustomers: eff.filter(m => m.match?.client_id).length,
        withMapPoint: eff.filter(m => m.match?.lat != null).length, placedBy: Object.fromEntries(how),
        routes: [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
        routeGivenButDifferent: eff.filter(m => m.client.route_given && m.match?.route_code && m.client.route_given !== m.match.route_code).slice(0, 15)
          .map(m => ({ rows: m.client.rows, address: `${m.client.house_no} ${m.client.street_name}`, listSays: m.client.route_given, mapSays: m.match!.route_code })),
        noRouteExamples: eff.filter(m => !m.match?.route_code).slice(0, 25).map(m => ({ rows: m.client.rows, address: `${m.client.house_no} ${m.client.street_name}`, city: m.client.city, listRoute: m.client.route_given })),
        bennyReadings: matchedNow.filter(m => m.fix).slice(0, 15).map(m => ({ was: m.client.raw_address, now: `${m.fix!.house_no} ${m.fix!.street}`, route: m.fix!.match?.route_code || null, confidence: m.fix!.confidence })),
        samePhoneSeveralAddresses: [...phoneAt.values()].filter(x => x.size > 1).length,
        rowsCombined: Math.max(0, (appliedNow?.rowsRead || 0) - (appliedNow?.skipped.length || 0) - eff.length),
      };
    }
    return ctx;
  };

  /** One turn of the chat: send what was said (and the upload as it stands), apply any changes. */
  const talk = async (text: string, opts: { hidden?: boolean; stage?: string; matchedNow?: Matched[]; appliedNow?: Applied | null } = {}) => {
    if (!mapping) return;
    const said: ChatMessage = { role: 'user', text, hidden: opts.hidden };
    const history = [...chat, said];
    setChat(history); setChatBusy(true);
    try {
      const stage = opts.stage || step;
      const res = await bennyChat(history.filter(m => !m.error).map(m => ({ role: m.role, text: m.changes?.length ? `${m.text}\n(Changed: ${m.changes.join('; ')})` : m.text })),
        chatContext(stage, opts.matchedNow, opts.appliedNow));
      const { mapping: next, changes } = applyChatActions(mapping, res.actions, (rows[mapping.headerRow] || []).map(cell));
      if (changes.length) {
        setMapping(next);
        if (stage === 'review') { setStep('columns'); setBennyNote('The Benny changed the layout, so the addresses need matching again: check the columns, then Next: match to routes.'); }
      }
      setChat(c => [...c, { role: 'assistant', text: res.reply || (changes.length ? 'Done.' : 'I don’t have anything to add.'), changes }]);
    } catch (e) {
      setChat(c => [...c, { role: 'assistant', text: `I couldn’t answer just now (${e instanceof Error ? e.message : String(e)}).`, error: true }]);
    } finally { setChatBusy(false); }
  };

  const counts = useMemo(() => {
    const n = { rowsRead: applied?.rowsRead || 0, clients: matched.length, skipped: applied?.skipped.length || 0, combined: 0, fresh: 0, merge: 0, routed: 0, unrouted: 0, fixed: 0, suggested: 0 };
    n.combined = Math.max(0, n.rowsRead - n.skipped - n.clients);
    for (const raw of matched) {
      const m = effective(raw);
      if (m.match?.client_id) n.merge++; else n.fresh++;
      if (m.match?.route_code) n.routed++; else n.unrouted++;
      if (raw.fix) { n.suggested++; if (raw.fix.on) n.fixed++; }
    }
    return n;
  }, [applied, matched]);

  const approve = () => src && mapping && run('Saving…', async () => {
    const chosen = matched.map(effective).filter(m => includeUnrouted || m.match?.route_code);
    const toRow = ({ client: c, match: m, fixed }: ReturnType<typeof effective>): ImportRow => ({
      house_no: c.house_no, street_name: c.street_name, unit: c.unit, city: c.city, province: c.province, postal_code: c.postal_code,
      lat: m?.lat ?? null, lng: m?.lng ?? null, route_code: m?.route_code ?? null, match_how: fixed && m?.how ? `${m.how}_benny` : m?.how ?? null,
      people: c.people, phones: c.phones, emails: c.emails, history: c.history, tags: c.tags,
      notes: [c.notes, fixed ? `Address on the list: “${c.raw_address}”, corrected by The Benny.` : ''].filter(Boolean).join('\n'),
      call_first: c.call_first, do_not_call: c.do_not_call, do_not_text: c.do_not_text,
    });
    const res = await commitImport({
      fileName: src.fileName, source: src.kind, sheetUrl: src.sheetUrl, fingerprint: lookupFp || fingerprint(headers), recipeName: recipeName || src.fileName,
      headers, mapping, rows: chosen.map(toRow),
      counts: { rows_read: counts.rowsRead, clients_in_file: counts.clients, rows_combined: counts.combined, rows_skipped: counts.skipped, on_route: counts.routed, needs_attention: counts.unrouted, left_out: matched.length - chosen.length },
    }, n => setBusy(`Saving… ${n} of ${chosen.length}`));
    setResult(res); setStep('done'); imports.reload(); recipes.reload();
  });

  const reset = () => { setStep('source'); setSrc(null); setMapping(null); setRecipe(null); setApplied(null); setMatched([]); setResult(null); setFixed(new Map()); setLink(''); setBennyNote(null); setChat([]); };

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

      {(step === 'columns' || step === 'review') && src && mapping && (
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '999 1 640px', minWidth: 0 }}>
      {step === 'columns' && preview && (
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
            <div className="v2-row" style={{ marginTop: 12, gap: 8 }}>
              <b>These are past clients of</b>
              {SERVICE_LINES.map(l => (
                <button key={l.key} type="button" className={`v2-chip${mapping.serviceLine === l.key ? ' on' : ''}`}
                  onClick={() => setMapping({ ...mapping, serviceLine: l.key as ServiceLine })}>{l.label}</button>
              ))}
              {!mapping.serviceLine && <span className="v2-small" style={{ color: '#b45309' }}>Pick the service. Each route keeps a separate past-client list per service.</span>}
            </div>
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
            <Btn disabled={!!busy || preview.clients.length === 0 || !mapping.serviceLine} onClick={matchAll}>Next: match to routes</Btn>
          </div>
        </div>
      )}

      {step === 'review' && src && (
        <Review counts={counts} matched={matched} skipped={applied?.skipped || []} busy={!!busy} note={bennyNote}
          bennyLeft={matched.filter(m => !effective(m).match?.route_code && !m.fix?.match?.route_code && !bennyTried.has(m.client.key)).length}
          bennyOpen={matched.filter(m => !effective(m).match?.route_code && !m.fix?.match?.route_code).length}
          busyLabel={busy} onRerunBenny={rerunBenny}
          onToggleFix={key => setMatched(ms => ms.map(m => m.client.key === key && m.fix ? { ...m, fix: { ...m.fix, on: !m.fix.on } } : m))}
          recipeName={recipeName} setRecipeName={setRecipeName} includeUnrouted={includeUnrouted} setIncludeUnrouted={setIncludeUnrouted}
          onBack={() => setStep('columns')} onApprove={approve} />
      )}
      </div>
      <div style={{ flex: '1 1 320px', maxWidth: 420, minWidth: 0 }}>
        <BennyChat messages={chat} busy={chatBusy} disabled={!!busy}
          suggestions={chat.filter(m => m.role === 'user').length ? [] : step === 'review'
            ? ['Why do some addresses have no route?', 'Which rows were combined?']
            : ['What’s in this file?', 'Which columns did you skip?', 'Why were some rows left out?']}
          onSend={t => { void talk(t); }} />
      </div>
      </div>
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
  counts: { rowsRead: number; clients: number; skipped: number; combined: number; fresh: number; merge: number; routed: number; unrouted: number; fixed: number; suggested: number };
  matched: Matched[]; skipped: Applied['skipped']; busy: boolean; note: string | null; onToggleFix: (key: string) => void;
  /** needs-attention addresses The Benny hasn't looked at yet / still without a route */
  bennyLeft: number; bennyOpen: number; busyLabel: string | null; onRerunBenny: () => void;
  recipeName: string; setRecipeName: (s: string) => void;
  includeUnrouted: boolean; setIncludeUnrouted: (b: boolean) => void; onBack: () => void; onApprove: () => void;
}> = ({ counts, matched, skipped, busy, note, onToggleFix, bennyLeft, bennyOpen, busyLabel, onRerunBenny, recipeName, setRecipeName, includeUnrouted, setIncludeUnrouted, onBack, onApprove }) => {
  const [tab, setTab] = useState<'new' | 'merge' | 'fixed' | 'attention' | 'skipped'>('new');
  const eff = matched.map(effective);
  const list = tab === 'new' ? eff.filter(m => !m.match?.client_id) : tab === 'merge' ? eff.filter(m => m.match?.client_id)
    : tab === 'attention' ? eff.filter(m => !m.match?.route_code) : [];
  const fixes = matched.filter(m => m.fix);
  const willImport = includeUnrouted ? counts.clients : counts.routed;
  return (
    <div className="v2-stack">
      <div className="v2-grid4">
        {[['Rows read', counts.rowsRead, ''], ['Clients (one per address)', counts.clients, `${counts.combined} duplicate rows combined`],
          ['New', counts.fresh, ''], ['Merge into existing', counts.merge, ''],
          ['On a route', counts.routed, counts.fixed ? `${counts.fixed} placed by The Benny` : ''], ['Needs attention', counts.unrouted, 'no route found'], ['Rows skipped', counts.skipped, 'no usable address'],
          ['Will be imported', willImport, '']].map(([label, n, sub]) => (
          <div key={String(label)} className="v2-card"><div className="v2-card-h">{label}</div><div className="v2-kpi">{n}</div>{sub && <div className="v2-note" style={{ marginTop: 0 }}>{sub}</div>}</div>
        ))}
      </div>
      <div className="v2-card" style={{ padding: 0 }}>
        <div style={{ padding: '10px 12px 0' }}>
          <Tabs value={tab} onChange={setTab} items={[{ key: 'new', label: 'New', count: counts.fresh }, { key: 'merge', label: 'Merging', count: counts.merge },
            { key: 'fixed', label: 'Placed by The Benny', count: counts.suggested },
            { key: 'attention', label: 'Needs attention', count: counts.unrouted }, { key: 'skipped', label: 'Skipped rows', count: counts.skipped }]} />
          {note && <div className="v2-note" style={{ margin: '0 0 8px' }}>{note}</div>}
          {tab === 'attention' && bennyOpen > 0 && (
            <div className="v2-row" style={{ margin: '0 0 10px', gap: 10 }}>
              <Btn size="sm" icon={Sparkles} disabled={busy} onClick={onRerunBenny}>
                {busy && busyLabel ? busyLabel : `Run The Benny again on ${Math.min(BENNY_BATCH, bennyLeft || bennyOpen).toLocaleString()} address${Math.min(BENNY_BATCH, bennyLeft || bennyOpen) === 1 ? '' : 'es'}`}
              </Btn>
              <span className="v2-small v2-mut">{bennyLeft
                ? `${bennyLeft.toLocaleString()} it hasn’t looked at yet${bennyLeft > BENNY_BATCH ? `, ${BENNY_BATCH} at a time` : ''}. It picks the real street a misspelled address meant; check its readings under Placed by The Benny.`
                : `It has looked at all ${bennyOpen.toLocaleString()}; this tries the ones still without a route again.`}</span>
            </div>
          )}
        </div>
        <div className="v2-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
          {tab === 'fixed' ? (
            <table className="v2-table"><thead><tr><th>On the list</th><th>The Benny’s reading</th><th>Route</th><th>Why</th><th>Use it</th></tr></thead>
              <tbody>{fixes.slice(0, 300).map(m => (
                <tr key={m.client.key} style={{ opacity: m.fix!.on ? 1 : 0.6 }}>
                  <td className="v2-mut">{m.client.raw_address || `${m.client.house_no} ${m.client.street_name}`}{m.client.city && `, ${m.client.city}`}</td>
                  <td><b>{m.fix!.house_no} {m.fix!.street}</b> <Tag tone={m.fix!.confidence === 'high' ? 'g' : m.fix!.confidence === 'medium' ? 'b' : 'a'}>{m.fix!.confidence}</Tag></td>
                  <td>{m.fix!.match?.route_code ? <b>{m.fix!.match.route_code}</b> : <Tag tone="a">Still no route</Tag>}</td>
                  <td className="v2-small v2-mut">{m.fix!.reason}</td>
                  <td><Toggle on={m.fix!.on} onChange={() => onToggleFix(m.client.key)} label={`Use The Benny’s reading for ${m.client.raw_address}`} /></td>
                </tr>
              ))}
              {fixes.length === 0 && <tr><td colSpan={5} className="v2-mut" style={{ textAlign: 'center', padding: 20 }}>Every address was found as written.</td></tr>}</tbody></table>
          ) : tab === 'skipped' ? (
            <table className="v2-table"><thead><tr><th>Row</th><th>Why</th><th>What it said</th></tr></thead>
              <tbody>{skipped.slice(0, 300).map(s => <tr key={s.row}><td>{s.row}</td><td>{s.reason}</td><td className="v2-mut">{s.text || '—'}</td></tr>)}</tbody></table>
          ) : (
            <table className="v2-table">
              <thead><tr><th>Address</th><th>Route</th><th>People</th><th>Phones</th><th>History</th><th>Flags</th><th>Rows</th></tr></thead>
              <tbody>{list.slice(0, 300).map(({ client: c, match: m, fixed }) => (
                <tr key={c.key}>
                  <td><b>{c.house_no} {c.street_name}</b>{c.unit && ` Unit ${c.unit}`}{fixed && <> <Tag tone="v">fixed</Tag></>}<div className="v2-small v2-mut">{[c.city, c.province, c.postal_code].filter(Boolean).join(', ')}</div></td>
                  <td>{m?.route_code ? <><b>{m.route_code}</b><div className="v2-small v2-mut">{HOW[m.how || ''] || ''}</div></> : <Tag tone="a">No route</Tag>}</td>
                  <td className="v2-small">{c.people.map(p => `${p.first} ${p.last}`.trim()).join(', ') || '—'}</td>
                  <td className="v2-small">{c.phones.map(formatPhone).join(', ') || '—'}</td>
                  <td className="v2-small">{c.history.map(h => [h.year, h.service || (h.line && lineLabel(h.line)), h.price && `$${h.price}`].filter(Boolean).join(' ')).join(' · ') || '—'}
                    {[...new Set(c.history.map(h => h.line).filter(Boolean))].map(l => <span key={l} style={{ marginLeft: 6 }}><Tag tone="b">{lineLabel(l)}</Tag></span>)}</td>
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
