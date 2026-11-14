// src/v2/lib/bennyPrebook.ts — the Benny's "prebook done" card, for today's live day: what it shows and what it saves.
// A prebook is a Production job with its booking's own job code, client and services; an office flat (AFSL, FSL, SP,
// RJ) is worth the season's set value, never a price someone typed. The database checks it first
// (benny_check_prebook_done). On the tap the app saves it the way the worker's own tap on the logsheet does
// (sessionService.completeJob with the booking's id), so the bookings sync marks the booking done and the cart's
// totals are worked out again.
// When the cart already has that address on it today (the prebook logged as a sale), that line is changed into the
// prebook with the logsheet's own edit save and then given the booking's id (benny_prebook_after), which closes the booking
// the same way.
import type { SessionTransaction } from '../../types';

export interface PrebookCheck {
  ok: boolean; problems?: string[]; date: string; stamp: string;
  worker: { cn: string; name: string };
  cart: { id: string; workers: string[]; names: string[] };
  booking: {
    id: string; address: string; street_address: string; city?: string; route?: string; job_code: string; prepaid: boolean;
    client?: string; services?: Record<string, boolean>; property_type?: string; field_notes?: string;
  };
  contact?: { phone?: string; email?: string };
  /** the line on this cart's logsheet today at the same address (the prebook logged the wrong way): it is changed, not doubled */
  replaces?: { id: string; type: string; amount: number; paid_by: string; shown_as?: string };
  cautions?: string[];
  /** what the job code is worth this season, put in by the app when it can read the season's flats (the card shows it) */
  value?: number | null;
}

const money = (n: number) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstOf = (name: string) => name.split(' ')[0];

/** What a booking's job code is worth: the season's office flat it starts with (longest code first: AFSL before FSL),
 *  else the dollars written there. null = it can't be told, and nothing is saved. The same rule as the logsheet screen. */
export function codeValue(code: string, flats: { code: string; value: number }[]): number | null {
  const raw = (code || '').trim().toUpperCase();
  const flat = [...flats].sort((a, b) => b.code.length - a.code.length).find(f => raw.startsWith(f.code.toUpperCase()));
  if (flat) return flat.value;
  if (!/^\$?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw.replace(/^\$/, ''));
  return n > 0 ? n : null;
}
/** The item name the logsheet gives a season's own job. */
export const seasonItem = (season: string) => (season === 'lawn_rejuv' ? 'Lawn Rejuvenation' : season === 'sealing' ? 'Sealing' : 'Aeration');
const servicesSaid = (s?: Record<string, boolean>) => Object.entries(s || {}).filter(([, on]) => on).map(([k]) => k).join(', ');

export function prebookCard(c: PrebookCheck): { title: string; lines: string[]; action: string } {
  const b = c.booking; const first = firstOf(c.worker.name); const team = c.cart.names.length > 1; const r = c.replaces;
  const services = servicesSaid(b.services);
  return {
    title: r ? `Fix the prebook on ${first}’s logsheet` : `Put the prebook on ${first}’s logsheet`,
    lines: [
      [b.client, b.address].filter(Boolean).join(' · '),
      `Production · ${b.job_code}${c.value != null ? ` (${money(c.value)} flat)` : ''} · prepaid${b.route ? ` · ${b.route}` : ''}`,
      ...(services ? [`Services as booked: ${services}`] : []),
      ...(r ? [`It’s on the logsheet now as a ${r.type.toLowerCase()} for ${money(r.amount)}, ${r.paid_by.toLowerCase()}. That line becomes this; no second job is added.`] : []),
      'The booking is marked done.',
      ...(c.cautions || []),
      ...(!r && c.contact?.email ? ['The client gets their receipt by email, the same as from the logsheet.'] : []),
      `${team ? `The cart’s (${c.cart.names.map(firstOf).join(' + ')})` : `${first}’s`} totals are worked out again.`,
    ].filter(Boolean),
    action: r ? 'Fix it' : 'Mark it done',
  };
}

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** The booking's id as the live day knows it: a Production line carrying it is what marks the booking done. */
export const liveBookingId = (c: PrebookCheck) => `mb:${c.booking.id}`;

/** The logsheet line for a prebook, as the logsheet screen makes it when the worker completes one. Pure, so it's tested. */
export function prebookLine(c: PrebookCheck, value: number, season: string, now = new Date(), id = uid): SessionTransaction {
  const b = c.booking; const jobId = liveBookingId(c);
  return {
    id: id(), jobId, timestamp: now.toISOString(), customerId: jobId, customerName: b.client || '', address: b.street_address,
    customerPhone: c.contact?.phone, customerEmail: c.contact?.email, workerId: c.worker.cn, workerName: c.worker.name, routeManagerName: 'RM',
    routeCode: b.route || '', type: 'Production', price: value, displayPrice: b.job_code, isPaid: true, paymentMethod: 'Prepaid',
    items: [{ name: seasonItem(season), price: value }], itemDescription: b.field_notes || '', isWestSplit: false, isPrepaid: true,
    serviceType: b.property_type || 'FP', services: season === 'lawn_rejuv' ? b.services : undefined,
  } as unknown as SessionTransaction;
}

/** What the logsheet's edit save is given to turn the line that is there into the prebook. Pure, so it's tested. */
export function prebookFix(c: PrebookCheck, value: number, season: string): Partial<SessionTransaction> {
  const b = c.booking;
  return {
    type: 'Production', price: value, displayPrice: b.job_code, paymentMethod: 'Prepaid', paymentBreakdown: { Prepaid: value },
    items: [{ name: seasonItem(season), price: value }], itemDescription: b.field_notes || '',
    customerName: b.client || '', address: b.street_address, routeCode: b.route || '', serviceType: b.property_type || 'FP',
    ...(c.contact?.phone ? { customerPhone: c.contact.phone } : {}), ...(c.contact?.email ? { customerEmail: c.contact.email } : {}),
    ...(season === 'lawn_rejuv' && b.services ? { services: b.services } : {}),
  } as unknown as Partial<SessionTransaction>;
}

/** What the Benny says once it is saved. booking: 'done', or 'failed' = the job saved and the booking didn't close. */
export function prebookSaid(c: PrebookCheck, value: number, booking: 'done' | 'failed'): string {
  const first = firstOf(c.worker.name); const b = c.booking;
  const job = c.replaces
    ? `${first}’s job at ${b.street_address} now reads Production, ${b.job_code} (${money(value)} flat), prepaid`
    : `${b.street_address} is on ${first}’s logsheet: Production, ${b.job_code} (${money(value)} flat), prepaid`;
  return `${job}. ${booking === 'done' ? 'The booking is marked done.' : 'I couldn’t confirm the booking closed: check it in Bookings › List.'} The totals are worked out again.`;
}
