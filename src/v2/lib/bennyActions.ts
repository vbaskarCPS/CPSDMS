// src/v2/lib/bennyActions.ts — the changes the Benny prepares, done by the app after the person taps Confirm.
// Each one uses the same code as the screen that does it by hand:
//   start_day  → Workerbook › Start session (startSession)
//   give_route → RM map › Assign route (whole route, with its prebooks; moves the route to the cart's manager)
//   partner    → RM map › Move worker › to another cart
//   solo       → RM map › Move worker › own cart
import { getDay, listRoster, type RosterRow } from './workerbook';
import { availableManagers, nextTeamName, planProblems, startSession, type Plan, type PlanManager, type PlanRoute, type PlanTeam } from './startSession';
import { listRateCards, listSeasons, regionTax } from './data';
import { cardFor, defaultRateCard, type RateCardData } from './rateCard';
import { centerService, type Service } from './permissions';
import { appShowedDates, countBefore } from './payoutEngine';
import { fullName } from './workerbook';

export type TeamMode = 'roster' | 'solo' | 'pairs';
export interface StartDayCheck {
  ok: boolean; date: string; day_id: string; pair: boolean;
  assign: { managers: { id: string; name: string }[] | null; routes: { code: string; area: string; number: number }[] | null }[];
  booked: number; showed: number; teams: number; no_team: number; open_prebooks: number; maps?: string[]; live_map_on?: string | null;
}
export interface LiveWorker { cn: string; name: string; cart_id?: string; manager?: string }
export interface GiveCheck { ok: boolean; date: string; route: string; map?: string; worker: LiveWorker; cart?: { cn: string; name: string }[]; now?: string[]; route_manager?: string; open_prebooks?: number }
export interface MoveCheck { ok: boolean; date: string; a: LiveWorker; b?: LiveWorker; carts?: Record<string, string[]> }
export type BennyProposal =
  | { kind: 'start_day'; check: StartDayCheck; team_mode?: TeamMode }
  | { kind: 'give_route'; check: GiveCheck }
  | { kind: 'partner'; check: MoveCheck }
  | { kind: 'solo'; check: MoveCheck };

/** What the confirm card says (pure, so it's tested). */
export function describe(p: BennyProposal): { title: string; lines: string[]; action: string } {
  switch (p.kind) {
    case 'start_day': {
      const c = p.check;
      const pretty = new Date(c.date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
      const routes = c.assign.flatMap(a => a.routes || []);
      const byMap = new Map<string, number>();
      for (const r of routes) byMap.set(r.area, (byMap.get(r.area) || 0) + 1);
      const mgrs = c.assign.map(a => (a.managers || []).map(m => m.name).join(' + ')).filter(Boolean);
      const mode = p.team_mode || 'roster';
      return {
        title: `Start ${pretty}`,
        lines: [
          `Manager${mgrs.length > 1 || mgrs.some(m => m.includes('+')) ? 's' : ''}: ${mgrs.join(' · ')}${c.pair ? ' (paired)' : mgrs.length === 1 && !mgrs[0].includes('+') ? ', solo' : ''}`,
          `Routes: ${[...byMap].map(([m, n]) => `${m} (${n})`).join(', ') || 'none'}`,
          `Workers: ${c.showed} of ${c.booked} booked, ${mode === 'solo' ? 'each on their own cart' : mode === 'pairs' ? 'paired two to a cart' : c.no_team ? `roster carts, ${c.no_team} without one get their own` : 'on their roster carts'}`,
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
  const entries = check.assign.map(a => ({ mgrs: (a.managers || []).map(m => m.id).filter(id => avail.has(id)), routes: a.routes || [] })).filter(e => e.mgrs.length);
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
    for (const [n, rows] of [...named].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })))
      addTeam(rows.map(r => r.hire_id), /^RC\d*$/i.test(n) ? 'ramp' : 'cart', rows.find(r => r.manager_id)?.manager_id, n);
    for (const r of showedRows.filter(r => !r.team)) addTeam([r.hire_id], 'cart', r.manager_id);
  } else if (teamMode === 'solo') {
    for (const r of showedRows) addTeam([r.hire_id], 'cart', r.manager_id);
  } else {
    for (let i = 0; i < showedRows.length; i += 2) addTeam(showedRows.slice(i, i + 2).map(r => r.hire_id), 'cart', showedRows[i].manager_id);
  }
  return {
    date: check.date, seasonYear, card, managers, routes, teams, members, roster, appDaysBefore,
    showed: new Set(showedRows.map(r => r.hire_id)),
    settings: { service, productCostPercent: card.productCostPercent, emailReceipts: true, liveCard: true, noTaxOnCash: card.noTaxOnCashDefault },
    pairs: pairs.length ? pairs : undefined,
  };
}

interface CenterLite { id: string; region?: string | null; services?: readonly string[] | null }

export async function startDayFromBenny(p: Extract<BennyProposal, { kind: 'start_day' }>, center: CenterLite): Promise<string> {
  const c = p.check;
  const day = await getDay(center.id, c.date);
  if (!day) throw new Error(`Nobody is booked on ${c.date}.`);
  const [roster, managers, seasons] = await Promise.all([listRoster(day.id), availableManagers(center.id, c.date), listSeasons(center.id)]);
  const season = seasons.find(s => s.starts_on <= c.date && c.date <= s.ends_on) || null;
  const cards = season ? await listRateCards(season.id) : [];
  const service = (season?.service || centerService(center.services)) as Service;
  const card = cardFor(cards, c.date)?.data || defaultRateCard(service, regionTax(center.region || 'East'));
  const shown = await appShowedDates(roster.map(r => r.hire_id));
  const appDays = Object.fromEntries(roster.map(r => [r.hire_id, countBefore(shown[r.hire_id], c.date)]));
  const plan = buildBennyPlan(c, p.team_mode || 'roster', roster, managers, card, service, season?.year || Number(c.date.slice(0, 4)), appDays);
  const problems = planProblems(plan);
  if (problems.length) throw new Error(problems[0]);
  await startSession(plan, day.id, center.id);
  return `Started ${c.date}: ${plan.routes.length} routes, ${plan.teams.length} carts, ${plan.showed.size} workers. Managers sign in to Route Manager › Map.`;
}

async function legacy(centerId: string) {
  const { pointLegacyAt } = await import('./legacy');
  await pointLegacyAt(centerId);
  const [{ sessionService }, { seasonHasTeams }] = await Promise.all([import('../../lib/sessionService'), import('../../lib/commandCenterService')]);
  const date = await sessionService.getDailySessionDate();
  return { sessionService, date, seasonHasTeams };
}

/** RM map › Assign route, whole route (the same steps as RMMapTab's handleAssign). */
export async function giveRouteFromBenny(p: Extract<BennyProposal, { kind: 'give_route' }>, centerId: string): Promise<string> {
  const c = p.check;
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
  const c = p.check;
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

export async function doProposal(p: BennyProposal, center: CenterLite): Promise<string> {
  if (p.kind === 'start_day') return startDayFromBenny(p, center);
  if (p.kind === 'give_route') return giveRouteFromBenny(p, center.id);
  return moveFromBenny(p, center.id);
}
