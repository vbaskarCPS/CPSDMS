import { describe, expect, it } from 'vitest';
import { BACK, STEPS, actIndex, fill, stepsOfAct, withBack, type DemoSandbox } from './demoTour';

describe('the demo tour', () => {
  it('goes manager → worker → manager, with a hand-off at each change of role', () => {
    expect(STEPS.map(s => s.role).join(',')).toMatch(/^(manager,)+(worker,)+(manager,?)+$/);
    STEPS.forEach((s, i) => {
      const next = STEPS[i + 1];
      if (next && next.role !== s.role) expect(s.handoff).toBe(next.role);
      else expect(s.handoff).toBeUndefined();
    });
  });
  it('Act 1 is the glance, layers and sharing, a cart, then assigning a route', () => {
    expect(stepsOfAct('Route Manager').map(s => s.title)).toEqual(['Your day at a glance', 'Layers and sharing', 'Open a cart', 'Assign a route']);
    expect(stepsOfAct('Worker').length).toBe(6);
    expect(actIndex(STEPS.length - 1)).toBe(2);
  });
  it('every step says why, and every hands-on step points at something', () => {
    for (const s of STEPS) { expect(s.why.length).toBeGreaterThan(10); if (s.check) expect(s.targets?.length, s.title).toBeGreaterThan(0); }
  });
});

describe('what the coach flashes', () => {
  it('always offers the way back to the map, ahead of the map itself', () => {
    const t = withBack(STEPS.find(s => s.title === 'Assign a route')!.targets);
    const back = t.findIndex(x => x.sel === BACK[0].sel), map = t.findIndex(x => x.sel === '.mapboxgl-canvas');
    expect(back).toBeGreaterThan(-1); expect(back).toBeLessThan(map);
    expect(withBack(undefined).map(x => x.sel)).toEqual(BACK.map(x => x.sel));
  });
  it('fills in the sandbox’s route numbers and codes', () => {
    const sb = { routes: ['DXKQM10', 'DXKQM08', 'DXKQM21'], route_nums: [10, 8, 21] } as DemoSandbox;
    expect(fill('Tap route {r3}, then {c1}', sb)).toBe('Tap route 21, then DXKQM10');
    expect(fill('route {r2}', { routes: ['DXA01', 'DXA07', 'DXA03'] } as DemoSandbox)).toBe('route 7');
  });
});
