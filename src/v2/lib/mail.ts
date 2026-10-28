// src/v2/lib/mail.ts — MainstreetAI mail (RUN_64): the inbox, a conversation, sending (ms-mail), Claude
// writing (ms-mail-ai), attachments (the private ms-mail bucket). Conversations belong to the business,
// so a rep sees the ones for businesses they're assigned; admins see all.
import { db, must } from './client';

export type Box = 'inbox' | 'unread' | 'starred' | 'sent' | 'archived' | 'unsorted';
export interface ThreadRow {
  id: string; subject: string; snippet?: string; last_at: string; last_dir: 'in' | 'out'; messages: number; unread: number;
  starred: boolean; archived: boolean; contact_email?: string; contact_name?: string; mailbox?: string;
  business_id?: string; business?: string; campaign_id?: string; campaign?: string; color?: string; zone?: string; rep?: string;
}
export interface Attachment { name: string; type?: string; size?: number; path: string }
export interface Message {
  id: string; dir: 'in' | 'out'; status: 'sending' | 'sent' | 'failed' | 'received'; from_email?: string; from_name?: string;
  to: string[]; cc?: string[]; subject?: string; html?: string; text?: string; attachments?: Attachment[]; at: string; error?: string; by?: string;
}
export interface Thread {
  id: string; subject: string; contact_email?: string; contact_name?: string; starred: boolean; archived: boolean; opted_out: boolean;
  business?: { id: string; name: string; address?: string; kind?: string; phone?: string } | null;
  campaign?: { id: string; name: string; color: string } | null;
  messages: Message[];
}

export async function inbox(box: Box = 'inbox', search?: string, business?: string): Promise<ThreadRow[]> {
  return (must(await db.rpc('ms_inbox', { p_box: box, p_search: search || null, p_business: business || null })) as ThreadRow[]) || [];
}
export async function inboxCounts(): Promise<{ unread: number; unsorted: number }> {
  return (must(await db.rpc('ms_inbox_counts')) as { unread: number; unsorted: number } | null) || { unread: 0, unsorted: 0 };
}
export async function thread(id: string): Promise<Thread> { return must(await db.rpc('ms_thread', { p_thread: id })) as Thread; }
export async function flagThread(id: string, f: { starred?: boolean; archived?: boolean; unread?: boolean }): Promise<void> {
  must(await db.rpc('ms_thread_flag', { p_thread: id, p_starred: f.starred ?? null, p_archived: f.archived ?? null, p_unread: f.unread ?? null }));
}
export async function fileThread(id: string, business: string, campaign: string): Promise<void> {
  must(await db.rpc('ms_thread_file', { p_thread: id, p_business: business, p_campaign: campaign }));
}

export interface Draft {
  thread_id?: string | null; business_id?: string | null; campaign_id?: string | null;
  staff?: boolean; mailbox_id?: string | null;          // a manager's own mailbox (staff email)
  to: string[]; cc: string[]; subject: string; html: string; text: string; attachments: Attachment[];
}
async function fnError(e: unknown, data: unknown): Promise<string> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  const ctx = (e as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if ((b as { error?: string }).error) return (b as { error: string }).error; } catch { /* not json */ } }
  return e instanceof Error ? e.message : 'Something went wrong';
}
export async function sendMail(d: Draft): Promise<{ thread_id: string; message_id: string }> {
  const { data, error } = await db.functions.invoke('ms-mail', { body: d });
  if (error || !(data as { ok?: boolean })?.ok) throw new Error(await fnError(error, data));
  return data as { thread_id: string; message_id: string };
}
export async function aiWrite(p: { mode: 'write' | 'rewrite'; staff?: boolean; thread_id?: string | null; business_id?: string | null; campaign_id?: string | null;
  instruction?: string; how?: string; subject?: string; html?: string }): Promise<{ subject: string; html: string }> {
  const { data, error } = await db.functions.invoke('ms-mail-ai', { body: p });
  if (error || !(data as { html?: string })?.html) throw new Error(await fnError(error, data));
  return data as { subject: string; html: string };
}

// ───────────── staff email: a manager's own mailbox (RUN_65) ─────────────
export interface MailBox { id: string; address: string; kind: 'person' | 'shared'; unread: number }
export interface Contact { name: string; address: string; me?: boolean }
export async function myBoxes(): Promise<MailBox[]> { return (must(await db.rpc('mail_my_boxes')) as MailBox[]) || []; }
export async function directory(): Promise<Contact[]> { return (must(await db.rpc('mail_directory')) as Contact[]) || []; }
export async function mailInbox(box: Box = 'inbox', search?: string, mailbox?: string | null): Promise<ThreadRow[]> {
  return (must(await db.rpc('mail_inbox', { p_box: mailbox || null, p_folder: box, p_search: search || null })) as ThreadRow[]) || [];
}
export async function mailCounts(): Promise<{ unread: number; unsorted: number }> {
  const r = must(await db.rpc('mail_counts')) as { unread: number } | null;
  return { unread: r?.unread || 0, unsorted: 0 };
}
export interface AdminBox {
  id: string; address: string; local: string; kind: string; active: boolean; owner_id: string | null; owner: string | null;
  owner_active: boolean; aliases: string[]; conversations: number;
}
export async function adminBoxes(): Promise<AdminBox[]> { return (must(await db.rpc('mail_admin_boxes')) as AdminBox[]) || []; }
export async function adminRename(box: string, local: string): Promise<void> { must(await db.rpc('mail_admin_rename', { p_box: box, p_local: local })); }
export async function adminHandover(box: string, toUser: string, mode: 'move' | 'merge'): Promise<void> {
  must(await db.rpc('mail_admin_handover', { p_box: box, p_to_user: toUser, p_mode: mode }));
}

export async function uploadAttachment(uid: string, file: File): Promise<Attachment> {
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} is over 15 MB`);
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'file';
  const path = `out/${uid}/${Date.now().toString(36)}-${safe}`;
  const { error } = await db.storage.from('ms-mail').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(error.message);
  return { name: file.name, type: file.type, size: file.size, path };
}
export async function attachmentUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await db.storage.from('ms-mail').createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error || !data) throw new Error(error?.message || 'Couldn’t open the file');
  return data.signedUrl;
}
export async function unsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
  const { data, error } = await db.rpc('ms_mail_unsubscribe', { p_token: token });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; email?: string };
}

// ───────────── words (tested) ─────────────
/** "Today 2:14 PM" style for lists: time today, "Mon" this week, "Oct 3" this year, else the date. */
export function mailWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 6 && days > 0) return d.toLocaleDateString('en-CA', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
/** Pasted "Ann <ann@x.ca>, bob@y.ca; carl@z.ca" → the addresses. */
export function splitAddresses(s: string): string[] {
  return s.split(/[,;\s]+/).map(x => (/<([^>]+)>/.exec(x)?.[1] || x).replace(/^[<"']+|[>"']+$/g, '').trim().toLowerCase()).filter(isEmail);
}
export const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);
/** Plain text for the text part of an email, from the composer's HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) => (label.replace(/<[^>]+>/g, '') === href ? href : `${label.replace(/<[^>]+>/g, '')} (${href})`))
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
}
export const initials = (name?: string | null, email?: string | null) => {
  const n = (name || '').trim() || (email || '').split('@')[0];
  const parts = n.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
};
export const fileSize = (n?: number) => (!n ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
