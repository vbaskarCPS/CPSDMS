// src/v2/lib/permissions.ts — the manager permissions and what they unlock.
export const PERMISSIONS = [
  { key: 'route_manager', label: 'Route Manager', unlocks: 'Route Manager map, team, routes, nav' },
  { key: 'rm_floater', label: 'Floater Route Manager', unlocks: 'Executive level: pick any of the day’s route managers (any center) and open the floater map for them' },
  { key: 'workerbook', label: 'Workerbook', unlocks: 'Days, Start session, payouts, payslips, rate cards, pipeline, contractors' },
  { key: 'bookings', label: 'Master Bookings', unlocks: 'Bookings, Inbox, Accounts, Crews, KPIs' },
  { key: 'dialer', label: 'Clients & Dialer', unlocks: 'Clients, Campaigns, Dialer, Follow-ups, KPIs' },
  { key: 'sa_users', label: 'SA · User Management', unlocks: 'Users, command centers, seasons, availability' },
  { key: 'sa_territory', label: 'SA · Territory & Client Data', unlocks: 'Digital maps, assignments, client imports' },
  { key: 'sa_reporting', label: 'SA · Reporting', unlocks: 'Reporting (Super Admin)' },
] as const;

export type Permission = typeof PERMISSIONS[number]['key'];

export const SUPER_ADMIN_PERMISSIONS: Permission[] = ['sa_users', 'sa_territory', 'sa_reporting'];

export const SERVICES = [
  { key: 'aeration', label: 'Aeration', code: 'AER' },
  { key: 'lawn_rejuv', label: 'Lawn Rejuv', code: 'RJ' },
  { key: 'sealing', label: 'Sealing', code: 'SE' },
  { key: 'cleaning', label: 'Window Cleaning', code: 'CL' },
] as const;
export type Service = typeof SERVICES[number]['key'];
export const serviceLabel = (s: string) => SERVICES.find(x => x.key === s)?.label || s;

/** Mirror of public.app_make_username (without the clash suffix, which the database adds). */
export function usernameBase(fullName: string): string {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const first = (parts[0] || '').replace(/[^a-z]/g, '');
  let last = parts.slice(1).join('').replace(/[^a-z]/g, '');
  if (!last) last = first;
  return last.slice(0, 3).padEnd(3, 'x') + first.slice(0, 2).padEnd(2, 'x');
}
