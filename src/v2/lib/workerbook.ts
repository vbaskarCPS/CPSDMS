// src/v2/lib/workerbook.ts — contractors, days and day rosters (phase 2a).
import { db, must } from './client';

// ───────────── types ─────────────
export const STATUS_LISTS = [
  { code: 'NS', label: 'No-show' },
  { code: 'WDR', label: "Worked, didn't rebook" },
  { code: 'TNB', label: 'Trained, not booked' },
  { code: 'SNOW', label: 'Seasonal' },
  { code: 'Q', label: 'Quit' },
  { code: 'F', label: 'Fired' },
  { code: 'WL', label: 'Waitlist — can’t be booked' },
] as const;
export type StatusCode = 'active' | typeof STATUS_LISTS[number]['code'];
export const statusLabel = (s: StatusCode) => s === 'active' ? 'Active' : STATUS_LISTS.find(x => x.code === s)?.label || s;

export type HatCode = 'AER' | 'RJ' | 'SE' | 'CL';
export const HAT_CODES: HatCode[] = ['AER', 'RJ', 'SE', 'CL'];

export interface Person {
  id: string; first_name: string; last_name: string; cell_phone: string | null; alt_phone: string | null; email: string | null;
  address: string | null; first_year: number | null; lifetime_days: number; hats: Record<HatCode, number>; notes: string | null;
}
export interface Hire {
  id: string; person_id: string; center_id: string; year: number; cn: string; shuttle: string | null; status: StatusCode;
  status_since: string | null; ns_count: number; alumni_rate: number | null; silver_rate: number | null; pin_set_at: string | null;
  person: Person;
}
export interface DaySummaryStored { carts: number; steps: number; gross: number; upsells: number; booked: number; showed: number; no_shows: number; had_session: boolean; archived_rows: number }
export interface Day { id: string; center_id: string; day: string; state: 'planned' | 'live' | 'closed'; notes: string | null; closed_at?: string | null; summary?: DaySummaryStored | null }
export interface RosterRow {
  id: string; day_id: string; hire_id: string; shuttle: string | null; manager_id: string | null; team: string | null;
  confirmed_at: string | null; confirmed_via: 'staff' | 'email' | 'text' | 'worker' | null; attendance: 'showed' | 'no_show' | null;
  next_day: string | null; next_action?: 'book' | 'WDR' | 'Q' | null; notes: string | null; hire: Hire;
}

export const fullName = (p: Pick<Person, 'first_name' | 'last_name'>) => `${p.first_name} ${p.last_name}`.trim();

// ───────────── contractors ─────────────
const HIRE_COLS = 'id, person_id, center_id, year, cn, shuttle, status, status_since, ns_count, alumni_rate, silver_rate, pin_set_at, '
  + 'person:people(id, first_name, last_name, cell_phone, alt_phone, email, address, first_year, lifetime_days, hats, notes)';

export async function listHires(year: number): Promise<Hire[]> {
  const rows = must(await db.from('hires').select(HIRE_COLS).eq('year', year).order('cn')) as unknown as Hire[];
  return rows;
}

export async function updatePerson(id: string, p: Partial<Pick<Person, 'first_name' | 'last_name' | 'cell_phone' | 'alt_phone' | 'email' | 'address' | 'notes'>>) {
  must(await db.from('people').update(p).eq('id', id));
}
/** The facts behind a worker's rate: first season, days worked before this app, Silver Hats per service. */
export async function updatePersonFacts(id: string, f: { first_year: number | null; lifetime_days: number; hats: Record<HatCode, number> }) {
  if (f.lifetime_days < 0 || !Number.isInteger(f.lifetime_days)) throw new Error('Days must be a whole number, 0 or more');
  if (Object.values(f.hats).some(n => n < 0 || !Number.isInteger(n))) throw new Error('Silver Hats must be whole numbers, 0 or more');
  must(await db.from('people').update(f).eq('id', id));
}
/** One contractor by hire id (for the contractor card). */
export async function getHire(id: string): Promise<Hire | null> {
  return must(await db.from('hires').select(HIRE_COLS).eq('id', id).maybeSingle()) as unknown as Hire | null;
}
export async function updateHire(id: string, h: Partial<Pick<Hire, 'shuttle' | 'status'>>) {
  must(await db.from('hires').update(h).eq('id', id));
}

