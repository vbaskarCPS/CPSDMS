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
  delivery?: Delivery; delivery_reason?: string; group?: string;   // what Resend said after sending; its group in Sent (RUN_70)
}
/** What happened to a sent email after it left: Resend's delivery events (no opens). */
export type Delivery = 'delivered' | 'delayed' | 'bounced' | 'complained';
export const DELIVERY_LABEL: Record<Delivery, string> = { delivered: 'Delivered', delayed: 'Delayed', bounced: 'Bounced', complained: 'Marked as spam' };
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
  batch_key?: string; batch_label?: string;              // one of a campaign's emails: its group in Sent (RUN_70)
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
export interface MailBox {
  id: string; address: string; kind: 'person' | 'shared'; unread: number;
  label?: string | null; role?: 'client' | 'staff' | null; center_id?: string | null; mine?: boolean | null;   // a centre's shared mailbox (RUN_69)
}
/** What a mailbox is called in the app: "Property Stars · BC Fall RJ" for a centre's, else the address. */
export const boxName = (b: Pick<MailBox, 'address' | 'label'>) => b.label || b.address;
export interface Contact { name: string; address: string; me?: boolean }
export async function myBoxes(): Promise<MailBox[]> { return (must(await db.rpc('mail_my_boxes')) as MailBox[]) || []; }
export async function directory(): Promise<Contact[]> { return (must(await db.rpc('mail_directory')) as Contact[]) || []; }
export async function mailInbox(box: Box = 'inbox', search?: string, mailbox?: string | null): Promise<ThreadRow[]> {
  return (must(await db.rpc('mail_inbox', { p_box: mailbox || null, p_folder: box, p_search: search || null })) as ThreadRow[]) || [];
}
/** A group in a mailbox's Sent folder: one booking-email campaign, or one session's receipts. */
export interface MailGroup {
  key: string; label?: string; mailbox_id: string; mailbox: string; mailbox_label?: string | null;
  emails: number; first_at: string; last_at: string;
  delivered: number; delayed: number; bounced: number; complained: number; failed: number; sending: number;
}
export interface GroupEmail {
  id: string; thread_id: string; to: string[]; contact_name?: string; subject?: string; status: Message['status']; error?: string;
  delivery?: Delivery; delivery_reason?: string; delivery_at?: string; at: string; label?: string;
}
export async function mailGroups(mailbox?: string | null): Promise<MailGroup[]> {
  return (must(await db.rpc('mail_batches', { p_box: mailbox || null })) as MailGroup[]) || [];
}
export async function mailGroup(box: string, key: string): Promise<GroupEmail[]> {
  return (must(await db.rpc('mail_batch', { p_box: box, p_key: key })) as GroupEmail[]) || [];
}
/** Sent through, no word back yet. */
export const groupWaiting = (g: MailGroup) => Math.max(0, g.emails - g.delivered - g.delayed - g.bounced - g.complained - g.failed - g.sending);
/** One email's state in a few words: Didn't send / Sending… / Bounced / Marked as spam / Delayed / Delivered / Sent. */
export function emailState(e: { status: Message['status']; delivery?: Delivery }): { label: string; tone: 'bad' | 'warn' | 'ok' | 'mut' } {
  if (e.status === 'failed') return { label: 'Didn’t send', tone: 'bad' };
  if (e.status === 'sending') return { label: 'Sending…', tone: 'mut' };
  if (e.delivery === 'bounced' || e.delivery === 'complained') return { label: DELIVERY_LABEL[e.delivery], tone: 'bad' };
  if (e.delivery === 'delayed') return { label: 'Delayed', tone: 'warn' };
  if (e.delivery === 'delivered') return { label: 'Delivered', tone: 'ok' };
  return { label: 'Sent', tone: 'mut' };
}
export async function mailCounts(): Promise<{ unread: number; unsorted: number }> {
  const r = must(await db.rpc('mail_counts')) as { unread: number } | null;
  return { unread: r?.unread || 0, unsorted: 0 };
}
export interface AdminBox {
  id: string; address: string; local: string; kind: string; active: boolean; owner_id: string | null; owner: string | null;
  owner_active: boolean; aliases: string[]; conversations: number;
  label?: string | null; role?: string | null; center?: string | null; members?: { id: string; name: string }[];
}
export async function adminBoxes(): Promise<AdminBox[]> { return (must(await db.rpc('mail_admin_boxes')) as AdminBox[]) || []; }
export async function adminRename(box: string, local: string): Promise<void> { must(await db.rpc('mail_admin_rename', { p_box: box, p_local: local })); }
export async function adminHandover(box: string, toUser: string, mode: 'move' | 'merge'): Promise<void> {
  must(await db.rpc('mail_admin_handover', { p_box: box, p_to_user: toUser, p_mode: mode }));
}

