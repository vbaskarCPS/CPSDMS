// src/v2/lib/clientImport.ts — turn any client list (callbook, CRM export, hand-made sheet)
// into one record per address. The Benny decides which column is what (a Mapping); this file
// applies a Mapping the same way every time, so a saved recipe gives the same result.

export type Field =
  | 'ignore'
  // people
  | 'first_name' | 'last_name' | 'full_name'
  // address
  | 'house_no' | 'street' | 'street_address' | 'full_address' | 'unit' | 'city' | 'province' | 'postal_code'
  // contact
  | 'phone' | 'email'
  // the list's own route code (used only when the address can't be placed on the map)
  | 'route_code'
  // flags and notes
  | 'notes' | 'call_first' | 'do_not_call' | 'do_not_text' | 'tag'
  // one year of service history (columns with the same `year` form one entry)
  | 'year' | 'service' | 'price' | 'contractor' | 'payment' | 'serviced'
  // how a job came (New / Existing / an upsell badge) and the day it was done (Logsheets-style lists)
  | 'client_type' | 'job_date';

export const FIELDS: { key: Field; label: string; group: string }[] = [
  { key: 'ignore', label: 'Ignore', group: '' },
  { key: 'first_name', label: 'First name', group: 'Person' },
  { key: 'last_name', label: 'Last name', group: 'Person' },
  { key: 'full_name', label: 'Full name', group: 'Person' },
  { key: 'house_no', label: 'House #', group: 'Address' },
  { key: 'street', label: 'Street name', group: 'Address' },
  { key: 'street_address', label: 'House # and street', group: 'Address' },
  { key: 'full_address', label: 'Full address (street, city, postal)', group: 'Address' },
  { key: 'unit', label: 'Unit', group: 'Address' },
  { key: 'city', label: 'City', group: 'Address' },
  { key: 'province', label: 'Province', group: 'Address' },
  { key: 'postal_code', label: 'Postal code', group: 'Address' },
  { key: 'phone', label: 'Phone', group: 'Contact' },
  { key: 'email', label: 'Email', group: 'Contact' },
  { key: 'route_code', label: 'Route code (from the list)', group: 'Address' },
  { key: 'notes', label: 'Notes', group: 'Flags' },
  { key: 'call_first', label: 'Call First note', group: 'Flags' },
  { key: 'do_not_call', label: 'Do not call', group: 'Flags' },
  { key: 'do_not_text', label: 'Do not text', group: 'Flags' },
  { key: 'tag', label: 'Tag (when filled in)', group: 'Flags' },
  { key: 'year', label: 'Service year', group: 'History' },
  { key: 'service', label: 'Service / code', group: 'History' },
  { key: 'price', label: 'Price', group: 'History' },
  { key: 'contractor', label: 'Contractor', group: 'History' },
  { key: 'payment', label: 'Payment type', group: 'History' },
  { key: 'serviced', label: 'Serviced that year (yes / code)', group: 'History' },
  { key: 'client_type', label: 'Client type (New / Existing / upsell)', group: 'History' },
  { key: 'job_date', label: 'Date done', group: 'History' },
];
const FIELD_KEYS = new Set(FIELDS.map(f => f.key));

/** The service a past client belongs to; each route has a past-client list per service. */
export type ServiceLine = 'aeration' | 'lawn_rejuv' | 'sealing' | 'cleaning';
export const SERVICE_LINES: { key: ServiceLine; label: string }[] = [
  { key: 'aeration', label: 'Aeration' }, { key: 'sealing', label: 'Sealing' },
  { key: 'lawn_rejuv', label: 'Lawn Rejuv' }, { key: 'cleaning', label: 'Window Cleaning' },
];
const LINE_KEYS = new Set<string>(SERVICE_LINES.map(l => l.key));
export const lineLabel = (l: string) => SERVICE_LINES.find(x => x.key === l)?.label || l;

/** A service code that clearly belongs to one service; anything else follows the list's service. */
export function classifyLine(code: string): ServiceLine | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  if (/^(AER|AERATION|CORE AERATION)$/.test(c)) return 'aeration';
  if (/^(SS|SSP|SSF|SEAL|SEALING|DRIVEWAY SEALING|DWS|RAMP|HOT ASPHALT)/.test(c) || /SEAL/.test(c)) return 'sealing';
  if (/^(RJ|REJUV|LAWN REJUV|LAWN REJUVENATION|REJUVENATION)/.test(c)) return 'lawn_rejuv';
  if (/^(WW|CL|WINDOW|WINDOWS|WINDOW CLEANING)/.test(c)) return 'cleaning';
  return null;
}

export interface ColumnRule {
  field: Field;
  year?: number | null;      // history columns that belong to one fixed year (e.g. "2024 Price")
  tag?: string | null;       // name of the tag for field 'tag'
  service?: string | null;   // service code for a 'serviced' column (e.g. "AER")
}

