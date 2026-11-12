// The sign-in state and the lock on a mailbox's stored token (supabase/functions/planner-mail/secure.ts).
// Every key, token and state value here is made up for the test.
import { describe, expect, it } from 'vitest';
import { b64u, looksLikeState, mailKey, newState, NoKey, open, sameSecret, seal, STATE_MINUTES, stateExpired, stateHash, stateRow, tokenOwner, unb64, WontOpen } from '../../../../supabase/functions/planner-mail/secure';

const KEY = b64u(new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256));           // 32 made-up bytes, web base64
const OTHER = b64u(new Uint8Array(32).map((_, i) => (i * 11 + 5) % 256));
const TOKEN = '1//made-up-refresh-token-for-the-test';
const VIJAY = tokenOwner({ user_id: 'u-vijay', provider: 'google', address: 'Vijay@Example.com' });
const ROSH = tokenOwner({ user_id: 'u-rosh', provider: 'google', address: 'vijay@example.com' });

describe('the sign-in state', () => {
  it('is 32 random bytes, different every time, and looks like nothing else', () => {
    const a = newState(), b = newState();
    expect(a).not.toBe(b);
    expect(unb64(a)).toHaveLength(32);
    expect(looksLikeState(a)).toBe(true);
    for (const junk of ['', 'abc', a.slice(1), `${a}x`, `${a.slice(0, 42)}!`, null, 42]) expect(looksLikeState(junk)).toBe(false);
  });
  it('is kept only as its hash: the row has who started it and which planner, never the value', async () => {
    const value = newState(), now = Date.parse('2026-11-11T18:00:00Z');
    const row = await stateRow(value, { userId: 'u-rosh', app: 'roshplanner', provider: 'google' }, now);
    expect(row).toEqual({ state_hash: await stateHash(value), user_id: 'u-rosh', app: 'roshplanner', provider: 'google', expires_at: '2026-11-11T18:10:00.000Z', used_at: null });
    expect(row.state_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(value);
    expect(await stateHash(newState())).not.toBe(row.state_hash);   // another value finds nothing
  });
  it('is good for ten minutes and not a moment longer', async () => {
    const now = Date.parse('2026-11-11T18:00:00Z');
    const row = await stateRow(newState(), { userId: 'u', app: 'vijayplanner', provider: 'google' }, now);
    expect(STATE_MINUTES).toBe(10);
    expect(stateExpired(row, now)).toBe(false);
    expect(stateExpired(row, now + 9 * 60_000 + 59_000)).toBe(false);
    expect(stateExpired(row, now + 10 * 60_000)).toBe(true);
    expect(stateExpired(row, now + 3 * 3600_000)).toBe(true);
    expect(stateExpired({ expires_at: 'not a time' }, now)).toBe(true);   // unreadable = run out
  });
});

describe('locking a mailbox’s token', () => {
  it('what is stored opens again to the same token, and holds none of it', async () => {
    const key = await mailKey(KEY);
    const stored = await seal(key, TOKEN, VIJAY);
    expect(stored).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(b64u(new TextEncoder().encode(TOKEN)));
    expect(await open(key, stored, VIJAY)).toBe(TOKEN);
  });
  it('uses a fresh IV every time: the same token locked twice is stored differently', async () => {
    const key = await mailKey(KEY);
    const a = await seal(key, TOKEN, VIJAY), b = await seal(key, TOKEN, VIJAY);
    expect(a).not.toBe(b);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
    expect(await open(key, a, VIJAY)).toBe(await open(key, b, VIJAY));
  });
  it('a value that was changed, cut or made up doesn’t open', async () => {
    const key = await mailKey(KEY);
    const stored = await seal(key, TOKEN, VIJAY);
    const [v, iv, locked] = stored.split('.');
    const flip = (s: string, at: number) => s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1);
    for (const bad of [`${v}.${iv}.${flip(locked, 5)}`, `${v}.${flip(iv, 2)}.${locked}`, `${v}.${iv}.${locked.slice(0, -4)}`, `v2.${iv}.${locked}`, `${iv}.${locked}`, '', 'v1..', TOKEN])
      await expect(open(key, bad, VIJAY)).rejects.toBeInstanceOf(WontOpen);
  });
  it('doesn’t open with another key, or for another person’s mailbox', async () => {
    const stored = await seal(await mailKey(KEY), TOKEN, VIJAY);
    await expect(open(await mailKey(OTHER), stored, VIJAY)).rejects.toBeInstanceOf(WontOpen);
    await expect(open(await mailKey(KEY), stored, ROSH)).rejects.toBeInstanceOf(WontOpen);   // the same address, connected by the other one
    expect(VIJAY).toBe('u-vijay|google|vijay@example.com');
  });
  it('an error never says what the token or the key was', async () => {
    const key = await mailKey(KEY);
    const e = (await open(key, `v1.AAAA.${b64u(new TextEncoder().encode(TOKEN))}`, VIJAY).catch(x => x)) as Error;
    expect(e.message).toBe('the stored token would not open');
    const k = (await mailKey('not-a-key').catch(x => x)) as Error;
    expect(k).toBeInstanceOf(NoKey);
    expect(k.message).not.toContain('not-a-key');
  });
  it('takes the key as base64 with or without its padding, in either alphabet, and nothing that isn’t 32 bytes', async () => {
    const bytes = new Uint8Array(32).map((_, i) => 250 - i);   // has + and / in the usual alphabet
    let bin = ''; for (const x of bytes) bin += String.fromCharCode(x);
    const padded = btoa(bin);
    expect(padded.endsWith('=')).toBe(true);
    const stored = await seal(await mailKey(padded), TOKEN, VIJAY);
    for (const same of [padded, padded.replace(/=+$/, ''), b64u(bytes), ` ${padded}\n`]) expect(await open(await mailKey(same), stored, VIJAY)).toBe(TOKEN);
    for (const bad of ['', undefined, null, 'short', btoa('sixteen bytes!!!'), b64u(new Uint8Array(33)), 'not base64 at all!!']) await expect(mailKey(bad)).rejects.toBeInstanceOf(NoKey);
  });
});

describe('comparing the cron key', () => {
  it('only the very same key passes; an empty one never does', () => {
    expect(sameSecret('k-123', 'k-123')).toBe(true);
    expect(sameSecret('k-123', 'k-124')).toBe(false);
    expect(sameSecret('k-123', 'k-1234')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('k', '')).toBe(false);
  });
});