// ───────────── a centre's shared mailboxes (RUN_69, Super Admin) ─────────────
export interface CenterBox { id: string; address: string; label: string; members: { id: string; name: string }[] }
export async function centerBoxes(center: string): Promise<{ client?: CenterBox; staff?: CenterBox }> {
  return (must(await db.rpc('mail_admin_center_boxes', { p_center: center })) as { client?: CenterBox; staff?: CenterBox }) || {};
}
export async function setCenterBox(center: string, role: 'client' | 'staff', local: string): Promise<{ id: string; address: string; label: string }> {
  return must(await db.rpc('mail_admin_set_center_box', { p_center: center, p_role: role, p_local: local })) as { id: string; address: string; label: string };
}
export async function setBoxMember(box: string, user: string, on: boolean): Promise<void> {
  must(await db.rpc('mail_admin_box_member', { p_box: box, p_user: user, p_on: on }));
}
export interface UserBox { id: string; address: string; label: string | null; center: string | null; role: 'client' | 'staff' | null; on: boolean }
export async function userBoxes(user: string): Promise<UserBox[]> { return (must(await db.rpc('mail_admin_user_boxes', { p_user: user })) as UserBox[]) || []; }

// ───────────── a centre's email templates (receipts, booking emails) ─────────────
export interface EmailTemplate { id: string; type: string; name: string; subject: string; html: string; active: boolean; updated_at: string }
export async function emailTemplates(center: string): Promise<EmailTemplate[]> {
  return (must(await db.rpc('app_email_templates', { p_center: center })) as EmailTemplate[]) || [];
}
export async function saveEmailTemplate(center: string, t: { type: string; name: string; subject: string; html: string; active?: boolean }): Promise<void> {
  must(await db.rpc('app_email_template_save', { p_center: center, p_type: t.type, p_name: t.name, p_subject: t.subject, p_html: t.html, p_active: t.active ?? true }));
}
export async function aiTemplate(p: { center_id: string; type: string; instruction?: string; subject?: string; html?: string }): Promise<{ subject: string; html: string }> {
  const { data, error } = await db.functions.invoke('ms-mail-ai', { body: { mode: 'template', ...p } });
  if (error || !(data as { html?: string })?.html) throw new Error(await fnError(error, data));
  return data as { subject: string; html: string };
}
/** One personal paragraph per booking (≤ 25 a call). */
export async function aiBookingNotes(p: { kind: 'day_before' | 'next_try'; date: string; ids: string[]; instruction?: string }): Promise<Record<string, string>> {
  const { data, error } = await db.functions.invoke('ms-mail-ai', { body: { mode: 'booking_note', ...p } });
  if (error || !(data as { notes?: unknown })?.notes) throw new Error(await fnError(error, data));
  return (data as { notes: Record<string, string> }).notes;
}

/** The booking emails' templates, and what each can say. Receipts are the other types. */
export const BOOKING_TEMPLATES: { type: 'day_before' | 'next_try'; name: string; hint: string; vars: string[] }[] = [
  { type: 'day_before', name: 'Day before', hint: 'Information only: we’re coming on this day.', vars: ['firstName', 'address', 'dateFriendly', 'services', 'companyName', 'note'] },
  { type: 'next_try', name: 'Next try', hint: 'We came but couldn’t do it; we’ll try again on this day.', vars: ['firstName', 'address', 'dateFriendly', 'services', 'reason', 'companyName', 'note'] },
];
export const RECEIPT_TEMPLATES: { type: string; name: string }[] = [
  { type: 'production', name: 'Receipt' }, { type: 'prepaid', name: 'Prepaid — done' }, { type: 'billed', name: 'Billed (invoice)' }, { type: 'sale', name: 'Sale (welcome)' },
  { type: 'upgrade_star_plan_pro', name: 'Upgrade · Star Plan Pro' }, { type: 'upgrade_lawn_rejuv', name: 'Upgrade · Lawn Rejuv' }, { type: 'upgrade_golf_course', name: 'Upgrade · Golf Course' },
  { type: 'addon_dethatch', name: 'Add-on · Dethatch' }, { type: 'addon_rejuv_after_care', name: 'Add-on · Rejuv after care' }, { type: 'addon_grub', name: 'Add-on · Grub' },
  { type: 'addon_driveway_sealing', name: 'Add-on · Driveway sealing' }, { type: 'addon_hot_asphalt', name: 'Add-on · Hot asphalt' },
];
export const RECEIPT_VARS = ['firstName', 'lastName', 'fullName', 'address', 'displayPrice', 'paymentMethod', 'date', 'serviceName', 'workerName', 'companyName', 'ETRANSFER_INSTRUCTIONS_SECTION'];

const escHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** {{name}} → its value (escaped; "note" is already HTML). Unknown {{x}} are left out. */
export function fillTemplate(t: string, vars: Record<string, string>, htmlVars: string[] = ['note']): string {
  return t.replace(/<p>\s*(\{\{\s*note\s*\}\})\s*<\/p>/g, '$1').replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (_m, k: string) => (k in vars ? (htmlVars.includes(k) ? vars[k] : escHtml(vars[k])) : ''))
    .replace(/<p>\s*<\/p>/g, '');
}
/** "Thursday, October 30" */
export function dateFriendly(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
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
