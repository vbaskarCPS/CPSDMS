// src/v2/lib/data.ts — database calls for phase 1 (users, centers, seasons, availability, rate cards).
import { useCallback, useEffect, useState } from 'react';
import { db, must } from './client';
import type { Center, Profile } from './auth';
import type { Permission, Service } from './permissions';
import type { RateCardData } from './rateCard';

// ───────────── generic loader hook ─────────────
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    run().then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [run, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

// ───────────── users ─────────────
export interface UserRow extends Profile { permissions: Permission[]; center_ids: string[] }

export async function listUsers(): Promise<UserRow[]> {
  const users = must(await db.from('app_users').select('*').order('full_name')) as Profile[];
  const perms = must(await db.from('user_permissions').select('user_id, permission')) as { user_id: string; permission: Permission }[];
  const links = must(await db.from('user_centers').select('user_id, center_id')) as { user_id: string; center_id: string }[];
  return users.map(u => ({
    ...u,
    permissions: perms.filter(p => p.user_id === u.id).map(p => p.permission),
    center_ids: links.filter(l => l.user_id === u.id).map(l => l.center_id),
  }));
}

/** The signed-in manager's own phone and email (also copied to today's old-app manager row). */
export async function updateMyContact(phone: string, email: string): Promise<void> {
  must(await db.rpc('app_update_my_contact', { p_phone: phone, p_email: email }));
}

export interface UserInput {
  full_name: string; phone: string; email: string; permissions: Permission[]; center_ids: string[];
  rm_center_id: string | null; is_active: boolean;
}

export async function createUser(u: UserInput, password: string): Promise<{ id: string; username: string }> {
  const rows = must(await db.rpc('app_admin_create_user', {
    p_full_name: u.full_name, p_password: password, p_phone: u.phone || null, p_email: u.email || null,
    p_permissions: u.permissions, p_centers: u.center_ids, p_rm_center: u.rm_center_id,
  })) as { id: string; username: string }[];
  return rows[0];
}

export async function updateUser(id: string, u: UserInput): Promise<void> {
  must(await db.rpc('app_admin_update_user', {
    p_user: id, p_full_name: u.full_name, p_phone: u.phone || null, p_email: u.email || null,
    p_permissions: u.permissions, p_centers: u.center_ids, p_rm_center: u.rm_center_id, p_active: u.is_active,
  }));
}

export async function resetPassword(id: string, password: string): Promise<void> {
  must(await db.rpc('app_admin_reset_password', { p_user: id, p_password: password }));
}

// ───────────── centers ─────────────
export async function listCenters(): Promise<Center[]> {
  return must(await db.from('command_centers')
    .select('id, display_name, region, services, cn_prefix, local_number, review_link, tax_name, tax_rate, is_active')
    .order('display_name')) as Center[];
}

export async function saveCenter(c: Omit<Center, 'id'> & { id: string | null }): Promise<string> {
  return must(await db.rpc('app_admin_save_center', {
    p_id: c.id, p_display_name: c.display_name, p_region: c.region, p_services: c.services, p_cn_prefix: c.cn_prefix,
    p_local_number: c.local_number, p_review_link: c.review_link, p_tax_name: c.tax_name, p_tax_rate: c.tax_rate, p_active: c.is_active,
  })) as string;
}

/** Tax defaults by region, matching today's getTaxRateForRegion (East 13%, others 5%). */
export const regionTax = (region: string) => region === 'East' ? { name: 'HST', rate: 13 } : { name: 'GST', rate: 5 };

// ───────────── seasons ─────────────
export interface Season {
  id: string; center_id: string; service: Service; year: number; starts_on: string; ends_on: string;
  closed_at: string | null; created_at: string;
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function seasonState(s: Season, today = todayISO()): 'closed' | 'upcoming' | 'open' | 'ended' {
  if (s.closed_at) return 'closed';
  if (today < s.starts_on) return 'upcoming';
  if (today <= s.ends_on) return 'open';
  return 'ended';
}

export async function listSeasons(centerId?: string): Promise<Season[]> {
  let q = db.from('seasons').select('*').order('starts_on', { ascending: false });
  if (centerId) q = q.eq('center_id', centerId);
  return must(await q) as Season[];
}

export async function saveSeason(s: { id?: string; center_id: string; service: Service; year: number; starts_on: string; ends_on: string }): Promise<Season> {
  const { id, ...rest } = s;
  const res = id
    ? await db.from('seasons').update(rest).eq('id', id).select().single()
    : await db.from('seasons').insert(rest).select().single();
  if (res.error?.code === '23P01' || /overlap/i.test(res.error?.message || '')) throw new Error('Seasons at a center cannot overlap');
  if (res.error?.code === '23505') throw new Error('That service already has a season for that year at this center');
  return must(res) as Season;
}

export async function closeSeason(id: string, userId: string): Promise<void> {
  must(await db.from('seasons').update({ closed_at: new Date().toISOString(), closed_by: userId }).eq('id', id));
}
export async function reopenSeason(id: string): Promise<void> {
  must(await db.from('seasons').update({ closed_at: null, closed_by: null }).eq('id', id));
}

/** The season running today at a center, else the next one coming up. */
export function useCurrentSeason(centerId: string | null): Season | null {
  const [s, setS] = useState<Season | null>(null);
  useEffect(() => {
    let live = true;
    if (!centerId) { setS(null); return; }
    listSeasons(centerId).then(list => {
      if (!live) return;
      const today = todayISO();
      const open = list.find(x => seasonState(x, today) === 'open');
      const next = [...list].filter(x => seasonState(x, today) === 'upcoming').sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
      setS(open || next || null);
    }).catch(() => live && setS(null));
    return () => { live = false; };
  }, [centerId]);
  return s;
}

// ───────────── availability ─────────────
export async function listDaysOff(from: string, to: string): Promise<{ user_id: string; day: string }[]> {
  return must(await db.from('manager_days_off').select('user_id, day').gte('day', from).lte('day', to)) as { user_id: string; day: string }[];
}
export async function setDayOff(userId: string, day: string, off: boolean): Promise<void> {
  if (off) must(await db.from('manager_days_off').upsert({ user_id: userId, day }));
  else must(await db.from('manager_days_off').delete().eq('user_id', userId).eq('day', day));
}

// ───────────── rate cards ─────────────
export interface RateCardRow { id: string; season_id: string; version: number; effective_from: string; data: RateCardData; created_by: string | null; created_at: string }

export async function listRateCards(seasonId: string): Promise<RateCardRow[]> {
  return must(await db.from('rate_cards').select('*').eq('season_id', seasonId).order('version', { ascending: false })) as RateCardRow[];
}

export async function saveRateCard(seasonId: string, effectiveFrom: string, data: RateCardData): Promise<RateCardRow> {
  // version is assigned by the database trigger
  return must(await db.from('rate_cards').insert({ season_id: seasonId, version: 0, effective_from: effectiveFrom, data }).select().single()) as RateCardRow;
}
