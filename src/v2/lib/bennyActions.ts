// src/v2/lib/bennyActions.ts — the changes the Benny prepares, done by the app after the person taps Confirm.
// Each one uses the same code as the screen that does it by hand:
//   start_day  → Workerbook › Start session (startSession). With a crew per manager when the plan has them ("give
//                Franklyn the worst half"): each worker's cart goes to the manager whose crew they are in.
//   give_route → RM map › Assign route (whole route, with its prebooks; moves the route to the cart's manager)
//   partner    → RM map › Move worker › to another cart
//   solo       → RM map › Move worker › own cart
//   booking    → Bookings › List › save (status, notes, route of one Master Booking)
//   pin        → RM map › Pins › drop a pin (the map's own createMapPin)
//   stops      → RM map › Pins: one numbered pin per cart, in the planned order; an earlier order of the same kind is replaced
//   job        → RM map › a worker's jobs › edit a job: its amount and how it was paid (the edit screen's own save, which
//                works the cart's equiv and totals out again). The database keeps a record of each one (benny_job_changes).
// Two cards change nothing. booking_emails opens Bookings › Send booking emails with the day and routes picked: the person
// reads the emails there and sends them; the Benny never sends. payouts opens the payout screen at the first open payout
// with no cash or cheque to count: the person presses Finalize on each and the screen moves to the next; the Benny never
// pays anyone out.
import { getDay, listRoster, type RosterRow } from './workerbook';
import { availableManagers, getSession, nextTeamName, planProblems, startSession, type Plan, type PlanManager, type PlanRoute, type PlanTeam } from './startSession';
import { db, must } from './client';
import { listRateCards, listSeasons, regionTax } from './data';
import { cardFor, defaultRateCard, type RateCardData } from './rateCard';
import { centerService, type Service } from './permissions';
import { appShowedDates, countBefore } from './payoutEngine';
import { fullName } from './workerbook';
import { saveBooking, type BookingPatch, type BookingStatus } from './bookings';
import type { BookingEmailKind, EmailPreset } from './bookingEmails';
import { STOP_WORD } from './bennyDrive';
import { queueHref } from './payoutQueue';

export type TeamMode = 'roster' | 'solo' | 'pairs';
/** A worker in a manager's crew, with their season so far (no days yet = no average). */
export interface CrewWorker { hire_id: string; cn?: string; name: string; days?: number; avg_equiv?: number }
export interface StartDayCheck {
  ok: boolean; date: string; day_id: string; pair: boolean;
  assign: { managers: { id: string; name: string }[] | null; routes: { code: string; area: string; number: number }[] | null;
    /** set when the plan splits the crew between the managers: who goes with this one, best first */
    crew?: CrewWorker[] | null; crew_avg?: number | null }[];
  booked: number; showed: number; teams: number; no_team: number; open_prebooks: number; maps?: string[]; live_map_on?: string | null;
  /** the plan says who goes with which manager (every worker who showed is in exactly one crew) */
  crews?: boolean; notes?: string[];
}
/** A crew in a few words: "Tim 23.2, Michael 19.7, Wilson (no days yet)". Two people with the same first name get their last initial. */
export function crewNames(crew: CrewWorker[], all: CrewWorker[] = crew, max = 14): string {
  const firsts = all.map(w => w.name.split(' ')[0]);
  const short = (w: CrewWorker) => { const [f, ...rest] = w.name.split(' '); return firsts.filter(x => x === f).length > 1 && rest.length ? `${f} ${rest[rest.length - 1][0]}` : f; };
  const one = (w: CrewWorker) => `${short(w)} ${w.avg_equiv != null && (w.days ?? 1) > 0 ? Number(w.avg_equiv).toFixed(1) : '(no days yet)'}`;
  return [...crew.slice(0, max).map(one), ...(crew.length > max ? [`+ ${crew.length - max} more`] : [])].join(', ');
}
export interface LiveWorker { cn: string; name: string; cart_id?: string; manager?: string }
export interface GiveCheck { ok: boolean; problems?: string[]; date: string; route: string; map?: string; worker: LiveWorker; cart?: { cn: string; name: string }[]; now?: string[]; route_manager?: string; open_prebooks?: number }
export interface MoveCheck { ok: boolean; problems?: string[]; date: string; a: LiveWorker; b?: LiveWorker; carts?: Record<string, string[]> }
/** A Master Booking as the Benny sees it (no phones, no emails). */
export interface BennyBooking {
  id: string; address: string; city?: string; list?: string; job?: string; status: BookingStatus; done_on?: string; done_by?: string;
  tried?: number; last_try?: string; route?: string; map?: string; placed?: string; prepaid?: boolean; people?: string[];
  field_note?: string; office_note?: string; on_live_map?: boolean;
}
export interface NoteChange { mode: 'set' | 'add' | 'replace' | 'clear'; text: string; was?: string }
export interface BookingCheck {
  ok: boolean; problems?: string[]; booking: BennyBooking; heard_as?: string;
  /** the change in words (for the card) */
  change: { status?: { from: BookingStatus; to: BookingStatus }; route?: { from?: string; to: string; map?: string }; field_note?: NoteChange; office_note?: NoteChange };
  /** exactly the fields the Bookings save gets */
  patch: Pick<BookingPatch, 'status' | 'route_code' | 'field_notes' | 'office_notes'>;
  /** cautions to read before saving */
  notes?: string[];
  /** the request, to run the same check again right before saving; stamp = when the booking last changed */
  ask: Record<string, string>; stamp: string; map?: string; route?: string;
}
/** The booking emails the Benny set up: who would get one (counts only), for the Send booking emails screen to write. */
export interface EmailsCheck {
  ok: boolean; problems?: string[]; kind: BookingEmailKind; date: string; list?: { id: string; name: string };
  routes: { code: string; area: string; number: number }[]; maps?: string[];
  counts: { bookings: number; to_email: number; no_email: number; already_sent: number }; from?: string; notes?: string[];
}
/** What the Send booking emails screen is opened with. */
export const emailsPreset = (c: EmailsCheck): EmailPreset => ({ kind: c.kind, date: c.date, list_id: c.list?.id || null, routes: c.routes });

