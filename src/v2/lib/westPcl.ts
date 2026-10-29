// src/v2/lib/westPcl.ts — West past clients (PCL): the BC call book and the 2026 Logsheets.
//
// In the West both service lines are lawn care, so every past client is one lawn list (lime green on
// the maps). Two sources:
//   Call book    tabs TOR, HAM, EDM, CAL, OTT, SCOTTY, Shopify… (never CCD): RC (route), House, Street,
//                names, phone, email, and "Service History": "45.0pp (A-25), 425.0 (DFSL-23), 52.5 (21)"
//                → one past job per entry: price, prepaid, services, year (no services = aeration, A).
//   Logsheets    the BC Master Bookings 2026 tab: visit rows (Existing / New) are spring 2026 jobs; a
//                row ending in "(ADFSL)"-style marks was a Spring Rejuv visit with those services, else
//                Spring Aeration (A). Upsell rows (REJUV, DET, GRUB, SP PRO, GOLF, AC, SPPP) are sales,
//                not jobs: they go on the customer as "Sold 2026: SP PRO".
// The town comes from the route prefix (there's no city column). Customers are placed on the maps by
// where they are only; with no built map there they wait ("waiting") and attach on their own later.
import { db, must } from './client';
import { BC_PREFIX_CITY, cityForRoute, tidyStreet } from './bookings';

const low = (s: unknown) => String(s ?? '').trim().toLowerCase();
const norm = (s: unknown) => String(s ?? '').trim();

export interface PastJob { year: number | null; part?: 'spring' | 'summer' | 'fall'; line: 'aeration' | 'lawn_rejuv'; service: string; price: string; payment?: string; contractor?: string }
export interface PclRow {
  key: string; tab: string; row: number;
  sheet_route: string; house_no: string; street: string; city: string;
  first: string; last: string; phones: string[]; emails: string[];
  history: PastJob[]; tags: string[];
}

/** "45.0pp (A-25), 425.0 (DFSL-23), 52.5 (21), 60 (A-??)" → past jobs. */
export function parseServiceHistory(text: string): PastJob[] {
  const out: PastJob[] = [];
  const re = /([\d,]+(?:\.\d+)?)?\s*(pp)?\s*\(\s*(?:([A-Za-z]+)\s*-\s*)?(\d{2,4}|\?\?)\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) {
    const code = (m[3] || 'A').toUpperCase().replace(/[^ADFSL]/g, '') || 'A';
    const y = m[4] === '??' ? null : Number(m[4].length === 2 ? `20${m[4]}` : m[4]);
    out.push({
      year: y && y >= 2010 && y <= 2100 ? y : null,
      line: /[DFSL]/.test(code) ? 'lawn_rejuv' : 'aeration',
      service: code, price: (m[1] || '').replace(/,/g, ''), payment: m[2] ? 'Prepaid' : undefined,
    });
  }
  return out;
}

const SKIP_TABS = /^(ccd|ccdetf|accounts?|.*card.*)$/i;
export const isSkippedTab = (name: string) => SKIP_TABS.test(name.trim());

/** A call book tab: RC, House, Street and Service History. */
export function callBookHeader(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = (rows[i] || []).map(low);
    if (h.includes('rc') && h.includes('house') && h.includes('street') && h.includes('service history')) return i;
  }
  return -1;
}
/** The Master Bookings Logsheets tab: Client Type, Property Type, Contractor Name. */
export function logsheetHeader(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = (rows[i] || []).map(low);
    if (h.includes('client type') && h.includes('property type') && h.includes('contractor name') && h.includes('street name')) return i;
  }
  return -1;
}
/** Most route codes are BC ones (a West list). */
export function looksWest(codes: string[]): boolean {
  const known = codes.filter(Boolean).map(c => c.toUpperCase().match(/^[A-Z]+/)?.[0] || '');
  if (!known.length) return false;
  return known.filter(p => BC_PREFIX_CITY[p] || BC_PREFIX_CITY[p.replace(/OFF$/, '')]).length / known.length >= 0.6;
}

const phonesOf = (s: string) => s.split(/[,/;]|\s{2,}/).map(p => p.replace(/[^\d]/g, '')).filter(p => p.length >= 10 && p.length <= 11);
const emailsOf = (s: string) => s.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e));
const keyOf = (house: string, street: string, city: string) => `${house.toLowerCase()}|${street.toLowerCase().replace(/\s+/g, ' ')}|${city.toLowerCase()}`;

