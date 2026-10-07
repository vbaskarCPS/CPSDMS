// src/v2/lib/startSession.ts — Start session from a Day.
//
// The plan (routes, roll call, teams, settings) is made in the new app and recorded in
// `sessions`. Until the RM map, map logsheet and payouts move into the new app, starting
// also writes the old session tables exactly the way Import from Sheets does
// (sessionService.uploadDailySession), so those live screens work unchanged.
import { db, must } from './client';
import type { Service } from './permissions';
import { alumniRate, silverRate, type RateCardData } from './rateCard';
import { routePrefix } from './territory';
import type { HatCode, RosterRow } from './workerbook';
import { fullName } from './workerbook';
import type { DailySessionData, ManagementUser, ManagerMappingConfig, RouteData, TeamCart, Worker } from '../../types';
import type { ImportMeta } from '../../lib/googleSheetsService';

export interface PlanManager { id: string; full_name: string; username: string; phone: string | null }
export interface PlanRoute { code: string; area: string; number: number; managerId: string }
export interface PlanTeam { name: string; kind: 'cart' | 'ramp'; managerId: string }
export interface PlanSettings { service: Service; productCostPercent: number; emailReceipts: boolean; liveCard: boolean; noTaxOnCash: boolean }
export interface Plan {
  date: string; seasonYear: number; card: RateCardData;
  managers: PlanManager[]; routes: PlanRoute[]; teams: PlanTeam[];
  members: Record<string, string>;   // hire_id → team name
  showed: Set<string>;               // hire ids ticked in roll call
  roster: RosterRow[]; settings: PlanSettings;
  /** days each hire showed in the app before this date (added to their days before the app) */
  appDaysBefore?: Record<string, number>;
}

export const SERVICE_HAT: Record<Service, HatCode> = { aeration: 'AER', lawn_rejuv: 'RJ', sealing: 'SE', cleaning: 'CL' };

