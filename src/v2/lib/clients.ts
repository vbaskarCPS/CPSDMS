// src/v2/lib/clients.ts — clients (one per address), client-list imports, recipes and The Benny.
import { db, must } from './client';
import { cell, profileColumns, sanitizeMapping, type ClientRow, type ImportCheck, type Mapping } from './clientImport';
import type { AuditResult, AuditRow, ImportSummary } from './importGuard';

// ─── The Benny ──────────────────────────────────────────────────────────────
async function benny<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke('benny', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') { try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* keep message */ } }
    if (/Failed to send a request|FunctionsFetchError/i.test(msg)) msg = 'The Benny isn’t set up on the server yet (edge function “benny”).';
    throw new Error(msg);
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error));
  return data as T;
}

/**
 * The Benny reads the layout: the top 60 rows of the tab plus a profile of every column over the
 * whole file (fill, common values, samples from further down), so look-alike columns are told apart.
 * Besides the layout it can come back with a few questions for the person importing.
 */
export async function bennyMap(fileName: string, rows: unknown[][], headerRow: number, tabs?: { names: string[]; current: string }, fingerprint?: string): Promise<Mapping & { questions: string[] }> {
  const start = Math.max(0, headerRow - 3);
  const sample = rows.slice(start, start + 60).map(r => (r || []).map(cell));
  const profile = profileColumns(rows, headerRow);
  const res = await benny<{ mapping: unknown }>({ task: 'map', fileName, rows: sample, profile, sheetNames: tabs?.names, sheetName: tabs?.current, fingerprint });
  const m = sanitizeMapping(res.mapping, Math.max(...rows.slice(0, 40).map(r => (r || []).length), 0));
  const raw = (res.mapping || {}) as { questions?: unknown };
  const questions = Array.isArray(raw.questions) ? raw.questions.filter((q): q is string => typeof q === 'string' && !!q.trim()).slice(0, 4) : [];
  return { ...m, headerRow: m.headerRow + start, questions };
}

/** One turn of the upload chat: what was said so far (newest last) and the upload as it stands. */
export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface ChatAction { tool: 'set_columns' | 'set_list_settings' | 'skip_rows' | 'propose_lesson'; input: Record<string, unknown> }
export async function bennyChat(messages: ChatTurn[], context: Record<string, unknown>, fingerprint?: string): Promise<{ reply: string; actions: ChatAction[] }> {
  const res = await benny<{ reply?: string; actions?: ChatAction[] }>({ task: 'chat', messages, context, fingerprint });
  return { reply: (res.reply || '').trim(), actions: Array.isArray(res.actions) ? res.actions : [] };
}

export interface FixedAddress { i: number; house_no: string; street: string; unit?: string; city?: string; province?: string; postal_code?: string }
export async function bennyFixAddresses(items: { i: number; text: string }[]): Promise<FixedAddress[]> {
  const out: FixedAddress[] = [];
  for (let k = 0; k < items.length; k += 150) {
    const res = await benny<{ items: FixedAddress[] }>({ task: 'fix_addresses', items: items.slice(k, k + 150) });
    out.push(...(res.items || []).filter(x => x && x.house_no && x.street));
  }
  return out;
}

export interface Candidate { street: string; near: boolean; score: number }
export interface Placement { i: number; house_no: string; street: string | null; confidence: 'high' | 'medium' | 'low'; reason: string }

/**
 * Real street names an unplaced address most likely meant (from the map's streets). 50 addresses
 * per request keeps each one well inside the database's time limit; a batch that still fails is
 * skipped (those addresses stay under Needs attention) instead of stopping the rest.
 */