export function parseCallBookTab(tab: string, rows: unknown[][]): PclRow[] {
  const hi = callBookHeader(rows);
  if (hi < 0) return [];
  const h = (rows[hi] || []).map(low);
  const at = (n: string) => h.indexOf(n);
  const c = { rc: at('rc'), house: at('house'), street: at('street'), first: at('first name'), last: at('last name'), phone: at('phone number'), email: at('email'), hist: at('service history') };
  const out: PclRow[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const g = (j: number) => (j >= 0 ? norm(r[j]) : '');
    const house = g(c.house).replace(/\s+/g, ''), street = g(c.street);
    if (!house || !street) continue;
    const route = g(c.rc).toUpperCase().replace(/\s+/g, '');
    const city = cityForRoute(route);
    out.push({ key: keyOf(house, street, city), tab, row: i + 1, sheet_route: route, house_no: house, street, city,
      first: g(c.first), last: g(c.last), phones: phonesOf(g(c.phone)), emails: emailsOf(g(c.email)),
      history: parseServiceHistory(g(c.hist)), tags: [] });
  }
  return out;
}

const UPSELLS = new Set(['REJUV', 'DET', 'GRUB', 'SP PRO', 'GOLF', 'AC', 'SPPP', 'DWS', 'WW', 'RAMP']);
export function parseLogsheets(rows: unknown[][], year = 2026): PclRow[] {
  const hi = logsheetHeader(rows);
  if (hi < 0) return [];
  const h = (rows[hi] || []).map(low);
  const at = (...n: string[]) => { for (const x of n) { const i = h.indexOf(x); if (i >= 0) return i; } return -1; };
  const c = { route: 0, first: at('first name'), last: at('last name'), house: at('street #', 'house #'), street: at('street name'), phone: at('phone number'),
    email: at('email address', 'email'), type: at('client type'), notes: at('notes'), price: at('price'), pay: at('payment type'), who: at('contractor name') };
  const out: PclRow[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const g = (j: number) => (j >= 0 ? norm(r[j]) : '');
    const house = g(c.house).replace(/\s+/g, ''), street = g(c.street);
    if (!house || !street) continue;
    const route = g(c.route).toUpperCase().replace(/\s+/g, '');
    const city = cityForRoute(route);
    const type = g(c.type).toUpperCase();
    const base = { key: keyOf(house, street, city), tab: 'Logsheets', row: i + 1, sheet_route: route, house_no: house, street, city,
      first: g(c.first), last: g(c.last), phones: phonesOf(g(c.phone)), emails: emailsOf(g(c.email)) };
    if (UPSELLS.has(type)) { out.push({ ...base, history: [], tags: [`Sold ${year}: ${type}`] }); continue; }
    if (/cancel/i.test(g(c.pay)) || r.slice(Math.max(c.who, 12) + 1).some(x => /cancel/i.test(norm(x)))) continue;
    const marks = (g(c.notes).match(/\(([ADFSL]+)\)\s*$/i)?.[1] || '').toUpperCase();
    out.push({ ...base, tags: [], history: [{
      year, part: 'spring', line: marks ? 'lawn_rejuv' : 'aeration', service: marks || 'A',
      price: g(c.price).replace(/[^0-9.]/g, ''), payment: g(c.pay) || undefined, contractor: g(c.who) || undefined,
    }] });
  }
  return out;
}

/** One customer per address: the same house, street and town on several rows or tabs merges. */
export interface Customer extends PclRow { rows: { tab: string; row: number }[] }
export function mergeRows(list: PclRow[]): Customer[] {
  const by = new Map<string, Customer>();
  for (const r of list) {
    const c = by.get(r.key);
    if (!c) { by.set(r.key, { ...r, history: [...r.history], tags: [...r.tags], rows: [{ tab: r.tab, row: r.row }] }); continue; }
    c.rows.push({ tab: r.tab, row: r.row });
    if (!c.first && r.first) { c.first = r.first; c.last = r.last; }
    if (!c.sheet_route && r.sheet_route) c.sheet_route = r.sheet_route;
    c.phones = [...new Set([...c.phones, ...r.phones])];
    c.emails = [...new Set([...c.emails, ...r.emails])];
    c.tags = [...new Set([...c.tags, ...r.tags])];
    for (const j of r.history) {
      if (!c.history.some(x => x.year === j.year && x.service === j.service && (x.part || '') === (j.part || '') && x.price === j.price)) c.history.push(j);
    }
  }
  return [...by.values()];
}

