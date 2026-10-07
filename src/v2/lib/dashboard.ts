// src/v2/lib/dashboard.ts — the numbers behind the home page's stat cards, one loader per
// component. Each loader is independent so one slow or failing source never blanks the rest.
import { db } from './client';
import { monthSummary, type DaySummary } from './workerbook';
import { listClients, listImports } from './clients';
import { allRoutes, listAssignments, groupAreas } from './territory';
import { legacyLiveSession } from './legacy';

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const count = (r: { count: number | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.count || 0; };

// ───────────── Route Manager + Master Bookings: the live session ─────────────
export interface LiveStats {
  date: string;
  workers: number; carts: number; managers: number;
  steps: number; gross: number; upsells: number; upsellGross: number;
  routes: number; openRoutes: number;
  prebooks: number; prebookRoutes: number; prebookValue: number;
}

/** Today's (or the still-open) session at this center, from the current app's tables. Null when none is open. */
export async function liveStats(centerId: string): Promise<LiveStats | null> {
  const live = await legacyLiveSession(centerId);
  if (!live) return null;
  const { sessionService } = await import('../../lib/sessionService');
  const sheets = await sessionService.getLogsheetSessions();
  const d = live.data;
  const money = (v: unknown) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; };
  const sum = (f: (s: (typeof sheets)[number]) => number) => sheets.reduce((a, s) => a + (f(s) || 0), 0);
  const prebookRoutes = new Set(d.pendingBookings.map(b => b['Route Number']).filter(Boolean));
  return {
    date: live.date,
    workers: d.workers.length,
    carts: sheets.length,
    managers: d.managers.length,
    steps: sum(s => s.stats?.stepCount),
    gross: sum(s => (s.stats?.prodGross || 0) + (s.stats?.upsellGross || 0)),
    upsells: sum(s => s.stats?.upsellCount),
    upsellGross: sum(s => s.stats?.upsellGross),
    routes: d.routes.length,
    openRoutes: d.routes.filter(r => !(r.assignedWorkerIds || []).length).length,
    prebooks: d.pendingBookings.length,
    prebookRoutes: prebookRoutes.size,
    prebookValue: d.pendingBookings.reduce((a, b) => a + money(b.Price), 0),
  };
}

// ───────────── Workerbook ─────────────
export interface WorkerbookStats { today: DaySummary | null; tomorrow: DaySummary | null; active: number; watch: number }

export async function workerbookStats(centerId: string): Promise<WorkerbookStats> {
  const now = new Date();
  const t = isoDay(now);
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const tmIso = isoDay(tm);
  const [days, active, watch] = await Promise.all([
    monthSummary(centerId, t, tmIso),
    db.from('hires').select('id', { count: 'exact', head: true }).eq('center_id', centerId).eq('year', now.getFullYear()).eq('status', 'active'),
    db.from('hires').select('id', { count: 'exact', head: true }).eq('center_id', centerId).eq('year', now.getFullYear()).in('status', ['NS', 'WL']),
  ]);
  return { today: days.find(d => d.day === t) || null, tomorrow: days.find(d => d.day === tmIso) || null, active: count(active), watch: count(watch) };
}

// ───────────── Clients & Dialer ─────────────
export interface ClientStats { total: number; noRoute: number; byLine: { key: string; n: number }[] }

export async function clientStats(lines: string[]): Promise<ClientStats> {
  const one = { pageSize: 1 };
  const [total, noRoute, ...per] = await Promise.all([
    listClients(one), listClients({ ...one, noRoute: true }), ...lines.map(l => listClients({ ...one, service: l })),
  ]);
  return { total: total.total, noRoute: noRoute.total, byLine: lines.map((key, i) => ({ key, n: per[i].total })) };
}

// ───────────── Super Admin ─────────────
export interface AdminStats {
  users?: { active: number; centers: number; managers: number };
  territory?: { routes: number; areas: number; unassignedAreas: number; lists: number };
}

export async function adminStats(opts: { users: boolean; territory: boolean }): Promise<AdminStats> {
  const out: AdminStats = {};
  await Promise.all([
    opts.users && (async () => {
      const [u, c, m] = await Promise.all([
        db.from('app_users').select('id', { count: 'exact', head: true }).eq('is_active', true),
        db.from('command_centers').select('id', { count: 'exact', head: true }).eq('is_active', true),
        db.from('user_permissions').select('user_id', { count: 'exact', head: true }).eq('permission', 'route_manager'),
      ]);
      out.users = { active: count(u), centers: count(c), managers: count(m) };
    })(),
    opts.territory && (async () => {
      const [routes, assigned, imports] = await Promise.all([allRoutes(), listAssignments(), listImports()]);
      const areas = groupAreas(routes, assigned);
      out.territory = { routes: routes.length, areas: areas.length, unassignedAreas: areas.filter(a => !a.centerId).length, lists: imports.filter(i => i.status === 'done').length };
    })(),
  ]);
  return out;
}