/** One pin, checked: where it goes, its name and who sees it (the map's own four choices). */
export interface PinCheck {
  ok: boolean; problems?: string[]; date: string; manager: string; label: string; lat: number; lng: number; at: string;
  visibility: 'private' | 'all' | 'manager' | 'worker'; seen_by: string; target_manager?: string; target_worker?: string; map?: string; route?: string;
}
export type StopKind = 'drop' | 'pickup' | 'check';
export interface Stop { n: number; label: string; who: string; lat: number; lng: number; by: 'route' | 'knock' | 'phone'; route?: string; age_min?: number }
/** A drop / pickup / check order: the team's carts as numbered stops, in driving order. */
export interface StopsCheck {
  ok: boolean; problems?: string[]; kind: StopKind; date: string; manager: string; start?: { lat: number; lng: number };
  stops: Stop[]; left_out?: string[]; km: number; replaces?: number; maps?: string[]; routes?: string[];
  /** the manager's reported position was nowhere near the carts (a map opened from another city), so it was left out */
  start_far?: boolean;
  /** set in the app once the stops are in driving order (bennyDrive): then km is road kilometres and minutes the drive */
  by_road?: boolean; minutes?: number;
}
/** The pins an order of this kind leaves on the map: "Drop 3 · Kyle". */
export const stopPin = (kind: StopKind) => new RegExp(`^${STOP_WORD[kind]} \\d+ · `);

/** One job on a cart's logsheet, as the Benny reads it: no phone, email or card detail. */
export interface LogJob {
  id: string; at?: string; client?: string; address?: string; route?: string; type: string; service?: string; does?: string[]; note?: string;
  amount: number; paid_by: string;
}
/** What the edit screen's save takes for a change of amount or payment type (transactions columns). */
export interface JobPatch { price: number; display_price: string; payment_method: string; payment_breakdown: Record<string, number>; items?: { name: string; price: number }[] }
export interface JobCheck {
  ok: boolean; problems?: string[]; date: string; worker: { cn: string; name: string }; cart: { id: string; workers: string[] };
  job: LogJob; change: { amount?: { from: number; to: number }; paid_by?: { from: string; to: string } };
  ask: { amount?: number; paid_by?: string }; patch: JobPatch; stamp: string; notes?: string[];
}
export const dollars = (n: number) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The patch as the old app's updateTransaction takes it. Only these five fields are ever sent. */
export function jobUpdates(patch: JobPatch): { price: number; displayPrice: string; paymentMethod: string; paymentBreakdown: Record<string, number>; items?: { name: string; price: number }[] } {
  return { price: patch.price, displayPrice: patch.display_price, paymentMethod: patch.payment_method, paymentBreakdown: patch.payment_breakdown, ...(patch.items ? { items: patch.items } : {}) };
}

/** The open payouts with nothing to count by hand (no cash, no cheque: a cart with no jobs is one of them), in the order to go through them. */
export interface PayoutsCheck {
  ok: boolean; problems?: string[]; date: string;
  carts: { cart_id: string; cn: string; workers: string[]; jobs: number; gross: number; upsell_gross?: number; collected: Record<string, number> }[];
  to_count?: { workers: string[]; cash: number; cheque: number }[]; paid_out?: number;
}
const firsts = (names: string[]) => names.map(n => n.split(' ')[0]).join(' + ');
const PAID_AS: [string, string][] = [['card', 'card'], ['e_transfer', 'e-transfer'], ['prepaid', 'prepaid'], ['billed', 'billed'], ['cash', 'cash'], ['cheque', 'cheque']];
/** Where the payouts card goes: the payout screen at the first payout, with the rest lined up behind it. */
export const payoutsStart = (c: PayoutsCheck): string | null => queueHref(c.date, c.carts.map(x => x.cn));