export async function nextCn(centerId: string, year: number): Promise<string> {
  return must(await db.rpc('app_next_cn', { p_center: centerId, p_year: year })) as string;
}

export async function addContractor(input: { centerId: string; year: number; cn: string; first: string; last: string; cell: string; email: string; shuttle: string }): Promise<void> {
  const res = await db.rpc('app_import_contractors', {
    p_center: input.centerId, p_year: input.year,
    p_rows: [{ cn: input.cn, first: input.first, last: input.last, cell: input.cell, email: input.email, shuttle: input.shuttle }],
  });
  const out = must(res) as ImportResult;
  if (out.skipped.length) throw new Error(out.skipped[0].reason);
}

export async function statusHistory(hireId: string): Promise<{ status: string; since: string; set_at: string }[]> {
  return must(await db.from('status_entries').select('status, since, set_at').eq('hire_id', hireId).order('set_at', { ascending: false })) as { status: string; since: string; set_at: string }[];
}

/** Days this person has been booked and showed, newest first (only days the viewer may see). */
export async function bookedDays(hireId: string): Promise<{ day: string; attendance: string | null; center_id: string }[]> {
  const rows = must(await db.from('day_roster').select('attendance, day:days(day, center_id)').eq('hire_id', hireId)) as unknown as
    { attendance: string | null; day: { day: string; center_id: string } }[];
  return rows.map(r => ({ day: r.day.day, center_id: r.day.center_id, attendance: r.attendance })).sort((a, b) => b.day.localeCompare(a.day));
}

// ───────────── import from the Workerbook Contractors tab ─────────────
export interface ImportRow {
  cn: string; first: string; last: string; cell?: string; alt?: string; email?: string; shuttle?: string; status?: string;
  days?: number; ns?: number; alm?: number; slv?: number; returning?: boolean; hats?: Partial<Record<HatCode, number>>;
}
export interface ImportResult {
  read: number; new_people: number; new_hires: number; updated: number;
  skipped: { row: number; cn: string | null; reason: string }[];
}

// Header text → field. Only these columns are ever read; anything else in the sheet
// (including ID numbers such as SIN, licence, health card or passport) is ignored.
const HEADER_MAP: Record<string, keyof ImportRow | HatCode> = {
  cn: 'cn', cnno: 'cn', cnnumber: 'cn', contractorid: 'cn',
  first: 'first', firstname: 'first', last: 'last', lastname: 'last',
  cell: 'cell', cellphone: 'cell', phone: 'cell', altphone: 'alt', alternatephone: 'alt', alt: 'alt',
  email: 'email', shuttle: 'shuttle', status: 'status', days: 'days', ns: 'ns',
  alminc: 'alm', alm: 'alm', alumni: 'alm', slvinc: 'slv', slv: 'slv', silver: 'slv', ar: 'returning',
  aer: 'AER', rj: 'RJ', se: 'SE', cl: 'CL',
};
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown) => String(v ?? '').trim();

/**
 * Turns the Contractors tab (as a grid of cells) into import rows. The header row is the
 * first of the top 6 rows that has a CN # column; rows without a CN # or a first name are dropped.
 */
export function parseContractorSheet(grid: unknown[][]): { rows: ImportRow[]; columns: string[]; ignored: string[]; headerRow: number } {
  const headerRow = grid.slice(0, 6).findIndex(r => (r || []).some(c => HEADER_MAP[norm(c)] === 'cn'));
  if (headerRow < 0) throw new Error('Couldn’t find a "CN #" column in the first 6 rows. Is this the Contractors tab?');
  const header = grid[headerRow] || [];
  const map: { idx: number; field: keyof ImportRow | HatCode }[] = [];
  const columns: string[] = []; const ignored: string[] = [];
  header.forEach((h, idx) => {
    const key = norm(h);
    if (!key) return;
    const field = HEADER_MAP[key];
    if (field && !map.some(m => m.field === field)) { map.push({ idx, field }); columns.push(str(h)); }
    else ignored.push(str(h));
  });
  const rows: ImportRow[] = [];
  for (const r of grid.slice(headerRow + 1)) {
    if (!r || r.every(c => str(c) === '')) continue;
    const o: ImportRow = { cn: '', first: '', last: '' };
    const hats: Partial<Record<HatCode, number>> = {};
    for (const { idx, field } of map) {
      const v = r[idx];
      switch (field) {
        case 'AER': case 'RJ': case 'SE': case 'CL': { const n = num(v); if (n !== undefined) hats[field] = n; break; }
        case 'days': case 'ns': case 'alm': case 'slv': { const n = num(v); if (n !== undefined) o[field] = n; break; }
        case 'returning': o.returning = /^a/i.test(str(v)); break;
        case 'cn': o.cn = str(v).toUpperCase().replace(/\s/g, ''); break;
        default: (o as unknown as Record<string, string>)[field] = str(v);
      }
    }
    if (Object.keys(hats).length) o.hats = hats;
    if (!o.cn && !o.first) continue;
    rows.push(o);
  }
  return { rows, columns, ignored, headerRow };
}

