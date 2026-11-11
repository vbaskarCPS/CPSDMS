// src/v2/lib/payoutQueue.ts — a line-up of payouts to finalize one after another on the payout screen.
//
// The Benny lines up the open payouts that have nothing to count by hand (no cash, no cheque). Nothing is paid out by
// the line-up: each payout opens on the payout screen, the person presses Finalize, and the screen moves to the next.
// The line-up rides in the address (?queue=I1167,I1013&at=1&of=3), so a refresh or the back button keeps its place.
const CN = /^[A-Za-z0-9_.-]{1,40}$/;

export const dayHref = (date: string) => `/app/workerbook/days/${date}`;
export const payoutHref = (date: string, cn: string) => `${dayHref(date)}/payouts/${encodeURIComponent(cn)}`;

/** The first payout of a line-up, carrying the rest. null when there is nobody to open. */
export function queueHref(date: string, cns: string[], at = 1, of?: number): string | null {
  const list = [...new Set(cns.filter(c => CN.test(c)))];
  if (!list.length) return null;
  const total = Math.max(of ?? list.length, at + list.length - 1);
  const rest = list.slice(1);
  return `${payoutHref(date, list[0])}?${rest.length ? `queue=${rest.join(',')}&` : ''}at=${at}&of=${total}`;
}

export interface PayoutQueue { rest: string[]; at: number; of: number }
/** The line-up a payout page was opened with, from its address. null = opened on its own. */
export function readQueue(search: string): PayoutQueue | null {
  const q = new URLSearchParams(search);
  const at = Number(q.get('at')); const of = Number(q.get('of'));
  if (!Number.isInteger(at) || !Number.isInteger(of) || at < 1 || of < at || of > 200) return null;
  const rest = (q.get('queue') || '').split(',').map(s => s.trim()).filter(c => CN.test(c)).slice(0, of - at);
  return { rest, at, of };
}

/** Where the payout screen goes after this one: the next in the line-up, or back to the day when it was the last. */
export function afterHref(date: string, q: PayoutQueue | null): string {
  if (!q || !q.rest.length) return dayHref(date);
  return queueHref(date, q.rest, q.at + 1, q.of) || dayHref(date);
}