export type BennyProposal =
  | { kind: 'payouts'; check: PayoutsCheck }
  | { kind: 'job'; check: JobCheck }
  | { kind: 'pin'; check: PinCheck }
  | { kind: 'stops'; check: StopsCheck }
  | { kind: 'booking_emails'; check: EmailsCheck }
  | { kind: 'start_day'; check: StartDayCheck; team_mode?: TeamMode }
  | { kind: 'give_route'; check: GiveCheck }
  | { kind: 'partner'; check: MoveCheck }
  | { kind: 'solo'; check: MoveCheck }
  | { kind: 'booking'; check: BookingCheck };

const NOTE = { field_note: 'field note', office_note: 'office note' } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** What was saved, in a few words: "marked done, moved to RMD137, field note added". */
export function bookingSaved(change: BookingCheck['change']): string {
  const out: string[] = [];
  if (change.status) out.push(change.status.to === 'done' ? 'marked done' : change.status.to === 'cancelled' ? 'cancelled' : 'open again');
  if (change.route) out.push(`moved to ${change.route.to}`);
  for (const k of ['field_note', 'office_note'] as const) {
    const n = change[k]; if (n) out.push(`${NOTE[k]} ${n.mode === 'clear' ? 'cleared' : n.mode === 'replace' ? 'changed' : 'added'}`);
  }
  return out.join(', ');
}

