// src/v2/lib/bookings.ts — Master Bookings' booking lists (RUN_66): one list per season of a
// region's year, its bookings, plans, the Star Plan import, and the day feed.
//
// A booking lasts all season. Start session copies the open ones on the day's routes into the old
// session (id "mb:<uuid>"), the crew finishes them on the map logsheet, and what they did flows
// back on its own (done / next time with a reason / cancelled).
import { db, must } from './client';
import { geocode } from './clients';
import type { Attempt, VisitLine } from './bookingCrew';

export type ListPart = 'spring' | 'summer' | 'fall';
export type MapState = 'on_map' | 'moved' | 'waiting' | 'no_location';
export type BookingStatus = 'open' | 'done' | 'cancelled';

export interface BookingList {
  id: string; region: string; year: number; part: ListPart; service: string; name: string;
  center_id: string | null; mine: boolean | null; job_code: string | null;
  total: number; open: number; done: number; cancelled: number; tried: number;
  on_map: number; moved: number; waiting: number; no_location: number;
}
export interface Services { aeration?: boolean; dethatch?: boolean; fertilizer?: boolean; seed?: boolean; lime?: boolean }
export interface Booking {
  id: string; list_id: string; plan_id: string | null; client_id: string | null;
  house_no: string; street_name: string; unit: string | null; city: string | null; province: string | null; postal_code: string | null;
  lat: number | null; lng: number | null; sheet_route: string | null; route_code: string | null; area_name: string | null;
  map_state: MapState; map_how: string | null; moved_from: string | null;
  job_code: string; services: Services; property_type: string | null; prepaid: boolean;
  people: { first: string; last: string }[]; phones: string[]; emails: string[];
  field_notes: string | null; office_notes: string | null; status: BookingStatus; attempts: Attempt[];
  done_on: string | null; done_by: string | null; done_by_name: string | null; done_services: Services | null;
  this_year: VisitLine[]; booked_by: string | null; booked_at: string | null; source: Record<string, unknown> | null;
  created_at: string; updated_at: string;
  plan: { id: string; kind: PlanKind; year: number; price: number | null; prepaid: boolean } | null;
  history?: { year?: number | string; service?: string; line?: string; price?: string; contractor?: string }[];
}
export type PlanKind = 'sp_pro' | 'star_plan' | 'grub' | 'chafer' | 'sppp' | 'other';
export const PLAN_LABEL: Record<PlanKind, string> = {
  sp_pro: 'SP Pro', star_plan: 'Star Plan', grub: 'Grub Control', chafer: 'Chafer Beetle', sppp: 'SP Protection Plus', other: 'Plan',
};
export const STATE_LABEL: Record<MapState, string> = { on_map: 'On map', moved: 'Moved', waiting: 'Waiting on map', no_location: 'No location' };
export const STATE_HINT: Record<MapState, string> = {
  on_map: 'Its point is on a built route that matches the sheet’s code.',
  moved: 'Its point is on a built route with a different code from the sheet; the map’s route is used.',
  waiting: 'No digital map is built there yet. It keeps the sheet’s code and can’t go into a day until the map exists.',
  no_location: 'The address couldn’t be found. Fix the address so it can be placed.',
};
export const PART_LABEL: Record<ListPart, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall' };

const SVC: [keyof Services, string][] = [['aeration', 'A'], ['dethatch', 'D'], ['fertilizer', 'F'], ['seed', 'S'], ['lime', 'L']];
/** {aeration, fertilizer, seed, lime} → "AFSL" */
export const servicesCode = (s: Services | null | undefined) => SVC.filter(([k]) => s?.[k]).map(([, c]) => c).join('');
export const servicesFromCode = (code: string): Services => {
  const up = code.toUpperCase(); const out: Services = {};
  for (const [k, c] of SVC) if (up.includes(c)) out[k] = true;
  return out;
};

