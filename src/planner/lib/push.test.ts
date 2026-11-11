// "Check notifications" (lib/push.ts): what each result of the check tells the person to do.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./auth', () => ({ call: vi.fn(), getPass: () => null, SignedOut: class extends Error {} }));
const { pushAdvice } = await import('./push');

describe('what the notification check found', () => {
  it('all three steps worked', () => {
    const a = pushAdvice({ here: 'shown', sent: true, arrived: true });
    expect(a.ok).toBe(true);
    expect(a.lines.map(l => l.ok)).toEqual([true, true, true]);
    expect(a.todo).toMatch(/Both worked/);
  });
  it('sent and accepted, but it never reached the phone: the phone is holding deliveries back', () => {
    const a = pushAdvice({ here: 'shown', sent: true, arrived: false });
    expect(a.ok).toBe(false);
    expect(a.lines.map(l => l.ok)).toEqual([true, true, false]);
    expect(a.todo).toMatch(/Power saving/);
    expect(a.todo).toMatch(/Sleeping and Deep sleeping apps/);
  });
  it('the phone won’t put one up itself: its settings are hiding them, whatever arrives', () => {
    const a = pushAdvice({ here: 'blocked', sent: true, arrived: true });
    expect(a.ok).toBe(false);
    expect(a.lines[0]).toEqual({ ok: false, text: 'This phone would not put up a notification from the planner.' });
    expect(a.todo).toMatch(/allow notifications for both/);
  });
  it('the server had no phone to send to: turn them off and on again', () => {
    const a = pushAdvice({ here: 'shown', sent: false, arrived: false });
    expect(a.lines).toHaveLength(2);
    expect(a.todo).toMatch(/off and on again/);
  });
  it('an app from before the check can’t tell whether it arrived: update first', () => {
    const a = pushAdvice({ here: 'shown', sent: true, arrived: null });
    expect(a.ok).toBe(false);
    expect(a.lines[2].ok).toBeNull();
    expect(a.todo).toMatch(/Tap Update/);
  });
});
