import { describe, expect, it } from 'vitest';
import { dealRandom, groupName, joinGroups, moneyLine, nextStep, splitGroup, toggleOut, walkAsk, type WalkState } from './bennyWalk';

const managers = [{ id: 'f', name: 'Franklyn Mitchell' }, { id: 'j', name: 'Jovan Chung' }, { id: 'v', name: 'Vijay Baskaran' }];
const base: WalkState = { step: 'attendance', date: '2026-11-13', roadTrip: true, managers, groups: [], maps: {}, areas: ['MISSION #1', 'NORTH VANCOUVER #1'] };

describe('start-the-day walk', () => {
  it('goes attendance → who → maps → crews → carts → money, skipping crews for one team', () => {
    expect(nextStep(base)).toBe('who');
    expect(nextStep({ ...base, step: 'rollcall' })).toBe('who');
    expect(nextStep({ ...base, step: 'maps', groups: [['f', 'j']] })).toBe('carts');
    expect(nextStep({ ...base, step: 'maps', groups: [['f'], ['j']] })).toBe('crews');
    expect(nextStep({ ...base, step: 'money' })).toBe('done');
  });
  it('picks managers, pairs two as one team carrying both names, and splits them', () => {
    let g = toggleOut([], 'f'); g = toggleOut(g, 'j'); g = toggleOut(g, 'v');
    expect(g).toEqual([['f'], ['j'], ['v']]);
    g = joinGroups(g, 'f', 'j');
    expect(g).toEqual([['v'], ['f', 'j']]);
    expect(groupName(g[1], managers)).toBe('Franklyn Mitchell + Jovan Chung');
    expect(toggleOut(g, 'j')).toEqual([['v'], ['f']]);
    expect(splitGroup(g, g[1])).toEqual([['v'], ['f'], ['j']]);
  });
  it('deals random crews evenly', () => {
    const out = dealRandom(['a', 'b', 'c', 'd', 'e'], 2, () => 0.5);
    expect(out.map(x => x.length)).toEqual([3, 2]);
    expect(out.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('asks the Benny for the plan in words', () => {
    const t = walkAsk({ ...base, groups: [['f', 'j'], ['v']], maps: { 'f+j': ['MISSION #1'], v: ['NORTH VANCOUVER #1'] }, crews: 'balanced', carts: 'pairs', rules: 'don’t give Franklyn Kyle' });
    expect(t).toContain('Start the day on 2026-11-13');
    expect(t).toContain('Franklyn Mitchell + Jovan Chung together as one team (both managers): MISSION #1.');
    expect(t).toContain('Vijay Baskaran: NORTH VANCOUVER #1.');
    expect(t).toContain('snake draft');
    expect(t).toContain('Keep in mind: don’t give Franklyn Kyle');
    expect(t).toContain('Carts: two to a cart.');
    const r = walkAsk({ ...base, groups: [['f'], ['j']], maps: { f: ['A'], j: ['B'] }, crews: 'random', carts: 'solo' }, [['Kyle Pitt'], ['Nathan Clark']]);
    expect(r).toContain('Franklyn Mitchell\'s crew: Kyle Pitt.');
    expect(r).toContain('Carts: everyone solo.');
  });
  it('says product cost and tax', () => {
    expect(moneyLine({ productCostPercent: 20, noTaxOnCash: true, taxName: 'GST', taxRate: 5, from: '2026-11-12' })).toBe('Product cost 20% · GST 5% · no tax on cash');
  });
});