// ───────────── reading ─────────────
export async function listLists(centerId: string): Promise<BookingList[]> {
  return (must(await db.rpc('app_mb_lists', { p_center: centerId })) as BookingList[]) || [];
}
/** The list this center works for a season (service + year), the fall one first. */
export function listFor(lists: BookingList[], service: string, year: number): BookingList | null {
  const mine = lists.filter(l => l.mine && l.service === service && l.year === year);
  const order: ListPart[] = ['fall', 'summer', 'spring'];
  return mine.sort((a, b) => order.indexOf(a.part) - order.indexOf(b.part))[0] || null;
}
export interface BookingFilter { q?: string; status?: BookingStatus | 'tried' | null; state?: MapState | null; area?: string | null; route?: string | null }
export async function listBookings(listId: string, f: BookingFilter = {}, page = 0, size = 200): Promise<{ total: number; rows: Booking[] }> {
  const r = must(await db.rpc('app_mb_list_bookings', {
    p_list: listId, p_q: f.q || null, p_status: f.status || null, p_state: f.state || null, p_area: f.area || null, p_route: f.route || null,
    p_limit: size, p_offset: page * size,
  })) as { total: number; rows: Booking[] };
  return { total: Number(r?.total) || 0, rows: r?.rows || [] };
}
export async function getBooking(id: string): Promise<Booking> {
  return must(await db.rpc('app_mb_booking', { p_id: id })) as Booking;
}
export type BookingPatch = Partial<Pick<Booking, 'house_no' | 'street_name' | 'unit' | 'city' | 'province' | 'postal_code' | 'lat' | 'lng' |
  'sheet_route' | 'job_code' | 'services' | 'property_type' | 'prepaid' | 'people' | 'phones' | 'emails' | 'field_notes' | 'office_notes' | 'status' | 'route_code'>>;
export async function saveBooking(id: string | null, listId: string | null, p: BookingPatch): Promise<Booking> {
  return must(await db.rpc('app_mb_booking_save', { p_id: id, p_list: listId, p })) as Booking;
}
export async function placeAgain(listId: string, all = false): Promise<number> {
  return Number(must(await db.rpc('app_mb_place_again', { p_list: listId, p_all: all }))) || 0;
}
export interface WaitingGroup { prefix: string; n: number; cities: string[]; routes: { code: string; n: number }[] }
export async function waiting(listId: string): Promise<WaitingGroup[]> {
  return (must(await db.rpc('app_mb_waiting', { p_list: listId })) as WaitingGroup[]) || [];
}
export interface Plan {
  id: string; kind: PlanKind; year: number; price: number | null; prepaid: boolean; note: string | null; created_at: string;
  client: { id: string; address: string; city: string | null; name: string | null } | null;
  bookings: { id: string; list: string; part: ListPart; status: BookingStatus; done_on: string | null; route_code: string | null; job_code: string; tried: number }[];
}
export async function listPlans(centerId: string, kind?: PlanKind | null, year?: number | null): Promise<Plan[]> {
  return (must(await db.rpc('app_mb_plans', { p_center: centerId, p_kind: kind || null, p_year: year || null })) as Plan[]) || [];
}

/** Booking dots for maps: every booking of the center's lists on these master maps. */
export interface BookingDot { id: string; lat: number; lng: number; route: string | null; status: BookingStatus; tried: boolean; name: string | null; job: string; address: string }
export async function areaBookings(centerId: string, areas: string[], service?: string, year?: number): Promise<BookingDot[]> {
  if (!areas.length) return [];
  const r = must(await db.rpc('app_mb_area_bookings', { p_center: centerId, p_areas: areas, p_service: service || null, p_year: year || null })) as unknown[][];
  return (r || []).map(a => ({ id: String(a[0]), lat: Number(a[1]), lng: Number(a[2]), route: (a[3] as string) || null, status: a[4] as BookingStatus,
    tried: !!a[5], name: (a[6] as string) || null, job: String(a[7] || ''), address: String(a[8] || '') }))
    .filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng));
}
export async function areaCounts(centerId: string, service: string, year: number): Promise<Record<string, { total: number; done: number; open: number; cancelled: number }>> {
  return (must(await db.rpc('app_mb_area_counts', { p_center: centerId, p_service: service, p_year: year })) as Record<string, { total: number; done: number; open: number; cancelled: number }>) || {};
}
export async function routeBookings(centerId: string, route: string, service: string, year: number): Promise<Booking[]> {
  return (must(await db.rpc('app_mb_route_bookings', { p_center: centerId, p_route: route, p_service: service, p_year: year })) as Booking[]) || [];
}
/** Booking colours on maps. */
export const BOOKING_COLORS = { open: '#d4a800', tried: '#ea580c', done: '#16a34a', cancelled: '#9ca3af' } as const;
export const bookingColor = (d: { status: BookingStatus; tried?: boolean; attempts?: Attempt[] }) =>
  d.status === 'done' ? BOOKING_COLORS.done : d.status === 'cancelled' ? BOOKING_COLORS.cancelled
    : (d.tried || (d.attempts?.length || 0) > 0) ? BOOKING_COLORS.tried : BOOKING_COLORS.open;

// ───────────── the day feed ─────────────
/** The open bookings on these routes, shaped as the old app's prebooks (for Start session). */
export async function dayBookings(centerId: string, routes: string[]): Promise<Record<string, unknown>[]> {
  if (!routes.length) return [];
  return (must(await db.rpc('app_mb_day_bookings', { p_center: centerId, p_routes: routes })) as Record<string, unknown>[]) || [];
}

