// src/lib/userWrites.ts — save rows to the old app's users table without needing to read passwords.
//
// The app key can no longer read users.password (security fix, Oct 2026). Postgres needs read
// access to a column to upsert it ("on conflict ... set password = excluded.password"), so an
// upsert that includes password fails with "permission denied for table users". Instead:
// upsert everything except the password, then set passwords with plain updates, which only
// need write access.
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown> & { user_id: string; password?: unknown };

/** Rows without their password, plus user ids grouped by the password to set (blank ones skipped). */
export function splitPasswords(rows: Row[]): { rest: Record<string, unknown>[]; byPassword: Map<string, string[]> } {
  const byPassword = new Map<string, string[]>();
  const rest = rows.map(({ password, ...r }) => {
    if (typeof password === 'string' && password !== '') {
      const ids = byPassword.get(password) || [];
      ids.push(r.user_id);
      byPassword.set(password, ids);
    }
    return r;
  });
  return { rest, byPassword };
}

export async function upsertUsers(client: SupabaseClient, rows: Row[]): Promise<void> {
  if (!rows.length) return;
  const { rest, byPassword } = splitPasswords(rows);
  const { error } = await client.from('users').upsert(rest, { onConflict: 'user_id' });
  if (error) throw error;
  const results = await Promise.all([...byPassword].map(([password, ids]) =>
    client.from('users').update({ password }).in('user_id', ids)));
  const failed = results.find(r => r.error);
  if (failed?.error) throw failed.error;
}