export interface Mapping {
  headerRow: number;                         // row (0-based) that holds the column titles
  columns: Record<string, ColumnRule>;       // by column index
  defaultYear?: number | null;               // history year when the list has no year column
  defaultService?: string | null;            // service when the list is all one service
  defaultCity?: string | null;
  defaultProvince?: string | null;
  serviceLine?: ServiceLine | null;          // which service this list's clients are past clients of
  yesValues?: string[];                      // extra values that mean "yes"
  notes?: string | null;                     // The Benny's explanation, shown on the review screen
  skipRows?: number[];                       // sheet rows (1-based) left out on purpose (e.g. from the chat)
}

/** A person on a client record. `phone` is the number that came on the same row as this
 *  name, so a text to it can greet the right person (a client can have several people). */
export interface Person { first: string; last: string; phone?: string }
export interface HistoryEntry {
  year: number | null; service: string; price: string; contractor: string; payment: string; line: ServiceLine | '';
  /** Door sale / Prebooked / Upsell, from a Client Type column. */
  source?: string;
  /** What an upsell was (its badge, e.g. SP PRO), from a Client Type column. */
  product?: string;
  /** The day the job was done (YYYY-MM-DD). */
  date?: string;
}

export interface ClientRow {
  key: string;                // address key inside this file
  rows: number[];             // spreadsheet row numbers (1-based, as in the sheet)
  house_no: string;
  street_name: string;
  unit: string;
  city: string;
  province: string;
  postal_code: string;
  route_given: string;
  people: Person[];
  phones: string[];
  emails: string[];
  history: HistoryEntry[];
  tags: string[];
  notes: string;
  call_first: string;
  do_not_call: boolean;
  do_not_text: boolean;
  raw_address: string;        // what the address looked like, for "needs attention"
}

export interface Applied {
  clients: ClientRow[]; skipped: { row: number; reason: string; text: string }[]; rowsRead: number;
  /** What the reader noticed about years and dates (see importChecks). */
  notes?: ReadNotes;
}
export interface ReadNotes {
  /** Date cells with no year in them ("August 9th", "27-May"): left off; the year comes from elsewhere. */
  yearlessDates: { row: number; text: string }[];
  /** Dates whose year disagreed with the row's YEAR column: the YEAR wins, the date is left off. */
  datesDropped: { row: number; date: string; year: number }[];
  /** Rows whose year came from a date because the YEAR cell was empty. */
  yearFromDate: number;
}

// ─── cell helpers ───────────────────────────────────────────────────────────
export const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  let s = String(v).replace(/ /g, ' ').trim();
  if (/^-?\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
};

const YES = new Set(['y', 'yes', 'x', '1', 'true', '✓', '✔', 'ok', 'done', 'serviced', 'booked', 'paid']);
export const isYes = (v: string, extra: string[] = []) => {
  const s = v.trim().toLowerCase();
  return !!s && (YES.has(s) || extra.some(e => e.trim().toLowerCase() === s));
};
const isNo = (v: string) => ['n', 'no', '0', 'false', '-', 'na', 'n/a', 'none'].includes(v.trim().toLowerCase());

export function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;   // already mixed case: leave it
  return t.toLowerCase().replace(/(^|[\s\-'’(/])([a-z])/g, (_m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, b) => 'Mc' + b.toUpperCase());
}

export function cleanPhone(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/[/,;|]|\bor\b|\band\b|&/i)) {
    let d = part.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length === 10) out.push(d);
    else if (d.length > 10) { const m = d.match(/\d{10}/g); if (m) out.push(...m); }
  }
  return [...new Set(out)];
}
export const formatPhone = (d: string) => d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;

export function cleanEmail(s: string): string[] {
  return [...new Set((s.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[a-z]{2,}/gi) || []).map(e => e.toLowerCase()))];
}

export function cleanPrice(s: string): string {
  const t = s.replace(/[$,\s]/g, '');
  if (/^\d+(\.\d+)?$/.test(t)) { const n = Number(t); return Number.isInteger(n) ? String(n) : n.toFixed(2); }
  return s.trim();
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = (w: string): number | undefined => MONTHS[w.slice(0, 3).toLowerCase()];
/**
 * "2026-10-03", "Oct 3, 2026", "10/03/2026", "3-Oct-26" → "2026-10-03"; '' when it isn't a date
 * OR HAS NO YEAR. A date like "August 9th" or "27-May" never gets a year made up for it (the
 * browser would quietly say 2001); the row's YEAR column gives that job its year instead.
 */
export function cleanDate(s: string): string {
  const t = s.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);            // month/day/year, the way the sheets write it
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = t.match(/^(\d{1,2})[\s.-]+([A-Za-z]{3,9})\.?[\s.,-]+(\d{2}|\d{4})$/);  // 3-Oct-26, 3 October 2026
  if (m) { const mo = monthOf(m[2]); if (mo) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, +m[1]); }
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);                   // Oct 3, 2026
  if (m) { const mo = monthOf(m[1]); if (mo) return iso(+m[3], mo, +m[2]); }
  // anything else: only when it plainly carries a four-digit year
  if (!/\b(19|20)\d{2}\b/.test(t)) return '';
  const d = new Date(t);
  return isNaN(d.getTime()) ? '' : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
