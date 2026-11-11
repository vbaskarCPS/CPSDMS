// src/planner/lib/news.ts — what's new in the planner, told by Arvy.
// The list is src/planner/news.json, newest first: add an entry at the top with every change they'll notice
// (CLAUDE.md). It's built into the app, so a phone only hears about what the version it is running can do: after an
// update, Arvy posts the entries that phone hasn't told yet as a message in its chat (features/arvy/Arvy.tsx), and
// "what's new?" is answered from the same list (features/arvy/arvy.ts). The file is also published as
// /planner-news.json, where the reminders function reads it to send one notification per update (planner-push).
import list from '../news.json';
import type { Profile } from './app';

export interface News { id: string; date: string; title: string; lines: string[]; /** only for this kind of planner */ for?: Profile }
export const NEWS: News[] = list as News[];

/** The entries to tell: everything above the last one told (`seen`, an id), for this profile, five at most. The first
 *  time (nothing told yet) it's what came in the last three days; an id that's no longer on the list = just the newest. */
export function newsSince(seen: string | null | undefined, profile: Profile, today: string, all: News[] = NEWS): News[] {
  const mine = all.filter(n => !n.for || n.for === profile);
  if (!seen) { const from = new Date(Date.parse(`${today}T12:00:00Z`) - 3 * 864e5).toISOString().slice(0, 10); return mine.filter(n => n.date >= from).slice(0, 5); }
  const at = all.findIndex(n => n.id === seen);
  if (at < 0) return mine.slice(0, 1);
  const newer = new Set(all.slice(0, at).map(n => n.id));
  return mine.filter(n => newer.has(n.id)).slice(0, 5);
}
/** Arvy's message about them. */
export function newsText(entries: News[]): string {
  if (!entries.length) return '';
  return `Your planner was updated. Here’s what’s new:\n\n${entries.map(n => `**${n.title}**\n${n.lines.map(l => `- ${l}`).join('\n')}`).join('\n\n')}`;
}
/** Is this a question about what changed in the planner? */
export const asksWhatsNew = (q: string): boolean => /what(?:'|’)?s new|what(?:(?:'|’)s| has| is)? changed|release notes|new features?|latest (?:updates?|changes)|recent(?:ly)? (?:updates?|changes|added)|been updated/i.test(q);
/** The list as a note for Arvy, when they ask what's new (it rides along with that question only). */
export function newsNote(profile: Profile, all: News[] = NEWS): string {
  const mine = all.filter(n => !n.for || n.for === profile).slice(0, 8);
  return `[The planner’s release notes, newest first, to answer this from: ${mine.map(n => `${n.date} ${n.title}: ${n.lines.join(' ')}`).join(' | ')}]`.slice(0, 3200);
}