// ───────────── finding the points: Mapbox batch search (1,000 a request), then one at a time ─────────────
export interface Point { lat: number; lng: number }
export async function batchFind(list: Customer[], onProgress?: (done: number) => void): Promise<Map<number, Point>> {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env || {};
  const token = env.VITE_MAPBOX_TOKEN;
  const out = new Map<number, Point>();
  if (!token || token === 'pk.test') return out;
  for (let k = 0; k < list.length; k += 1000) {
    const slice = list.slice(k, k + 1000);
    const body = slice.map(c => ({ types: ['address'], address_number: c.house_no.match(/^\d+/)?.[0] || c.house_no, street: tidyStreet(c.street),
      place: c.city || undefined, region: 'British Columbia', country: 'ca', limit: 1 }));
    try {
      const res = await fetch(`https://api.mapbox.com/search/geocode/v6/batch?access_token=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) break;                          // no batch search on this account: the one-at-a-time pass does it
      const j = await res.json() as { batch?: { features?: { geometry: { coordinates: [number, number] }; properties?: { context?: Record<string, { name?: string; address_number?: string }>; match_code?: { confidence?: string } } }[] }[] };
      (j.batch || []).forEach((fc, n) => {
        const f = fc.features?.[0]; if (!f) return;
        const ctx = f.properties?.context || {};
        const conf = f.properties?.match_code?.confidence || '';
        const num = String(ctx.address?.address_number || '');
        if (ctx.region?.name !== 'British Columbia' || num !== (slice[n].house_no.match(/^\d+/)?.[0] || '') || !['exact', 'high', 'medium'].includes(conf)) return;
        out.set(k + n, { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
      });
    } catch { break; }
    onProgress?.(Math.min(list.length, k + 1000));
  }
  return out;
}

/** Where points land on the built maps (by location only). */
export async function placePoints(items: { i: number; lat: number; lng: number; street: string; house_no: string }[], onProgress?: (done: number) => void): Promise<Map<number, { route_code: string | null; area_name: string | null }>> {
  const out = new Map<number, { route_code: string | null; area_name: string | null }>();
  for (let k = 0; k < items.length; k += 500) {
    const r = must(await db.rpc('app_place_points', { p_items: items.slice(k, k + 500) })) as { i: number; route_code: string | null; area_name: string | null }[];
    for (const x of r || []) out.set(Number(x.i), { route_code: x.route_code, area_name: x.area_name });
    onProgress?.(Math.min(items.length, k + 500));
  }
  return out;
}

/** A customer as an import row (the safe import: held, previewed, saved, undoable). */
export function toImportRow(c: Customer, pt: Point | null, route: string | null) {
  return {
    house_no: c.house_no.toUpperCase(), street_name: tidyStreet(c.street), unit: '', city: c.city, province: 'BC', postal_code: '',
    lat: pt?.lat ?? null, lng: pt?.lng ?? null, route_code: route, match_how: route ? 'map' : pt ? 'waiting' : 'no_location', sheet_route: c.sheet_route,
    people: (c.first || c.last) ? [{ first: c.first, last: c.last }] : [], phones: c.phones, emails: c.emails,
    history: c.history.map(h => ({ ...(h.year ? { year: h.year } : {}), ...(h.part ? { part: h.part } : {}), line: h.line, service: h.service, price: h.price,
      payment: h.payment || '', contractor: h.contractor || '' })),
    tags: c.tags, notes: '', call_first: '', do_not_call: false, do_not_text: false,
    source: c.rows.slice(0, 5).map(r => ({ row: r.row, cells: { tab: r.tab } })),
  };
}

export async function waitingCustomers(): Promise<{ prefix: string; n: number; cities: string[] }[]> {
  return (must(await db.rpc('app_clients_waiting')) as { prefix: string; n: number; cities: string[] }[]) || [];
}