/** What the confirm card says (pure, so it's tested). */
export function describe(p: BennyProposal): { title: string; lines: string[]; action: string } {
  switch (p.kind) {
    case 'start_day': {
      const c = p.check;
      const pretty = new Date(c.date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
      const routes = c.assign.flatMap(a => a.routes || []);
      const mapsOf = (rs: { area: string }[]) => { const by = new Map<string, number>(); for (const r of rs) by.set(r.area, (by.get(r.area) || 0) + 1); return [...by].map(([m, n]) => `${m} (${n})`).join(', ') || 'none'; };
      const first = (a: StartDayCheck['assign'][number]) => (a.managers || []).map(m => m.name.split(' ')[0]).join(' + ') || 'Nobody';
      const mgrs = c.assign.map(a => (a.managers || []).map(m => m.name).join(' + ')).filter(Boolean);
      const mode = p.team_mode || 'roster';
      return {
        title: `Start ${pretty}`,
        lines: [
          `Manager${mgrs.length > 1 || mgrs.some(m => m.includes('+')) ? 's' : ''}: ${mgrs.join(' · ')}${c.pair ? ' (paired)' : mgrs.length === 1 && !mgrs[0].includes('+') ? ', solo' : ''}`,
          // who goes where: one line when there is one manager (or one pair), a line each when they have their own maps
          ...(c.assign.length > 1 ? c.assign.map(a => `${first(a)}’s routes: ${mapsOf(a.routes || [])}`) : [`Routes: ${mapsOf(routes)}`]),
          `Workers: ${c.showed} of ${c.booked} booked, ${mode === 'solo' || (mode === 'roster' && !c.teams && c.no_team) ? 'each on their own cart' : mode === 'pairs' ? `paired two to a cart${c.crews ? ' within each crew' : ''}` : c.no_team ? `roster carts, ${c.no_team} without one get their own` : 'on their roster carts'}`,
          // who goes with whom, when the plan splits the crew: each crew best first, with its average equiv per day worked
          ...(c.crews ? c.assign.filter(a => a.crew?.length).map(a =>
            `${first(a)}’s crew (${a.crew!.length}${a.crew_avg != null ? `, average ${Number(a.crew_avg).toFixed(1)} equiv a day` : ''}): ${crewNames(a.crew!, c.assign.flatMap(x => x.crew || []))}`) : []),
          ...(c.notes || []),
          `Prebooks on these routes: ${c.open_prebooks}`,
          ...(c.live_map_on && c.live_map_on !== c.date ? [`The live map moves from ${c.live_map_on} to this day (that day stays open to close).`] : []),
        ],
        action: 'Start the day',
      };
    }
    case 'give_route': {
      const c = p.check;
      const who = (c.cart || []).map(w => w.name).join(' + ') || c.worker.name;
      return {
        title: `Give ${c.route} to ${c.worker.name.split(' ')[0]}’s cart`,
        lines: [`${who}${c.map ? ` · ${c.map}` : ''}`, `${c.open_prebooks || 0} prebook${c.open_prebooks === 1 ? '' : 's'} on ${c.route}`,
          ...(c.now?.length ? [`Takes it from ${c.now.join(' + ')}`] : [])],
        action: 'Assign',
      };
    }
    case 'partner': {
      const c = p.check;
      const aCart = c.a.cart_id && c.carts?.[c.a.cart_id] || [c.a.name];
      return {
        title: `Partner ${c.b?.name.split(' ')[0]} with ${c.a.name.split(' ')[0]}`,
        lines: [`${c.b?.name} joins ${aCart.join(' + ')}’s cart`, `${c.a.name.split(' ')[0]}’s routes stay with the cart`],
        action: 'Partner up',
      };
    }
    case 'pin': {
      const c = p.check;
      return { title: `Drop a pin: “${c.label}”`, lines: [cap(c.at), `Seen by: ${c.seen_by.charAt(0).toLowerCase()}${c.seen_by.slice(1)}`], action: 'Drop the pin' };
    }
    case 'stops': {
      const c = p.check; const many = c.stops.length !== 1;
      const where = (s: Stop) => s.by === 'route' ? `route ${s.route || '?'}` : `${s.by === 'phone' ? 'phone' : 'last knock'}, ${s.age_min ?? 0} min ago`;
      return {
        title: `${STOP_WORD[c.kind]} order: ${c.stops.length} stop${many ? 's' : ''}`,
        lines: [
          ...c.stops.slice(0, 10).map(s => `${s.n}. ${s.who} · ${where(s)}`),
          ...(c.stops.length > 10 ? [`+ ${c.stops.length - 10} more`] : []),
          `About ${c.by_road ? `${c.minutes} min of driving (${c.km} km)` : `${c.km} km in a straight line`}${c.start ? ', from where you are' : `, starting at ${c.stops[0]?.who} (${c.start_far ? 'your location is too far from the carts to start from' : 'I don’t have your location'})`}`,
          ...(c.left_out?.length ? [`Left out: ${c.left_out.join(', ')}`] : []),
          ...(c.replaces ? [`Replaces your ${c.replaces} earlier ${c.kind} pin${c.replaces === 1 ? '' : 's'}`] : []),
          'Only you see these pins. Tap one on the map, then Navigate.',
        ],
        action: many ? 'Drop the pins' : 'Drop the pin',
      };
    }
    case 'booking_emails': {
      const c = p.check; const n = c.counts;
      const pretty = new Date(c.date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
      const byMap = new Map<string, number>();
      for (const r of c.routes) byMap.set(r.area, (byMap.get(r.area) || 0) + 1);
      const maps = [...byMap].map(([m, k]) => `${m} (${k})`);
      return {
        title: `${c.kind === 'next_try' ? 'Next-try' : 'Day-before'} emails for ${pretty}`,
        lines: [
          `Routes: ${maps.length > 4 ? `${c.routes.length} on ${maps.length} maps` : maps.join(', ') || 'none'}`,
          `${n.to_email} customer${n.to_email === 1 ? '' : 's'} to email${n.no_email ? ` · ${n.no_email} ha${n.no_email === 1 ? 's' : 've'} no email` : ''}${n.already_sent ? ` · ${n.already_sent} already got it` : ''}`,
          ...(c.from ? [`From ${c.from}`] : []),
          ...(c.notes || []),
          'Nothing is sent from here: you read every email, then press Send.',
        ],
        action: 'Open to read and send',
      };
    }
    case 'booking': {
      const c = p.check; const ch = c.change; const a = c.booking.address;
      const one = Object.keys(ch).length === 1;
      const note = ch.field_note ? 'field_note' as const : ch.office_note ? 'office_note' as const : null;
      const title = !one ? `Change ${a}`
        : ch.status ? (ch.status.to === 'done' ? `Mark ${a} done` : ch.status.to === 'cancelled' ? `Cancel ${a}` : `Reopen ${a}`)
        : ch.route ? `Move ${a} to ${ch.route.to}`
        : note && ch[note]!.mode === 'clear' ? `Clear the ${NOTE[note]} on ${a}`
        : note && ch[note]!.mode === 'replace' ? `Change the ${NOTE[note]} on ${a}`
        : note ? `Add ${note === 'office_note' ? 'an' : 'a'} ${NOTE[note]} to ${a}` : `Change ${a}`;
      const lines = [[c.booking.city, c.booking.list, c.booking.job, c.booking.people?.[0]].filter(Boolean).join(' · ')].filter(Boolean);
      if (ch.status) lines.push(`Status: ${ch.status.from} → ${ch.status.to}`);
      if (ch.route) lines.push(`Route: ${ch.route.from || 'none'} → ${ch.route.to}${ch.route.map ? ` (${ch.route.map})` : ''}`);
      for (const k of ['field_note', 'office_note'] as const) {
        const n = ch[k]; if (!n) continue;
        lines.push(`${cap(NOTE[k])}: ${n.mode === 'clear' ? `cleared (was “${n.was}”)` : n.mode === 'replace' ? `“${n.was}” becomes “${n.text}”` : n.mode === 'add' ? `adds “${n.text}”` : `“${n.text}”`}`);
      }
      return { title, lines: [...lines, ...(c.notes || [])], action: 'Save' };
    }
    case 'payouts': {
      const c = p.check; const n = c.carts.length;
      return {
        title: `Go through ${n} payout${n === 1 ? '' : 's'} with no cash or cheque`,
        lines: [
          ...c.carts.slice(0, 10).map(x => !x.jobs ? `${firsts(x.workers)} · no jobs`
            : `${firsts(x.workers)} · ${x.jobs} job${x.jobs === 1 ? '' : 's'} · ${PAID_AS.filter(([k]) => (x.collected?.[k] || 0) > 0).map(([k, w]) => `${dollars(x.collected[k])} ${w}`).join(', ') || dollars(x.gross + (x.upsell_gross || 0))}`),
          ...(n > 10 ? [`+ ${n - 10} more`] : []),
          ...(c.to_count?.length ? [`Left for a hand count: ${c.to_count.map(t => `${firsts(t.workers)} (${[t.cash > 0 ? `${dollars(t.cash)} cash` : '', t.cheque > 0 ? `${dollars(t.cheque)} in cheques` : ''].filter(Boolean).join(', ')})`).join('; ')}`] : []),
          'Nothing is paid out from here: each one opens on the payout screen and you press Finalize. It then moves to the next.',
        ],
        action: 'Open',
      };
    }
    case 'job': {
      const c = p.check; const j = c.job; const ch = c.change; const first = c.worker.name.split(' ')[0];
      const what = [j.type === 'Production' ? 'Production' : j.type, j.service, j.does?.length ? `(${j.does.join(', ')})` : ''].filter(Boolean).join(' · ').replace(' · (', ' (');
      const team = c.cart.workers.length > 1;
      return {
        title: `Change a job on ${first}’s logsheet`,
        lines: [
          [j.client, j.address].filter(Boolean).join(' · ') || 'A job with no client name',
          what,
          ch.amount ? `Amount: ${dollars(ch.amount.from)} → ${dollars(ch.amount.to)}` : `Amount: ${dollars(j.amount)} (stays)`,
          ch.paid_by ? `Paid by: ${ch.paid_by.from || 'not set'} → ${ch.paid_by.to}` : `Paid by: ${j.paid_by} (stays)`,
          ...(c.notes || []),
          `${team ? `The cart’s (${c.cart.workers.map(n => n.split(' ')[0]).join(' + ')})` : `${first}’s`} equiv and totals are worked out again. The change is recorded under your name.`,
        ],
        action: 'Save',
      };
    }
    case 'solo': {
      const c = p.check;
      return { title: `${c.a.name.split(' ')[0]} on a cart alone`, lines: [`${c.a.name} leaves ${(c.a.cart_id && c.carts?.[c.a.cart_id] || []).filter(n => n !== c.a.name).join(' + ') || 'their cart'}`], action: 'Move' };
    }
  }
}

/** The Start session plan from the Benny's checked plan and the day's roster (pure, so it's tested). */
export function buildBennyPlan(check: StartDayCheck, teamMode: TeamMode, roster: RosterRow[], managers: PlanManager[],
  card: RateCardData, service: Service, seasonYear: number, appDaysBefore: Record<string, number> = {}): Plan {
  const avail = new Set(managers.map(m => m.id));
  const entries = check.assign.map(a => ({ mgrs: (a.managers || []).map(m => m.id).filter(id => avail.has(id)), routes: a.routes || [], crew: (a.crew || []).map(w => w.hire_id) })).filter(e => e.mgrs.length);
  // a crew per manager, when the plan has them: a worker's cart goes to the manager whose crew they are in
  const crewOf = new Map<string, string>();
  for (const e of entries) for (const h of e.crew) if (!crewOf.has(h)) crewOf.set(h, e.mgrs[0]);
  const mgrOf = (r: RosterRow) => crewOf.get(r.hire_id) ?? r.manager_id;
  const routes: PlanRoute[] = entries.flatMap(e => e.routes.map(r => ({ code: r.code, area: r.area, number: r.number, managerId: e.mgrs[0] })));
  const pairs = entries.filter(e => e.mgrs.length > 1).map(e => e.mgrs);
  const leads = entries.map(e => e.mgrs[0]);
  const showedRows = roster.filter(r => (r.attendance ?? 'showed') === 'showed')
    .sort((a, b) => fullName(a.hire.person).localeCompare(fullName(b.hire.person)));
  const teams: PlanTeam[] = []; const members: Record<string, string> = {};
  let turn = 0;
  const lead = (rosterMgr?: string | null) => rosterMgr && leads.includes(rosterMgr) ? rosterMgr : leads[(turn++) % Math.max(1, leads.length)] || '';
  const addTeam = (hireIds: string[], kind: PlanTeam['kind'] = 'cart', mgr?: string | null, name?: string) => {
    const n = name && !teams.some(t => t.name === name) ? name : nextTeamName(teams, kind);
    teams.push({ name: n, kind, managerId: lead(mgr) });
    for (const h of hireIds) members[h] = n;
  };
  if (teamMode === 'roster') {
    const named = new Map<string, RosterRow[]>();
    for (const r of showedRows) if (r.team) named.set(r.team, [...(named.get(r.team) || []), r]);
    for (const [n, rows] of [...named].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      // a roster cart whose members were put in different crews is broken up: each of them gets a cart of their own
      const split = new Set(rows.map(r => crewOf.get(r.hire_id) || '')).size > 1;
      if (split) for (const r of rows) addTeam([r.hire_id], 'cart', mgrOf(r));
      else addTeam(rows.map(r => r.hire_id), /^RC\d*$/i.test(n) ? 'ramp' : 'cart', crewOf.get(rows[0].hire_id) ?? rows.find(r => r.manager_id)?.manager_id, n);
    }
    for (const r of showedRows.filter(r => !r.team)) addTeam([r.hire_id], 'cart', mgrOf(r));
  } else if (teamMode === 'solo') {
    for (const r of showedRows) addTeam([r.hire_id], 'cart', mgrOf(r));
  } else {
    // two to a cart; with crews, partners come from the same crew
    const groups = crewOf.size ? [...leads.map(l => showedRows.filter(r => crewOf.get(r.hire_id) === l)), showedRows.filter(r => !crewOf.has(r.hire_id))] : [showedRows];
    for (const g of groups) for (let i = 0; i < g.length; i += 2) addTeam(g.slice(i, i + 2).map(r => r.hire_id), 'cart', mgrOf(g[i]));
  }
  return {
    date: check.date, seasonYear, card, managers, routes, teams, members, roster, appDaysBefore,
    showed: new Set(showedRows.map(r => r.hire_id)),
    settings: { service, productCostPercent: card.productCostPercent, emailReceipts: true, liveCard: true, noTaxOnCash: card.noTaxOnCashDefault },
    pairs: pairs.length ? pairs : undefined,
  };
}

interface CenterLite { id: string; region?: string | null; services?: readonly string[] | null }

/** A plan with crews, checked against the roster as it is now (the card may be minutes old): the person said who goes with
 *  whom, so a manager who has gone or a worker added since is a reason to stop, not something to deal out quietly. */
export function crewProblems(check: StartDayCheck, roster: RosterRow[], managers: PlanManager[]): string[] {
  if (!check.crews) return [];
  const avail = new Set(managers.map(m => m.id));
  const gone = check.assign.filter(a => a.crew?.length && !(a.managers || []).some(m => avail.has(m.id))).flatMap(a => (a.managers || []).map(m => m.name));
  const placed = new Set(check.assign.flatMap(a => (a.crew || []).map(w => w.hire_id)));
  const loose = roster.filter(r => (r.attendance ?? 'showed') === 'showed' && !placed.has(r.hire_id)).map(r => fullName(r.hire.person));
  return [
    ...(gone.length ? [`${gone.join(' and ')} ${gone.length > 1 ? 'aren’t' : 'isn’t'} available on ${check.date} any more, so the crews don’t hold. Ask me again.`] : []),
    ...(loose.length ? [`${loose.join(', ')} ${loose.length > 1 ? 'aren’t' : 'isn’t'} in a crew: the roster changed since I checked. Ask me again.`] : []),
  ];
}

export async function startDayFromBenny(p: Extract<BennyProposal, { kind: 'start_day' }>, center: CenterLite): Promise<string> {
  const c = p.check;
  const day = await getDay(center.id, c.date);
  if (!day) throw new Error(`Nobody is booked on ${c.date}.`);
  if (await getSession(day.id)) throw new Error(`The session for ${c.date} has already started.`);   // an old card tapped again
  const [roster, managers, seasons] = await Promise.all([listRoster(day.id), availableManagers(center.id, c.date), listSeasons(center.id)]);
  const season = seasons.find(s => s.starts_on <= c.date && c.date <= s.ends_on) || null;
  const cards = season ? await listRateCards(season.id) : [];
  const service = (season?.service || centerService(center.services)) as Service;
  const card = cardFor(cards, c.date)?.data || defaultRateCard(service, regionTax(center.region || 'East'));
  const shown = await appShowedDates(roster.map(r => r.hire_id));
  const appDays = Object.fromEntries(roster.map(r => [r.hire_id, countBefore(shown[r.hire_id], c.date)]));
  const stale = crewProblems(c, roster, managers);
  if (stale.length) throw new Error(stale[0]);
  const plan = buildBennyPlan(c, p.team_mode || 'roster', roster, managers, card, service, season?.year || Number(c.date.slice(0, 4)), appDays);
  const problems = planProblems(plan);
  if (problems.length) throw new Error(problems[0]);
  await startSession(plan, day.id, center.id);
  return `Started ${c.date}: ${plan.routes.length} routes, ${plan.teams.length} carts, ${plan.showed.size} workers. Managers sign in to Route Manager › Map.`;
}

/** The same check that made the card, run again right before the change: the team may have moved since. */
async function recheck<T extends { ok: boolean; problems?: string[] }>(fn: string, args: Record<string, unknown>): Promise<T> {
  const fresh = must(await db.rpc(fn, args)) as T;
  if (!fresh?.ok) throw new Error(fresh?.problems?.[0] || 'That can’t be done any more. Ask me again.');
  return fresh;
}
const same = (a?: string[] | null, b?: string[] | null) => [...(a || [])].sort().join('|') === [...(b || [])].sort().join('|');

async function legacy(centerId: string) {
  const { pointLegacyAt } = await import('./legacy');
  await pointLegacyAt(centerId);
  const [{ sessionService }, { seasonHasTeams }] = await Promise.all([import('../../lib/sessionService'), import('../../lib/commandCenterService')]);
  const date = await sessionService.getDailySessionDate();
  return { sessionService, date, seasonHasTeams };
}

/** RM map › Assign route, whole route (the same steps as RMMapTab's handleAssign). */
export async function giveRouteFromBenny(p: Extract<BennyProposal, { kind: 'give_route' }>, centerId: string): Promise<string> {
  const c = await recheck<GiveCheck>('benny_check_give', { p_center: centerId, p_route: p.check.route, p_worker: p.check.worker.cn });
  if (!same(c.now, p.check.now)) throw new Error(`${c.route} changed hands since I checked${c.now?.length ? ` (${c.now.join(' + ')} has it now)` : ''}. Ask me again.`);
  const { sessionService, date, seasonHasTeams } = await legacy(centerId);
  if (date !== c.date) throw new Error('The live day changed since I checked. Ask me again.');
  const session = await sessionService.getWorkerLogsheetSession(c.worker.cn);
  if (!session) throw new Error(`${c.worker.name} isn’t on a cart any more.`);
  const cartIds: string[] = session.teamWorkerIds?.length ? session.teamWorkerIds : [c.worker.cn];
  const { supabase } = await import('../../lib/supabase');
  const { data: rows, error } = await supabase.from('bookings').select('booking_id, status, data')
    .eq('command_center_id', centerId).eq('session_date', c.date).eq('status', 'pending').eq('route_number', c.route);
  if (error) throw new Error(error.message);
  const pending = (rows || []).filter(b => {
    const d = (b.data || {}) as Record<string, unknown>;
    return d.Completed !== 'x';   // the RM map's own rule: the day's pending bookings not yet marked done
  }).map(b => b.booking_id as string);
  const team = seasonHasTeams(await sessionService.getSessionSeasonType());
  await sessionService.assignRouteToWorkers(c.route, team && cartIds.length > 1 ? cartIds : [c.worker.cn]);
  if (team) { if (pending.length) await sessionService.assignBookingsToSession(pending, session.id); }
  else await Promise.all(pending.map(id => sessionService.assignBookingToWorker(id, c.worker.cn)));
  if (c.worker.manager && c.worker.manager !== c.route_manager) await sessionService.transferRouteToManager(c.route, c.worker.manager);
  // the old app's assign logs a failed save without stopping: check it really is on the cart
  const { data: saved } = await supabase.from('routes').select('assigned_worker_ids')
    .eq('command_center_id', centerId).eq('session_date', c.date).eq('route_code', c.route).maybeSingle();
  if (!((saved?.assigned_worker_ids as string[] | null) || []).includes(c.worker.cn)) throw new Error(`${c.route} didn’t save to the cart. Try it on the map.`);
  return `${c.route} is on ${(c.cart || []).map(w => w.name.split(' ')[0]).join(' + ') || c.worker.name}’s cart${pending.length ? ` with ${pending.length} prebook${pending.length === 1 ? '' : 's'}` : ''}.`;
}

/** RM map › Move worker: b joins a's cart, or a goes solo. */
export async function moveFromBenny(p: Extract<BennyProposal, { kind: 'partner' | 'solo' }>, centerId: string): Promise<string> {
  const c = await recheck<MoveCheck>('benny_check_move', { p_center: centerId, p_a: p.check.a.cn, p_b: p.check.b?.cn ?? null });
  const { sessionService, date } = await legacy(centerId);
  if (date !== c.date) throw new Error('The live day changed since I checked. Ask me again.');
  if (p.kind === 'solo') {
    await sessionService.reassignWorker(c.a.cn, { type: 'new_solo' });
    return `${c.a.name} is on a cart alone now.`;
  }
  if (!c.b) throw new Error('Who joins the cart?');
  const target = await sessionService.getWorkerLogsheetSession(c.a.cn);
  if (!target) throw new Error(`${c.a.name} isn’t on a cart any more.`);
  await sessionService.reassignWorker(c.b.cn, { type: 'existing_cart', targetSessionId: target.id });
  return `${c.b.name} is on ${c.a.name.split(' ')[0]}’s cart now.`;
}

/** Bookings › List › save: the same save, after the same check that made the card says nothing moved since. */
export async function bookingFromBenny(p: Extract<BennyProposal, { kind: 'booking' }>, centerId: string): Promise<string> {
  const c = await recheck<BookingCheck>('benny_check_booking', { p_center: centerId, p_booking: p.check.booking.id, p_change: p.check.ask });
  if (c.stamp !== p.check.stamp) throw new Error(`${c.booking.address} was changed since I checked. Ask me again.`);
  const saved = await saveBooking(c.booking.id, null, c.patch);
  const kept = (k: 'field_notes' | 'office_notes') => !(k in c.patch) || (saved[k] || '') === (c.patch[k] || '');
  if ((c.patch.status && saved.status !== c.patch.status) || (c.patch.route_code && saved.route_code !== c.patch.route_code) || !kept('field_notes') || !kept('office_notes'))
    throw new Error(`${c.booking.address} didn’t save. Try it in Bookings › List.`);
  return `${c.booking.address}: ${bookingSaved(c.change)}.`;
}

/** A logsheet job's amount and payment type, saved by the old app's own edit save (it works the cart's equiv and totals
 *  out again). The database checks it once more just before (nothing may have moved since the card was made), starts a
 *  record of the change, and after the save reads the job back to close the record: only then is it called saved. */
export async function jobFromBenny(p: Extract<BennyProposal, { kind: 'job' }>, centerId: string): Promise<string> {
  const c = p.check; const first = c.worker.name.split(' ')[0];
  const { sessionService, date } = await legacy(centerId);
  if (date !== c.date) throw new Error('The live day changed since I checked. Ask me again.');
  const begun = must(await db.rpc('benny_job_begin', { p_center: centerId, p_worker: c.worker.cn, p_job: c.job.id, p_change: c.ask, p_stamp: c.stamp })) as JobCheck & { change_id?: string };
  if (!begun?.ok || !begun.change_id || !begun.patch) throw new Error(begun?.problems?.[0] || 'That job can’t be changed now. Ask me again.');
  let failed = false;
  try { await sessionService.updateTransaction(c.job.id, jobUpdates(begun.patch)); } catch { failed = true; }
  // read it back whatever happened, so the record says what the job reads now
  let state: string | undefined;
  try { state = ((await db.rpc('benny_job_done', { p_id: begun.change_id })).data as { state?: string } | null)?.state; } catch { /* no signal: not confirmed */ }
  const screen = 'the edit screen (RM map › the worker › tap the job)';
  if (state === 'not_saved' || (failed && state !== 'done')) throw new Error(`The change didn’t save: ${first}’s job still reads ${dollars(c.job.amount)}, ${c.job.paid_by}. Try again, or change it on the edit screen.`);
  if (state === 'differs') throw new Error(`It saved, but it doesn’t read the way you asked. Check the job on ${screen}.`);
  if (state !== 'done') throw new Error(`I couldn’t read the job back to confirm it. Check it on ${screen} before trying again.`);
  return `${c.job.client ? `${c.job.client.split(' ')[0]}’s job` : 'The job'} on ${first}’s logsheet now reads ${dollars(begun.patch.price)}, ${begun.patch.payment_method}. The totals are worked out again.`;
}

/** RM map › Pins › drop a pin: the map's own save, on the day and manager the check was made for. */
export async function pinFromBenny(p: Extract<BennyProposal, { kind: 'pin' }>, centerId: string): Promise<string> {
  const c = p.check;
  const { sessionService, date } = await legacy(centerId);
  if (date !== c.date) throw new Error('The live day changed since I checked. Ask me again.');
  const pin = await sessionService.createMapPin(c.label, c.lat, c.lng, c.manager, c.visibility, c.target_manager || null, c.target_worker || null);
  if (!pin) throw new Error('The pin didn’t save. Drop it on the map instead.');
  return `“${c.label}” is on the map, ${c.at}.`;
}

/** A planned order becomes numbered pins, only the manager's own. An earlier order of the same kind goes first, so the
 *  numbers on the map are this order's alone. */
export async function stopsFromBenny(p: Extract<BennyProposal, { kind: 'stops' }>, centerId: string): Promise<string> {
  const c = p.check;
  const { sessionService, date } = await legacy(centerId);
  if (date !== c.date) throw new Error('The live day changed since I checked. Ask me again.');
  const mine = stopPin(c.kind);
  const old = (await sessionService.getMapPins([c.manager])).filter(x => x.createdBy === c.manager && x.visibility === 'private' && mine.test(x.label));
  for (const o of old) await sessionService.deleteMapPin(o.id);
  let made = 0;
  for (const s of c.stops) { if (await sessionService.createMapPin(s.label, s.lat, s.lng, c.manager, 'private')) made++; }
  if (made !== c.stops.length) throw new Error(`Only ${made} of ${c.stops.length} pins saved. Ask me again to redo them.`);
  return `${made} ${c.kind} pin${made === 1 ? ' is' : 's are'} on your map, numbered in order. Tap one, then Navigate.`;
}

export async function doProposal(p: BennyProposal, center: CenterLite): Promise<string> {
  if (p.kind === 'start_day') return startDayFromBenny(p, center);
  if (p.kind === 'give_route') return giveRouteFromBenny(p, center.id);
  if (p.kind === 'booking') return bookingFromBenny(p, center.id);
  if (p.kind === 'job') return jobFromBenny(p, center.id);
  if (p.kind === 'pin') return pinFromBenny(p, center.id);
  if (p.kind === 'stops') return stopsFromBenny(p, center.id);
  // not a change: the panel opens the Send booking emails screen instead (see BennyPanel)
  if (p.kind === 'booking_emails') throw new Error('Open Bookings › Send booking emails to read and send these.');
  if (p.kind === 'payouts') throw new Error('Open the payouts on the day page to finalize these.');
  return moveFromBenny(p, center.id);
}
