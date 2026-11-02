// src/msdemo/store.ts — the MainstreetAI demo's pretend server. The real rep and host screens run unchanged;
// every Supabase call they make is answered here, from memory: real Oakville businesses (seed.json), with
// made-up visits, deals, calls and mail. Nothing is saved anywhere and nothing is sent; a reload starts over.
import seedJson from './seed.json';
import type { Kit, MapBiz, MapPair, PinState, RepBusiness, RepVisit } from '../v2/lib/rep';
import type { DeckAnswers, Hours, Meeting, MeetingStatus } from '../v2/lib/meetings';
import type { Message, Thread, ThreadRow } from '../v2/lib/mail';

type SeedBiz = { id: string; n: string; a: string | null; lat: number; lng: number; k: string; p: string | null; pid: number | null; z: string; ph: string | null; w: string | null; h: string[] | null };
type SeedZone = { id: string; name: string; city: string; polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon; center: [number, number] };
interface Seed {
  campaign: { id: string; name: string; color: string; kit: Record<string, unknown> };
  zones: SeedZone[]; businesses: SeedBiz[];
}
const seed = seedJson as unknown as Seed;

const MIN = 6e4, H = 60 * MIN, D = 24 * H;
const TZ = 'America/Toronto';
const iso = (t: number) => new Date(t).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const REP = { id: 'demo-rep', name: 'Alex Morgan', first: 'Alex', phone: '(905) 555-0142', email: 'alex.morgan@mainstreetai.demo' };
export const HOST = { id: 'demo-host', name: 'Sarah Chen', email: 'sarah.chen@taxifi.demo', zoom: 'https://zoom.us/j/5550100200' };

const camp = { id: seed.campaign.id, name: seed.campaign.name, color: seed.campaign.color || '#0b7d57' };
const bizById = new Map(seed.businesses.map(b => [b.id, b]));
const zoneById = new Map(seed.zones.map(z => [z.id, z]));