/** A date's year is a real service year: not before 1990, not after next year. */
const iso = (y: number, mo: number, d: number) =>
  y >= 1990 && y <= new Date().getFullYear() + 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';

/** A Client Type cell → how the job came: New = a door sale, Existing = prebooked, else an upsell badge. */
export function clientTypeSource(v: string): { source: string; product?: string } {
  const t = v.trim();
  if (/^new\b/i.test(t)) return { source: 'Door sale' };
  if (/^(existing|prebook|pre-book|booked)/i.test(t)) return { source: 'Prebooked' };
  return { source: 'Upsell', product: t.toUpperCase() };
}

export function cleanYear(s: string): number | null {
  const m = s.match(/\b(19|20)\d{2}\b/);
  if (m) return Number(m[0]);
  const t = s.trim();
  if (/^\d{2}$/.test(t)) return 2000 + Number(t);
  return null;
}

const POSTAL = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
const PROVINCES: Record<string, string> = {
  ON: 'ON', ONTARIO: 'ON', AB: 'AB', ALBERTA: 'AB', BC: 'BC', 'BRITISH COLUMBIA': 'BC', MB: 'MB', MANITOBA: 'MB',
  SK: 'SK', SASKATCHEWAN: 'SK', QC: 'QC', QUEBEC: 'QC', NS: 'NS', 'NOVA SCOTIA': 'NS', NB: 'NB', 'NEW BRUNSWICK': 'NB',
  PE: 'PE', PEI: 'PE', NL: 'NL',
};
export const cleanPostal = (s: string) => { const m = s.match(POSTAL); return m ? `${m[1]} ${m[2]}`.toUpperCase() : ''; };
export const cleanProvince = (s: string) => PROVINCES[s.trim().toUpperCase().replace(/\./g, '')] || '';

