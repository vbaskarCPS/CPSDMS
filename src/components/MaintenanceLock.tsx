// src/components/MaintenanceLock.tsx — "Under construction": the whole field app is closed while the database is being
// worked on. The switch lives in the database (public.app_lock() returns the message, or null when the app is open),
// so the app can be closed and opened again without a new release. Phones with no signal skip the check and open as
// usual. While closed, the screen checks every 20 seconds and reloads itself once the app is open again.
import React from 'react';
import { Construction } from 'lucide-react';
import { supabaseAnonKey, supabaseUrl } from '../lib/supabaseConfig';

/** The lock message, or null when the app is open (or the check couldn't be made: no signal, slow network). */
export async function lockMessage(timeoutMs = 3500): Promise<string | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/app_lock`, {
      method: 'POST', signal: ctl.signal, cache: 'no-store',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const v: unknown = await r.json();
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Calls back with the message whenever the app becomes closed, and reloads the page when a closed app opens again. */
export function watchLock(locked: boolean, onLock: (message: string) => void): void {
  const every = locked ? 20_000 : 120_000;
  const tick = async () => {
    const m = await lockMessage();
    if (locked && !m && navigator.onLine !== false) { window.location.reload(); return; }
    if (!locked && m) { locked = true; onLock(m); }
    setTimeout(tick, locked ? 20_000 : 120_000);
  };
  setTimeout(tick, every);
}

export const MaintenanceLock: React.FC<{ message: string }> = ({ message }) => {
  const [title, ...rest] = message.split('\n');
  return (
    <div role="alert" style={{
      position: 'fixed', inset: 0, zIndex: 2147483600, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', background: '#0f172a', color: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: 18, borderRadius: 20, background: '#facc15', color: '#1c1917', marginBottom: 20 }}>
          <Construction size={44} aria-hidden="true" />
        </div>
        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: '0 0 12px', fontWeight: 800 }}>{title}</h1>
        {rest.filter(l => l.trim()).map((l, i) => (
          <p key={i} style={{ fontSize: 16, lineHeight: 1.5, margin: '0 0 10px', color: '#cbd5e1' }}>{l}</p>
        ))}
        <p style={{ fontSize: 13, marginTop: 22, color: '#94a3b8' }}>This page opens the app by itself when it’s ready.</p>
      </div>
    </div>
  );
};
