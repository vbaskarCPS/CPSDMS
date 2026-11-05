// src/v2/lib/repCard.ts — reps' digital business cards (like HiHello): one per campaign, branded with it.
// The rep edits theirs in the app (Settings › My business card) and shares it by QR code or link; the card is a public
// page (/card/<slug>) with Save contact, call / text / email, their links, and "Share my info", which sends the
// owner's details back to the rep as a lead.
import { db, must } from './client';

export type CardStyle = 'classic' | 'bold' | 'dark' | 'minimal';
export const CARD_STYLES: { key: CardStyle; label: string }[] = [
  { key: 'classic', label: 'Classic' }, { key: 'bold', label: 'Bold' }, { key: 'dark', label: 'Dark' }, { key: 'minimal', label: 'Minimal' },
];
export interface CardLink { label: string; url: string }
export interface Card {
  slug: string; name: string; title: string | null; phone: string | null; email: string | null; about: string | null;
  photo_path: string | null; links: CardLink[]; style: CardStyle;
  campaign: { name: string; color: string | null; info_url: string | null };
  campaign_id?: string;
}
export interface CardCampaign { id: string; name: string; color: string | null }
export interface CardLead {
  id: string; name: string; business: string | null; address: string | null; phone: string | null; email: string | null; note: string | null;
  campaign_id: string; campaign: string; created_at: string;
}

export const CARD_HOST = 'https://mainstreetai.propertystars.app';
export const cardUrl = (slug: string) => `${CARD_HOST}/card/${slug}`;
export const photoUrl = (path: string | null) => (path ? db.storage.from('ms-rep-cards').getPublicUrl(path).data.publicUrl : null);

const fix = (c: Card): Card => ({ ...c, links: Array.isArray(c.links) ? c.links : [] });
export async function cardCampaigns(): Promise<CardCampaign[]> { return (must(await db.rpc('ms_card_campaigns')) as CardCampaign[]) || []; }
export async function myCard(campaign: string): Promise<Card> { return fix(must(await db.rpc('ms_card_mine', { p_campaign: campaign })) as Card); }
export async function saveCard(campaign: string, c: Pick<Card, 'title' | 'phone' | 'email' | 'about' | 'photo_path' | 'links' | 'style'>): Promise<Card> {
  return fix(must(await db.rpc('ms_card_save', { p_campaign: campaign, p: c })) as Card);
}
/** A card photo: squared and shrunk on the phone, saved under the rep's own folder. */
export async function uploadCardPhoto(uid: string, file: File): Promise<string> {
  const blob = await squarePhoto(file, 600);
  const path = `${uid}/${Date.now()}.jpg`;
  const { error } = await db.storage.from('ms-rep-cards').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
async function squarePhoto(file: File, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  cv.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('Couldn’t read that photo'))), 'image/jpeg', 0.86));
}

// the public side
export async function publicCard(slug: string): Promise<Card | null> {
  const r = must(await db.rpc('ms_card_json', { p_slug: slug })) as Card | null;
  return r ? fix(r) : null;
}
export async function shareMyInfo(slug: string, p: { name: string; business: string; address: string; phone: string; email: string; note: string; website?: string }): Promise<void> {
  must(await db.rpc('ms_card_exchange', { p_slug: slug, p }));
}

// leads from the rep's cards
export async function cardLeads(): Promise<CardLead[]> { return (must(await db.rpc('ms_card_leads_mine')) as CardLead[]) || []; }
export async function markCardLead(id: string, status: 'added' | 'dismissed', business?: string): Promise<void> {
  must(await db.rpc('ms_card_lead_mark', { p_id: id, p_status: status, p_business: business || null }));
}

/** The rep as a contact (.vcf) for "Save contact". */
export function vcard(c: Card, url: string): string {
  const e = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);
  const [first, ...rest] = (c.name || '').trim().split(/\s+/);
  return [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${e(rest.join(' '))};${e(first || '')};;;`, `FN:${e(c.name || '')}`,
    `ORG:${e(c.campaign.name)}`, ...(c.title ? [`TITLE:${e(c.title)}`] : []),
    ...(c.phone ? [`TEL;TYPE=CELL:${c.phone.replace(/[^0-9+]/g, '')}`] : []),
    ...(c.email ? [`EMAIL;TYPE=WORK:${c.email}`] : []),
    `URL:${url}`, ...c.links.map(l => `URL:${l.url}`),
    ...(c.about ? [`NOTE:${e(c.about)}`] : []),
    'END:VCARD', '',
  ].join('\r\n');
}

/** Colours for a style, from the campaign's colour. */
export function cardTheme(style: CardStyle, color: string | null): { bg: string; fg: string; mut: string; accent: string; head: string; headFg: string; card: string } {
  const a = /^#[0-9a-f]{6}$/i.test(color || '') ? color! : '#0f766e';
  switch (style) {
    case 'bold': return { bg: a, fg: '#ffffff', mut: 'rgba(255,255,255,.82)', accent: '#ffffff', head: a, headFg: '#ffffff', card: 'rgba(255,255,255,.14)' };
    case 'dark': return { bg: '#0f1115', fg: '#f3f4f6', mut: '#9ca3af', accent: a, head: '#0f1115', headFg: '#f3f4f6', card: '#1a1d24' };
    case 'minimal': return { bg: '#ffffff', fg: '#111827', mut: '#6b7280', accent: a, head: '#ffffff', headFg: '#111827', card: '#f9fafb' };
    default: return { bg: '#f6f7f9', fg: '#111827', mut: '#6b7280', accent: a, head: a, headFg: '#ffffff', card: '#ffffff' };
  }
}
