// src/v2/lib/importGuard.ts — the checks every client-list import passes before it can be saved,
// on top of what the reader notices (importChecks). Nothing here trusts The Benny: a column The
// Benny mapped is still read back and counted, and the database refuses the same bad years and
// card numbers again on its side.
//
//   sensitiveColumns   columns that look like card numbers, CVCs, SINs, licence, health card or
//                      passport numbers: forced to Ignore, hidden from The Benny, never saved
//   guardChecks        stop / warn / info lines for the review screen (see GuardInput)
//   importSummary      the shape of an import (rows, jobs per service and year, prices), kept with
//                      the import so the next file with the same layout can be compared to it
//   auditSample        25 rows, as the sheet has them and as they were read, for The Benny to
//                      double-check
import { cell, cleanYear, FIRST_SERVICE_YEAR, type Applied, type ImportCheck, type Mapping } from './clientImport';

// ───────────── privacy guard ─────────────
export interface Sensitive { i: number; header: string; why: string }

const SENSITIVE_HEADER: [RegExp, string][] = [
  [/\b(card ?(no|num|number|#)?|credit|cc ?(no|num|#)?|visa|master ?card|amex)\b/i, 'card numbers'],
  [/\b(cvv|cvc|csc|cvv2|security code)\b/i, 'card security codes'],
  [/\b(expiry|expiration|exp\.? ?date)\b/i, 'card expiry dates'],
  [/\b(sin|s\.i\.n\.?|social insurance)\b/i, 'SIN numbers'],
  [/\b(licen[cs]e|driver'?s? ?lic|dl ?#)\b/i, 'licence numbers'],
  [/\b(health ?card|ohip|hcn)\b/i, 'health card numbers'],
  [/\bpassport\b/i, 'passport numbers'],
  [/\b(bank|account ?(no|num|#)|acct|transit|institution ?(no|#)?|routing)\b/i, 'bank details'],
];

export function luhnOk(d: string): boolean {
  if (!/^\d{2,}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
const CARD = /(?<!\d)((?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|6011|65\d{2})(?:[ -]?\d{4}){3}|3[47]\d{2}[ -]?\d{6}[ -]?\d{5})(?!\d)/g;
/** A payment card number (15–16 digits that pass the card check) anywhere in the text. */
export const hasCardNumber = (t: string) => [...t.matchAll(CARD)].some(m => luhnOk(m[1].replace(/\D/g, '')));
const isSin = (t: string) => /^\d{3}[ -]?\d{3}[ -]?\d{3}$/.test(t.trim()) && luhnOk(t.replace(/\D/g, ''));

/** Columns that must never be read: by their title, or because their cells look like card numbers or SINs. */
export function sensitiveColumns(rows: unknown[][], headerRow: number): Sensitive[] {
  const headers = (rows[headerRow] || []).map(cell);
  const body = rows.slice(headerRow + 1);
  const width = Math.max(headers.length, ...body.slice(0, 300).map(r => (r || []).length), 0);
  const out: Sensitive[] = [];
  for (let i = 0; i < width; i++) {
    const header = headers[i] || '';
    const byTitle = SENSITIVE_HEADER.find(([re]) => re.test(header));
    if (byTitle) { out.push({ i, header, why: byTitle[1] }); continue; }
    const vals = body.map(r => cell((r || [])[i])).filter(Boolean);
    if (!vals.length) continue;
    const share = (f: (v: string) => boolean) => vals.filter(f).length / vals.length;
    if (vals.some(hasCardNumber) && share(hasCardNumber) >= 0.2) out.push({ i, header, why: 'card numbers' });
    else if (share(isSin) >= 0.5) out.push({ i, header, why: 'SIN numbers' });
  }
  return out;
}

/** The layout with every sensitive column set to Ignore. */
export function lockSensitive(m: Mapping, sens: Sensitive[]): Mapping {
  if (!sens.some(s => m.columns[String(s.i)]?.field && m.columns[String(s.i)].field !== 'ignore')) return m;
  const columns = { ...m.columns };
  for (const s of sens) columns[String(s.i)] = { field: 'ignore' };
  return { ...m, columns };
}

/** The rows with sensitive cells blanked out, for anything sent to The Benny. */
export function maskRows(rows: unknown[][], sens: Sensitive[], headerRow: number): unknown[][] {
  if (!sens.length) return rows;
  const hide = new Set(sens.map(s => s.i));
  return rows.map((r, k) => k <= headerRow || !Array.isArray(r) ? r : r.map((v, i) => hide.has(i) && cell(v) ? '[hidden]' : v));
}

// ───────────── the shape of an import ─────────────
export interface ImportSummary {
  rows: number;
  /** jobs per service line and year */
  lines: Record<string, Record<string, number>>;
  /** middle price per service line */
  price: Record<string, number>;
}
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
export function importSummary(a: Applied): ImportSummary {
  const lines: ImportSummary['lines'] = {}; const prices = new Map<string, number[]>();
  for (const c of a.clients) for (const h of c.history) {
    const l = h.line || '—'; const y = h.year == null ? 'no year' : String(h.year);
    (lines[l] ||= {})[y] = (lines[l][y] || 0) + 1;
    const p = Number(h.price); if (h.price && Number.isFinite(p)) { if (!prices.has(l)) prices.set(l, []); prices.get(l)!.push(p); }
  }
  return { rows: a.rowsRead, lines, price: Object.fromEntries([...prices].map(([l, ps]) => [l, median(ps)])) };
}

// ───────────── the checks ─────────────
const SEASON: Record<string, number[]> = {
  aeration: [3, 4, 5, 6, 8, 9, 10, 11], sealing: [4, 5, 6, 7, 8, 9, 10, 11], lawn_rejuv: [4, 5, 6, 7, 8, 9, 10], cleaning: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
const PRICE_BAND: Record<string, [number, number]> = {
  aeration: [20, 500], sealing: [50, 2500], lawn_rejuv: [40, 3000], cleaning: [40, 2500],
};
const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LINE_NAME: Record<string, string> = { aeration: 'aeration', sealing: 'sealing', lawn_rejuv: 'lawn rejuv', cleaning: 'window cleaning' };
const n = (x: number) => x.toLocaleString();
const s = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

export interface AuditResult {
  state: 'running' | 'done' | 'failed';
  checked?: number;
  problems?: { row: number; what: string }[];
  error?: string;
}
export interface GuardInput {
  rows: unknown[][];
  mapping: Mapping;
  applied: Applied;
  sensitive: Sensitive[];
  /** the last finished import with the same layout */
  baseline?: { summary: ImportSummary; at: string } | null;
  /** earlier imports of exactly this file */
  sameFile?: { file_name: string; created_at: string }[];
  audit?: AuditResult | null;
}

export function guardChecks(g: GuardInput): ImportCheck[] {
  const out: ImportCheck[] = [];
  const { rows, mapping: m, applied: a } = g;

  for (const x of g.sensitive) {
    out.push({ level: 'warn', text: `Column “${x.header || `#${x.i + 1}`}” looks like ${x.why}. It is ignored, hidden from The Benny and never saved.` });
  }
  if (!m.serviceLine) out.push({ level: 'stop', text: 'Pick which service these are past clients of. Each route keeps a separate past-client list per service.' });

  // every row is accounted for: imported (alone or combined with others at its address) or skipped
  const placed = a.clients.reduce((t, c) => t + c.rows.length, 0);
  if (placed + a.skipped.length !== a.rowsRead) {
    out.push({ level: 'stop', text: `${s(Math.abs(a.rowsRead - placed - a.skipped.length), 'row')} of the file can't be accounted for (read ${n(a.rowsRead)}, imported ${n(placed)}, skipped ${n(a.skipped.length)}). Ask The Benny again or start over.` });
  }

  // read back: each row's YEAR cell must be one of its customer's job years
  const yearCols = Object.entries(m.columns).filter(([, r]) => r.field === 'year' && !r.year).map(([i]) => Number(i));
  if (yearCols.length) {
    const misses: { row: number; year: number }[] = [];
    for (const c of a.clients) {
      const years = new Set(c.history.map(h => h.year));
      for (const r of c.rows) {
        const raw = yearCols.map(i => cleanYear(cell((rows[r - 1] || [])[i]))).find(y => y != null);
        if (raw != null && !years.has(raw)) misses.push({ row: r, year: raw });
      }
    }
    if (misses.length) {
      const ex = misses.slice(0, 3).map(x => `row ${x.row}: YEAR ${x.year}`).join(', ');
      out.push({ level: 'stop', text: `${s(misses.length, 'row')} would be saved without the year in their YEAR cell (${ex}). The layout is reading the year from the wrong place.` });
    }
  }

  // dates in the service's season, prices in its usual range
  const jobs = a.clients.flatMap(c => c.history.map(h => ({ h, c })));
  for (const line of Object.keys(SEASON)) {
    const dated = jobs.filter(({ h }) => h.line === line && h.date);
    const off = dated.filter(({ h }) => !SEASON[line].includes(Number(h.date!.slice(5, 7))));
    if (off.length >= 3 && off.length / dated.length > 0.05) {
      const ex = off[0];
      out.push({ level: 'warn', text: `${s(off.length, `${LINE_NAME[line]} job`)} are dated outside the ${LINE_NAME[line]} season (e.g. ${ex.c.house_no} ${ex.c.street_name}: ${MONTH[Number(ex.h.date!.slice(5, 7))]} ${ex.h.date!.slice(0, 4)}). Check the service and the date column.` });
    }
    const priced = jobs.filter(({ h }) => h.line === line && h.price && Number.isFinite(Number(h.price)));
    const [lo, hi] = PRICE_BAND[line];
    const odd = priced.filter(({ h }) => Number(h.price) < lo || Number(h.price) > hi);
    if (odd.length >= 3 && odd.length / priced.length > 0.1) {
      out.push({ level: 'warn', text: `${s(odd.length, `${LINE_NAME[line]} price`)} are outside the usual $${lo}–$${n(hi)} (e.g. $${odd[0].h.price}). Check the service and the price column.` });
    }
  }

  // compared with the last file of the same layout
  if (g.baseline) {
    const was = g.baseline.summary; const now = importSummary(a);
    const when = new Date(g.baseline.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    if (was.rows >= 50 && (now.rows > was.rows * 5 || now.rows * 5 < was.rows)) {
      out.push({ level: 'warn', text: `The last file with this layout (${when}) had ${s(was.rows, 'row')}; this one has ${n(now.rows)}. Check it's the same kind of list.` });
    }
    const lines = (x: ImportSummary) => Object.keys(x.lines).filter(l => l !== '—');
    const wasLines = lines(was); const nowLines = lines(now);
    if (wasLines.length && nowLines.length && !nowLines.some(l => wasLines.includes(l))) {
      out.push({ level: 'warn', text: `The last file with this layout was ${wasLines.map(l => LINE_NAME[l] || l).join(' and ')}; this one reads as ${nowLines.map(l => LINE_NAME[l] || l).join(' and ')}.` });
    }
    for (const l of nowLines) {
      const yw = Object.keys(was.lines[l] || {}).filter(y => y !== 'no year'); const yn = Object.keys(now.lines[l] || {}).filter(y => y !== 'no year');
      if (yw.length >= 3 && yn.length === 1 && now.rows >= 50) {
        out.push({ level: 'warn', text: `Last time this layout's ${LINE_NAME[l] || l} jobs were spread over ${yw.length} years; this file puts every one in ${yn[0]}.` });
      }
      const pw = was.price[l]; const pn = now.price[l];
      if (pw && pn && (pn > pw * 2 || pn * 2 < pw)) {
        out.push({ level: 'warn', text: `The usual ${LINE_NAME[l] || l} price was $${pw} last time and is $${pn} in this file. Check the price column.` });
      }
    }
  }

  if (g.sameFile?.length) {
    const f = g.sameFile[0];
    out.push({ level: 'warn', text: `This exact file was imported before (${f.file_name}, ${new Date(f.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}). Jobs already saved won't be added twice, but check you meant to bring it in again.` });
  }

  const au = g.audit;
  if (au?.state === 'running') out.push({ level: 'info', text: 'The Benny is double-checking 25 rows against the sheet…' });
  else if (au?.state === 'failed') out.push({ level: 'warn', text: `The Benny couldn't double-check the rows (${au.error || 'no answer'}). The other checks still ran; you can ask it again.` });
  else if (au?.state === 'done') {
    if (au.problems?.length) {
      for (const p of au.problems.slice(0, 6)) out.push({ level: 'warn', text: `The Benny's double-check, row ${p.row}: ${p.what}` });
      if (au.problems.length > 6) out.push({ level: 'warn', text: `…and ${s(au.problems.length - 6, 'more row')} The Benny flagged.` });
    } else out.push({ level: 'info', text: `The Benny double-checked ${s(au.checked || 0, 'row')} against the sheet: they read right.` });
  }
  return out;
}

export const hasStop = (checks: ImportCheck[]) => checks.some(c => c.level === 'stop');

// ───────────── The Benny's double-check ─────────────
export interface AuditRow {
  row: number;
  sheet: Record<string, string>;
  read: { address: string; city: string; people: string[]; phones: string[]; emails: string[]; jobs: unknown[]; tags: string[]; flags: string[] };
}
/** Up to `count` rows spread over the file, as the sheet has them and as they were read. */
export function auditSample(rows: unknown[][], m: Mapping, a: Applied, sens: Sensitive[], count = 25): AuditRow[] {
  const headers = (rows[m.headerRow] || []).map(cell);
  const hide = new Set(sens.map(x => x.i));
  const cols = Object.entries(m.columns).filter(([i, r]) => r.field !== 'ignore' && !hide.has(Number(i))).map(([i]) => Number(i));
  const list = a.clients;
  if (!list.length) return [];
  const step = list.length / Math.min(count, list.length);
  const out: AuditRow[] = [];
  for (let k = 0; k < Math.min(count, list.length); k++) {
    const c = list[Math.floor(k * step + step / 2) % list.length];
    const r = c.rows[0];
    const sheet: Record<string, string> = {};
    for (const i of cols) { const v = cell((rows[r - 1] || [])[i]); if (v) sheet[headers[i] || `column ${i + 1}`] = v.slice(0, 120); }
    out.push({ row: r, sheet, read: {
      address: [c.unit && `Unit ${c.unit}`, `${c.house_no} ${c.street_name}`].filter(Boolean).join(', '), city: c.city,
      people: c.people.map(p => `${p.first} ${p.last}`.trim()), phones: c.phones, emails: c.emails,
      jobs: c.history, tags: c.tags, flags: [c.do_not_call && 'do not call', c.do_not_text && 'do not text', c.call_first && `call first: ${c.call_first}`].filter(Boolean) as string[],
    } });
  }
  return out;
}

/** The sheet cells an import row came from (the columns that were read; never a hidden one). */
export function sourceCells(rows: unknown[][], m: Mapping, sheetRows: number[], sens: Sensitive[]): { row: number; cells: Record<string, string> }[] {
  const headers = (rows[m.headerRow] || []).map(cell);
  const hide = new Set(sens.map(x => x.i));
  const cols = Object.entries(m.columns).filter(([i, r]) => r.field !== 'ignore' && !hide.has(Number(i))).map(([i]) => Number(i));
  return sheetRows.slice(0, 20).map(r => {
    const cells: Record<string, string> = {};
    for (const i of cols) { const v = cell((rows[r - 1] || [])[i]); if (v) cells[headers[i] || `column ${i + 1}`] = v.slice(0, 200); }
    return { row: r, cells };
  });
}

export { FIRST_SERVICE_YEAR };
