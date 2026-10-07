// src/v2/lib/auth.tsx — who is signed in, what they may open, and which center they're looking at.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { db, loginAddress, must } from './client';
import type { Permission } from './permissions';

export interface Center {
  id: string; display_name: string; region: string; services: string[]; cn_prefix: string | null;
  local_number: string | null; review_link: string | null; tax_name: string | null; tax_rate: number | null; is_active: boolean;
}
export interface Profile {
  id: string; username: string; full_name: string; phone: string | null; email: string | null;
  is_super_admin: boolean; rm_center_id: string | null; is_active: boolean; must_change_password: boolean;
}
interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  permissions: Set<Permission>;
  centers: Center[];
  center: Center | null;
  setCenterId: (id: string) => void;
  can: (p: Permission) => boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (pw: string) => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const CENTER_KEY = (uid: string) => `cpsdms-v2-center-${uid}`;

function readPref(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function writePref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());
  const [centers, setCenters] = useState<Center[]>([]);
  const [centerId, setCenterIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setProfile(null); setPermissions(new Set()); setCenters([]); setCenterIdState(null); setLoading(false); return; }
    try {
      const uid = s.user.id;
      const prof = must(await db.from('app_users').select('*').eq('id', uid).maybeSingle()) as Profile | null;
      if (!prof || !prof.is_active) {
        await db.auth.signOut();
        setProfile(null); setLoading(false);
        return;
      }
      const perms = must(await db.from('user_permissions').select('permission').eq('user_id', uid)) as { permission: Permission }[];
      const cols = 'id, display_name, region, services, cn_prefix, local_number, review_link, tax_name, tax_rate, is_active';
      let list: Center[];
      if (prof.is_super_admin) {
        list = must(await db.from('command_centers').select(cols).order('display_name')) as Center[];
      } else {
        const links = must(await db.from('user_centers').select('center_id').eq('user_id', uid)) as { center_id: string }[];
        const ids = links.map(l => l.center_id);
        list = ids.length ? must(await db.from('command_centers').select(cols).in('id', ids).order('display_name')) as Center[] : [];
      }
      setProfile(prof);
      setPermissions(new Set(perms.map(p => p.permission)));
      setCenters(list);
      const saved = readPref(CENTER_KEY(uid));
      const pick = list.find(c => c.id === saved) || list.find(c => c.id === prof.rm_center_id) || list[0] || null;
      setCenterIdState(pick?.id || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = db.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load(s);
      else setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const setCenterId = useCallback((id: string) => {
    setCenterIdState(id);
    if (session) writePref(CENTER_KEY(session.user.id), id);
  }, [session]);

  const value = useMemo<AuthState>(() => ({
    loading, session, profile, permissions, centers,
    center: centers.find(c => c.id === centerId) || null,
    setCenterId,
    can: (p: Permission) => !!profile && (profile.is_super_admin || permissions.has(p)),
    signIn: async (username, password) => {
      setLoading(true);
      const { error } = await db.auth.signInWithPassword({ email: loginAddress(username), password });
      if (error) { setLoading(false); throw new Error(error.message === 'Invalid login credentials' ? 'Wrong username or password' : error.message); }
    },
    signOut: async () => { await db.auth.signOut(); },
    changePassword: async (pw) => {
      if (pw.length < 8) throw new Error('Use at least 8 characters');
      const { error } = await db.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      must(await db.rpc('app_password_changed'));
      await load((await db.auth.getSession()).data.session);
    },
    reload: async () => load((await db.auth.getSession()).data.session),
  }), [loading, session, profile, permissions, centers, centerId, setCenterId, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
