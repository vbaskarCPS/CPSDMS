// src/planner/features/mail/todos.ts — to-dos offered from email. Every half hour the planner-mail function reads
// what has come into a connected mailbox and saves what it asks of the person as their own docs (kind 'mailtodo',
// supabase/functions/planner-mail/mail.ts). Nothing is on their list yet: the Today card (MailTodos.tsx) shows the
// ones still waiting, and this is what its two buttons do. Add puts it on a day's to-do list through the very code
// Arvy's add_todos runs (features/arvy/act.ts prepare), on the day the email named or else today; Not needed puts it
// aside. Either way the doc stays, marked, so it isn't offered again. No React here; tested in todos.test.ts.
import { dayKey, docsChanged, getDocs, putDoc } from '../../lib/docs';
import { prepare } from '../arvy/act';
import { cleanMailTodo, MAILTODO_KIND, type MailTodo } from '../../../../supabase/functions/planner-mail/mail';

/** One offered to-do and the key of its doc. */
export interface Offered { key: string; todo: MailTodo }
/** How long one is offered for. After that it quietly stops showing (the doc stays). */
export const OFFER_DAYS = 14;

/** Of the docs loaded, the ones still to offer: waiting, found in the last OFFER_DAYS, the oldest email first. */
export function waitingOf(docs: { key: string; data: unknown }[], nowMs: number): Offered[] {
  const since = new Date(nowMs - OFFER_DAYS * 864e5).toISOString();
  const out: Offered[] = [];
  for (const d of docs) {
    const todo = cleanMailTodo(d.data);
    if (todo && todo.state === 'waiting' && (todo.found || todo.arrived || d.key) >= since) out.push({ key: d.key, todo });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
/** The ones waiting now. */
export async function loadOffered(): Promise<Offered[]> {
  // the docs are kept under when the email arrived: ones from long before the offer ran out needn't be loaded
  const docs = await getDocs<unknown>(MAILTODO_KIND, new Date(Date.now() - (OFFER_DAYS + 7) * 864e5).toISOString());
  return waitingOf(docs, Date.now());
}

/** The day one goes on: the day the email named when that is today or still ahead, else today. */
export const dayFor = (t: Pick<MailTodo, 'date'>, today: string): string => (t.date && t.date >= today ? t.date : today);
/** A day in a few words: "today", "tomorrow", "Thu, Nov 12". */
export function dayWords(day: string, today: string): string {
  if (day === today) return 'today';
  const [y, m, d] = today.split('-').map(Number), next = new Date(y, m - 1, d + 1);
  const tomorrow = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return day === tomorrow ? 'tomorrow' : new Date(`${day}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Add: onto that day's to-do list, by the same code Arvy's add_todos uses, then the offer is marked added.
 *  Returns the day it went on. */
export async function addOffered(o: Offered, today: string = dayKey()): Promise<string> {
  const day = dayFor(o.todo, today);
  const change = await prepare('add_todos', { todos: [{ text: o.todo.what, ...(o.todo.time && o.todo.date === day ? { time: o.todo.time } : {}) }], date: day });
  if (!change) throw new Error('That couldn’t be added.');
  await change.apply();
  docsChanged(change.kinds);
  // it is on the list now. If marking the offer fails, it stays on the card (and could be added again) rather than
  // being reported as not added: tried twice, then left.
  const done = { ...o.todo, state: 'added' as const, doneAt: new Date().toISOString(), addedTo: day };
  await putDoc(MAILTODO_KIND, o.key, done).catch(() => putDoc(MAILTODO_KIND, o.key, done)).catch(() => undefined);
  docsChanged([MAILTODO_KIND]);
  return day;
}
/** Not needed: put aside, and not offered again. */
export async function dismissOffered(o: Offered): Promise<void> {
  await putDoc(MAILTODO_KIND, o.key, { ...o.todo, state: 'dismissed' as const, doneAt: new Date().toISOString() });
  docsChanged([MAILTODO_KIND]);
}