// ───────────── the crew card ─────────────
export * from './bookingCrew';

// ───────────── the Star Plan Bookings tab (old BC Master Bookings sheet) ─────────────
// Booked By | Date Booked | Time Booked | Route # | First Name | Last Name | (house #) | Street Name | Call 1st |
// Phone # | E-Mail | Service Type | PP | ($) | A | D | F | S | L | City | Notes
export interface SheetBooking {
  row: number;                       // 1-based row in the sheet
  key: string;                       // route|house|street, for loading each booking once
  booked_by: string; booked_at: string; sheet_route: string; first: string; last: string;
  house_no: string; street: string; city: string; field_notes: string; phones: string[]; emails: string[];
  property_type: string; prepaid_marked: boolean; price: string; office_notes: string;
  spring: string;                    // what the A–L marks say was done in spring ("FSL")
  springDetail: string;              // dates / contractor numbers written in those marks
}
const norm = (s: unknown) => String(s ?? '').trim();
const low = (s: unknown) => norm(s).toLowerCase();

/** The header row of a Master Bookings booking tab, or -1 when the rows aren't one. */
export function bookingHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map(low);
    if (r.includes('route #') && r.includes('first name') && r.includes('street name') && (r.includes('booked by') || r.includes('pp'))) return i;
  }
  return -1;
}
/** Is this a Master Bookings booking tab (Star Plan Bookings and the like)? */
export const looksLikeBookingTab = (rows: unknown[][]) => bookingHeaderRow(rows) >= 0;

export function parseBookingTab(rows: unknown[][]): SheetBooking[] {
  const hi = bookingHeaderRow(rows);
  if (hi < 0) return [];
  const h = (rows[hi] || []).map(low);
  const at = (...names: string[]) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = {
    by: at('booked by'), date: at('date booked'), time: at('time booked'), route: at('route #', 'route'), first: at('first name'), last: at('last name'),
    house: at('house #', 'house', 'street #'), street: at('street name'), call: at('call 1st'), phone: at('phone #', 'phone'), email: at('e-mail', 'email'),
    type: at('service type'), pp: at('pp'), city: at('city'), notes: at('notes'),
  };
  if (c.house < 0 && c.last >= 0) c.house = c.last + 1;        // the house # column has no title in some tabs
  const price = c.pp >= 0 ? (h[c.pp + 1] === '' || /\$|amt|price/.test(h[c.pp + 1] || '') ? c.pp + 1 : -1) : -1;
  const marks: [string, number][] = ['a', 'd', 'f', 's', 'l'].map(k => [k.toUpperCase(), h.indexOf(k, Math.max(0, c.pp))]);
  const get = (r: unknown[], i: number) => (i >= 0 ? norm(r[i]) : '');
  const out: SheetBooking[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const house = get(r, c.house).replace(/\s+/g, ''); const street = get(r, c.street);
    if (!house && !street && !get(r, c.last)) continue;
    const route = get(r, c.route).toUpperCase();
    const markVals = marks.map(([k, j]) => [k, get(r, j)] as const).filter(([, v]) => v);
    const detail = [...new Set(markVals.map(([, v]) => v).filter(v => !/^x$/i.test(v)))].join(' · ');
    out.push({
      row: i + 1, key: `${route}|${house.toLowerCase()}|${street.toLowerCase().replace(/\s+/g, ' ')}`,
      booked_by: get(r, c.by), booked_at: [get(r, c.date), get(r, c.time)].filter(Boolean).join(' '), sheet_route: route,
      first: get(r, c.first), last: get(r, c.last), house_no: house, street, city: get(r, c.city), field_notes: get(r, c.call),
      phones: get(r, c.phone).split(/[,/;]|\s{2,}/).map(p => p.replace(/[^\d+]/g, '')).filter(p => p.replace(/\D/g, '').length >= 7),
      emails: get(r, c.email).split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)),
      property_type: get(r, c.type).toUpperCase(), prepaid_marked: /^x/i.test(get(r, c.pp)) || /confirmed/i.test(get(r, c.pp)),
      price: get(r, price), office_notes: get(r, c.notes),
      spring: markVals.map(([k]) => k).join(''), springDetail: detail,
    });
  }
  return out;
}

