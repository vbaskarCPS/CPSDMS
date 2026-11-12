// src/planner/features/mail/finish.ts — the last step of connecting a mailbox. After the sign-in on Google's page the
// browser lands on Settings › Email with Google's code and the sign-in's state after the # of the address:
//   …/settings/mail#mail_code=…&mail_state=…
// (after the #, so neither is ever sent to a server or passed along to another site). This file takes both out of
// the address bar the moment the planner loads, before anything is drawn or the router has looked at the address,
// and keeps them in memory only: never in the address, never in storage. Settings › Email then hands them to the
// planner-mail function once (finishReturn). The function connects the mailbox only when the person signed in to
// this planner is the one who tapped Connect.
// If nobody is signed in here, the planner's sign-in screen shows first (and the router drops the # on its way
// there). The two values wait in memory; once the person has signed in and is taken on to Settings › Email, the
// finish happens. They wait ten minutes at most (the sign-in is no good after that anyway), and a reload of the
// page forgets them: then it's Connect Gmail again.
// No React here; tested in client.test.ts.
import { connectFinish, MailProblem, type Mailbox } from './mail';

/** How the finish ended: the mailbox that is now connected and the person's list, or why nothing was connected. */
export type Finished = { connected: string; mailboxes: Mailbox[] } | { problem: string };
/** How long what came back is kept waiting (for the planner's own sign-in screen): as long as the sign-in is good for. */
export const WAIT_MS = 10 * 60_000;
const TOO_LONG = 'That sign-in took too long. Tap Connect Gmail again.';

let held: { code: string; state: string; at: number } | null = null;   // what came back, waiting to be handed over
let running: Promise<Finished> | null = null;                           // the one hand-over, while it's on its way

/** Take what Google's page handed back out of the address bar and keep it in memory. Only on Settings › Email, and
 *  only when both pieces are there and look right; the address keeps its path and loses everything after the #. */
export function readReturn(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, hist: Pick<History, 'replaceState' | 'state'>, now: number = Date.now()): void {
  if (!loc.hash || !/[#&]mail_(?:code|state)=/.test(loc.hash)) return;
  if (!loc.pathname.replace(/\/+$/, '').endsWith('/settings/mail')) return;
  const got = new URLSearchParams(loc.hash.slice(1));
  const code = got.get('mail_code') || '', state = got.get('mail_state') || '';
  // out of the address first, whatever it holds: nothing after this line can leave it there
  try { hist.replaceState(hist.state, '', loc.pathname + loc.search); } catch { /* an address bar we can't write to: it is still handed over once */ }
  if (/^[A-Za-z0-9_-]{43}$/.test(state) && code.length >= 4 && code.length <= 1024 && /^[\x21-\x7e]+$/.test(code)) held = { code, state, at: now };
}
/** Is a finish waiting to be made, or on its way? (Settings › Email shows "Finishing…".) */
export const returnWaiting = (now: number = Date.now()): boolean => !!running || (!!held && now - held.at <= WAIT_MS);

/** Hand what came back to the function. Made once: asking again while it's on its way gives the same answer (a screen
 *  is sometimes drawn twice), and asking after it's done gives null. null = there is nothing to finish. */
export function finishReturn(now: number = Date.now()): Promise<Finished> | null {
  if (running) return running;
  const got = held;
  if (!got) return null;
  held = null;   // gone from memory before anything is sent: it can't be handed over twice
  if (now - got.at > WAIT_MS) return Promise.resolve({ problem: TOO_LONG });
  const done: Promise<Finished> = connectFinish(got.code, got.state)
    .then((r): Finished => r, (e): Finished => ({ problem: e instanceof MailProblem ? e.message : 'The planner couldn’t be reached to finish connecting. Check the connection and tap Connect Gmail again.' }))
    .finally(() => { if (running === done) running = null; });
  running = done;
  return done;
}
/** Forget anything waiting (the tests start clean). */
export const forgetReturn = (): void => { held = null; running = null; };

// the moment the planner loads: before the first screen is drawn, and before the router can pass the address on
if (typeof window !== 'undefined') readReturn(window.location, window.history);
