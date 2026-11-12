// src/planner/features/arvy/log.ts — Arvy's improvements log (docs of kind 'arvylog', key = time~id).
// An entry is saved whenever Arvy falls short: it was asked for something it has no tool for (request), a tool or the
// server failed (error), it couldn't find what was named (miss), a change was undone (undo), a reply got a thumbs-down
// (feedback), or the person told Arvy something is broken or could be better (bug / idea).
// A scheduled check reads new entries, works out the fix and writes what it found back on the entry (findings, pr):
// Settings › Arvy's log shows them. Saving never gets in the way: failures are swallowed, the demo saves nothing.
// An entry about a question that looked at email has any card number, code, password or ID number blanked first:
// those are never copied out of an email, into the log either.
import { getDocs, putDoc } from '../../lib/docs';
import { isDemo } from '../../lib/app';
import { hideSecrets } from '../../../../supabase/functions/planner-mail/mail';

export type LogType = 'request' | 'error' | 'miss' | 'undo' | 'feedback' | 'bug' | 'idea';
export interface LogFindings { verdict?: string; summary?: string; cause?: string; fix?: string; size?: string; risk?: string; needs?: string }
export interface LogEntry {
  id: string; at: string; type: LogType; title: string;
  detail?: string;          // more on what happened (an error message, their own words)
  question?: string;        // what was asked
  reply?: string;           // what Arvy said
  tools?: string[];         // the tools it used
  path?: string;            // the screen they were on
  area?: string;
  status: 'open' | 'done';
  // written by the check, not the app:
  investigated_at?: string; findings?: LogFindings; pr?: string; done_at?: string;
}

export const LOG_LABEL: Record<LogType, string> = {
  request: 'Asked for', error: 'Something broke', miss: 'Couldn’t find it', undo: 'Undone', feedback: 'Thumbs down', bug: 'Bug', idea: 'Idea',
};

const said = new Set<string>();   // the same thing isn't logged twice in one visit
const clip = (s: unknown, n: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : undefined);

/** What gets saved for an entry (also used by the tests). */
export function entryOf(e: Partial<LogEntry> & { type: LogType; title: string }, now = new Date()): LogEntry {
  const at = now.toISOString();
  // a question that looked at email: what is kept of it has no card number, code, password or ID number in it
  const mail = !!e.tools?.some(t => t.startsWith('email_'));
  const safe = (s: unknown) => (mail && typeof s === 'string' ? hideSecrets(s) : s);
  const out: LogEntry = { id: Math.random().toString(36).slice(2, 8), at, type: e.type, title: String(safe(e.title)).trim().slice(0, 200) || LOG_LABEL[e.type], status: 'open' };
  const detail = clip(safe(e.detail), 1200), question = clip(safe(e.question), 600), reply = clip(safe(e.reply), 1200), path = clip(e.path, 80), area = clip(e.area, 30);
  if (detail) out.detail = detail;
  if (question) out.question = question;
  if (reply) out.reply = reply;
  if (path) out.path = path;
  if (area) out.area = area;
  if (e.tools?.length) out.tools = [...new Set(e.tools)].slice(0, 12);
  return out;
}

/** Save an entry. Never throws. */
export async function logArvy(e: Partial<LogEntry> & { type: LogType; title: string }): Promise<void> {
  try {
    if (isDemo()) return;
    const mark = `${e.type}|${e.title}`;
    if (said.has(mark)) return;
    said.add(mark);
    const entry = entryOf(e);
    await putDoc('arvylog', `${entry.at}~${entry.id}`, entry);
  } catch { /* the log must never break the chat */ }
}

/** The log, newest first. */
export async function loadLog(): Promise<LogEntry[]> {
  const docs = await getDocs<LogEntry>('arvylog');
  return docs.map(d => d.data).filter(e => e && e.id && e.title).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
}

/** Where an entry stands, in plain words. */
export function stageOf(e: LogEntry): { label: string; tone: 'new' | 'looked' | 'ready' | 'done' } {
  if (e.status === 'done') return { label: 'Done', tone: 'done' };
  if (e.pr) return { label: 'Fix ready for review', tone: 'ready' };
  if (e.investigated_at) return { label: 'Looked at', tone: 'looked' };
  return { label: 'New', tone: 'new' };
}
