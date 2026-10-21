import { describe, expect, it } from 'vitest';
import { STEPS, actIndex, stepsOfAct } from './demoTour';

describe('the demo tour', () => {
  it('goes manager → worker → manager, with a hand-off at each change of role', () => {
    const roles = STEPS.map(s => s.role);
    expect(roles.join(',')).toMatch(/^(manager,)+(worker,)+(manager,?)+$/);
    STEPS.forEach((s, i) => {
      const next = STEPS[i + 1];
      if (next && next.role !== s.role) expect(s.handoff).toBe(next.role);
      else expect(s.handoff).toBeUndefined();
    });
  });
  it('covers what was asked for', () => {
    const titles = STEPS.map(s => s.title.toLowerCase());
    for (const t of ['assign a route', 'manage team', 'late arrival', 'colours', 'invalid', 'pending', 'complete', 'sale on your map']) {
      expect(titles.some(x => x.includes(t)), t).toBe(true);
    }
    expect(stepsOfAct('Route Manager').length).toBe(6);
    expect(stepsOfAct('Worker').length).toBe(6);
    expect(actIndex(STEPS.length - 1)).toBe(2);
  });
  it('every step says why, and every watched step has a check or an action', () => {
    for (const s of STEPS) { expect(s.why.length).toBeGreaterThan(10); if (s.action) expect(s.check).toBeDefined(); }
  });
});
