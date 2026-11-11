// The 5 am club (night profile): up → gym → sauna (the meal plan, today's Brief) → the list → dinner → lights out.
import { describe, expect, it } from 'vitest';
import { adjustWords, blocks, cleanAdjust, currentBlock, lateGym, mergeAdjust, NIGHT_ROUTINE, MORNING_ROUTINE, planAt, routineFor, type DayAdjust } from './routine';

const at = (h: number, m: number) => { const d = new Date(2026, 10, 6, h, m); return d; };

describe('the 5 am club', () => {
  it('runs gym first, then the sauna for the meal plan and Brief, and nothing at night but lights out', () => {
    const b = blocks(NIGHT_ROUTINE).map(x => `${x.at} ${x.id}`);
    expect(b).toEqual(['05:00 wake', '05:15 gym', '06:20 sauna', '06:20 brief', '06:45 work', '14:00 kitchen', '21:30 lightsOut']);
    expect(blocks(NIGHT_ROUTINE).some(x => x.id === 'unwind' || x.id === 'windDown' || x.id === 'shake')).toBe(false);
  });
  it('without a sauna, the review and Brief come straight after the gym', () => {
    const r = { ...NIGHT_ROUTINE, saunaMin: 0 };
    expect(planAt(r)).toBe('06:45');
    expect(blocks(r).find(x => x.id === 'gym')!.until).toBe('06:45');
  });
  it('knows where the day is', () => {
    expect(currentBlock(NIGHT_ROUTINE, at(4, 30))).toBe('lightsOut');
    expect(currentBlock(NIGHT_ROUTINE, at(5, 30))).toBe('gym');
    expect(currentBlock(NIGHT_ROUTINE, at(6, 30))).toBe('brief');
    expect(currentBlock(NIGHT_ROUTINE, at(10, 0))).toBe('work');
    expect(currentBlock(NIGHT_ROUTINE, at(15, 0))).toBe('kitchen');
    expect(currentBlock(NIGHT_ROUTINE, at(22, 0))).toBe('lightsOut');
  });
  it('falls back to dinner when there is no kitchen cut-off', () => {
    expect(blocks({ ...NIGHT_ROUTINE, kitchenClose: '' }).map(x => x.id)).toContain('dinner');
  });
  it("leaves Rosh's morning routine as it was", () => {
    expect(blocks(MORNING_ROUTINE).map(x => x.id)).toEqual(['wake', 'morning', 'brief', 'kiaanUp', 'work', 'dinner', 'evening', 'lightsOut']);
  });
});