// ───────────── a seeded random, so every visitor sees the same starting point ─────────────
let rs = 20261102;
const rand = () => { rs = (rs * 1664525 + 1013904223) % 4294967296; return rs / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

// Toronto wall-clock → a real moment (so the host's hours mean Toronto hours wherever the demo is opened)
function tzOffsetMin(t: number, tz = TZ): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - t) / MIN);
}
/** The Toronto calendar day of a moment: "2026-11-02" and its weekday (0 = Sunday). */
function torontoDay(t: number): { key: string; dow: number } {
  const key = new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
  const [y, m, d] = key.split('-').map(Number);
  return { key, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function torontoAt(dayKey: string, minutes: number): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  return guess - tzOffsetMin(guess) * MIN;
}

// ───────────── the state ─────────────
interface Visit extends RepVisit { business_id: string; contact_role?: string }
interface Contact { id: string; business_id: string; name?: string; role?: string; title?: string; phone?: string; email?: string; decides?: boolean; best_time?: string; source?: string; email_ok?: boolean | null; updated_at: string; hidden?: boolean }
interface Lead extends SeedBiz { lead: true }
const S = {
  visits: [] as Visit[],
  deals: new Map<string, { status: 'pending' | 'approved' | 'rejected'; at: string; note?: string }>(),   // by visit id
  answers: new Map<string, DeckAnswers>(),                                                                 // by business id
  contacts: [] as Contact[],
  meetings: [] as Meeting[],
  leads: [] as Lead[],
  day: { started_at: null as string | null, ended_at: null as string | null, distance_m: 0 },
  host: {
    zoom_url: HOST.zoom as string | null, timezone: TZ, active: true, days_off: [] as string[],
    hours: { '1': [[540, 1020]], '2': [[540, 1020]], '3': [[540, 1020]], '4': [[540, 1020]], '5': [[540, 960]] } as Hours,
  },
  threads: [] as (Thread & { last_at: string; unread: number; business_id: string })[],
  lost: new Map<string, string>(),   // business → the lost reason
  pitched: new Set<string>(),         // businesses the deck was presented at
};

const OWNERS = ['Maria Lopez', 'Dev Patel', 'Jordan Lee', 'Priya Sharma', 'Tom Reyes', 'Lina Haddad', 'Marco Bianchi', 'Grace Kim', 'Omar Siddiqui', 'Hannah Wright', 'Chris Novak', 'Aisha Bello'];
const emailFor = (owner: string, biz: string) => `${owner.split(' ')[0].toLowerCase()}@${biz.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'shop'}.demo`;
const phoneFor = () => `(905) 555-${String(1000 + Math.floor(rand() * 8999)).slice(0, 4)}`;

const sampleAnswers = (owner: string, biz: SeedBiz): DeckAnswers => ({
  v: 1, answers: { role: 'Owner', expenses: '25_50', staff: '4', books: 'bookkeeper', pay_now: '600_1000', year_end: '2000_3500' },
  contact: { name: owner, role: 'Owner', phone: phoneFor(), email: emailFor(owner, biz.n) },
  summary: [['Talking with', `${owner} (Owner)`], ['How long you’ve been in business', '5–10 years'], ['Owned it the whole time?', 'Original owner'],
    ['Monthly business expenses', '$25K–$50K'], ['Staff on payroll', '4'], ['Who does the books now', 'A bookkeeper'],
    ['What you pay now for bookkeeping and payroll', '$600–$1,000'], ['What you pay for year-end', '$2,000–$3,500'],
    ['How do the bulk of your customers find you?', 'Walk-in, Google'], ['Approximate staff hours a week on administrative duties', '11–40 hrs']],
  proposal: { lines: [['Core bookkeeping', '$549/mo'], ['Corporate return (T2 Standard)', 'from $1,500/yr'], ['Payroll', '$89/mo'], ['Bundle discount', '−15%']],
    monthly: 559, yearly: 6783, quoted: false, today_yearly: 12350, savings: 5567, fit: 'taxifi takes over the monthly bookkeeping, with a Canadian accountant signing every month.' },
});

function addVisit(b: SeedBiz, outcome: RepVisit['outcome'], at: number, extra: Partial<Visit> = {}): Visit {
  const v: Visit = { id: uid(), business_id: b.id, at: iso(at), outcome, far: false, distance_m: Math.round(4 + rand() * 30), ...extra };
  S.visits.push(v);
  return v;
}

// a believable last two weeks for a rep: kept for a fuller demo, but the demo starts blank (the rep adds the first one)
export function seedHistory() {
  const now = Date.now();
  const list = [...seed.businesses];
  // walk a few streets: every 6th business or so has been visited
  const visited = list.filter((_, i) => i % 6 === 0).slice(0, 110);
  for (const b of visited) {
    const daysAgo = Math.floor(rand() * 12) + (rand() < 0.3 ? 0 : 1);
    const at = now - daysAgo * D - Math.floor(rand() * 6 * H) - H;
    const r = rand();
    const owner = pick(OWNERS);
    if (r < 0.32) addVisit(b, 'come_back', at, { notes: pick(['Owner not in, back after 2', 'Closed at lunch', 'Manager only on Fridays']) });
    else if (r < 0.52) addVisit(b, 'not_interested', at, { notes: pick(['Happy with their accountant', 'Not incorporated', 'Too busy to talk']), contact_name: owner });
    else if (r < 0.68) {
      const f = now + (rand() < 0.45 ? -Math.floor(rand() * 2) * D + 2 * H : Math.floor(1 + rand() * 6) * D) ;
      addVisit(b, 'follow_up', at, { follow_up_at: iso(f), contact_name: owner, contact_phone: phoneFor(), notes: pick(['Ask for the owner, mornings are best', 'Wants to see pricing with their partner', 'Call after their HST filing']) });
    } else if (r < 0.82) addVisit(b, 'interested', at, { contact_name: owner, contact_email: emailFor(owner, b.n), notes: 'Sent the info link by text' });
    else if (r < 0.95) {
      const v = addVisit(b, 'closed', at, { contact_name: owner, contact_phone: phoneFor(), contact_email: emailFor(owner, b.n), notes: 'Booked onboarding from the deck' });
      S.deals.set(v.id, { status: rand() < 0.6 ? 'approved' : 'pending', at: v.at });
      S.answers.set(b.id, sampleAnswers(owner, b));
    } else addVisit(b, 'cant_sell', at, { notes: pick(['Head office only, in Toronto', 'Shut down', 'Franchise: accounting is head office']) });
  }
  // the calls the host has: from closed deals
  const closed = S.visits.filter(v => v.outcome === 'closed').slice(0, 5);
  const slotsAt = [now - 45 * MIN, now + 22 * H, now + 2 * D + 3 * H, now - 3 * D, now - 5 * D];
  closed.forEach((v, i) => {
    const b = bizById.get(v.business_id)!;
    const t = Math.round(slotsAt[i] / (30 * MIN)) * 30 * MIN;
    const status: MeetingStatus = i === 3 ? 'closed' : i === 4 ? 'no_show' : 'booked';
    S.meetings.push(meetingFor(b, t, v.contact_name || pick(OWNERS), v.contact_phone || phoneFor(), v.contact_email || null, status,
      i === 3 ? { outcome_note: 'Signed up for Core + T2', outcome_by: HOST.name, outcome_at: iso(t + 40 * MIN) } : i === 4 ? { outcome_by: HOST.name, outcome_at: iso(t + 35 * MIN) } : {}));
  });
  // mail
  const inter = S.visits.filter(v => v.outcome === 'interested' && v.contact_email).slice(0, 3);
  inter.forEach((v, i) => {
    const b = bizById.get(v.business_id)!;
    const sent = new Date(v.at).getTime() + 20 * MIN;
    const msgs: Message[] = [
      { id: uid(), dir: 'out', status: 'sent', from_email: REP.email, from_name: REP.name, to: [v.contact_email!], subject: `Following up from today, ${b.n}`,
        html: `<p>Hi ${(v.contact_name || '').split(' ')[0]},</p><p>Thanks for your time today. Here’s the link I mentioned: it shows what taxifi would look like for ${b.n}.</p><p>Alex</p>`, at: iso(sent), delivery: 'delivered' },
    ];
    if (i < 2) msgs.push({ id: uid(), dir: 'in', status: 'received', from_email: v.contact_email!, from_name: v.contact_name || undefined, to: [REP.email], subject: `Re: Following up from today, ${b.n}`,
      html: i === 0 ? '<p>Thanks Alex. What would payroll cost for 4 people? We pay our bookkeeper about $700 a month now.</p>' : '<p>Can we do a call next week? Tuesday works best.</p>', at: iso(sent + 5 * H) });
    const last = msgs[msgs.length - 1];
    S.threads.push({ id: uid(), subject: `Following up from today, ${b.n}`, contact_email: v.contact_email, contact_name: v.contact_name, starred: false, archived: false, opted_out: false,
      business: { id: b.id, name: b.n, address: b.a || undefined, kind: b.k, phone: b.ph || undefined }, campaign: camp, messages: msgs, last_at: last.at, unread: last.dir === 'in' ? 1 : 0, business_id: b.id });
  });
}

function meetingFor(b: SeedBiz, start: number, owner: string, phone: string | null, email: string | null, status: MeetingStatus = 'booked', extra: Partial<Meeting> = {}): Meeting {
  return {
    id: uid(), status, starts_at: iso(start), ends_at: iso(start + 30 * MIN), length_min: 30, timezone: TZ,
    owner_name: owner, owner_phone: phone, owner_email: email, notes: null, outcome_note: null, outcome_at: null, outcome_by: null,
    campaign: { id: camp.id, name: camp.name, color: camp.color }, business: { id: b.id, name: b.n, address: b.a, phone: b.ph },
    host: { id: HOST.id, name: HOST.name, email: HOST.email, zoom_url: S.host.zoom_url, timezone: S.host.timezone },
    rep: { id: REP.id, name: REP.name, phone: REP.phone, email: REP.email }, deal_id: null, deal_status: null, created_at: iso(start - 2 * D),
    answers: S.answers.get(b.id) || null, ...extra,
  };
}

// ───────────── reading the state ─────────────
// Like the real app, reps only see businesses reps have added (plus anything already visited): the ones
// visited in the sample history, about as many more that other reps added, and whatever is added in the demo.
const added = new Set<string>();   // the demo starts blank: businesses appear as the rep adds them
const allBiz = (): SeedBiz[] => [...seed.businesses.filter(b => added.has(b.id) || S.visits.some(v => v.business_id === b.id)), ...S.leads];
const visitsOf = (bid: string) => S.visits.filter(v => v.business_id === bid).sort((a, b) => b.at.localeCompare(a.at));
const retryDays = () => Number(seed.campaign.kit.retry_days) || 30;
function stateOf(bid: string): { state: PinState; last_at: string | null; follow_up_at: string | null; visits: number } {
  const vs = visitsOf(bid);
  if (!vs.length) return { state: 'new', last_at: null, follow_up_at: null, visits: 0 };
  const v = vs[0];
  let state: PinState = v.outcome;
  if (v.outcome === 'closed') { const d = S.deals.get(v.id); state = !d || d.status === 'pending' ? 'pending' : d.status === 'approved' ? 'closed' : 'rejected'; }
  if (v.outcome === 'not_interested' && Date.now() - new Date(v.at).getTime() > retryDays() * D) state = 'retry';
  return { state, last_at: v.at, follow_up_at: v.outcome === 'follow_up' ? v.follow_up_at || null : null, visits: vs.length };
}
const OPEN: PinState[] = ['new', 'retry', 'come_back', 'follow_up', 'interested', 'rejected'];

function zoneCounts(zid: string) {
  const list = allBiz().filter(b => b.z === zid);
  let left = 0, visited = 0, fu = 0, pend = 0, appr = 0;
  for (const b of list) {
    const s = stateOf(b.id);
    if (OPEN.includes(s.state)) left++;
    if (s.visits) visited++;
    if (s.follow_up_at && new Date(s.follow_up_at).getTime() < Date.now() + D) fu++;
    if (s.state === 'pending') pend++;
    if (s.state === 'closed') appr++;
  }
  return { total: list.length, left, visited, followups_due: fu, deals_pending: pend, deals_approved: appr, leads: S.leads.filter(l => l.z === zid).length };
}
const kit = (): Kit => ({
  id: camp.id, name: camp.name, color: camp.color, pitch: (seed.campaign.kit.pitch as string) || null,
  objections: Array.isArray(seed.campaign.kit.objections) ? seed.campaign.kit.objections as Kit['objections'] : [],
  info_url: (seed.campaign.kit.info_url as string) || null, info_sms: (seed.campaign.kit.info_sms as string) || null,
  info_email_subject: (seed.campaign.kit.info_email_subject as string) || null, info_email_body: (seed.campaign.kit.info_email_body as string) || null,
  onepager_url: (seed.campaign.kit.onepager_url as string) || null, present_url: (seed.campaign.kit.present_url as string) || '/present/taxifi.html',
  pay_per_deal: seed.campaign.kit.pay_per_deal == null ? 50 : Number(seed.campaign.kit.pay_per_deal), retry_days: retryDays(), ref: 'DEMO',
});
const todayKey = () => torontoDay(Date.now()).key;
const visitsToday = () => S.visits.filter(v => torontoDay(new Date(v.at).getTime()).key === todayKey());

function today() {
  const vs = visitsToday();
  const minutes = S.day.started_at ? Math.round(((S.day.ended_at ? new Date(S.day.ended_at).getTime() : Date.now()) - new Date(S.day.started_at).getTime()) / MIN) : 0;
  return { day: todayKey(), started_at: S.day.started_at, ended_at: S.day.ended_at, distance_m: S.day.distance_m + vs.length * 140, minutes,
    visits: vs.length, deals: vs.filter(v => v.outcome === 'closed').length, followups: vs.filter(v => v.outcome === 'follow_up').length,
    goal_visits: myGoal ?? 40, goal_deals: 2, goal_own: myGoal != null, team_goal_visits: 40 };
}
let myGoal: number | null = null;   // the demo rep's own daily visits goal (session only)
function followups() {
  const out = [];
  for (const b of allBiz()) {
    const s = stateOf(b.id);
    if (s.state !== 'follow_up' || !s.follow_up_at) continue;
    const v = visitsOf(b.id)[0];
    const t = new Date(s.follow_up_at).getTime();
    const when = t < Date.now() ? 'overdue' : torontoDay(t).key === todayKey() ? 'today' : 'later';
    const z = zoneById.get(b.z);
    out.push({ business_id: b.id, name: b.n, address: b.a, zone_id: b.z, zone_name: z?.name || '', campaign_id: camp.id, campaign_name: camp.name,
      follow_up_at: s.follow_up_at, when, contact_name: v.contact_name || null, contact_phone: v.contact_phone || null, notes: v.notes || null });
  }
  return out.sort((a, b) => a.follow_up_at.localeCompare(b.follow_up_at));
}

function slots(days = 14) {
  const out: { start: string; hosts: number }[] = [];
  if (!S.host.active) return { length_min: 30, timezone: TZ, days_ahead: 14, hosts: 0, slots: out };
  const earliest = Date.now() + 2 * H;
  const booked = S.meetings.filter(m => m.status === 'booked').map(m => [new Date(m.starts_at).getTime() - 10 * MIN, new Date(m.ends_at).getTime() + 10 * MIN]);
  for (let i = 0; i <= Math.min(days, 14); i++) {
    const { key, dow } = torontoDay(Date.now() + i * D);
    if (S.host.days_off.includes(key)) continue;
    for (const [a, b] of (S.host.hours[String(dow)] || [])) {
      for (let m = a; m + 30 <= b; m += 30) {
        const t = torontoAt(key, m);
        if (t < earliest || booked.some(([x, y]) => t < y && t + 30 * MIN > x)) continue;
        out.push({ start: iso(t), hosts: 1 });
      }
    }
  }
  return { length_min: 30, timezone: TZ, days_ahead: 14, hosts: 1, slots: out };
}

const hostMe = () => ({
  id: HOST.id, name: HOST.name, email: HOST.email, zoom_url: S.host.zoom_url, timezone: S.host.timezone, hours: S.host.hours, days_off: S.host.days_off,
  active: S.host.active, campaign: { id: camp.id, name: camp.name, color: camp.color },
  rules: { campaign_id: camp.id, length_min: 30, buffer_min: 10, notice_min: 120, days_ahead: 14, max_per_day: 6, timezone: TZ },
});
const freshMeeting = (m: Meeting): Meeting => ({ ...m, answers: S.answers.get(m.business.id) || m.answers || null,
  host: { ...m.host, zoom_url: S.host.zoom_url, timezone: S.host.timezone } });

function businessView(bid: string) {
  const b = bizById.get(bid) || S.leads.find(l => l.id === bid);
  if (!b) return null;
  return {
    id: b.id, name: b.n, address: b.a, lat: b.lat, lng: b.lng, kind: b.k, phone: b.ph, website: b.w, hours: b.h, plaza: b.p, zone_id: b.z, campaign_id: camp.id,
    lead: !!(b as Lead).lead, sends: [],
    visits: visitsOf(bid).map(v => { const d = S.deals.get(v.id); return { ...v, deal: d?.status, deal_note: d?.note }; }),
  };
}
function bizState(bid: string) {
  const vs = visitsOf(bid);
  const m = S.meetings.filter(x => x.business.id === bid).sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
  const s = stateOf(bid);
  const stage = S.lost.has(bid) || m?.status === 'not_fit' ? 'lost' : s.state === 'closed' || m?.status === 'closed' ? 'won' : m && m.status === 'booked' ? 'booked'
    : s.state === 'not_interested' || s.state === 'cant_sell' ? 'lost' : s.state === 'interested' || s.state === 'pending' || S.pitched.has(bid) || S.answers.has(bid) ? 'pitched'
    : 'new';
  const heat = stage === 'booked' || stage === 'pitched' ? (s.state === 'interested' ? 'hot' : 'warm') : stage === 'new' && vs.length ? 'cold' : undefined;
  const a = S.answers.get(bid);
  return { stage, heat, points: vs.length * 10 + (a ? 30 : 0), why: heat ? [a ? 'Answered the deck questions' : 'Asked for information', `${vs.length} visit${vs.length === 1 ? '' : 's'}`] : [],
    meeting: m ? { id: m.id, starts_at: m.starts_at, status: m.status, host: m.host.name } : undefined, yearly: a?.proposal?.yearly,
    decider: vs.find(v => v.contact_name)?.contact_name, last_at: vs[0]?.at, visits: vs.length, lost_reason: stage === 'lost' ? S.lost.get(bid) || (vs[0]?.outcome === 'not_interested' ? 'Said not interested' : vs[0]?.notes) : undefined };
}
function timeline(bid: string) {
  const items: { at: string; kind: string; title?: string; outcome?: string; by?: string; text?: string; who?: string; follow_up_at?: string }[] = [];
  for (const v of visitsOf(bid)) items.push({ at: v.at, kind: 'visit', outcome: v.outcome, by: REP.name, text: v.notes, who: v.contact_name, follow_up_at: v.follow_up_at });
  for (const m of S.meetings.filter(x => x.business.id === bid)) items.push({ at: m.created_at, kind: 'meeting', title: `Onboarding call booked with ${m.host.name}`, by: REP.name, text: new Date(m.starts_at).toLocaleString('en-CA', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
  for (const t of S.threads.filter(x => x.business_id === bid)) for (const msg of t.messages) items.push({ at: msg.at, kind: msg.dir === 'in' ? 'mail_in' : 'mail_out', title: msg.dir === 'in' ? `Email from ${msg.from_name || msg.from_email}` : `Email sent: ${msg.subject}`, by: msg.dir === 'out' ? REP.name : undefined });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
const threadRow = (t: typeof S.threads[number]): ThreadRow => {
  const last = t.messages[t.messages.length - 1];
  const z = zoneById.get(bizById.get(t.business_id)?.z || '');
  return { id: t.id, subject: t.subject, snippet: (last.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120), last_at: t.last_at, last_dir: last.dir,
    messages: t.messages.length, unread: t.unread, starred: t.starred, archived: t.archived, contact_email: t.contact_email, contact_name: t.contact_name,
    business_id: t.business_id, business: t.business?.name, campaign_id: camp.id, campaign: camp.name, color: camp.color, zone: z?.name, rep: REP.name };
};

// ───────────── the calls ─────────────
type Args = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));

export function rpc(name: string, a: Args): unknown {
  switch (name) {
    // ── the rep ──
    case 'ms_rep_home': return { name: REP.name, first_name: REP.first, today: todayKey(),
      zones: seed.zones.map(z => ({ zone_id: z.id, zone_name: z.name, city: z.city, campaign_id: camp.id, campaign_name: camp.name, color: camp.color, ...zoneCounts(z.id) })) };
    case 'ms_rep_map': {
      const pairs: MapPair[] = seed.zones.map(z => ({ zone_id: z.id, zone_name: z.name, city: z.city, polygon: z.polygon, campaign_id: camp.id, campaign_name: camp.name, color: camp.color }));
      const businesses: MapBiz[] = allBiz().map(b => { const s = stateOf(b.id); return { id: b.id, n: b.n, a: b.a || undefined, lat: b.lat, lng: b.lng, k: b.k, p: b.p || undefined, z: b.z, c: camp.id,
        h: b.h || undefined, lead: (b as Lead).lead || undefined, s: s.state, st: bizState(b.id).stage, at: s.last_at || undefined, f: s.follow_up_at || undefined }; });
      return { pairs, businesses };
    }
    case 'ms_rep_zone': {
      const z = zoneById.get(str(a.p_zone)); if (!z) throw new Error('That zone isn’t yours.');
      const businesses: RepBusiness[] = allBiz().filter(b => b.z === z.id).map(b => ({ id: b.id, name: b.n, address: b.a, lat: b.lat, lng: b.lng, kind: b.k, plaza: b.p, plaza_id: b.pid == null ? null : String(b.pid), hours: b.h, lead: (b as Lead).lead, ...stateOf(b.id), stage: bizState(b.id).stage }));
      return { zone: { id: z.id, name: z.name, city: z.city, polygon: z.polygon, center: z.center }, campaign: camp, businesses };
    }
    case 'ms_rep_business': { const v = businessView(str(a.p_business)); if (!v) throw new Error('Not found'); return v; }
    case 'ms_rep_log_visit': {
      const b = bizById.get(str(a.p_business)) || S.leads.find(l => l.id === str(a.p_business)); if (!b) throw new Error('Not found');
      const again = S.visits.find(v => v.id === str(a.p_client_id));
      if (again) return { id: again.id, far: false, distance_m: again.distance_m, state: stateOf(b.id).state, again: true };
      const v = addVisit(b, a.p_outcome as RepVisit['outcome'], a.p_at ? new Date(str(a.p_at)).getTime() : Date.now(), {
        id: str(a.p_client_id) || uid(), notes: str(a.p_notes) || undefined, contact_name: str(a.p_contact_name) || undefined, contact_phone: str(a.p_contact_phone) || undefined,
        contact_email: str(a.p_contact_email) || undefined, follow_up_at: str(a.p_follow_up_at) || undefined, photos: (a.p_photos as string[] | null) || undefined });
      if (v.outcome === 'closed') S.deals.set(v.id, { status: 'pending', at: v.at });
      if (!S.day.started_at) S.day.started_at = iso(Date.now() - 20 * MIN);
      return { id: v.id, far: false, distance_m: v.distance_m, state: stateOf(b.id).state };
    }
    case 'ms_rep_followups': return followups();
    case 'ms_rep_followups_due': return [];
    case 'ms_followup_done': return null;
    case 'ms_rep_numbers': {
      const days = []; for (let i = 6; i >= 0; i--) { const k = torontoDay(Date.now() - i * D).key; const vs = S.visits.filter(v => torontoDay(new Date(v.at).getTime()).key === k); days.push({ day: k, visits: vs.length, deals: vs.filter(v => v.outcome === 'closed').length }); }
      const ds = [...S.deals.entries()];
      return { today: todayKey(), days, visits_total: S.visits.length,
        deals: { pending: ds.filter(([, d]) => d.status === 'pending').length, approved: ds.filter(([, d]) => d.status === 'approved').length, rejected: ds.filter(([, d]) => d.status === 'rejected').length },
        recent_deals: ds.sort((x, y) => y[1].at.localeCompare(x[1].at)).slice(0, 8).map(([vid, d]) => { const v = S.visits.find(x => x.id === vid)!; return { id: vid, business: bizById.get(v.business_id)?.n || 'Lead', campaign: camp.name, at: d.at, status: d.status, note: d.note || null }; }) };
    }
    case 'ms_rep_kit': return kit();
    case 'ms_rep_today': return today();
    case 'ms_rep_day_start': S.day.started_at = iso(Date.now()); S.day.ended_at = null; return today();
    case 'ms_rep_day_ping': S.day.distance_m += 25; return null;
    case 'ms_rep_day_end': S.day.ended_at = iso(Date.now()); return today();
    case 'ms_rep_leaderboard': {
      const period = str(a.p_period) === 'today' ? 'today' : str(a.p_period) === 'month' ? 'month' : 'week';
      const days = period === 'today' ? 1 : period === 'week' ? torontoDay(Date.now()).dow + 1 : new Date().getDate();
      const f = period === 'today' ? 1 / 7 : period === 'week' ? 1 : 4;
      const mine = S.visits.filter(v => Date.now() - new Date(v.at).getTime() < days * D);
      const reps = [
        { me: true, name: REP.name, visits: mine.length, approved: [...S.deals.values()].filter(d => d.status === 'approved').length, pending: [...S.deals.values()].filter(d => d.status === 'pending').length },
        { me: false, name: 'Jamie Tran', visits: Math.round(96 * f), approved: Math.round(5 * f), pending: 1 },
        { me: false, name: 'Riya Kapoor', visits: Math.round(81 * f), approved: Math.round(3 * f), pending: Math.round(2 * f) },
        { me: false, name: 'Ben Okafor', visits: Math.round(64 * f), approved: Math.round(2 * f), pending: 0 },
      ];
      const from = period === 'today' ? todayKey() : period === 'week' ? torontoDay(Date.now() - torontoDay(Date.now()).dow * D).key : `${todayKey().slice(0, 8)}01`;
      return { period, from, streak: 3, goal_visits: myGoal ?? 40, reps };
    }
    case 'ms_rep_set_visit_goal': {
      const v = a.p_visits == null ? null : Number(a.p_visits);
      if (v != null && !(v >= 1 && v <= 500)) throw new Error('Pick a goal between 1 and 500');
      myGoal = v;
      return { goal_visits: myGoal ?? 40, own: myGoal != null, team_goal_visits: 40 };
    }
    case 'ms_get_goals': return { visits_per_day: 40, deals_per_day: 2 };
    case 'ms_rep_add_lead': {
      // a known business with the same name within 60 m becomes the rep's (like the real thing), not a copy
      const lat = Number(a.p_lat), lng = Number(a.p_lng), nm = str(a.p_name).trim().toLowerCase();
      const same = seed.businesses.find(b => b.n.trim().toLowerCase() === nm && Math.hypot((b.lat - lat) * 111320, (b.lng - lng) * 80000) <= 60);
      if (same) { added.add(same.id); return { id: same.id, zone_id: same.z, zone_name: zoneById.get(same.z)?.name || null, campaign_id: camp.id, in_my_zone: true }; }
      const z = seed.zones[0];
      const l: Lead = { id: uid(), n: str(a.p_name), a: str(a.p_address) || null, lat: Number(a.p_lat), lng: Number(a.p_lng), k: str(a.p_kind) || 'other', p: null, pid: null, z: z.id, ph: str(a.p_phone) || null, w: str(a.p_website) || null, h: null, lead: true };
      S.leads.push(l);
      return { id: l.id, zone_id: z.id, zone_name: z.name, campaign_id: camp.id, in_my_zone: true };
    }
    case 'ms_rep_nearby': return [];
    case 'ms_zone_walked': return { total_m: 18500, walked_m: Math.min(18500, 4200 + S.visits.length * 30), roads: [] };
    case 'ms_save_deck_answers': S.answers.set(str(a.p_business), a.p_data as DeckAnswers); return null;
    case 'ms_business_state': return bizState(str(a.p_business));
    case 'ms_business_timeline': return timeline(str(a.p_business));
    case 'ms_mark_pitched': S.pitched.add(str(a.p_business)); return bizState(str(a.p_business));
    case 'ms_rep_known_near': {
      const lat = Number(a.p_lat), lng = Number(a.p_lng), on = new Set(allBiz().map(b => b.id));
      const m = (b: SeedBiz) => Math.round(Math.hypot((b.lat - lat) * 111320, (b.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180)));
      return seed.businesses.filter(b => !on.has(b.id)).map(b => ({ b, d: m(b) })).filter(x => x.d <= 90).sort((x, y) => x.d - y.d).slice(0, 12)
        .map(({ b, d }) => ({ id: b.id, name: b.n, address: b.a || undefined, kind: b.k, phone: b.ph || undefined, website: b.w || undefined, lat: b.lat, lng: b.lng, m: d }));
    }
    case 'ms_set_lost': { const r = str(a.p_reason); if (r) S.lost.set(str(a.p_business), r); else S.lost.delete(str(a.p_business)); return bizState(str(a.p_business)); }
    case 'ms_set_do_not_knock': return null;
    case 'ms_business_set_website': return null;
    case 'ms_business_contacts_list': {
      const bid = str(a.p_business);
      const fromVisits = visitsOf(bid).filter(v => v.contact_name).slice(0, 1).map(v => ({ id: `v-${v.id}`, business_id: bid, name: v.contact_name, role: 'Owner', phone: v.contact_phone, email: v.contact_email, decides: true, source: 'typed', updated_at: v.at }));
      const mine = S.contacts.filter(c => c.business_id === bid && !c.hidden);
      return [...mine, ...fromVisits.filter(f => !mine.some(m => m.name === f.name))];
    }
    case 'ms_contact_save': {
      const id = str(a.p_id) || uid();
      const c = S.contacts.find(x => x.id === id);
      const row: Contact = { id, business_id: str(a.p_business), name: str(a.p_name), role: str(a.p_role), title: str(a.p_title), phone: str(a.p_phone), email: str(a.p_email),
        decides: !!a.p_decides, best_time: str(a.p_best_time), source: str(a.p_source) || 'typed', updated_at: iso(Date.now()) };
      if (c) Object.assign(c, row); else S.contacts.push(row);
      return id;
    }
    case 'ms_contact_hide': { const c = S.contacts.find(x => x.id === str(a.p_id)); if (c) c.hidden = true; return null; }
    case 'ms_contact_email_ok': return null;

    // ── booking from the deck ──
    case 'ms_meeting_slots': return slots(Number(a.p_days) || 14);
    case 'ms_book_meeting': {
      const b = bizById.get(str(a.p_business)) || S.leads.find(l => l.id === str(a.p_business)); if (!b) throw new Error('Not found');
      const t = new Date(str(a.p_start)).getTime();
      if (!slots().slots.some(s => new Date(s.start).getTime() === t)) throw new Error('That time was just taken. Pick another.');
      const m = meetingFor(b, t, str(a.p_name), str(a.p_phone) || null, str(a.p_email) || null, 'booked', { notes: str(a.p_notes) || null, created_at: iso(Date.now()) });
      S.meetings.push(m);
      // booking is the close: the visit is saved as a deal waiting for approval
      const v = addVisit(b, 'closed', Date.now(), { contact_name: m.owner_name, contact_phone: m.owner_phone || undefined, contact_email: m.owner_email || undefined, notes: 'Onboarding booked from the deck' });
      S.deals.set(v.id, { status: 'pending', at: v.at });
      return m;
    }

    // ── the host ──
    case 'ms_is_host': return true;
    case 'ms_host_me': return hostMe();
    case 'ms_host_save': {
      S.host.zoom_url = str(a.p_zoom) || null; S.host.timezone = str(a.p_timezone) || TZ; S.host.hours = (a.p_hours as Hours) || {}; S.host.days_off = (a.p_days_off as string[]) || [];
      return hostMe();
    }
    case 'ms_meetings_list': {
      const from = a.p_from ? new Date(str(a.p_from)).getTime() : 0, to = a.p_to ? new Date(str(a.p_to)).getTime() : Infinity;
      return S.meetings.filter(m => { const t = new Date(m.starts_at).getTime(); return t >= from && t <= to; }).sort((x, y) => x.starts_at.localeCompare(y.starts_at)).map(freshMeeting);
    }
    case 'ms_meeting_follow_up': {
      const m = S.meetings.find(x => x.id === str(a.p_meeting)); if (!m) throw new Error('Not found');
      m.status = 'booked'; m.follow_up_at = a.p_at ? str(a.p_at) : null; if (str(a.p_note)) m.outcome_note = str(a.p_note);
      m.outcome_by = a.p_at ? HOST.name : null; m.outcome_at = a.p_at ? iso(Date.now()) : null;
      return freshMeeting(m);
    }
    case 'ms_meeting_outcome': {
      const m = S.meetings.find(x => x.id === str(a.p_meeting)); if (!m) throw new Error('Not found');
      m.status = a.p_status as MeetingStatus; m.outcome_note = str(a.p_note) || null;
      m.outcome_by = m.status === 'booked' ? null : HOST.name; m.outcome_at = m.status === 'booked' ? null : iso(Date.now());
      return freshMeeting(m);
    }

    // ── mail ──
    case 'ms_inbox': {
      const box = str(a.p_box) || 'inbox', q = str(a.p_search).toLowerCase(), bid = str(a.p_business);
      return S.threads.filter(t => (!bid || t.business_id === bid) && (box === 'archived' ? t.archived : box === 'starred' ? t.starred : box === 'unread' ? t.unread > 0 : box === 'sent' ? t.messages.some(m => m.dir === 'out') : !t.archived)
        && (!q || `${t.subject} ${t.contact_name} ${t.business?.name}`.toLowerCase().includes(q))).map(threadRow).sort((x, y) => y.last_at.localeCompare(x.last_at));
    }
    case 'ms_inbox_counts': return { unread: S.threads.filter(t => t.unread > 0 && !t.archived).length, unsorted: 0 };
    case 'ms_thread': { const t = S.threads.find(x => x.id === str(a.p_thread)); if (!t) throw new Error('Not found'); t.unread = 0; const { last_at: _l, unread: _u, business_id: _b, ...rest } = t; void _l; void _u; void _b; return rest; }
    case 'ms_thread_flag': {
      const t = S.threads.find(x => x.id === str(a.p_thread));
      if (t) { if (a.p_starred != null) t.starred = !!a.p_starred; if (a.p_archived != null) t.archived = !!a.p_archived; if (a.p_unread != null) t.unread = a.p_unread ? 1 : 0; }
      return null;
    }
    case 'ms_thread_file': return null;
    case 'mail_directory': return [];
    default: return undefined;
  }
}

/** Edge functions the rep and host screens call. Nothing is sent. */
export function fn(name: string, body: Args): unknown {
  if (name === 'ms-meetings') return { sent: ['owner', 'host'], skipped: [] };
  if (name === 'ms-mail') {
    const to = (body.to as string[]) || [];
    let t = S.threads.find(x => x.id === str(body.thread_id));
    const msg: Message = { id: uid(), dir: 'out', status: 'sent', from_email: REP.email, from_name: REP.name, to, subject: str(body.subject), html: str(body.html), at: iso(Date.now()), delivery: 'delivered' };
    if (!t) {
      const b = bizById.get(str(body.business_id));
      t = { id: uid(), subject: str(body.subject), contact_email: to[0], contact_name: undefined, starred: false, archived: false, opted_out: false,
        business: b ? { id: b.id, name: b.n, address: b.a || undefined, kind: b.k, phone: b.ph || undefined } : null, campaign: camp, messages: [], last_at: msg.at, unread: 0, business_id: b?.id || '' };
      S.threads.push(t);
    }
    t.messages.push(msg); t.last_at = msg.at;
    return { thread_id: t.id, message_id: msg.id };
  }
  if (name === 'ms-mail-ai') {
    const b = bizById.get(str(body.business_id));
    return { subject: str(body.subject) || `Following up${b ? `, ${b.n}` : ''}`,
      html: `<p>Hi there,</p><p>Thanks again for your time today${b ? ` at ${b.n}` : ''}. As promised, here’s how taxifi keeps your books current every day, with a Canadian accountant signing every month and your corporate return included.</p><p>Would a 30-minute onboarding call this week work? I can book a time that suits you.</p><p>Alex</p>` };
  }
  if (name === 'rep-auth') return { error: 'This is a demo: no sign-in needed.' };
  return {};
}

/** A table read (supabase.from(...).select()): the rep screens only look up a few. */
export function table(name: string): unknown[] {
  if (name === 'ms_campaigns') return [{ id: camp.id, name: camp.name, color: camp.color, is_active: true }];
  return [];
}