export async function streetCandidates(items: { i: number; house_no: string; street: string; city: string }[], routes: string[],
  onProgress?: (done: number) => void): Promise<{ found: Map<number, Candidate[]>; failed: number; error: string | null }> {
  const found = new Map<number, Candidate[]>();
  let failed = 0; let error: string | null = null;
  for (let k = 0; k < items.length; k += 50) {
    const batch = items.slice(k, k + 50);
    try {
      const res = must(await db.rpc('app_client_street_candidates', { p_items: batch, p_routes: routes })) as { i: number; candidates: Candidate[] }[];
      for (const r of res) found.set(Number(r.i), r.candidates || []);
    } catch (e) { failed += batch.length; error = e instanceof Error ? e.message : String(e); }
    onProgress?.(Math.min(items.length, k + 50));
  }
  return { found, failed, error };
}

/** The Benny picks which real street each misspelled address meant (or none). */
export async function bennyPlace(items: { i: number; house_no: string; street: string; city: string; text: string; candidates: Candidate[] }[],
  onProgress?: (done: number) => void): Promise<Placement[]> {
  const out: Placement[] = [];
  let lastError: unknown = null;
  for (let k = 0; k < items.length; k += 80) {
    try {
      const res = await benny<{ items: Placement[] }>({ task: 'place_addresses', items: items.slice(k, k + 80) });
      out.push(...(res.items || []));
    } catch (e) { lastError = e; }   // one batch failing doesn't lose the others
    onProgress?.(Math.min(items.length, k + 80));
  }
  if (!out.length && lastError) throw lastError;
  return out;
}

/** The Benny compares rows as the sheet has them with how they were read, and says which look wrong. */
export async function bennyAudit(p: { fileName: string; serviceLine: string | null; columns: { title: string; means: string }[]; rows: AuditRow[] }): Promise<AuditResult> {
  const res = await benny<{ problems?: { row: number; what: string }[]; checked?: number }>({ task: 'audit', ...p });
  const rows = new Set(p.rows.map(r => r.row));
  const problems = (Array.isArray(res.problems) ? res.problems : [])
    .filter(x => x && rows.has(Number(x.row)) && typeof x.what === 'string' && x.what.trim())
    .map(x => ({ row: Number(x.row), what: x.what.trim().slice(0, 300) }));
  return { state: 'done', checked: p.rows.length, problems };
}

export async function fetchSheetCsv(url: string): Promise<string> {
  return (await benny<{ csv: string }>({ task: 'fetch_sheet', url })).csv;
}

// ─── reading files ──────────────────────────────────────────────────────────
export interface Sheet { name: string; rows: unknown[][] }
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => {
    showFullDates(wb.Sheets[name]);
    return { name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }) };
  }).filter(s => s.rows.length > 0);
}

/**
 * Cells are read as they're shown, so a real date formatted "27-May" or "May 27" would arrive
 * with its year hidden (and a browser then guesses 2001). Every true date cell is shown as the
 * full date instead (2024-05-27); times of day (no calendar date) keep their own text.
 */
