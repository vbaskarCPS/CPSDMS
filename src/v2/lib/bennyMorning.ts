// src/v2/lib/bennyMorning.ts — the Benny's morning report. At the person's morning time (Settings › Notifications, 7:30
// by default) a notification goes out, and the Benny opens with what it has learned since they last looked (a "See
// what's new" button), any day from before today that's still open, and, for people who run the workerbook, an offer to
// help start the day. Shown once a day. The database decides what's in it (benny_morning).
import { db } from './client';

export interface MorningNew { id: string; title: string; how: string; ask: string | null; on: string }
export interface MorningOpen { center_id: string; center: string; day: string }
export interface MorningReport { due: boolean; today: string; line: string; new: MorningNew[]; open: MorningOpen[]; can_start: boolean }

/** The report. Never in the way: a failure is no report. */
export async function bennyMorning(force = false): Promise<MorningReport | null> {
  try {
    const { data, error } = await db.rpc('benny_morning', { p_force: force });
    return !error && data && typeof data === 'object' ? data as MorningReport : null;
  } catch { return null; }
}
/** Shown (and, with seenNew, what's new was looked at, so it isn't counted again). */
export async function bennyMorningSeen(seenNew = false): Promise<void> {
  try { await db.rpc('benny_morning_seen', { p_new: seenNew }); } catch { /* it shows again */ }
}

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

/** The Benny's first message of the day. Pure, so it's tested. */
export function morningText(r: MorningReport, name?: string | null): string {
  const first = (name || '').trim().split(/\s+/)[0];
  const lines = [`**Good morning${first ? `, ${first}` : ''}.**`];
  const n = r.new.length;
  if (n) lines.push(`I learned how to do ${n === 1 ? '1 new thing' : `${n} new things`} since you last looked.`);
  if (r.open.length === 1) lines.push(`${r.open[0].center} ${day(r.open[0].day)} hasn’t been closed yet.`);
  else if (r.open.length > 1) lines.push(`These days haven’t been closed yet: ${r.open.map(o => `${o.center} ${day(o.day)}`).join(', ')}.`);
  if (r.can_start) lines.push(r.open.length ? 'Once that’s closed, want help starting today?' : 'Want help starting the day?');
  if (lines.length === 1) lines.push('Nothing new this morning. Ask me anything.');
  return lines.join('\n');
}

/** What's new, as the Benny's message: each thing and what to say to try it. */
export function whatsNewText(list: MorningNew[]): string {
  if (!list.length) return 'Nothing new since you last looked.';
  return [`**What’s new (${list.length})**`, ...list.map(x => `• **${x.title}**: ${x.how}`)].join('\n');
}

/** The day's page, to close a day that's still open. */
export const openDayHref = (o: MorningOpen) => `/app/workerbook/days/${o.day}`;
/** "Help me start the day": what the Benny is asked. */
export const START_ASK = 'Help me start today';
/** The morning link from the notification (?benny=morning) */
export const fromMorningLink = (search: string) => new URLSearchParams(search).get('benny') === 'morning';