/** Reads an .xlsx/.xls/.csv file into a grid, using the sheet called Contractors when there is one. */
export async function readSheetFile(file: File): Promise<{ grid: unknown[][]; sheet: string }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.SheetNames.find(n => n.trim().toLowerCase() === 'contractors') || wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' }) as unknown[][];
  return { grid, sheet };
}

export async function importContractors(centerId: string, year: number, rows: ImportRow[]): Promise<ImportResult> {
  return must(await db.rpc('app_import_contractors', { p_center: centerId, p_year: year, p_rows: rows })) as ImportResult;
}

// ───────────── days ─────────────
export interface DaySummary {
  day: string; state: Day['state']; booked: number; confirmed: number; showed: number; noShow: number; firstDay: number;
  /** closed days: from the day's summary and payout lines */
  steps?: number; gross?: number; worked?: number;
}

export async function monthSummary(centerId: string, from: string, to: string): Promise<DaySummary[]> {
  const rows = must(await db.from('days')
    .select('day, state, summary, day_roster(confirmed_at, attendance, hire:hires(person:people(lifetime_days)))')
    .eq('center_id', centerId).gte('day', from).lte('day', to)) as unknown as
    { day: string; state: Day['state']; summary: Record<string, unknown> | null; day_roster: { confirmed_at: string | null; attendance: string | null; hire: { person: { lifetime_days: number } } | null }[] }[];
  // who worked a closed day = who has a payout line for it
  const lines = rows.some(d => d.state === 'closed')
    ? (await db.from('payout_lines').select('day, cn').eq('center_id', centerId).gte('day', from).lte('day', to)).data as { day: string; cn: string }[] | null
    : null;
  const worked = new Map<string, Set<string>>();
  for (const l of lines || []) { if (!worked.has(l.day)) worked.set(l.day, new Set()); worked.get(l.day)!.add(l.cn); }
  return rows.map(d => {
    const s = summarize(d.day, d.state, d.day_roster.map(r => ({
      confirmed_at: r.confirmed_at, attendance: r.attendance, firstDay: (r.hire?.person?.lifetime_days ?? 1) === 0,
    })));
    if (d.state === 'closed') {
      const num = (v: unknown) => (v == null || v === '' ? undefined : Number(v));
      return { ...s, steps: num(d.summary?.steps), gross: num(d.summary?.gross), worked: worked.get(d.day)?.size ?? num(d.summary?.showed) };
    }
    return s;
  });
}

export function summarize(day: string, state: Day['state'], roster: { confirmed_at: string | null; attendance: string | null; firstDay: boolean }[]): DaySummary {
  return {
    day, state,
    booked: roster.length,
    confirmed: roster.filter(r => r.confirmed_at).length,
    showed: roster.filter(r => r.attendance === 'showed').length,
    noShow: roster.filter(r => r.attendance === 'no_show').length,
    firstDay: roster.filter(r => r.firstDay).length,
  };
}