/** "123A Main St", "4-123 Main St", "123 Main St Unit 4", "#4 123 Main St" → parts. */
export function parseStreetAddress(s: string): { house_no: string; street: string; unit: string } | null {
  let t = s.replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');
  if (!t) return null;
  let unit = '';
  const unitTail = t.match(/[,\s]+(?:unit|apt|suite|ste|#)\s*([\w-]+)$/i);
  if (unitTail) { unit = unitTail[1]; t = t.slice(0, unitTail.index).trim(); }
  const unitHead = t.match(/^(?:unit|apt|suite|ste|#)\s*([\w-]+)[\s,-]+/i);
  if (unitHead) { unit = unitHead[1]; t = t.slice(unitHead[0].length).trim(); }
  const dash = t.match(/^(\w{1,6})\s*-\s*(\d+[A-Za-z]?)\s+(.+)$/);       // 4-123 Main St
  if (dash) return { unit: unit || dash[1], house_no: dash[2], street: dash[3] };
  const m = t.match(/^(\d+)\s*([A-Za-z](?=\s))?\s*(?:,\s*)?(.+)$/);
  if (!m) return null;
  const street = m[3].trim();
  if (!/[A-Za-z]/.test(street)) return null;
  return { house_no: m[1] + (m[2] ? m[2].toUpperCase() : ''), street, unit };
}

/** "123 Main St, Oakville, ON L6H 1A1" → parts. */
export function parseFullAddress(s: string): { house_no: string; street: string; unit: string; city: string; province: string; postal_code: string } | null {
  const postal = cleanPostal(s);
  let rest = postal ? s.replace(POSTAL, ' ') : s;
  const parts = rest.split(',').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const street = parseStreetAddress(parts[0]);
  if (!street) return null;
  let city = '', province = '';
  for (const p of parts.slice(1)) {
    const words = p.split(/\s+/);
    const last = words[words.length - 1] || '';
    if (cleanProvince(p)) { province = cleanProvince(p); continue; }
    if (cleanProvince(last) && words.length > 1) { province = cleanProvince(last); city = city || titleCase(words.slice(0, -1).join(' ')); continue; }
    if (!city && /[A-Za-z]/.test(p) && !/^canada$/i.test(p)) city = titleCase(p);
  }
  rest = '';
  return { ...street, city, province, postal_code: postal };
}

/** Lower case, single spaces, no punctuation — enough to spot the same address twice in one file. */
export const roughStreet = (s: string) => s.toLowerCase().replace(/[.,'’]/g, '').replace(/\b(street)\b/g, 'st').replace(/\b(drive)\b/g, 'dr')
  .replace(/\b(road)\b/g, 'rd').replace(/\b(avenue|av)\b/g, 'ave').replace(/\b(crescent|cr)\b/g, 'cres').replace(/\b(court|ct)\b/g, 'crt')
  .replace(/\b(boulevard)\b/g, 'blvd').replace(/\b(place)\b/g, 'pl').replace(/\b(lane)\b/g, 'ln').replace(/\s+/g, ' ').trim();

export function splitNames(full: string): Person[] {
  const t = full.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const comma = t.match(/^([^,]+),\s*(.+)$/);                       // "Lee, Ann" / "Lee, Ann & Bob"
  if (comma) return comma[2].split(/\s*(?:&|\band\b|\/)\s*/i).filter(Boolean).map(f => ({ first: titleCase(f), last: titleCase(comma[1]) }));
  const words = t.split(' ');
  if (words.length === 1) return [{ first: titleCase(t), last: '' }];
  const last = words[words.length - 1];
  const firsts = words.slice(0, -1).join(' ').split(/\s*(?:&|\band\b|\/)\s*/i).filter(Boolean);
  return firsts.map(f => ({ first: titleCase(f), last: titleCase(last) }));
}

// ─── header row, fingerprint, guessing ──────────────────────────────────────
export function findHeaderRow(rows: unknown[][]): number {
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    const cells = (rows[r] || []).map(cell).filter(Boolean);
    const texty = cells.filter(c => /[A-Za-z]/.test(c) && c.length <= 40).length;
    const score = texty * 2 - (cells.length - texty);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/** Same column titles in the same order → same fingerprint, whatever the rows hold. */
export function fingerprint(headers: string[]): string {
  const norm = headers.map(h => h.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) { h ^= norm.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `v1-${headers.length}-${h.toString(16).padStart(8, '0')}`;
}

/** A mapping from column titles alone, used when The Benny isn't available. */
export function guessMapping(rows: unknown[][], headerRow = findHeaderRow(rows)): Mapping {
  const headers = (rows[headerRow] || []).map(cell);
  const columns: Record<string, ColumnRule> = {};
  headers.forEach((raw, i) => {
    const h = raw.toUpperCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    const year = cleanYear(h);
    const rule = (field: Field, extra: Partial<ColumnRule> = {}): ColumnRule => ({ field, ...(year && field !== 'year' ? { year } : {}), ...extra });
    let r: ColumnRule = { field: 'ignore' };
    if (!h) r = { field: 'ignore' };
    else if (/^(FIRST|FIRST NAME|FNAME|GIVEN NAME)$/.test(h)) r = rule('first_name');
    else if (/^(LAST|LAST NAME|LNAME|SURNAME)$/.test(h)) r = rule('last_name');
    else if (/^(NAME|CLIENT|CLIENT NAME|CUSTOMER|CUSTOMER NAME|FULL NAME|HOMEOWNER)$/.test(h)) r = rule('full_name');
    else if (/^(HOUSE ?#|HOUSE|HOUSE NUM(BER)?|STREET ?#|STREET NO|CIVIC|PREFIX|NUMBER|NO)$/.test(h)) r = rule('house_no');
    else if (/^(STREET|STREET NAME|ST NAME|ROAD)$/.test(h)) r = rule('street');
    else if (/^(ADDRESS|STREET ADDRESS|ADDRESS 1|ADDRESS LINE 1)$/.test(h)) r = rule('street_address');
    else if (/^(FULL ADDRESS|MAILING ADDRESS)$/.test(h)) r = rule('full_address');
    else if (/^(UNIT|APT|SUITE|UNIT ?#)$/.test(h)) r = rule('unit');
    else if (/^(CITY|TOWN|MUNICIPALITY)$/.test(h)) r = rule('city');
    else if (/^(PROV|PROVINCE|STATE)$/.test(h)) r = rule('province');
    else if (/^(POSTAL|POSTAL CODE|POSTCODE|ZIP)$/.test(h)) r = rule('postal_code');
    else if (/PHONE|CELL|MOBILE|TEL/.test(h)) r = rule('phone');
    else if (/E-?MAIL/.test(h)) r = rule('email');
    else if (/^ROUTE( CODE)?$|^RC$/.test(h)) r = rule('route_code');
    else if (/^(DNC|DO NOT CALL)$/.test(h)) r = rule('do_not_call');
    else if (/^(DNT|DO NOT TEXT|NO TEXT)$/.test(h)) r = rule('do_not_text');
    else if (/CALL FIRST/.test(h)) r = rule('call_first');
    else if (/NOTE|COMMENT/.test(h)) r = rule('notes');
    else if (/^YEAR$|^SEASON$/.test(h)) r = rule('year');
    else if (/^CLIENT TYPE$|^CUSTOMER TYPE$/.test(h)) r = rule('client_type');
    else if (/^PROPERTY TYPE$/.test(h)) r = rule('service');
    else if (/^(DATE|DATE DONE|DATE COMPLETED|COMPLETED|DONE ON|JOB DATE)$/.test(h)) r = rule('job_date');
    else if (/^(SERVICE|SERVICE TYPE|FO|SVC)$/.test(h) || /\bSERVICE\b/.test(h)) r = rule('service');
    else if (/PRICE|AMOUNT|AMT|\$/.test(h)) r = rule('price');
    else if (/CONTRACTOR|TECH|WORKER/.test(h)) r = rule('contractor');
    else if (/PMT|PAYMENT|PAID BY|METHOD/.test(h)) r = rule('payment');
    else if (year && /^\d{4}$/.test(h)) r = { field: 'serviced', year };
    else if (/^(AER|AERATION|SEAL|SEALING|SS|RJ|REJUV|WW)$/.test(h)) r = { field: 'serviced', service: h };
    else if (h.length <= 12) r = { field: 'tag', tag: raw.trim() };
    columns[String(i)] = r;
  });
  return { headerRow, columns, notes: 'Guessed from the column titles.' };
}

/** Keep only known fields and sane values (The Benny's answer is checked, not trusted). */
export function sanitizeMapping(m: unknown, columnCount: number): Mapping {
  const src = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
  const cols = (src.columns && typeof src.columns === 'object' ? src.columns : {}) as Record<string, Record<string, unknown>>;
  const columns: Record<string, ColumnRule> = {};
  for (let i = 0; i < columnCount; i++) {
    const c = cols[String(i)];
    const field = c && FIELD_KEYS.has(c.field as Field) ? c.field as Field : 'ignore';
    const rule: ColumnRule = { field };
    const y = c ? Number(c.year) : NaN;
    if (Number.isInteger(y) && y >= 1990 && y <= 2100) rule.year = y;
    if (c && typeof c.tag === 'string' && c.tag.trim()) rule.tag = c.tag.trim().slice(0, 40);
    if (c && typeof c.service === 'string' && c.service.trim()) rule.service = c.service.trim().slice(0, 20);
    columns[String(i)] = rule;
  }
  const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null; };
  const str = (v: unknown, n = 40) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
  const hr = Number(src.headerRow);
  return {
    headerRow: Number.isInteger(hr) && hr >= 0 && hr < 50 ? hr : 0,
    columns,
    defaultYear: num(src.defaultYear),
    defaultService: str(src.defaultService, 20),
    defaultCity: str(src.defaultCity),
    defaultProvince: str(src.defaultProvince, 20) ? (cleanProvince(String(src.defaultProvince)) || null) : null,
    serviceLine: typeof src.serviceLine === 'string' && LINE_KEYS.has(src.serviceLine) ? src.serviceLine as ServiceLine : null,
    yesValues: Array.isArray(src.yesValues) ? src.yesValues.filter(v => typeof v === 'string').slice(0, 20) as string[] : [],
    notes: str(src.notes, 2000),
    skipRows: Array.isArray(src.skipRows) ? [...new Set(src.skipRows.map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 5000) : [],
  };
}

// ─── apply a mapping ────────────────────────────────────────────────────────
export function applyMapping(rows: unknown[][], mapping: Mapping, opts: { fixedAddresses?: Map<number, { house_no: string; street: string; unit?: string; city?: string; province?: string; postal_code?: string }> } = {}): Applied {
  const headers = (rows[mapping.headerRow] || []).map(cell);
  const entries = Object.entries(mapping.columns).map(([i, r]) => [Number(i), r] as const).filter(([, r]) => r.field !== 'ignore');
  const yes = mapping.yesValues || [];
  const skipRows = new Set(mapping.skipRows || []);
  const byKey = new Map<string, ClientRow>();
  const skipped: Applied['skipped'] = [];
  let rowsRead = 0;
  const readNotes: ReadNotes = { yearlessDates: [], datesDropped: [], yearFromDate: 0 };

  for (let r = mapping.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const vals = entries.map(([i, rule]) => [rule, cell(row[i]), headers[i] || ''] as const);
    if (!vals.some(([, v]) => v)) continue;          // blank row
    rowsRead++;
    const sheetRow = r + 1;
    if (skipRows.has(sheetRow)) { skipped.push({ row: sheetRow, reason: 'Left out', text: vals.map(([, v]) => v).filter(Boolean).slice(0, 6).join(' · ') }); continue; }
    let house = '', street = '', unit = '', city = '', province = '', postal = '', route = '';
    let first = '', last = '';
    const people: Person[] = []; const phones: string[] = []; const emails: string[] = []; const tags: string[] = [];
    const notes: string[] = []; let callFirst = ''; let dnc = false; let dnt = false;
    // The row's year: a YEAR column always wins (whatever order the columns are in); a date's
    // year only when the YEAR cell is empty; then the list's default year.
    let colYear: number | null = null; let dateYear: number | null = null;
    const hist = new Map<string, HistoryEntry & { any: boolean }>();
    const h = (year: number | null | undefined) => {
      const k = year ? String(year) : 'row';
      if (!hist.has(k)) hist.set(k, { year: year ?? null, service: '', price: '', contractor: '', payment: '', line: '', any: false });
      return hist.get(k)!;
    };
    let rawAddress = '';
    for (const [rule, v, header] of vals) {
      if (!v) continue;
      switch (rule.field) {
        case 'first_name': first = first || v; break;
        case 'last_name': last = last || v; break;
        case 'full_name': people.push(...splitNames(v)); break;
        case 'house_no': house = house || v.replace(/\s+/g, ''); rawAddress = `${v} ${rawAddress}`.trim(); break;
        case 'street': street = street || v; rawAddress = `${rawAddress} ${v}`.trim(); break;
        case 'street_address': { rawAddress = rawAddress || v; const p = parseStreetAddress(v); if (p) { house = house || p.house_no; street = street || p.street; unit = unit || p.unit; } break; }
        case 'full_address': {
          rawAddress = rawAddress || v; const p = parseFullAddress(v);
          if (p) { house = house || p.house_no; street = street || p.street; unit = unit || p.unit; city = city || p.city; province = province || p.province; postal = postal || p.postal_code; }
          break;
        }
        case 'unit': unit = unit || v.replace(/^(unit|apt|suite|#)\s*/i, ''); break;
        case 'city': city = city || titleCase(v); break;
        case 'province': province = province || cleanProvince(v); break;
        case 'postal_code': postal = postal || cleanPostal(v); break;
        case 'phone': phones.push(...cleanPhone(v)); break;
        case 'email': emails.push(...cleanEmail(v)); break;
        case 'route_code': route = route || v.toUpperCase().replace(/\s+/g, ''); break;
        case 'notes': notes.push(header && !/note|comment/i.test(header) ? `${header}: ${v}` : v); break;
        case 'call_first': callFirst = callFirst || v; break;
        case 'do_not_call': if (isYes(v, yes) || /dnc|do not call|don'?t call/i.test(v)) dnc = true; break;
        case 'do_not_text': if (isYes(v, yes) || /dnt|do not text|no text/i.test(v)) dnt = true; break;
        case 'tag': if (!isNo(v)) tags.push(isYes(v, yes) ? (rule.tag || header) : `${rule.tag || header}: ${v}`); break;
        case 'year': { const y = cleanYear(v); if (rule.year) h(rule.year); else colYear = colYear ?? y; break; }
        case 'service': { const e = h(rule.year); e.service = e.service || v.toUpperCase(); e.any = true; break; }
        case 'price': { const e = h(rule.year); e.price = e.price || cleanPrice(v); if (e.price) e.any = true; break; }
        case 'contractor': { const e = h(rule.year); e.contractor = e.contractor || titleCase(v); break; }
        case 'payment': { const e = h(rule.year); e.payment = e.payment || v; break; }
        case 'client_type': { const e = h(rule.year); const c = clientTypeSource(v); e.source = e.source || c.source; if (c.product) e.product = e.product || c.product; e.any = true; break; }
        case 'job_date': {
          const d = cleanDate(v);
          if (!d) { if (readNotes.yearlessDates.length < 5000) readNotes.yearlessDates.push({ row: sheetRow, text: v }); break; }
          const e = h(rule.year); e.date = e.date || d; e.any = true; dateYear = dateYear ?? Number(d.slice(0, 4)); break;
        }
        case 'serviced': {
          if (isNo(v)) break;
          const e = h(rule.year);
          e.any = true;
          if (!isYes(v, yes)) e.service = e.service || v.toUpperCase();
          else e.service = e.service || (rule.service || mapping.defaultService || '').toUpperCase();
          break;
        }
        default: break;
      }
    }
    const fixed = opts.fixedAddresses?.get(sheetRow);
    if (fixed) { house = fixed.house_no; street = fixed.street; unit = fixed.unit || unit; city = fixed.city || city; province = fixed.province || province; postal = fixed.postal_code || postal; }
    if (house && !street) { const p = parseStreetAddress(house); if (p) { house = p.house_no; street = p.street; } }
    if (!house && street) { const p = parseStreetAddress(street); if (p) { house = p.house_no; street = p.street; unit = unit || p.unit; } }
    house = house.replace(/\.0+$/, '').toUpperCase();
    if (!/^\d+[A-Z]?$/.test(house) || !/[A-Za-z]{2}/.test(street)) {
      skipped.push({ row: sheetRow, reason: !house && !street ? 'No address' : 'Address not understood', text: rawAddress || [house, street].join(' ').trim() });
      continue;
    }
    street = titleCase(street.replace(/\s+/g, ' ').trim());
    city = city || mapping.defaultCity || '';
    province = province || mapping.defaultProvince || '';
    if (first || last) people.unshift({ first: titleCase(first), last: titleCase(last) });
    // the row's phone belongs to the row's (first) person
    if (people.length && phones.length && !people[0].phone) people[0] = { ...people[0], phone: phones[0] };

    const rowYear = colYear ?? dateYear;
    if (colYear == null && dateYear != null && entries.some(([, rule]) => rule.field === 'year' && !rule.year)) readNotes.yearFromDate++;
    const history: HistoryEntry[] = [];
    const listLine = mapping.serviceLine || '';
    for (const e of hist.values()) {
      if (!e.any && !e.contractor) continue;
      const year = e.year ?? rowYear ?? mapping.defaultYear ?? null;
      // a date from another year than the job's YEAR is not this job's date: leave it off
      if (e.date && year != null && Number(e.date.slice(0, 4)) !== year) {
        if (readNotes.datesDropped.length < 5000) readNotes.datesDropped.push({ row: sheetRow, date: e.date, year });
        delete e.date;
      }
      const service = e.service || (mapping.defaultService || '').toUpperCase();
      history.push({ year, service, price: e.price, contractor: e.contractor, payment: e.payment, line: classifyLine(service) || listLine,
        ...(e.source ? { source: e.source } : {}), ...(e.product ? { product: e.product } : {}), ...(e.date ? { date: e.date } : {}) });
    }
    // a client on a list with no history columns is still a past client of the list's service
    if (!history.length && listLine) {
      history.push({ year: rowYear ?? mapping.defaultYear ?? null, service: (mapping.defaultService || '').toUpperCase(), price: '', contractor: '', payment: '', line: listLine });
    }

    const key = `${house}|${roughStreet(street)}|${unit.toLowerCase()}|${city.toLowerCase()}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        key, rows: [sheetRow], house_no: house, street_name: street, unit, city, province, postal_code: postal, route_given: route,
        people: dedupePeople(people), phones: [...new Set(phones)], emails: [...new Set(emails)], history: dedupeHistory(history),
        tags: [...new Set(tags)], notes: notes.join('\n'), call_first: callFirst, do_not_call: dnc, do_not_text: dnt, raw_address: rawAddress,
      });
    } else {
      cur.rows.push(sheetRow);
      cur.people = dedupePeople([...cur.people, ...people]);
      cur.phones = [...new Set([...cur.phones, ...phones])];
      cur.emails = [...new Set([...cur.emails, ...emails])];
      cur.history = dedupeHistory([...cur.history, ...history]);
      cur.tags = [...new Set([...cur.tags, ...tags])];
      if (notes.length) cur.notes = [...new Set([...cur.notes.split('\n').filter(Boolean), ...notes])].join('\n');
      cur.call_first = cur.call_first || callFirst;
      cur.do_not_call ||= dnc; cur.do_not_text ||= dnt;
      cur.postal_code ||= postal; cur.province ||= province; cur.route_given ||= route;
    }
  }
  return { clients: [...byKey.values()], skipped, rowsRead, notes: readNotes };
}

// ─── checks before anything is saved ────────────────────────────────────────
export interface ImportCheck { level: 'stop' | 'warn' | 'info'; text: string }
/** Jobs per service and year, as the import would save them. */
export function yearSpread(a: Applied): { line: string; years: [string, number][] }[] {
  const by = new Map<string, Map<string, number>>();
  for (const c of a.clients) for (const h of c.history) {
    const l = h.line || '—'; if (!by.has(l)) by.set(l, new Map());
    const y = h.year == null ? 'no year' : String(h.year); const m = by.get(l)!; m.set(y, (m.get(y) || 0) + 1);
  }
  return [...by.entries()].map(([line, m]) => ({ line, years: [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])) }));
}
/**
 * What must be right before an import is approved. 'stop' means the years look wrong and the
 * person has to confirm they checked; 'warn' explains what the reader did; 'info' is the spread.
 */
export function importChecks(a: Applied, mapping: Mapping): ImportCheck[] {
  const out: ImportCheck[] = [];
  const now = new Date().getFullYear();
  const jobs = a.clients.flatMap(c => c.history.map(h => ({ h, c })));
  const odd = jobs.filter(({ h }) => h.year != null && (h.year < 1995 || h.year > now + 1));
  if (odd.length) {
    const ys = [...new Set(odd.map(({ h }) => h.year))].slice(0, 5).join(', ');
    out.push({ level: 'stop', text: `${odd.length.toLocaleString()} job${odd.length === 1 ? ' has' : 's have'} a year that can't be a service year (${ys}). Check which column holds the year.` });
  }
  const noYear = jobs.filter(({ h }) => h.year == null).length;
  const hasYearSource = Object.values(mapping.columns).some(r => r.field === 'year' || r.year) || mapping.defaultYear != null;
  if (noYear && !hasYearSource) out.push({ level: 'stop', text: `No column gives the year, and no year is set for the list: ${noYear.toLocaleString()} job${noYear === 1 ? '' : 's'} would have no year. Set the year the list is for, or pick the YEAR column.` });
  else if (noYear) out.push({ level: 'warn', text: `${noYear.toLocaleString()} job${noYear === 1 ? '' : 's'} have no year (their YEAR cell is empty).` });
  // one year swallowing a list that should be spread out
  const years = new Map<number, number>(); for (const { h } of jobs) if (h.year != null) years.set(h.year, (years.get(h.year) || 0) + 1);
  const yearCol = Object.values(mapping.columns).some(r => r.field === 'year' && !r.year);
  const top = [...years.entries()].sort((x, y) => y[1] - x[1])[0];
  if (yearCol && top && jobs.length >= 50 && top[1] / jobs.length > 0.9 && years.size > 1) {
    out.push({ level: 'warn', text: `${Math.round(100 * top[1] / jobs.length)}% of jobs are ${top[0]}. If the YEAR column is spread over several years, the wrong column may be the year.` });
  }
  const n = a.notes;
  if (n?.yearlessDates.length) {
    const ex = n.yearlessDates.slice(0, 2).map(d => `row ${d.row}: “${d.text}”`).join(', ');
    out.push({ level: 'warn', text: `${n.yearlessDates.length.toLocaleString()} date${n.yearlessDates.length === 1 ? ' has' : 's have'} no year in them (${ex}). They're left off; the job's year comes from the YEAR column.` });
  }
  if (n?.datesDropped.length) {
    const d = n.datesDropped[0];
    out.push({ level: 'warn', text: `${n.datesDropped.length.toLocaleString()} date${n.datesDropped.length === 1 ? '' : 's'} didn't match the row's YEAR (e.g. row ${d.row}: ${d.date}, YEAR ${d.year}). The YEAR is kept and the date left off.` });
  }
  if (n?.yearFromDate) out.push({ level: 'info', text: `${n.yearFromDate.toLocaleString()} row${n.yearFromDate === 1 ? '' : 's'} had an empty YEAR cell; their year comes from their date.` });
  for (const s of yearSpread(a)) {
    out.push({ level: 'info', text: `${s.line === '—' ? 'Jobs' : s.line[0].toUpperCase() + s.line.slice(1)} by year: ${s.years.map(([y, c]) => `${y} ${c.toLocaleString()}`).join(' · ')}` });
  }
  return out;
}

function dedupePeople(list: Person[]): Person[] {
  const seen = new Map<string, number>(); const out: Person[] = [];
  for (const p of list) {
    if (!p.first && !p.last) continue;
    const k = `${p.first}|${p.last}`.toLowerCase();
    const at = seen.get(k);
    if (at === undefined) { seen.set(k, out.length); out.push(p); }
    else if (!out[at].phone && p.phone) out[at] = { ...out[at], phone: p.phone };
  }
  return out;
}
function dedupeHistory(list: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>(); const out: HistoryEntry[] = [];
  for (const e of list) { const k = `${e.year}|${e.line}|${e.service}|${e.price}|${e.contractor}|${e.date || ''}`.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(e); } }
  return out.sort((a, b) => (b.year || 0) - (a.year || 0));
}

/** Google Sheet link → CSV export link for that tab. */
export function sheetCsvUrl(link: string): string | null {
  const id = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) return null;
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

// ─── a summary of every column over the whole file (for The Benny) ─────────
export interface ColumnProfile {
  i: number; header: string; filled: number; distinct: number;
  top: [string, number][];        // most common values and how often
  samples: string[];              // values from all through the file
  looks: string[];                // what the values look like: phone, email, money, year, date, yes/no, number, text
}
export function profileColumns(rows: unknown[][], headerRow: number, maxCols = 80): ColumnProfile[] {
  const headers = (rows[headerRow] || []).map(cell);
  const body = rows.slice(headerRow + 1);
  const width = Math.min(maxCols, Math.max(headers.length, ...body.slice(0, 200).map(r => (r || []).length)));
  const out: ColumnProfile[] = [];
  for (let i = 0; i < width; i++) {
    const counts = new Map<string, number>();
    const vals: string[] = [];
    for (const r of body) { const v = cell((r || [])[i]); if (!v) continue; vals.push(v); counts.set(v, (counts.get(v) || 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => [v.slice(0, 40), n] as [string, number]);
    const step = Math.max(1, Math.floor(vals.length / 6));
    const samples = [...new Set(vals.filter((_, k) => k % step === 0).map(v => v.slice(0, 50)))].slice(0, 6);
    const share = (re: RegExp) => vals.length ? vals.filter(v => re.test(v)).length / vals.length : 0;
    const looks: string[] = [];
    if (share(/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/) > 0.5) looks.push('phone');
    if (share(/@/) > 0.5) looks.push('email');
    if (share(/^\$?\s?\d{1,5}(\.\d{2})?$/) > 0.6 && share(/^(19|20)\d{2}$/) < 0.6) looks.push('money or number');
    if (share(/^(19|20)\d{2}$/) > 0.6) looks.push('year');
    if (share(/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$|^\d{4}-\d{2}-\d{2}/) > 0.5) looks.push('date');
    if (counts.size > 0 && counts.size <= 4 && [...counts.keys()].every(v => v.length <= 4)) looks.push('flag or short code');
    if (share(/^\d+[A-Za-z]?\s+\D/) > 0.5) looks.push('street address');
    out.push({ i, header: headers[i] || '', filled: vals.length, distinct: counts.size, top, samples, looks });
  }
  return out;
}
