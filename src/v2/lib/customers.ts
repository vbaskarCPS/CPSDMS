// src/v2/lib/customers.ts — the customer CRM: the territory map (each customer's category this
// season) and the customer page (record, jobs, money and every visit at the house).
import { db, must } from './client';
import type { Client } from './clients';

// ───────────── categories on the map ─────────────
export type Cat = 'owed' | 'done' | 'new' | 'no' | 'past' | 'none';
export const CATS: { key: Cat; label: string; color: string; hint: string }[] = [
  { key: 'done', label: 'Back again', color: '#059669', hint: 'Done this season, and a customer before' },
  { key: 'new', label: 'New this season', color: '#2563eb', hint: 'Done this season, first time' },
  { key: 'owed', label: 'Owed', color: '#d97706', hint: 'Done this season, not paid yet (billed or e-transfer to confirm)' },
  { key: 'past', label: 'Past customer', color: '#6b7280', hint: 'A customer in earlier years, not done this season' },
  { key: 'no', label: 'Said no / invalid', color: '#e11d48', hint: 'Said no or marked invalid at the door this season' },
  { key: 'none', label: 'No history', color: '#cbd5e1', hint: 'On file with no jobs yet' },
];
export const catOf = (k: string) => CATS.find(c => c.key === k) || CATS[CATS.length - 1];

export interface MyArea { area: string; region: string | null; routes: number; customers: number; done: number }
export interface AreaPoint { id: string | null; lat: number; lng: number; route: string; cat: Cat; address: string; name: string | null; paid: number }
export interface AreaTotals { customers: number; done: number; new: number; back: number; past: number; owed: number; paid: number; owed_amount: number }
export interface AreaCustomers { points: AreaPoint[]; totals: AreaTotals; routes: number; year: number; said_no: number }

export async function myAreas(): Promise<MyArea[]> {
  return (must(await db.rpc('app_my_areas')) as MyArea[] | null) || [];
}

export async function areaCustomers(area: string): Promise<AreaCustomers> {
  const raw = must(await db.rpc('app_area_customers', { p_area: area })) as {
    points?: [string | null, number, number, string, Cat, string, string | null, number | string][];
    totals?: Partial<AreaTotals>; routes?: number; year?: number; said_no?: number;
  };
  return parseArea(raw);
}

export function parseArea(raw: {
  points?: [string | null, number, number, string, Cat, string, string | null, number | string][];
  totals?: Partial<AreaTotals>; routes?: number; year?: number; said_no?: number;
}): AreaCustomers {
  const t = raw.totals || {};
  const num = (v: unknown) => Number(v) || 0;
  return {
    points: (raw.points || []).filter(p => typeof p[1] === 'number' && typeof p[2] === 'number')
      .map(p => ({ id: p[0], lat: p[1], lng: p[2], route: p[3], cat: (CATS.some(c => c.key === p[4]) ? p[4] : 'none') as Cat, address: p[5] || '', name: p[6], paid: num(p[7]) })),
    totals: { customers: num(t.customers), done: num(t.done), new: num(t.new), back: num(t.back), past: num(t.past), owed: num(t.owed), paid: num(t.paid), owed_amount: num(t.owed_amount) },
    routes: num(raw.routes), year: num(raw.year) || new Date().getFullYear(), said_no: num(raw.said_no),
  };
}

export const countByCat = (pts: AreaPoint[]) => {
  const out = Object.fromEntries(CATS.map(c => [c.key, 0])) as Record<Cat, number>;
  for (const p of pts) out[p.cat]++;
  return out;
};

// ───────────── one customer ─────────────
export interface Job {
  year: number | string | null; service?: string; product?: string; source?: string; price?: string; payment?: string; payment_detail?: string;
  paid?: 'paid' | 'owed' | 'to_confirm' | string; contractor?: string; crew?: { hire_id?: string; cn?: string; name?: string }[];
  date?: string; route?: string; line?: string; src?: string; day?: string;
}
export interface Visit { day: string; at: string; status: string; note?: string; first_name?: string; worker_id?: string; worker?: string }
export interface CustomerFull {
  client: Omit<Client, 'history'> & { history: Job[]; created_at?: string };
  area: string | null; visits: Visit[]; texts: { at: string }[];
}