/** BC route prefixes → the town they're in (from the old Routes tab), so an address without a city can be found. */
export const BC_PREFIX_CITY: Record<string, string> = {
  MIH: '100 Mile House', ABB: 'Abbotsford', AGA: 'Agassiz', ALB: 'Maple Ridge', ALG: 'Aldergrove', ARM: 'Armstrong', ASH: 'Ashcroft', BAR: 'Barriere',
  BLM: 'West Kelowna', BBY: 'Blind Bay', BRF: 'Chilliwack', CCK: 'Cache Creek', CMB: 'Campbell River', CAP: 'North Vancouver', CSG: 'Castlegar',
  CSNH: 'Central Saanich', CHA: 'Chase', CHE: 'Chemainus', CHL: 'Chilliwack', CHMT: 'Chilliwack', CLK: 'Christina Lake', CBL: 'Cobble Hill', CLD: 'Colwood',
  COM: 'Comox', COQ: 'Coquitlam', COU: 'Courtenay', CBY: 'Cowichan Bay', CNB: 'Cranbrook', CFT: 'Crofton', CBD: 'Cumberland', DUN: 'Duncan',
  DNB: 'Campbell River', END: 'Enderby', ESQ: 'Esquimalt', FER: 'Fernie', FLNG: 'Fort Langley', GAB: 'Gabriola', GNL: 'Genelle', GIB: 'Gibsons',
  GOL: 'Golden', GDF: 'Grand Forks', HHS: 'Harrison Hot Springs', HOP: 'Hope', HUN: 'Abbotsford', JBY: 'Victoria', KMP: 'Kamloops', KEL: 'Kelowna',
  KIM: 'Kimberley', LAD: 'Delta', LDY: 'Ladysmith', LKC: 'Lake Country', LVH: 'West Kelowna', LGF: 'Langford', LNG: 'Langley', LIL: 'Lillooet',
  LGL: 'Logan Lake', MPR: 'Maple Ridge', MPRC: 'Maple Ridge', MRR: 'Merritt', MCN: 'Victoria', MBY: 'Mill Bay', MIS: 'Mission', MTR: 'Montrose',
  MUV: 'Langley', NAN: 'Nanaimo', NEWI: 'New Westminster', NEW: 'New Westminster', NBY: 'Burnaby', NCOQ: 'Coquitlam', NDEL: 'Delta',
  NSNH: 'North Saanich', NSR: 'Surrey', NVN: 'North Vancouver', NES: 'Surrey', NWS: 'Surrey', OAK: 'Oak Bay', OLI: 'Oliver', OSO: 'Osoyoos',
  PAR: 'Parksville', PEC: 'Peachland', PEN: 'Penticton', PTM: 'Pitt Meadows', PAL: 'Port Alberni', PCOQ: 'Port Coquitlam', POW: 'Powell River',
  PRO: 'Chilliwack', QUB: 'Qualicum Beach', RAY: 'Kamloops', REV: 'Revelstoke', RHM: 'Richmond', RBC: 'Roberts Creek', ROS: 'Rossland',
  SNH: 'Saanich', SAL: 'Salmon Arm', SAR: 'Chilliwack', SEC: 'Sechelt', SIC: 'Sicamous', SDN: 'Sidney', SLC: 'Salmon Arm', SOO: 'Sooke',
  SRT: 'Sorrento', SBY: 'Burnaby', SCAP: 'North Vancouver', SSR: 'Surrey', SKEL: 'Kelowna', SES: 'Surrey', SWS: 'Surrey', SQU: 'Squamish',
  SYB: 'Campbell River', SUM: 'Summerland', SUR: 'Surrey', TRL: 'Trail', TSW: 'Delta', VNNE: 'Vancouver', VNNW: 'Vancouver', VNSE: 'Vancouver',
  VNSW: 'Vancouver', VED: 'Chilliwack', VER: 'Vernon', VIC: 'Victoria', VIE: 'View Royal', WAG: 'Langley', WFD: 'Warfield', WSNH: 'North Saanich',
  WKEL: 'West Kelowna', WVN: 'West Vancouver', WVE: 'West Vancouver', WBK: 'West Kelowna', WSY: 'Kamloops', WHR: 'White Rock', WHRUS: 'White Rock',
};
export function cityForRoute(route: string): string {
  const p = (route.toUpperCase().match(/^[A-Z]+/)?.[0] || '');
  return BC_PREFIX_CITY[p] || BC_PREFIX_CITY[p.replace(/OFF$/, '')] || '';
}