export function showFullDates(sheet: Record<string, unknown>): void {
  for (const [addr, c] of Object.entries(sheet)) {
    if (addr.startsWith('!')) continue;
    const cellObj = c as { t?: string; v?: unknown; w?: string };
    if (cellObj?.t !== 'd' || !(cellObj.v instanceof Date) || isNaN(cellObj.v.getTime())) continue;
    const d = cellObj.v;
    if (d.getFullYear() < 1905) continue;   // a time of day (Excel's day 0 is 1899/1900)
    cellObj.w = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
export async function parseCsv(text: string): Promise<unknown[][]> {
  const Papa = (await import('papaparse')).default;
  return Papa.parse<unknown[]>(text, { skipEmptyLines: 'greedy' }).data;
}

/** A file's fingerprint for spotting the same file twice (SHA-256 of its bytes; the tab is added when importing). */
export async function fileHash(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── recipes ────────────────────────────────────────────────────────────────
export interface Recipe { id: string; fingerprint: string; name: string; headers: string[]; mapping: Mapping; notes: string | null; times_used: number; last_used_at: string | null; active: boolean; created_at: string }
export async function findRecipe(fp: string): Promise<Recipe | null> {
  return must(await db.from('client_import_recipes').select('*').eq('fingerprint', fp).eq('active', true).maybeSingle()) as Recipe | null;
}
export async function listRecipes(): Promise<Recipe[]> {
  return must(await db.from('client_import_recipes').select('*').order('last_used_at', { ascending: false, nullsFirst: false })) as Recipe[];
}
export async function updateRecipe(id: string, name: string | null, active: boolean | null): Promise<void> {
  must(await db.rpc('app_client_recipe_update', { p_id: id, p_name: name, p_active: active }));
}

// ─── matching ───────────────────────────────────────────────────────────────
export interface MatchResult { i: number; street_norm: string | null; route_code: string | null; lat: number | null; lng: number | null; how: string | null; client_id: string | null }

export async function matchClients(list: { i: number; house_no: string; street: string; unit: string; city: string; lat?: number | null; lng?: number | null; route?: string }[],
  onProgress?: (done: number) => void): Promise<Map<number, MatchResult>> {
  const out = new Map<number, MatchResult>();
  // 200 per request keeps each well inside the 8-second limit on a request
  for (let k = 0; k < list.length; k += 200) {
    const res = must(await db.rpc('app_client_match', { p_rows: list.slice(k, k + 200) })) as MatchResult[];
    for (const r of res) out.set(Number(r.i), r);
    onProgress?.(Math.min(list.length, k + 200));
  }
  return out;
}

/** Mapbox lookup for an address the map's own address data doesn't know. */
export async function geocode(c: Pick<ClientRow, 'house_no' | 'street_name' | 'city' | 'province' | 'postal_code'>): Promise<{ lat: number; lng: number } | null> {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env || {};
  const token = env.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  const q = [`${c.house_no} ${c.street_name}`, c.city, c.province, c.postal_code, 'Canada'].filter(Boolean).join(', ');
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=1&country=ca&types=address`);
    if (!res.ok) return null;
    const f = (await res.json()).features?.[0];
    if (!f || (f.relevance ?? 0) < 0.8 || String(f.address || '') !== c.house_no.replace(/[A-Z]$/, '')) return null;
    return { lat: f.center[1], lng: f.center[0] };
  } catch { return null; }
}

// ─── imports ────────────────────────────────────────────────────────────────
export interface ImportRow {
  house_no: string; street_name: string; unit: string; city: string; province: string; postal_code: string;
  lat: number | null; lng: number | null; route_code: string | null; match_how: string | null;
  people: { first: string; last: string; phone?: string }[]; phones: string[]; emails: string[];
  history: { year: number | null; service: string; price: string; contractor: string; payment: string; line: string }[];
  tags: string[]; notes: string; call_first: string; do_not_call: boolean; do_not_text: boolean;
}

export async function commitImport(p: {
  fileName: string; source: 'file' | 'sheet'; sheetUrl: string | null; fingerprint: string; recipeName: string;
  headers: string[]; mapping: Mapping; rows: ImportRow[]; counts: Record<string, number>;
}, onProgress?: (done: number) => void): Promise<{ id: string; inserted: number; merged: number }> {
  const id = must(await db.rpc('app_client_import_begin', {
    p_file: p.fileName, p_source: p.source, p_sheet_url: p.sheetUrl, p_fingerprint: p.fingerprint, p_recipe_name: p.recipeName,
    p_headers: p.headers, p_mapping: p.mapping, p_notes: p.mapping.notes || null,
  })) as string;
  let inserted = 0, merged = 0;
  for (let k = 0; k < p.rows.length; k += 500) {
    const res = must(await db.rpc('app_client_import_add', { p_import: id, p_rows: p.rows.slice(k, k + 500) })) as { inserted: number; merged: number };
    inserted += res.inserted; merged += res.merged;
    onProgress?.(Math.min(p.rows.length, k + 500));
  }
  must(await db.rpc('app_client_import_finish', { p_import: id, p_counts: { ...p.counts, inserted, merged } }));
  return { id, inserted, merged };
}

export interface ImportRecord { id: string; file_name: string; source: string; sheet_url: string | null; status: 'staged' | 'running' | 'done' | 'undone' | 'cancelled'; counts: Record<string, unknown>; created_at: string; finished_at: string | null; undone_at: string | null; recipe: { name: string } | null }
export async function listImports(): Promise<ImportRecord[]> {
  return must(await db.from('client_imports').select('id, file_name, source, sheet_url, status, counts, created_at, finished_at, undone_at, recipe:client_import_recipes(name)')
    .order('created_at', { ascending: false }).limit(50)) as unknown as ImportRecord[];
}
export async function undoImport(id: string): Promise<{ removed: number; restored: number; kept?: number }> {
  return must(await db.rpc('app_client_import_undo', { p_import: id })) as { removed: number; restored: number; kept?: number };
}

// ─── the safe import: open → hold the rows → preview → save → complete ─────
export type StagedRow = ImportRow & { source?: { row: number; cells: Record<string, string> }[] };
export interface ImportPreview {
  inserted: number; merged: number; nothing_new: number;
  jobs_added: Record<string, number>;     // "line|year" → jobs
  jobs_filled: Record<string, number>;    // "line|year" → saved jobs that get details filled in
  phones_added: number; people_added: number; routes_set: number;
  examples: { address: string; city: string | null; added: unknown[] | null; filled: { was: unknown; now: unknown }[] | null }[];
}
const addCounts = (a: Record<string, number>, b: Record<string, number> = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + Number(v); return o; };

export async function openImport(p: { fileName: string; source: 'file' | 'sheet'; sheetUrl: string | null; fingerprint: string; recipeName: string;
  headers: string[]; mapping: Mapping; fileHash: string | null; checks: ImportCheck[]; audit: AuditResult | null }): Promise<string> {
  return must(await db.rpc('app_client_import_open', {
    p_file: p.fileName, p_source: p.source, p_sheet_url: p.sheetUrl, p_fingerprint: p.fingerprint, p_recipe_name: p.recipeName,
    p_headers: p.headers, p_mapping: p.mapping, p_notes: p.mapping.notes || null, p_file_hash: p.fileHash, p_checks: p.checks, p_audit: p.audit,
  })) as string;
}
export async function sameFileImports(hash: string): Promise<{ id: string; file_name: string; created_at: string; status: string }[]> {
  return (must(await db.rpc('app_client_import_same_file', { p_hash: hash })) as { id: string; file_name: string; created_at: string; status: string }[]) || [];
}
export async function stageImport(id: string, rows: StagedRow[], onProgress?: (done: number) => void): Promise<void> {
  for (let k = 0; k < rows.length; k += 500) {
    must(await db.rpc('app_client_import_stage', { p_import: id, p_rows: rows.slice(k, k + 500) }));
    onProgress?.(Math.min(rows.length, k + 500));
  }
}
/** What saving would do, worked out on the server by saving and rolling back, 300 rows at a time. */
export async function previewImport(id: string, total: number, onProgress?: (done: number) => void): Promise<ImportPreview> {
  let out: ImportPreview = { inserted: 0, merged: 0, nothing_new: 0, jobs_added: {}, jobs_filled: {}, phones_added: 0, people_added: 0, routes_set: 0, examples: [] };
  for (let k = 0; k < total; k += 300) {
    const p = must(await db.rpc('app_client_import_preview', { p_import: id, p_from: k, p_count: 300 })) as ImportPreview;
    out = {
      inserted: out.inserted + Number(p.inserted || 0), merged: out.merged + Number(p.merged || 0), nothing_new: out.nothing_new + Number(p.nothing_new || 0),
      jobs_added: addCounts(out.jobs_added, p.jobs_added), jobs_filled: addCounts(out.jobs_filled, p.jobs_filled),
      phones_added: out.phones_added + Number(p.phones_added || 0), people_added: out.people_added + Number(p.people_added || 0),
      routes_set: out.routes_set + Number(p.routes_set || 0), examples: out.examples.length >= 8 ? out.examples : [...out.examples, ...(p.examples || [])].slice(0, 8),
    };
    onProgress?.(Math.min(total, k + 300));
  }
  return out;
}
/** Save the held rows (picks up where it stopped if it was interrupted), then finish the import. */
export async function saveImport(id: string, counts: Record<string, unknown>, onProgress?: (remaining: number) => void): Promise<{ inserted: number; merged: number }> {
  for (let guard = 0; guard < 10000; guard++) {
    const r = must(await db.rpc('app_client_import_apply', { p_import: id, p_count: 300 })) as { remaining: number };
    onProgress?.(Number(r.remaining));
    if (!Number(r.remaining)) break;
  }
  const res = must(await db.rpc('app_client_import_complete', { p_import: id, p_counts: counts })) as { inserted: number; merged: number };
  return { inserted: Number(res.inserted || 0), merged: Number(res.merged || 0) };
}
export async function cancelImport(id: string): Promise<void> {
  must(await db.rpc('app_client_import_cancel', { p_import: id }));
}
/** The shape of the last finished import with this layout, to compare a new file with. */
export async function layoutBaseline(recipeId: string): Promise<{ summary: ImportSummary; at: string } | null> {
  const rows = must(await db.from('client_imports').select('counts, finished_at').eq('recipe_id', recipeId).eq('status', 'done')
    .order('finished_at', { ascending: false }).limit(1)) as { counts: { summary?: ImportSummary }; finished_at: string }[];
  const r = rows?.[0];
  return r?.counts?.summary ? { summary: r.counts.summary, at: r.finished_at } : null;
}

// ─── The Benny's lessons ───────────────────────────────────────────────────
export interface Lesson { id: string; text: string; fingerprint: string | null; layout_name: string | null; active: boolean; created_at: string }
export async function listLessons(): Promise<Lesson[]> {
  return (must(await db.rpc('app_benny_lessons_all')) as Lesson[]) || [];
}
export async function saveLesson(p: { id?: string | null; text?: string | null; fingerprint?: string | null; layoutName?: string | null; active?: boolean | null }): Promise<string> {
  return must(await db.rpc('app_benny_lesson_save', { p_id: p.id ?? null, p_text: p.text ?? null, p_fingerprint: p.fingerprint ?? null,
    p_layout_name: p.layoutName ?? null, p_active: p.active ?? null })) as string;
}

// ─── data health ───────────────────────────────────────────────────────────
interface HealthExample { id: string; address: string; city: string | null; job: Record<string, unknown>; why?: string; same_as?: Record<string, unknown> }
export interface HealthReport {
  clients: number; jobs: number;
  bad_jobs: { count: number; examples: HealthExample[] };
  duplicate_jobs: { count: number; examples: HealthExample[] };
  routes_behind: { count: number; routes: string[]; by_service: Record<string, number> };
}
export interface Health { ran_at: string | null; report: HealthReport | null; pending_since: string | null }
export async function latestHealth(): Promise<Health> {
  return (must(await db.rpc('app_client_integrity_latest')) as Health) || { ran_at: null, report: null, pending_since: null };
}
export async function checkHealthNow(): Promise<Health> {
  return must(await db.rpc('app_client_integrity_run_now')) as Health;
}
/** Rebuild routes' past-client map lists, 25 at a time. */
export async function rebuildRoutes(routes: string[], onProgress?: (done: number) => void): Promise<void> {
  for (let k = 0; k < routes.length; k += 25) {
    must(await db.rpc('app_client_refresh_routes', { p_routes: routes.slice(k, k + 25) }));
    onProgress?.(Math.min(routes.length, k + 25));
  }
}
export async function finishStuckImport(id: string): Promise<void> {
  must(await db.rpc('app_client_import_finish', { p_import: id, p_counts: { note: 'finished after an interrupted upload' } }));
}

// ─── clients ────────────────────────────────────────────────────────────────
/** Client counts by city › route map › route (a route map sits under the city most of its clients are in). */
export interface TreeRoute { code: string; n: number }
export interface TreeArea { name: string | null; region: string | null; n: number; routes: TreeRoute[] }
export interface TreeCity { city: string; n: number; areas: TreeArea[]; noRoute: number }
export async function clientTree(service?: string): Promise<TreeCity[]> {
  const rows = must(await db.rpc('app_client_tree', { p_service: service || null })) as
    { city: string; area_name: string | null; region: string | null; route_code: string | null; clients: number }[];
  return buildTree(rows);
}
export function buildTree(rows: { city: string; area_name: string | null; region: string | null; route_code: string | null; clients: number }[]): TreeCity[] {
  const num = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const cities = new Map<string, TreeCity>();
  for (const r of rows) {
    const c = cities.get(r.city) || { city: r.city, n: 0, areas: [], noRoute: 0 };
    cities.set(r.city, c);
    c.n += r.clients;
    if (!r.route_code) { c.noRoute += r.clients; continue; }
    let a = c.areas.find(x => x.name === r.area_name);
    if (!a) { a = { name: r.area_name, region: r.region, n: 0, routes: [] }; c.areas.push(a); }
    a.n += r.clients; a.routes.push({ code: r.route_code, n: r.clients });
  }
  for (const c of cities.values()) {
    c.areas.sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || num(a.name || '', b.name || ''));
    for (const a of c.areas) a.routes.sort((x, y) => num(x.code, y.code));
  }
  return [...cities.values()].sort((a, b) => (a.city ? 0 : 1) - (b.city ? 0 : 1) || num(a.city, b.city));
}

export interface Client {
  id: string; house_no: string; street_name: string; unit: string | null; city: string | null; province: string | null; postal_code: string | null;
  lat: number | null; lng: number | null; route_code: string | null; match_how: string | null;
  people: { first: string; last: string; phone?: string }[]; phones: string[]; emails: string[];
  history: { year: number | null; service: string; price: string; contractor: string; payment: string; line?: string }[];
  services: string[];
  tags: string[]; notes: string | null; call_first: string | null; do_not_call: boolean; do_not_text: boolean; updated_at: string;
}
export async function listClients(opts: { q?: string; route?: string; noRoute?: boolean; service?: string; city?: string; page?: number; pageSize?: number }): Promise<{ rows: Client[]; total: number }> {
  const size = opts.pageSize || 100; const from = (opts.page || 0) * size;
  let qb = db.from('clients').select('*', { count: 'exact' });
  if (opts.service) qb = qb.contains('services', [opts.service]);
  if (opts.city !== undefined) qb = opts.city ? qb.ilike('city', opts.city.replace(/[%_]/g, '\\$&')) : qb.or('city.is.null,city.eq.');
  if (opts.noRoute) qb = qb.is('route_code', null);
  else if (opts.route) qb = qb.eq('route_code', opts.route.toUpperCase());
  const q = (opts.q || '').trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const term = digits.length >= 7 && digits.length === q.replace(/[\s().+-]/g, '').length ? digits.slice(-10) : q.replace(/[%_,()]/g, ' ').trim().replace(/\s+/g, '%');
    qb = qb.ilike('search_text', `%${term}%`);
  }
  const res = await qb.order('street_norm').order('house_no').range(from, from + size - 1);
  if (res.error) throw new Error(res.error.message);
  return { rows: (res.data || []) as Client[], total: res.count || 0 };
}