/** Calendar cells for a month: leading blanks (null) then one ISO date per day. Weeks start on Sunday. */
export function monthCells(year: number, month0: number): (string | null)[] {
  const first = new Date(year, month0, 1);
  const n = new Date(year, month0 + 1, 0).getDate();
  const iso = (d: number) => `${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return [...Array.from({ length: first.getDay() }, () => null), ...Array.from({ length: n }, (_, i) => iso(i + 1))];
}

export async function getDay(centerId: string, day: string): Promise<Day | null> {
  const res = await db.from('days').select('id, center_id, day, state, notes, closed_at, summary').eq('center_id', centerId).eq('day', day).maybeSingle();
  // (before the close-day columns exist, read without them)
  if (res.error && /closed_at|summary/.test(res.error.message)) {
    return must(await db.from('days').select('id, center_id, day, state, notes').eq('center_id', centerId).eq('day', day).maybeSingle()) as Day | null;
  }
  return must(res) as Day | null;
}

// ───────────── close day ─────────────
export interface CloseCheck {
  state: Day['state']; has_session: boolean;
  /** road-trip center: no attendance or NS list (who worked = who has a finalized payout) */
  road_trip?: boolean;
  carts: number; paid: number; steps: number; gross: number; upsells: number; booked: number; showed: number;
  unpaid: { worker_id: string; status: string; names: string | null; sales: number }[];
  unmarked: { cn: string; name: string }[];
  no_shows: { cn: string; name: string; status: string; ns_count: number }[];
  can_close: boolean;
}
export async function closeDayCheck(centerId: string, day: string): Promise<CloseCheck> {
  return must(await db.rpc('app_close_day_check', { p_center: centerId, p_day: day })) as CloseCheck;
}
export async function closeDay(centerId: string, day: string): Promise<DaySummaryStored> {
  return must(await db.rpc('app_close_day', { p_center: centerId, p_day: day })) as DaySummaryStored;
}

export async function listRoster(dayId: string): Promise<RosterRow[]> {
  const cols = 'id, day_id, hire_id, shuttle, manager_id, team, confirmed_at, confirmed_via, attendance, next_day, notes';
  const res = await db.from('day_roster').select(`${cols}, next_action, hire:hires(${HIRE_COLS})`).eq('day_id', dayId);
  // (before the roll-call column exists, read without it)
  if (res.error && /next_action/.test(res.error.message)) {
    return must(await db.from('day_roster').select(`${cols}, hire:hires(${HIRE_COLS})`).eq('day_id', dayId)) as unknown as RosterRow[];
  }
  return must(res) as unknown as RosterRow[];
}

/** Roll call answers → bookings / WDR / Quit (all showed people, or one). */
export async function applyNextDays(dayId: string, hireId?: string): Promise<{ booked: number; wdr: number; quit: number }> {
  return must(await db.rpc('app_apply_next_days', { p_day: dayId, p_hire: hireId ?? null })) as { booked: number; wdr: number; quit: number };
}

/** Showed days recorded in this app per hire (added to the imported lifetime days). */
export async function showedCounts(hireIds: string[]): Promise<Record<string, number>> {
  if (!hireIds.length) return {};
  const rows = must(await db.from('day_roster').select('hire_id').eq('attendance', 'showed').in('hire_id', hireIds)) as { hire_id: string }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.hire_id] = (out[r.hire_id] || 0) + 1;
  return out;
}

export async function book(centerId: string, day: string, hireIds: string[]): Promise<number> {
  return must(await db.rpc('app_book', { p_center: centerId, p_day: day, p_hires: hireIds })) as number;
}

export async function updateRoster(id: string, patch: Partial<Pick<RosterRow, 'manager_id' | 'team' | 'attendance' | 'notes' | 'shuttle' | 'next_day' | 'next_action'>> & { confirmed?: boolean }) {
  const { confirmed, ...rest } = patch;
  const body: Record<string, unknown> = { ...rest };
  if (confirmed !== undefined) { body.confirmed_at = confirmed ? new Date().toISOString() : null; body.confirmed_via = confirmed ? 'staff' : null; }
  must(await db.from('day_roster').update(body).eq('id', id));
}

export async function removeFromDay(id: string) { must(await db.from('day_roster').delete().eq('id', id)); }

/** Move a booking to another date: book there, then take it off this day. */
export async function moveBooking(row: RosterRow, centerId: string, toDay: string): Promise<void> {
  await book(centerId, toDay, [row.hire_id]);
  await removeFromDay(row.id);
}

export async function listCenterManagers(centerId: string): Promise<{ id: string; full_name: string; username: string }[]> {
  return must(await db.from('app_users').select('id, full_name, username').eq('rm_center_id', centerId).eq('is_active', true).order('full_name')) as
    { id: string; full_name: string; username: string }[];
}