/** The old app's manager id convention: "rm_" + name letters ("Cheryl Merrick" → "rm_cherylmerrick"). */
export const legacyManagerId = (fullNameText: string) => `rm_${fullNameText.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** Ramp crews are named RC1, RC2… (the old app's asphalt rules follow that name); carts are 1, 2, 3… */
export function nextTeamName(teams: PlanTeam[], kind: PlanTeam['kind']): string {
  const used = new Set(teams.map(t => t.name));
  for (let i = 1; ; i++) { const n = kind === 'ramp' ? `RC${i}` : String(i); if (!used.has(n)) return n; }
}

/** One digital-map config per area a manager works, as the RM map expects. */
export function mappingsFor(routes: PlanRoute[]): ManagerMappingConfig[] {
  const by = new Map<string, PlanRoute[]>();
  for (const r of routes) { if (!by.has(r.area)) by.set(r.area, []); by.get(r.area)!.push(r); }
  return [...by.entries()].map(([areaName, rs]) => {
    rs.sort((a, b) => a.number - b.number);
    return { areaName, prefix: routePrefix(rs[0].code), routeStart: rs[0].number, routeEnd: rs[rs.length - 1].number, routeCodes: rs.map(r => r.code) };
  });
}

export function formatPhone(raw: string | null | undefined): string {
  const d = (raw || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (raw || '');
}

/** Problems that stop Start; empty when the plan is ready. */
export function planProblems(p: Plan): string[] {
  const errs: string[] = [];
  if (!p.routes.length) errs.push('Pick at least one route.');
  if (!p.teams.length) errs.push('Add at least one team.');
  const showed = p.roster.filter(r => p.showed.has(r.hire_id));
  if (!showed.length) errs.push('Tick who showed in roll call.');
  const noTeam = showed.filter(r => !p.members[r.hire_id] || !p.teams.some(t => t.name === p.members[r.hire_id]));
  if (noTeam.length) errs.push(`${noTeam.length} ${noTeam.length === 1 ? 'worker who showed has' : 'workers who showed have'} no team: ${noTeam.slice(0, 4).map(r => fullName(r.hire.person)).join(', ')}${noTeam.length > 4 ? '…' : ''}`);
  const empty = p.teams.filter(t => !showed.some(r => p.members[r.hire_id] === t.name));
  if (empty.length) errs.push(`Team${empty.length > 1 ? 's' : ''} with nobody in ${empty.length > 1 ? 'them' : 'it'}: ${empty.map(t => t.name).join(', ')}`);
  const mgrIds = new Set(p.managers.map(m => m.id));
  if (p.teams.some(t => !mgrIds.has(t.managerId))) errs.push('Every team needs a manager who is available that day.');
  if (p.routes.some(r => !mgrIds.has(r.managerId))) errs.push('Every route needs a manager who is available that day.');
  return errs;
}

/** The old app's session data, built from the plan (what Import from Sheets would have produced). */
export function buildLegacySession(p: Plan, centerId: string): { data: DailySessionData; meta: ImportMeta } {
  const hat = SERVICE_HAT[p.settings.service];
  const teamByName = new Map(p.teams.map(t => [t.name, t]));
  const mgrById = new Map(p.managers.map(m => [m.id, m]));
  const usedMgrIds = new Set([...p.teams.map(t => t.managerId), ...p.routes.map(r => r.managerId)]);

  const managers: ManagementUser[] = p.managers.filter(m => usedMgrIds.has(m.id)).map(m => {
    const maps = mappingsFor(p.routes.filter(r => r.managerId === m.id));
    return {
      userId: legacyManagerId(m.full_name), username: m.username, name: m.full_name, phone: formatPhone(m.phone),
      role: 'RouteManager', commandCenterId: centerId, floatingFor: [],
      digitalMapping: maps[0], digitalMappings: maps,
    };
  });

  const workers: Worker[] = p.roster.filter(r => p.showed.has(r.hire_id)).map(r => {
    const team = teamByName.get(p.members[r.hire_id])!;
    const person = r.hire.person;
    const contractorYear = p.seasonYear - (person.first_year ?? p.seasonYear) + 1;
    return {
      contractorId: r.hire.cn, firstName: person.first_name, lastName: person.last_name, cellPhone: formatPhone(person.cell_phone),
      email: person.email || undefined, status: 'Return',
      alumniRate: alumniRate(p.card, contractorYear, person.lifetime_days + (p.appDaysBefore?.[r.hire_id] || 0)),
      silverRate: silverRate(p.card, person.hats?.[hat] || 0),
      assignedManagerId: legacyManagerId(mgrById.get(team.managerId)!.full_name),
      commandCenterId: centerId, teamId: team.name, upsellsEnabled: true,
    };
  });

  const teamCarts: TeamCart[] = p.teams.map(t => {
    const ws = workers.filter(w => w.teamId === t.name);
    return { teamId: t.name, workerIds: ws.map(w => w.contractorId), workers: ws };
  }).filter(c => c.workers.length > 0);

  const routes: RouteData[] = [...p.routes].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map(r => ({
    routeCode: r.code, managerId: legacyManagerId(mgrById.get(r.managerId)!.full_name), assignedWorkerIds: [], commandCenterId: centerId,
  }));

  const meta: ImportMeta = {
    source: 'app', sheetsExported: false, seasonType: p.settings.service,
    productCostPercent: p.settings.productCostPercent,
    liveCardProcessingEnabled: p.settings.liveCard, noTaxOnCash: p.settings.noTaxOnCash,
  };
  return {
    data: { date: p.date, managers, workers, routes, pendingBookings: [], commandCenterId: centerId, seasonType: p.settings.service, teamCarts },
    meta,
  };
}

/** The old app allows one active session per center; it must be closed there first. */
export async function openLegacySession(centerId: string): Promise<string | null> {
  const { supabase } = await import('../../lib/supabase');
  const { data, error } = await supabase.from('daily_sessions').select('date').eq('command_center_id', centerId).eq('is_active', true).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.date || null;
}

export interface StartResult { sessionId: string }

/**
 * Writes the old session tables from a plan, so the RM map and map logsheet see the day. Worker
 * sign-ins follow the newest day started: an older open day is handed off first (its carts saved,
 * the old tables cleared); it stays open to be finished and closed later.
 */
async function writeLiveMap(p: Plan, centerId: string): Promise<void> {
  const open = await openLegacySession(centerId);
  if (open === p.date) return;   // already there
  if (open && open > p.date) throw new Error(`Worker sign-ins and the RM map are on ${open}, a newer day. They follow the newest day started.`);
  if (open) {
    const { handOffDay } = await import('./payoutCarts');
    await handOffDay(centerId, open);
  }
  const [{ commandCenterService }, { sessionService }] = await Promise.all([
    import('../../lib/commandCenterService'), import('../../lib/sessionService'),
  ]);
  const cc = await commandCenterService.getCommandCenterById(centerId);
  if (!cc) throw new Error('Couldn’t load this center in the old app.');
  commandCenterService.setCurrentCommandCenter(cc);
  const { data, meta } = buildLegacySession(p, centerId);
  await sessionService.uploadDailySession(data, p.settings.emailReceipts, meta);
}

/** Writes the old session (so the live map works), then records the session in the new app. */
export async function startSession(p: Plan, dayId: string, centerId: string, _opts: { legacyAlreadyWritten?: boolean } = {}): Promise<StartResult> {
  const problems = planProblems(p);
  if (problems.length) throw new Error(problems[0]);
  // Always checked against the database, not the page: a half-started session may have been
  // cleared since the page loaded.
  await writeLiveMap(p, centerId);
  const showedIds = p.roster.filter(r => p.showed.has(r.hire_id)).map(r => r.hire_id);
  const sessionId = must(await db.rpc('app_start_session', {
    p_day: dayId,
    p_settings: p.settings,
    p_routes: p.routes.map(r => ({ code: r.code, area: r.area, manager_id: r.managerId })),
    p_teams: p.teams.map(t => ({ name: t.name, kind: t.kind, manager_id: t.managerId, hire_ids: showedIds.filter(h => p.members[h] === t.name) })),
    p_showed: showedIds,
  })) as string;
  // Roll call answers (next day / WDR / Quit) take effect now that the session has started.
  try { await db.rpc('app_apply_next_days', { p_day: dayId, p_hire: null }); }
  catch (e) { console.warn('[StartSession] next-day answers not applied:', e); }
  return { sessionId };
}

/**
 * A worker who arrives after the session started: put them on the live map (old users table),
 * under a manager, with no team yet — the manager puts them on a cart from Manage Team.
 */
export async function addLateArrival(centerId: string, row: RosterRow, manager: PlanManager, card: RateCardData, seasonYear: number, service: Service, appDaysBefore = 0): Promise<void> {
  await import('./legacy').then(m => m.pointLegacyAt(centerId));
  const [{ supabase }, { upsertUsers }] = await Promise.all([import('../../lib/supabase'), import('../../lib/userWrites')]);
  const person = row.hire.person;
  const contractorYear = seasonYear - (person.first_year ?? seasonYear) + 1;
  await upsertUsers(supabase, [{
    user_id: row.hire.cn, name: `${person.first_name} ${person.last_name}`.trim(), role: 'Worker', password: person.first_name,
    metadata: {
      phone: formatPhone(person.cell_phone), alumniRate: alumniRate(card, contractorYear, person.lifetime_days + appDaysBefore),
      silverRate: silverRate(card, person.hats?.[SERVICE_HAT[service]] || 0),
      assignedManagerId: legacyManagerId(manager.full_name), upsellsEnabled: true,
    },
    command_center_id: centerId,
  }]);
}

interface SessionRecord {
  settings: PlanSettings;
  routes: { code: string; area: string; manager_id: string }[];
  teams: { name: string; kind: PlanTeam['kind']; manager_id: string; hire_ids: string[] }[];
}

/**
 * A started day whose live map is missing (the old session tables were never written or were
 * cleared): rebuild the plan from what was recorded at Start and write the live map from it.
 */
export async function writeLiveMapFromSession(dayId: string, centerId: string, date: string, card: RateCardData, seasonYear: number): Promise<void> {
  const s = must(await db.from('sessions').select('settings, routes, teams').eq('day_id', dayId).single()) as SessionRecord;
  const { listRoster } = await import('./workerbook');
  const roster = await listRoster(dayId);
  const ids = [...new Set([...s.routes.map(r => r.manager_id), ...s.teams.map(t => t.manager_id)])];
  const managers = must(await db.from('app_users').select('id, full_name, username, phone').in('id', ids)) as PlanManager[];
  const members: Record<string, string> = {};
  const showed = new Set<string>();
  for (const t of s.teams) for (const h of t.hire_ids) { members[h] = t.name; showed.add(h); }
  const plan: Plan = {
    date, seasonYear, card, managers, roster, settings: s.settings, members, showed,
    routes: s.routes.map(r => ({ code: r.code, area: r.area, number: parseInt(r.code.replace(/^\D+/, ''), 10) || 0, managerId: r.manager_id })),
    teams: s.teams.map(t => ({ name: t.name, kind: t.kind, managerId: t.manager_id })),
  };
  const problems = planProblems(plan);
  if (problems.length) throw new Error(problems[0]);
  await writeLiveMap(plan, centerId);
}

export async function availableManagers(centerId: string, day: string): Promise<PlanManager[]> {
  const [mgrs, off] = await Promise.all([
    db.from('app_users').select('id, full_name, username, phone').eq('rm_center_id', centerId).eq('is_active', true).order('full_name'),
    db.from('manager_days_off').select('user_id').eq('day', day),
  ]);
  const offIds = new Set((must(off) as { user_id: string }[]).map(o => o.user_id));
  return (must(mgrs) as PlanManager[]).filter(m => !offIds.has(m.id));
}

export async function getSession(dayId: string): Promise<{ id: string; settings: PlanSettings; routes: { code: string }[]; teams: { name: string }[]; started_at: string } | null> {
  return must(await db.from('sessions').select('id, settings, routes, teams, started_at').eq('day_id', dayId).maybeSingle()) as
    { id: string; settings: PlanSettings; routes: { code: string }[]; teams: { name: string }[]; started_at: string } | null;
}
