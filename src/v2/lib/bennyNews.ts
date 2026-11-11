// src/v2/lib/bennyNews.ts — "it's live": what the Benny tells someone when something they logged (a bug, or a request it
// couldn't do) has been built. Shown once, in their chat, the next time they open the app; a notification goes to the
// devices they turned notifications on. Pure: no database, no browser.
export interface BennyNews { id: string; kind: 'bug' | 'request'; title: string; asked?: string; note: string; live_at?: string }

const short = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** The message the Benny shows: that it's live, what they asked for, and what to say or do now. */
export function newsText(n: BennyNews): string {
  const asked = (n.asked || '').replace(/\s+/g, ' ').trim();
  const head = n.kind === 'bug' ? `**Fixed: ${n.title}**` : `**It’s live: ${n.title}**`;
  const quote = asked ? `\n${n.kind === 'bug' ? 'You told me' : 'You asked'}: “${short(asked, 160)}”` : '';
  return `${head}${quote}\n\n${n.note}`;
}

const claimed = new Set<string>();
/** The news not shown on this page yet. The Benny can be on a page twice (the top bar and a map): only one of them shows each. */
export function claimNews(list: BennyNews[], seen: Set<string> = claimed): BennyNews[] {
  const fresh = (Array.isArray(list) ? list : []).filter(n => !!n && typeof n.id === 'string' && !!n.id && typeof n.note === 'string' && !!n.note.trim() && !seen.has(n.id));
  for (const n of fresh) seen.add(n.id);
  return fresh;
}

/** Who a log entry's person is, for a button: their first name, or "them". */
export const firstName = (by?: string | null) => (by || '').trim().split(/\s+/)[0] || 'them';

/** What the Bug log says about a notice that went out: when, whether it was seen, and whether a notification reached a device. */
export function toldLine(live: { at: string; seen_at?: string; pushed_at?: string; sent?: number }, when: (iso: string) => string): string {
  const seen = live.seen_at ? `seen in the Benny ${when(live.seen_at)}` : 'not seen in the Benny yet';
  const push = live.pushed_at ? (live.sent ? `notification sent to ${live.sent} device${live.sent === 1 ? '' : 's'}` : 'no notification got through') : 'no notification (not turned on)';
  return `${when(live.at)} · ${seen} · ${push}`;
}
