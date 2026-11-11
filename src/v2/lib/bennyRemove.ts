// src/v2/lib/bennyRemove.ts — taking a worker off today's live day through the Benny: the pure parts of its card.
//
// The card does what the route manager map's "Remove from session" does, after the person taps it. That erases the
// worker's logsheet for the day, so the database only lets through a worker with nothing logged who was named exactly
// (benny_check_remove), and records each removal (benny_removals). No database here: tested in bennyRemove.test.ts.

/** One worker on the card, as the database checked them. */
export interface RemoveWorker {
  cn: string; name: string; manager?: string; manager_name?: string; cart_id?: string;
  /** who they share a cart with (they stay on it) */
  mates?: string[];
  /** their routes today; frees = the ones nobody else is on, which go back to free */
  routes?: string[]; frees?: string[]; prebooks?: number;
  /** today's list: what it says now, and what it will say once they are off */
  roster?: { id: string; now: string; then: string };
}
export interface RemoveCheck { ok: boolean; problems?: string[]; date: string; center_type?: string; workers: RemoveWorker[]; stamp: string }
/** What the database found once the app had removed them (benny_remove_done). */
export interface RemoveDone { state?: 'done' | 'partly' | 'not_removed' | 'unknown'; workers?: { cn: string; name: string; state: string; routes?: string[]; roster?: string }[] }

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What happens to today's list, in words; null when it doesn't change (not on the list, or already says so). */
export function rosterLine(workers: Pick<RemoveWorker, 'roster'>[]): string | null {
  const changing = workers.filter(w => w.roster && w.roster.now !== w.roster.then);
  if (!changing.length) return null;
  const all = changing.length === workers.length; const who = workers.length === 1 ? 'them' : all ? 'them' : `${changing.length} of them`;
  return changing[0].roster!.then === 'no_show' ? `Today’s list will have ${who} as a no-show.` : `Today’s list will no longer have ${who} marked as showed.`;
}

/** The card's words: who comes off, what they leave behind, what the list will say, and that it can't be undone here. */
export function removeCard(c: Pick<RemoveCheck, 'workers'>): { title: string; lines: string[]; action: string } {
  const n = c.workers.length;
  const lines = c.workers.map(w => {
    const bits: string[] = [];
    if (w.mates?.length) bits.push(`leaves ${list(w.mates)} on the cart`);
    if (w.frees?.length) bits.push(`${list(w.frees)} ${plural(w.frees.length, 'goes', 'go')} back to free${w.prebooks ? ` (${w.prebooks} ${plural(w.prebooks, 'prebook stays', 'prebooks stay')} on ${plural(w.frees.length, 'it', 'them')})` : ''}`);
    else if (!w.routes?.length) bits.push('no route');
    return `${w.name} (${w.cn})${w.manager_name ? `, ${w.manager_name}’s team` : ''}${bits.length ? `: ${bits.join('; ')}` : ''}`;
  });
  const roster = rosterLine(c.workers);
  return {
    title: n === 1 ? `Take ${c.workers[0].name} off today` : `Take ${n} workers off today`,
    lines: [...lines, ...(roster ? [roster] : []),
      `Nothing is logged for ${plural(n, 'them', 'any of them')} today. ${plural(n, 'Their logsheet', 'Their logsheets')} for today ${plural(n, 'is', 'are')} erased, and this can’t be undone from here: if they turn up, add them again from the day page (Late arrival).`],
    action: 'Remove from today',
  };
}

/** What to say once it's done, from what the database found (only the ones who really are off). */
export function removedSaid(check: Pick<RemoveCheck, 'workers'>, done: RemoveDone): string {
  const off = (done.workers || []).filter(x => x.state === 'done');
  const offCns = new Set(off.map(x => x.cn));
  const frees = check.workers.filter(w => offCns.has(w.cn)).flatMap(w => w.frees || []);
  const marks = [...new Set(off.map(x => x.roster).filter(Boolean))];
  const them = off.length === 1 ? off[0].name.split(' ')[0] : 'them';
  return [`${list(off.map(x => x.name))} ${plural(off.length, 'is', 'are')} off today’s map.`,
    frees.length ? `${list(frees)} ${plural(frees.length, 'is', 'are')} free again.` : '',
    marks.length === 1 && marks[0] === 'no_show' ? `Today’s list has ${them} as a no-show.` : marks.length === 1 && marks[0] === 'not marked' ? `Today’s list no longer has ${them} marked as showed.` : '',
  ].filter(Boolean).join(' ');
}
