// src/v2/lib/notify.ts — Settings › Notifications: which notifications a person gets on their phone, about whom, and
// their quiet hours. The database decides who can have which (their permissions), so the list differs per person.
import { db, must } from './client';

export type Scope = 'mine' | 'team' | 'center';
export interface NotifyEvent {
  key: string; group: string; group_label: string; label: string; help: string | null;
  scopes: Scope[]; on: boolean; scope: Scope; minutes: number | null;
}
export interface Quiet { on: boolean; from: string; to: string; tz: string }
export interface NotifySettings { devices: number; quiet: Quiet; events: NotifyEvent[]; /** the Benny's morning report, HH:MM */ morning?: string }

export const SCOPE_LABEL: Record<Scope, string> = { mine: 'Mine', team: 'My team', center: 'Whole center' };
export const MINUTES = [30, 60, 90, 120] as const;

export async function notifyGet(): Promise<NotifySettings> {
  return must(await db.rpc('notify_get')) as NotifySettings;
}
export async function notifySet(key: string, on: boolean | null, scope?: Scope | null, minutes?: number | null): Promise<void> {
  must(await db.rpc('notify_set', { p_event: key, p_on: on, p_scope: scope ?? null, p_minutes: minutes ?? null }));
}
export async function notifyQuietSet(q: Pick<Quiet, 'on' | 'from' | 'to'>): Promise<void> {
  let tz: string | null = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* the saved one stays */ }
  must(await db.rpc('notify_quiet_set', { p_on: q.on, p_from: q.from, p_to: q.to, p_tz: tz }));
}
/** The time of the Benny's morning report (HH:MM, the person's own time). */
export async function notifyMorningSet(at: string): Promise<void> {
  must(await db.rpc('notify_morning_set', { p_at: at }));
}
export async function notifyTest(): Promise<{ ok: boolean; devices: number }> {
  return must(await db.rpc('notify_test')) as { ok: boolean; devices: number };
}

/** The events in their groups, in the order the database gives them. */
export function grouped(events: NotifyEvent[]): { group: string; label: string; events: NotifyEvent[] }[] {
  const out: { group: string; label: string; events: NotifyEvent[] }[] = [];
  for (const e of events) {
    const g = out.find(x => x.group === e.group && x.label === e.group_label);
    if (g) g.events.push(e); else out.push({ group: e.group, label: e.group_label, events: [e] });
  }
  return out;
}

/** "9:00 pm" from "21:00". */
export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm;
  const h = Number(m[1]); const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 || 12;
  return `${h12}:${m[2]} ${ap}`;
}