/** A Star Plan row as a Fall Rejuv booking: a prepaid AFSL office flat on an SP Pro plan. */
export function starPlanToBooking(b: SheetBooking, point: { lat: number; lng: number } | null, cityHint: string) {
  const officeNotes = [b.office_notes, !b.prepaid_marked ? 'PP wasn’t marked in the sheet (loaded as prepaid).' : null].filter(Boolean).join(' · ');
  return {
    key: b.key, house_no: b.house_no, street: b.street, unit: null, city: b.city || cityHint || null, province: 'BC', postal_code: null,
    lat: point?.lat ?? null, lng: point?.lng ?? null, sheet_route: b.sheet_route,
    people: (b.first || b.last) ? [{ first: b.first, last: b.last }] : [], phones: b.phones, emails: b.emails,
    field_notes: b.field_notes || null, office_notes: officeNotes || null,
    job_code: 'AFSL', services: servicesFromCode('AFSL'), property_type: ['FO', 'BO', 'FP'].includes(b.property_type) ? b.property_type : null,
    prepaid: true, plan: { kind: 'sp_pro' as PlanKind, price: b.price || null, prepaid: true },
    this_year: [
      { label: 'Spring', done: !!b.spring, detail: [b.spring || null, b.springDetail || null].filter(Boolean).join(' · ') || undefined },
      { label: 'Summer Fert', done: true },
    ],
    booked_by: b.booked_by || null, booked_at: b.booked_at || null, source: { row: b.row, sheet: 'Star Plan Bookings' },
  };
}
export type ImportRow = ReturnType<typeof starPlanToBooking>;

/** Find each row's point (Mapbox), a few at a time. */
export async function locateRows(list: SheetBooking[], onProgress?: (done: number) => void): Promise<Map<number, { lat: number; lng: number }>> {
  const out = new Map<number, { lat: number; lng: number }>();
  let done = 0;
  for (let k = 0; k < list.length; k += 8) {
    await Promise.all(list.slice(k, k + 8).map(async (b, j) => {
      const city = b.city || cityForRoute(b.sheet_route);
      const g = b.house_no && b.street ? await geocode({ house_no: b.house_no, street_name: b.street, city, province: 'BC', postal_code: '' }) : null;
      if (g) out.set(k + j, g);
    }));
    done = Math.min(list.length, k + 8); onProgress?.(done);
  }
  return out;
}
export interface CheckRow { i: number; already: boolean; client_id: string | null; route_code: string | null; area_name: string | null; map_state: MapState; how: string | null; moved_from: string | null }
export async function checkImport(listId: string, rows: (ImportRow & { i: number })[]): Promise<Map<number, CheckRow>> {
  const out = new Map<number, CheckRow>();
  for (let k = 0; k < rows.length; k += 400) {
    const res = must(await db.rpc('app_mb_import_check', { p_list: listId, p_rows: rows.slice(k, k + 400).map(r => ({
      i: r.i, key: r.key, house_no: r.house_no, street: r.street, unit: r.unit, city: r.city, lat: r.lat, lng: r.lng, sheet_route: r.sheet_route })) })) as CheckRow[];
    for (const r of res || []) out.set(Number(r.i), r);
  }
  return out;
}
export async function saveImportRows(listId: string, file: string, rows: ImportRow[], onProgress?: (done: number) => void): Promise<{ added: number; already: number; new_clients: number; states: Record<string, number> }> {
  const total = { added: 0, already: 0, new_clients: 0, states: {} as Record<string, number> };
  for (let k = 0; k < rows.length; k += 200) {
    const r = must(await db.rpc('app_mb_import_save', { p_list: listId, p_file: file, p_rows: rows.slice(k, k + 200) })) as typeof total;
    total.added += Number(r.added) || 0; total.already += Number(r.already) || 0; total.new_clients += Number(r.new_clients) || 0;
    for (const [s, n] of Object.entries(r.states || {})) total.states[s] = (total.states[s] || 0) + Number(n);
    onProgress?.(Math.min(rows.length, k + 200));
  }
  return total;
}

/** Repeats in a file: rows that share a route and address (loaded once). */
export function repeats(list: SheetBooking[]): SheetBooking[][] {
  const by = new Map<string, SheetBooking[]>();
  for (const b of list) { const g = by.get(b.key) || []; g.push(b); by.set(b.key, g); }
  return [...by.values()].filter(g => g.length > 1);
}

/**
 * The booking tab of an Excel download: only that tab is opened (Accounts, CCDETF and every other tab
 * are never read). Returns null when the workbook has no booking tab.
 */
export async function readBookingTabFromWorkbook(file: File): Promise<{ name: string; rows: unknown[][] } | null> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames || [];
  const tab = names.find(n => /^star\s*plan\s*bookings$/i.test(n.trim()));
  if (!tab) return null;
  const wb = XLSX.read(buf, { type: 'array', sheets: [tab], cellNF: true });
  const ws = wb.Sheets[tab];
  if (!ws) return null;
  return { name: tab, rows: XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false }) };
}
