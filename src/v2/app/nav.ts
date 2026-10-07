// src/v2/app/nav.ts — the component → subcomponent map behind the grid menu.
import type { LucideIcon } from 'lucide-react';
import {
  Map, BookOpen, CalendarCheck, Phone, Shield, Calendar, FileText, SlidersHorizontal, UserPlus, Contact, AlertCircle,
  List, Inbox, Receipt, Truck, BarChart3, Users, Megaphone, Clock, MapPin, Building2, CalendarOff,
} from 'lucide-react';
import type { ColorName } from '../ui';
import type { Permission } from '../lib/permissions';

export interface Sub { key: string; label: string; icon: LucideIcon; color: ColorName; path: string; ready: boolean; superAdminOnly?: boolean }
export interface Component { key: string; label: string; icon: LucideIcon; color: ColorName; perm: Permission | 'super_admin_any'; subs: Sub[] }

export const COMPONENTS: Component[] = [
  { key: 'rm', label: 'Route Manager', icon: Map, color: 'blue', perm: 'route_manager', subs: [
    { key: 'map', label: 'Map', icon: Map, color: 'blue', path: '/app/rm', ready: false },
  ] },
  { key: 'wb', label: 'Workerbook', icon: BookOpen, color: 'green', perm: 'workerbook', subs: [
    { key: 'days', label: 'Days', icon: Calendar, color: 'green', path: '/app/workerbook/days', ready: false },
    { key: 'payslips', label: 'Payslips', icon: FileText, color: 'sky', path: '/app/workerbook/payslips', ready: false },
    { key: 'rates', label: 'Rate cards', icon: SlidersHorizontal, color: 'slate', path: '/app/workerbook/rate-cards', ready: true },
    { key: 'pipeline', label: 'Pipeline', icon: UserPlus, color: 'violet', path: '/app/workerbook/pipeline', ready: false },
    { key: 'contractors', label: 'Contractors', icon: Contact, color: 'teal', path: '/app/workerbook/contractors', ready: false },
    { key: 'status', label: 'Status lists', icon: AlertCircle, color: 'amber', path: '/app/workerbook/status', ready: false },
  ] },
  { key: 'mb', label: 'Master Bookings', icon: CalendarCheck, color: 'amber', perm: 'bookings', subs: [
    { key: 'bookings', label: 'Bookings', icon: List, color: 'amber', path: '/app/bookings', ready: false },
    { key: 'inbox', label: 'Inbox', icon: Inbox, color: 'blue', path: '/app/bookings/inbox', ready: false },
    { key: 'accounts', label: 'Accounts', icon: Receipt, color: 'green', path: '/app/bookings/accounts', ready: false },
    { key: 'crews', label: 'Crews', icon: Truck, color: 'teal', path: '/app/bookings/crews', ready: false },
    { key: 'kpis', label: 'KPIs', icon: BarChart3, color: 'violet', path: '/app/bookings/kpis', ready: false },
  ] },
  { key: 'cd', label: 'Clients & Dialer', icon: Phone, color: 'violet', perm: 'dialer', subs: [
    { key: 'clients', label: 'Clients', icon: Users, color: 'violet', path: '/app/clients', ready: false },
    { key: 'campaigns', label: 'Campaigns', icon: Megaphone, color: 'rose', path: '/app/clients/campaigns', ready: false },
    { key: 'dialer', label: 'Dialer', icon: Phone, color: 'green', path: '/app/clients/dialer', ready: false },
    { key: 'followups', label: 'Follow-ups', icon: Clock, color: 'amber', path: '/app/clients/follow-ups', ready: false },
    { key: 'kpis', label: 'KPIs', icon: BarChart3, color: 'blue', path: '/app/clients/kpis', ready: false },
  ] },
  { key: 'sa', label: 'Super Admin', icon: Shield, color: 'rose', perm: 'super_admin_any', subs: [
    { key: 'users', label: 'Users', icon: Users, color: 'rose', path: '/app/admin/users', ready: true },
    { key: 'centers', label: 'Centers & seasons', icon: Building2, color: 'blue', path: '/app/admin/centers', ready: true },
    { key: 'availability', label: 'Availability', icon: CalendarOff, color: 'amber', path: '/app/admin/availability', ready: true },
    { key: 'territory', label: 'Territory & Client Data', icon: MapPin, color: 'sky', path: '/app/admin/territory', ready: false },
    { key: 'reporting', label: 'Reporting', icon: BarChart3, color: 'violet', path: '/app/admin/reporting', ready: false },
  ] },
];

/** Which permission each Super Admin subcomponent needs. */
export const SA_SUB_PERM: Record<string, Permission> = {
  users: 'sa_users', centers: 'sa_users', availability: 'sa_users', territory: 'sa_territory', reporting: 'sa_reporting',
};

export function visibleComponents(can: (p: Permission) => boolean): Component[] {
  return COMPONENTS
    .map(c => c.key === 'sa' ? { ...c, subs: c.subs.filter(s => can(SA_SUB_PERM[s.key])) } : c)
    .filter(c => c.perm === 'super_admin_any' ? c.subs.length > 0 : can(c.perm));
}

export function findByPath(path: string): { comp: Component; sub: Sub } | null {
  for (const comp of COMPONENTS) {
    const sub = [...comp.subs].sort((a, b) => b.path.length - a.path.length).find(s => path === s.path || path.startsWith(s.path + '/'));
    if (sub) return { comp, sub };
  }
  return null;
}
