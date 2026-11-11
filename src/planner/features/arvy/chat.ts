// src/planner/features/arvy/chat.ts — Arvy's conversation, kept between visits and on every device (doc 'arvychat',
// key 'current', the last KEEP lines). The first time it's loaded, the old Coach chat (doc 'coachchat') is carried
// over so nothing said to the coach is lost; that old doc is left as it was. "Start over" saves an empty chat, so the
// old one doesn't come back. The demo keeps nothing.
import { getDoc, putDoc } from '../../lib/docs';
import { isDemo } from '../../lib/app';
import type { ChatLine } from './arvy';

export const KEEP = 60;
interface ChatDoc { lines: ChatLine[]; from_coach?: number; updatedAt: string }

/** The Coach chat's messages as Arvy chat lines (marked `old`: carried over, not said to Arvy). */
export function fromCoach(messages: unknown): ChatLine[] {
  if (!Array.isArray(messages)) return [];
  const out: ChatLine[] = [];
  for (const m of messages as { role?: unknown; content?: unknown; at?: unknown }[]) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) continue;
    out.push({ role: m.role, text: m.content.trim(), at: typeof m.at === 'string' && m.at ? m.at : new Date(0).toISOString(), old: true });
  }
  return out.slice(-KEEP);
}

const tidy = (lines: unknown): ChatLine[] => (Array.isArray(lines) ? lines : [])
  .filter((l): l is ChatLine => !!l && (l.role === 'user' || l.role === 'assistant') && typeof l.text === 'string' && typeof l.at === 'string').slice(-KEEP);

/** Of two copies of the chat (this tab's and the saved one), the one talked in most recently. */
export function newer(mine: ChatLine[], saved: ChatLine[]): ChatLine[] {
  if (!saved.length) return mine;
  if (!mine.length) return saved;
  return saved[saved.length - 1].at > mine[mine.length - 1].at ? saved : mine;
}

/** The saved chat. `carried` = this was the first load and the Coach chat was just brought over. */
export async function loadChat(): Promise<{ lines: ChatLine[]; carried: boolean }> {
  if (isDemo()) return { lines: [], carried: false };
  const d = await getDoc<ChatDoc>('arvychat', 'current');
  if (d && Array.isArray(d.lines)) return { lines: tidy(d.lines), carried: false };
  const old = await getDoc<{ messages?: unknown }>('coachchat', 'current').catch(() => null);
  const lines = fromCoach(old?.messages);
  await putDoc('arvychat', 'current', { lines, from_coach: lines.length, updatedAt: new Date().toISOString() } satisfies ChatDoc);
  return { lines, carried: lines.length > 0 };
}

// saving waits a moment, so a burst of changes (a question, its answer, a Confirm) is one write
let timer: ReturnType<typeof setTimeout> | null = null;
let waiting: ChatLine[] | null = null;
export function saveChat(lines: ChatLine[]): void {
  if (isDemo()) return;
  waiting = lines;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushChat(); }, 700);
}
/** Save now (the chat is closing). Never throws: the chat on screen is still right. */
export async function flushChat(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const lines = waiting; waiting = null;
  if (!lines) return;
  try { await putDoc('arvychat', 'current', { lines: lines.slice(-KEEP), updatedAt: new Date().toISOString() } satisfies ChatDoc); } catch { /* next change tries again */ }
}
