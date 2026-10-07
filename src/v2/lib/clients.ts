// src/v2/lib/clients.ts — clients (one per address), client-list imports, recipes and The Benny.
import { db, must } from './client';
import { cell, sanitizeMapping, type ClientRow, type Mapping } from './clientImport';

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

export async function bennyMap(fileName: string, rows: unknown[][], headerRow: number): Promise<Mapping> {
  const start = Math.max(0, headerRow - 3);
  const sample = rows.slice(start, start + 28).map(r => (r || []).map(cell));
  const res = await benny<{ mapping: unknown }>({ task: 'map', fileName, rows: sample });
  const m = sanitizeMapping(res.mapping, Math.max(...rows.slice(0, 40).map(r => (r || []).length), 0));
  return { ...m, headerRow: m.headerRow + start };
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

export async function fetchSheetCsv(url: string): Promise<string> {
  return (await benny<{ csv: string }>({ task: 'fetch_sheet', url })).csv;
}

// ─── reading files ──────────────────────────────────────────────────────────
export interface Sheet { name: string; rows: unknown[][] }
export async function readWorkbook(file: File): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map(name => ({
    name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }),
  })).filter(s => s.rows.length > 0);
}
export async function parseCsv(text: string): Promise<unknown[][]> {
  const Papa = (await import('papaparse')).default;
  return Papa.parse<unknown[]>(text, { skipEmptyLines: 'greedy' }).data;
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
  for (let k = 0; k < list.length; k += 400) {
    const res = must(await db.rpc('app_client_match', { p_rows: list.slice(k, k + 400) })) as MatchResult[];
    for (const r of res) out.set(Number(r.i), r);
    onProgress?.(Math.min(list.length, k + 400));
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
  people: { first: string; last: string }[]; phones: string[]; emails: string[];
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

export interface ImportRecord { id: string; file_name: string; source: string; sheet_url: string | null; status: 'running' | 'done' | 'undone'; counts: Record<string, number>; created_at: string; finished_at: string | null; undone_at: string | null; recipe: { name: string } | null }
export async function listImports(): Promise<ImportRecord[]> {
  return must(await db.from('client_imports').select('id, file_name, source, sheet_url, status, counts, created_at, finished_at, undone_at, recipe:client_import_recipes(name)')
    .order('created_at', { ascending: false }).limit(50)) as unknown as ImportRecord[];
}
export async function undoImport(id: string): Promise<{ removed: number; restored: number }> {
  return must(await db.rpc('app_client_import_undo', { p_import: id })) as { removed: number; restored: number };
}
export async function finishStuckImport(id: string): Promise<void> {
  must(await db.rpc('app_client_import_finish', { p_import: id, p_counts: { note: 'finished after an interrupted upload' } }));
}

// ─── clients ────────────────────────────────────────────────────────────────
export interface Client {
  id: string; house_no: string; street_name: string; unit: string | null; city: string | null; province: string | null; postal_code: string | null;
  lat: number | null; lng: number | null; route_code: string | null; match_how: string | null;
  people: { first: string; last: string }[]; phones: string[]; emails: string[];
  history: { year: number | null; service: string; price: string; contractor: string; payment: string; line?: string }[];
  services: string[];
  tags: string[]; notes: string | null; call_first: string | null; do_not_call: boolean; do_not_text: boolean; updated_at: string;
}
export async function listClients(opts: { q?: string; route?: string; noRoute?: boolean; service?: string; page?: number; pageSize?: number }): Promise<{ rows: Client[]; total: number }> {
  const size = opts.pageSize || 100; const from = (opts.page || 0) * size;
  let qb = db.from('clients').select('*', { count: 'exact' });
  if (opts.service) qb = qb.contains('services', [opts.service]);
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