// One day can differ from the routine: the changes are kept on the day and worked out the same way for the Today
// screen and the reminders (supabase/functions/planner-push/adjust.ts).
describe('a changed day', () => {
  const line = (a: DayAdjust, r = NIGHT_ROUTINE) => blocks(r, a).map(x => `${x.at} ${x.id}`);
  const sick: DayAdjust = { why: 'Sick day', skip: ['gym', 'sauna'], times: { wake: '07:00' },
    added: [{ id: 's1', at: '07:00', label: 'Home stretch', note: 'easy, 20 min' }, { id: 'b1', at: '07:30', label: 'Breakfast' }] };

  it('a sick day: no gym, no sauna, up at 7, a stretch and breakfast slotted in', () => {
    expect(line(sick)).toEqual(['07:00 wake', '07:00 x:s1', '07:15 brief', '07:15 work', '07:30 x:b1', '14:00 kitchen', '21:30 lightsOut']);
    const b = blocks(NIGHT_ROUTINE, sick);
    expect(b[0].label).toBe('Up');                                    // not "straight to the gym"
    expect(b.find(x => x.id === 'x:s1')).toMatchObject({ label: 'Home stretch', blurb: 'easy, 20 min' });
    expect(b[b.length - 1].blurb).toContain('5:00 am');               // tomorrow is a normal day
    expect(routineFor(NIGHT_ROUTINE, sick)).toMatchObject({ wake: '07:00', saunaMin: 0, review: '07:15', lightsOut: '21:30' });
  });
  it('leaves the routine alone when nothing changed', () => {
    expect(routineFor(NIGHT_ROUTINE, undefined)).toBe(NIGHT_ROUTINE);
    expect(routineFor(NIGHT_ROUTINE, { times: { lightsOut: '22:30' } })).toMatchObject({ wake: '05:00', gym: '05:15', review: '06:45', saunaMin: 25, lightsOut: '22:30', windDown: '22:30' });
    expect(line({ times: { lightsOut: '22:30' } })).toEqual(['05:00 wake', '05:15 gym', '06:20 sauna', '06:20 brief', '06:45 work', '14:00 kitchen', '22:30 lightsOut']);
  });
  it('moving the wake time moves the morning with it', () => {
    expect(line({ times: { wake: '06:00' } })).toEqual(['06:00 wake', '06:15 gym', '07:20 sauna', '07:20 brief', '07:45 work', '14:00 kitchen', '21:30 lightsOut']);
  });
  it('a skipped link closes the gap', () => {
    expect(line({ skip: ['gym'] })).toEqual(['05:00 wake', '05:15 sauna', '05:15 brief', '05:40 work', '14:00 kitchen', '21:30 lightsOut']);
    expect(line({ skip: ['sauna'] })).toEqual(['05:00 wake', '05:15 gym', '06:20 brief', '06:20 work', '14:00 kitchen', '21:30 lightsOut']);
    expect(line({ skip: ['kitchen'] })).toEqual(['05:00 wake', '05:15 gym', '06:20 sauna', '06:20 brief', '06:45 work', '21:30 lightsOut']);
  });
  it('the gym moved to the evening leaves the morning, and its sauna goes with it', () => {
    const a: DayAdjust = { times: { gym: '17:00' } };
    expect(lateGym(NIGHT_ROUTINE, a)).toEqual({ at: '17:00', until: '18:05', saunaUntil: '18:30' });
    expect(line(a)).toEqual(['05:00 wake', '05:15 brief', '05:15 work', '14:00 kitchen', '17:00 gym', '18:05 sauna', '21:30 lightsOut']);
    expect(blocks(NIGHT_ROUTINE, a)[0].label).toBe('Up');
    expect(lateGym(NIGHT_ROUTINE, { times: { gym: '05:45' } })).toBeNull();   // a little later is still the morning gym
    expect(line({ times: { gym: '05:45' } })).toEqual(['05:00 wake', '05:45 gym', '06:50 sauna', '06:50 brief', '07:15 work', '14:00 kitchen', '21:30 lightsOut']);
  });
  it('knows where a changed day is', () => {
    expect(currentBlock(NIGHT_ROUTINE, at(5, 30), sick)).toBe('lightsOut');   // still asleep: up at 7 today
    expect(currentBlock(NIGHT_ROUTINE, at(7, 5), sick)).toBe('x:s1');
    expect(currentBlock(NIGHT_ROUTINE, at(7, 20), sick)).toBe('work');
    expect(currentBlock(NIGHT_ROUTINE, at(7, 40), sick)).toBe('x:b1');
  });
  it("Rosh's morning: skip the Miracle Morning and the Brief starts when she's up", () => {
    expect(blocks(MORNING_ROUTINE, { skip: ['morning'], times: { wake: '06:30' } }).map(x => `${x.at} ${x.id}`))
      .toEqual(['06:30 wake', '06:30 brief', '08:00 kiaanUp', '08:00 work', '18:00 dinner', '20:30 evening', '21:00 lightsOut']);
  });
  it('Rosh with no minutes for a morning routine: no Miracle Morning block, the Brief starts the day', () => {
    const none = { ...MORNING_ROUTINE, wake: '08:00', stretchMin: 0, meditateMin: 0, workoutMin: 0 };
    expect(blocks(none).map(x => `${x.at} ${x.id}`)).toEqual(['08:00 wake', '08:00 brief', '08:00 kiaanUp', '08:00 work', '18:00 dinner', '20:30 evening', '21:00 lightsOut']);
    expect(blocks(none).find(x => x.id === 'brief')).toMatchObject({ at: '08:00', until: '08:10' });
    // only the parts she does are named
    expect(blocks({ ...MORNING_ROUTINE, meditateMin: 0 }).find(x => x.id === 'morning')).toMatchObject({ until: '06:00', blurb: 'stretch 10 · move 20' });
  });
  it('says what changed in a few words', () => {
    expect(adjustWords(sick)).toEqual(['no gym', 'no sauna', 'up at 7:00 am', '+ Home stretch 7:00 am', '+ Breakfast 7:30 am']);
    expect(adjustWords(undefined)).toEqual([]);
  });
  it('checks what is stored and adds one change to another', () => {
    expect(cleanAdjust({ skip: ['gym', 'wake', 'nonsense'], times: { wake: '7am', gym: '17:00' }, added: [{ id: 'a', at: 'x', label: 'Nap' }] })).toEqual({ skip: ['gym'], times: { gym: '17:00' } });
    expect(cleanAdjust({ skip: [], times: {} })).toBeUndefined();
    // a block can be the day's training session, and the gym session moved on is remembered while the gym is off
    expect(cleanAdjust({ skip: ['gym'], held: { id: 't1', to: '2026-11-12' }, added: [{ id: 'a', at: '08:00', label: 'Home stretch', session: true }] }))
      .toEqual({ skip: ['gym'], held: { id: 't1', to: '2026-11-12' }, added: [{ id: 'a', at: '08:00', label: 'Home stretch', session: true }] });
    expect(cleanAdjust({ skip: ['sauna'], held: { id: 't1', to: '2026-11-12' } })).toEqual({ skip: ['sauna'] });   // the gym is on: nothing is held
    const one = mergeAdjust(undefined, { why: 'Sick day', skip: ['gym'], times: { wake: '07:00' } }, new Date('2026-11-11T11:00:00Z'))!;
    expect(one).toEqual({ why: 'Sick day', skip: ['gym'], times: { wake: '07:00' }, at: '2026-11-11T11:00:00.000Z' });
    const two = mergeAdjust(one, { skip: ['sauna'], add: [{ id: 'n1', at: '13:00', label: 'Nap' }] })!;
    expect(two.skip).toEqual(['gym', 'sauna']); expect(two.times).toEqual({ wake: '07:00' }); expect(two.added?.[0].label).toBe('Nap'); expect(two.why).toBe('Sick day');
    const back = mergeAdjust(two, { unskip: ['gym', 'sauna'], times: { wake: null }, remove: ['n1'] });
    expect(back).toBeUndefined();   // everything put back: the day is normal again
  });
});