export async function customer(id: string): Promise<CustomerFull> {
  const raw = must(await db.rpc('app_customer', { p_id: id })) as CustomerFull;
  return { ...raw, client: { ...raw.client, history: raw.client?.history || [], people: raw.client?.people || [], phones: raw.client?.phones || [], emails: raw.client?.emails || [], tags: raw.client?.tags || [] },
    visits: raw.visits || [], texts: raw.texts || [] };
}

export const VISIT: Record<string, { label: string; tone: 'g' | 'a' | 'b' | 'v' | 'r' | undefined }> = {
  no: { label: 'Said no', tone: 'r' }, invalid: { label: 'Invalid', tone: 'r' }, not_home: { label: 'Not home', tone: undefined }, go_back: { label: 'Go back', tone: 'a' },
};
export const PAID: Record<string, { label: string; tone: 'g' | 'a' | 'r' }> = {
  paid: { label: 'Paid', tone: 'g' }, owed: { label: 'Owed', tone: 'r' }, to_confirm: { label: 'To confirm', tone: 'a' },
};

export const money = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const fmtMoney = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Jobs grouped by year, newest year first; within a year, newest date first. */
export function jobsByYear(jobs: Job[]): { year: string; jobs: Job[] }[] {
  const by = new Map<string, Job[]>();
  for (const j of jobs) { const y = j.year ? String(j.year) : '—'; if (!by.has(y)) by.set(y, []); by.get(y)!.push(j); }
  return [...by.entries()].sort((a, b) => (b[0] === '—' ? -1 : a[0] === '—' ? 1 : Number(b[0]) - Number(a[0])))
    .map(([year, js]) => ({ year, jobs: [...js].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) }));
}

/** What the customer has paid and owes: lifetime, this season, and what's still owed. */
export function moneySummary(jobs: Job[], year: number) {
  let lifetime = 0, season = 0, owed = 0, count = 0;
  for (const j of jobs) {
    const p = money(j.price);
    const unpaid = j.paid === 'owed' || j.paid === 'to_confirm';
    if (unpaid) owed += p; else lifetime += p;
    if (String(j.year) === String(year) && !unpaid) season += p;
    count++;
  }
  const years = new Set(jobs.map(j => j.year).filter(Boolean).map(String));
  return { lifetime, season, owed, jobs: count, years: years.size };
}

export interface TimelineItem { at: string; kind: 'job' | 'visit' | 'text'; title: string; detail?: string; tone?: 'g' | 'a' | 'b' | 'v' | 'r' }

/** Every touch at the house, newest first: jobs (with a date), knocks and texts sent. */
export function timeline(c: CustomerFull): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const j of c.client.history) {
    if (!j.date) continue;
    const what = [j.product || j.service, j.price && `${fmtMoney(money(j.price))}`].filter(Boolean).join(' · ');
    const crew = (j.crew || []).map(x => x.name).filter(Boolean).join(', ') || j.contractor;
    out.push({ at: j.date, kind: 'job', title: `Job done${what ? ` — ${what}` : ''}`, detail: [j.source, crew && `crew: ${crew}`, j.paid && PAID[j.paid]?.label].filter(Boolean).join(' · '), tone: 'g' });
  }
  for (const v of c.visits) {
    const s = VISIT[v.status] || { label: v.status, tone: undefined };
    out.push({ at: v.at || v.day, kind: 'visit', title: `Knock — ${s.label}`, tone: s.tone,
      detail: [v.worker || v.worker_id, v.first_name && `spoke to ${v.first_name}`, v.note && `“${v.note}”`].filter(Boolean).join(' · ') });
  }
  for (const t of c.texts) out.push({ at: t.at, kind: 'text', title: 'Text sent (past-client outreach)', tone: 'b' });
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** "2026-10-06" or an ISO time → "Tue Oct 6, 2026" (a bare date stays on its own day). */
export function fmtDay(s: string): string {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
