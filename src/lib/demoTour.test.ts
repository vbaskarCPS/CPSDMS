import { describe, expect, it } from 'vitest';
import { EXITS, OFF_TRACK, STEPS, actIndex, fill, stepsOfAct, withExits, type DemoSandbox } from './demoTour';

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
    expect(stepsOfAct('Route Manager').map(s => s.title)).toEqual(['Your map: what the marks mean', 'Layers and sharing', 'Open a cart', 'Assign a route']);
    expect(stepsOfAct('Worker').length).toBe(6);
    expect(actIndex(STEPS.length - 1)).toBe(2);
  });
  it('every step says why, and every hands-on step points at something', () => {
    for (const s of STEPS) { expect(s.why.length).toBeGreaterThan(10); if (s.check) expect(s.targets?.length, s.title).toBeGreaterThan(0); }
  });
});

describe('what the coach flashes', () => {
  it('offers the ways out (back, then close) after a step’s own controls and before the map', () => {
    const t = withExits(STEPS.find(s => s.title === 'Assign a route')!.targets);
    const own = t.findIndex(x => x.text === 'Amara'), back = t.findIndex(x => x.sel === '[aria-label="Back to map"]');
    const close = t.findIndex(x => x.hint === OFF_TRACK), map = t.findIndex(x => x.sel === '.mapboxgl-canvas');
    expect(own).toBeLessThan(back); expect(back).toBeLessThan(close); expect(close).toBeLessThan(map);
    expect(withExits(undefined)).toEqual(EXITS);
    expect(EXITS.filter(x => x.hint === OFF_TRACK).every(x => x.overlay)).toBe(true);
  });
  it('the first step explains the marks on the map', () => {
    expect(STEPS[0].legend?.length).toBeGreaterThanOrEqual(8);
  });
  it('fills in the sandbox’s route numbers and codes', () => {
    const sb = { routes: ['DXKQM10', 'DXKQM08', 'DXKQM21'], route_nums: [10, 8, 21] } as DemoSandbox;
    expect(fill('Tap route {r3}, then {c1}', sb)).toBe('Tap route 21, then DXKQM10');
    expect(fill('route {r2}', { routes: ['DXA01', 'DXA07', 'DXA03'] } as DemoSandbox)).toBe('route 7');
  });
});

describe('the sale steps walk through every field', () => {
  it('fields come before the button that saves them', () => {
    for (const title of ['A yes: save it as pending', 'Do the job and complete it']) {
      const t = STEPS.find(s => s.title === title)!.targets!;
      const lastField = Math.max(...t.map((x, i) => (x.field || x.input ? i : -1)));
      const save = t.findIndex(x => x.text === 'Save Pending' || x.text === 'Save & Complete');
      expect(lastField, title).toBeGreaterThan(-1); expect(save, title).toBeGreaterThan(lastField);
    }
  });
});
