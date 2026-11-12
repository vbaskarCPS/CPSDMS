// What's on Today and in what order (widgets.ts): the original page for each planner, how a saved arrangement is read
// back (unknown, missing and repeated entries), switching off and on, sizes, the widgets a person adds, "put it back as
// it was", the compact plan's folding, and the countdown's sums across month and year ends.
import { describe, expect, it } from 'vitest';
import todayScreen from '../../screens/Today.tsx?raw';
import {
  add, ADDED, arrange, BLOCKS, canAdd, change, clean, countdownView, daysBetween, defaultOrder, EMPTY, foldsAway, isAsItWas, isDay, MAX_ADDED, monthCells, move, moveTo,
  nextTime, putBack, remove, rows, setOn, setSize, untouched, yearOn, type Added, type WidgetPrefs,
} from './widgets';

const order = (p: WidgetPrefs, profile: 'night' | 'morning' = 'night') => arrange(p, profile).map(i => i.id);
const shown = (p: WidgetPrefs, profile: 'night' | 'morning' = 'night') => rows(arrange(p, profile)).map(r => r.map(i => i.id).join('+'));
const saved = (over: Partial<WidgetPrefs>): WidgetPrefs => ({ ...EMPTY, ...over });
const note: Added = { id: 'x-note1', kind: 'note', paper: 'bright' };
const xmas: Added = { id: 'x-xmas1', kind: 'countdown', title: 'Christmas', date: '2026-12-25', yearly: true, occasion: 'christmas' };
const month: Added = { id: 'x-month1', kind: 'month' };
const week: Added = { id: 'x-week1', kind: 'habitweek' };

describe('Today before anyone arranges it', () => {
  it('is in the order it has always been: Vijay’s without the cycle card, Rosh’s with it', () => {
    expect(defaultOrder('night')).toEqual(['streaks', 'plan', 'calendar', 'shop', 'habits', 'train', 'food', 'money']);
    expect(defaultOrder('morning')).toEqual(['streaks', 'plan', 'calendar', 'shop', 'cycle', 'habits', 'train', 'food', 'money']);
    expect(order(EMPTY, 'night')).toEqual(defaultOrder('night'));
    expect(order(EMPTY, 'morning')).toEqual(defaultOrder('morning'));
  });
  it('is the order the Today screen itself writes its blocks in, every block named there and none left out', () => {
    const map = todayScreen.slice(todayScreen.indexOf('<TodayWidgets '), todayScreen.indexOf('</main>'));
    const at = (id: string) => map.search(new RegExp(`[{,(\\s]${id}: [(<]`));
    for (const b of BLOCKS) expect(at(b.id), b.id).toBeGreaterThan(-1);
    expect([...BLOCKS].sort((a, b) => at(a.id) - at(b.id)).map(b => b.id)).toEqual(BLOCKS.map(b => b.id));
    // and each block is still the card it has always been
    for (const [id, card] of Object.entries({ streaks: 'today-streaks', plan: 'today-timeline', calendar: 'CalendarTodayCard', shop: 'ShopTodayCard', cycle: 'CycleTodayCard', habits: 'HabitsTodayCard', train: 'WorkoutTodayCard', food: 'FoodTodayCard', money: 'MoneyTodayCard' })) {
      expect(map.slice(at(id)).split('\n').slice(0, 2).join(' '), id).toContain(card);
    }
  });
  it('everything shows at full size, each on its own row, and nothing counts as changed', () => {
    expect(arrange(EMPTY, 'morning').every(i => i.on && i.size === 'full')).toBe(true);
    expect(shown(EMPTY, 'morning')).toEqual(defaultOrder('morning'));
    expect(untouched(EMPTY, 'night')).toBe(true);
    expect(untouched(clean(null), 'morning')).toBe(true);
    expect(untouched(clean('nonsense'), 'night')).toBe(true);
  });
});

describe('a saved order', () => {
  it('is followed', () => {
    const p = saved({ order: ['plan', 'streaks', 'money', 'calendar', 'shop', 'habits', 'train', 'food'] });
    expect(order(p)).toEqual(['plan', 'streaks', 'money', 'calendar', 'shop', 'habits', 'train', 'food']);
  });
  it('a block it doesn’t mention still shows, at its usual place: after the block that comes before it on the original page', () => {
    // saved before "shop" and "train" existed
    expect(order(saved({ order: ['money', 'plan', 'calendar', 'streaks', 'habits', 'food'] }))).toEqual(['money', 'plan', 'calendar', 'shop', 'streaks', 'habits', 'train', 'food']);
    // the first block on the page is the one missing: it goes in front of the one that follows it
    expect(order(saved({ order: ['plan', 'calendar', 'shop', 'habits', 'train', 'food', 'money'] }))).toEqual(defaultOrder('night'));
    expect(order(saved({ order: ['money', 'food', 'plan'] })).slice(0, 4)).toEqual(['money', 'food', 'streaks', 'plan']);
    // with most of the page missing, each still follows the one before it
    expect(order(saved({ order: ['calendar', 'plan'] }))).toEqual(['calendar', 'shop', 'habits', 'train', 'food', 'money', 'streaks', 'plan']);
    // a new block always shows, even for someone who switched others off
    expect(arrange(saved({ order: ['plan'], off: ['streaks', 'calendar'] }), 'night').find(i => i.id === 'shop')?.on).toBe(true);
  });
  it('entries it doesn’t know are passed over, and one named twice counts once', () => {
    const p = saved({ order: ['food', 'weather', 'plan', 'food', 'x-gone', 'plan', 'streaks'] });
    expect(order(p)).toEqual(['food', 'money', 'plan', 'calendar', 'shop', 'habits', 'train', 'streaks']);
    expect(new Set(order(p)).size).toBe(order(p).length);
  });
  it('Rosh’s cycle card has no place on Vijay’s page, and comes back at its usual place on hers', () => {
    const p = saved({ order: ['cycle', 'plan', 'streaks', 'calendar', 'shop', 'habits', 'train', 'food', 'money'] });
    expect(order(p, 'night')).not.toContain('cycle');
    expect(order(p, 'morning')[0]).toBe('cycle');
    expect(order(saved({ order: defaultOrder('night') }), 'morning')).toEqual(defaultOrder('morning'));
  });
  it('junk is read as nothing saved, never an error', () => {
    for (const junk of [null, undefined, 7, 'x', [], { order: 'plan' }, { order: [1, null, {}], off: 'all', size: [], added: 'no' }, { added: [null, 3, { id: 'x-1' }, { kind: 'note' }] }]) {
      expect(order(clean(junk))).toEqual(defaultOrder('night'));
      expect(clean(junk).added).toEqual([]);
    }
  });
});

describe('moving a block', () => {
  it('one place up or down, and Today follows', () => {
    const p = move(EMPTY, 'night', 'habits', -1);
    expect(order(p)).toEqual(['streaks', 'plan', 'calendar', 'habits', 'shop', 'train', 'food', 'money']);
    expect(order(move(p, 'night', 'habits', 1))).toEqual(defaultOrder('night'));
    expect(shown(p)).toEqual(order(p));
  });
  it('the top one can’t go up and the bottom one can’t go down', () => {
    expect(move(EMPTY, 'night', 'streaks', -1)).toBe(EMPTY);
    expect(move(EMPTY, 'night', 'money', 1)).toBe(EMPTY);
    expect(move(EMPTY, 'night', 'nothing', 1)).toBe(EMPTY);
  });
  it('dragged straight to a place', () => {
    expect(order(moveTo(EMPTY, 'night', 'money', 0))).toEqual(['money', 'streaks', 'plan', 'calendar', 'shop', 'habits', 'train', 'food']);
    expect(order(moveTo(EMPTY, 'night', 'streaks', 7)).slice(-1)).toEqual(['streaks']);
    expect(moveTo(EMPTY, 'night', 'streaks', 8)).toBe(EMPTY);
    expect(moveTo(EMPTY, 'night', 'plan', 1)).toBe(EMPTY);
  });
  it('the whole order is written down, so a later update can’t shuffle what was arranged', () => {
    expect(move(EMPTY, 'morning', 'cycle', -1).order).toEqual(['streaks', 'plan', 'calendar', 'cycle', 'shop', 'habits', 'train', 'food', 'money']);
  });
});

describe('switching a block off and back on', () => {
  it('off: it stays on the list but not on Today; on: back where it was', () => {
    const off = setOn(move(EMPTY, 'night', 'food', -1), 'food', false);
    expect(arrange(off, 'night').find(i => i.id === 'food')?.on).toBe(false);
    expect(order(off)).toContain('food');
    expect(shown(off)).toEqual(['streaks', 'plan', 'calendar', 'shop', 'habits', 'train', 'money']);
    const on = setOn(off, 'food', true);
    expect(shown(on)).toEqual(['streaks', 'plan', 'calendar', 'shop', 'habits', 'food', 'train', 'money']);
    expect(on.off).toEqual([]);
    expect(setOn(setOn(EMPTY, 'food', false), 'food', false).off).toEqual(['food']);
  });
  it('the day’s plan is always shown: it can’t be switched off, and a saved "off" for it is not believed', () => {
    expect(BLOCKS.filter(b => b.always).map(b => b.id)).toEqual(['plan']);
    expect(setOn(EMPTY, 'plan', false).off).toEqual([]);
    expect(clean({ off: ['plan', 'money'] }).off).toEqual(['money']);
    expect(arrange(saved({ off: ['plan', 'money'] }), 'night').find(i => i.id === 'plan')?.on).toBe(true);
    expect(shown(saved({ off: ['plan'] }))).toContain('plan');
  });
  it('everything else off still leaves the plan', () => {
    const p = defaultOrder('morning').reduce((acc, id) => setOn(acc, id, false), EMPTY);
    expect(shown(p, 'morning')).toEqual(['plan']);
  });
});

describe('sizes', () => {
  it('the blocks with two sizes: the plan, calendar, cycle, habits and food; the rest have one', () => {
    expect(BLOCKS.filter(b => b.sizes).map(b => b.id)).toEqual(['plan', 'calendar', 'cycle', 'habits', 'food']);
    expect(arrange(EMPTY, 'morning').filter(i => i.resizable).map(i => i.id)).toEqual(['plan', 'calendar', 'cycle', 'habits', 'food']);
  });
  it('compact is remembered, full is the usual and isn’t written down', () => {
    const p = setSize(EMPTY, 'habits', 'compact');
    expect(p.size).toEqual({ habits: 'compact' });
    expect(arrange(p, 'night').find(i => i.id === 'habits')?.size).toBe('compact');
    expect(setSize(p, 'habits', 'full').size).toEqual({});
  });
  it('a one-size block stays as it is whatever is asked or saved', () => {
    expect(setSize(EMPTY, 'money', 'compact').size).toEqual({});
    expect(arrange(saved({ size: { streaks: 'compact', shop: 'compact' } }), 'night').every(i => i.size === 'full')).toBe(true);
  });
  it('the compact plan folds away only what is finished and earlier in the day', () => {
    expect(foldsAway(true, { past: true, done: true })).toBe(true);
    expect(foldsAway(true, { past: true, done: false })).toBe(false);          // not ticked yet: stays in sight
    expect(foldsAway(true, { past: false, done: true })).toBe(false);         // ticked ahead of time: stays
    expect(foldsAway(true, { past: true, done: true, now: true })).toBe(false); // the block the clock is in: stays
    expect(foldsAway(false, { past: true, done: true })).toBe(false);         // full size: nothing folds
  });
});

describe('widgets a person adds', () => {
  it('go to the top of Today', () => {
    const p = add(add(EMPTY, 'night', note), 'night', xmas);
    expect(order(p).slice(0, 3)).toEqual(['x-xmas1', 'x-note1', 'streaks']);
    expect(p.added).toEqual([note, xmas]);
    expect(untouched(p, 'night')).toBe(false);
  });
  it('are named in the list: a countdown by its title', () => {
    const list = arrange(add(add(add(add(EMPTY, 'night', note), 'night', xmas), 'night', month), 'night', week), 'night');
    expect(list.slice(0, 4).map(i => i.name)).toEqual(['Habit tracker', 'Mini calendar', 'Christmas', 'Note']);
  });
  it('several countdowns and notes, but one mini calendar and one habit tracker', () => {
    let p = add(add(EMPTY, 'night', month), 'night', week);
    expect(canAdd(p, 'month')).toBe(false);
    expect(canAdd(p, 'habitweek')).toBe(false);
    expect(add(p, 'night', { id: 'x-month2', kind: 'month' }).added).toHaveLength(2);
    for (let i = 0; i < 10; i++) p = add(p, 'night', { id: `x-note${i}0`, kind: 'note', paper: 'plain' });
    expect(p.added.filter(a => a.kind === 'note')).toHaveLength(ADDED.note.max);
    expect(canAdd(p, 'note')).toBe(false);
    expect(canAdd(p, 'countdown')).toBe(true);
    expect(p.added.length).toBeLessThanOrEqual(MAX_ADDED);
  });
  it('the same one can’t be added twice, and a broken one not at all', () => {
    expect(add(add(EMPTY, 'night', note), 'night', note).added).toEqual([note]);
    expect(add(EMPTY, 'night', { id: 'plan', kind: 'note', paper: 'plain' }).added).toEqual([]);
    expect(add(EMPTY, 'night', { id: 'x-bad1', kind: 'countdown', title: 'No day', date: '2026-02-30' }).added).toEqual([]);
  });
  it('move like any block, and two small ones next to each other share a row', () => {
    let p = add(add(add(EMPTY, 'night', month), 'night', note), 'night', xmas);   // xmas, note, month, streaks, plan…
    p = setSize(setSize(p, 'x-xmas1', 'compact'), 'x-note1', 'compact');
    expect(shown(p).slice(0, 3)).toEqual(['x-xmas1+x-note1', 'x-month1', 'streaks']);
    p = setSize(p, 'x-month1', 'compact');
    expect(shown(p).slice(0, 3)).toEqual(['x-xmas1+x-note1', 'x-month1', 'streaks']);   // a third small one starts a new row
    p = move(p, 'night', 'x-note1', 1);   // xmas, month, note
    expect(shown(p).slice(0, 2)).toEqual(['x-xmas1+x-month1', 'x-note1']);
    p = moveTo(p, 'night', 'x-month1', 4);   // xmas, note, streaks, plan, month
    expect(shown(p).slice(0, 5)).toEqual(['x-xmas1+x-note1', 'streaks', 'plan', 'x-month1', 'calendar']);
    // the planner's own compact cards are one line, full width: never side by side
    expect(shown(setSize(setSize(EMPTY, 'calendar', 'compact'), 'habits', 'compact'))).toEqual(defaultOrder('night'));
  });
  it('the habit tracker has one size', () => {
    const p = setSize(add(EMPTY, 'night', week), 'x-week1', 'compact');
    expect(p.size).toEqual({});
    expect(arrange(p, 'night')[0]).toMatchObject({ id: 'x-week1', resizable: false, size: 'full' });
  });
  it('a countdown’s day or a note’s paper can be changed; the place it sits in stays', () => {
    let p = move(add(add(EMPTY, 'night', note), 'night', xmas), 'night', 'x-xmas1', 1);
    p = change(p, { ...xmas, title: 'Christmas at Mum’s', date: '2027-12-25' });
    p = change(p, { id: 'x-note1', kind: 'note', paper: 'fresh' });
    expect(arrange(p, 'night').slice(0, 2).map(i => i.name)).toEqual(['Note', 'Christmas at Mum’s']);
    expect(p.added).toEqual([{ id: 'x-note1', kind: 'note', paper: 'fresh' }, { ...xmas, title: 'Christmas at Mum’s', date: '2027-12-25' }]);
    expect(change(p, { id: 'x-note1', kind: 'month' }).added).toEqual(p.added);   // not the same kind of thing: left alone
  });
  it('removed: off the page, its size forgotten, the rest as arranged', () => {
    let p = setSize(add(move(EMPTY, 'night', 'money', -1), 'night', note), 'x-note1', 'compact');
    p = remove(p, 'x-note1');
    expect(p.added).toEqual([]);
    expect(p.size).toEqual({});
    expect(order(p)).toEqual(['streaks', 'plan', 'calendar', 'shop', 'habits', 'train', 'money', 'food']);
    expect(remove(p, 'x-note1')).toEqual(p);
  });
});

describe('put it back as it was', () => {
  it('the original order, everything showing, at full size', () => {
    let p = move(move(EMPTY, 'morning', 'money', -1), 'morning', 'plan', 1);
    p = setSize(setOn(setOn(p, 'cycle', false), 'streaks', false), 'plan', 'compact');
    expect(isAsItWas(p, 'morning')).toBe(false);
    const back = putBack(p, 'morning');
    expect(order(back, 'morning')).toEqual(defaultOrder('morning'));
    expect(shown(back, 'morning')).toEqual(defaultOrder('morning'));
    expect(back).toEqual({ v: 1, order: defaultOrder('morning'), off: [], size: {}, added: [] });
    expect(isAsItWas(back, 'morning')).toBe(true);
    expect(untouched(back, 'morning')).toBe(true);
  });
  it('what the person added is theirs: it stays, below the rest, at the size it had', () => {
    let p = add(add(EMPTY, 'night', note), 'night', xmas);
    p = setSize(setOn(move(p, 'night', 'x-note1', 1), 'food', false), 'x-xmas1', 'compact');
    const back = putBack(p, 'night');
    expect(order(back)).toEqual([...defaultOrder('night'), 'x-xmas1', 'x-note1']);
    expect(back.size).toEqual({ 'x-xmas1': 'compact' });
    expect(back.added).toEqual(p.added);
    expect(isAsItWas(back, 'night')).toBe(true);     // nothing left to put back
    expect(untouched(back, 'night')).toBe(false);    // but the page has their widgets on it
    expect(isAsItWas(p, 'night')).toBe(false);
  });
});

describe('the saved shape', () => {
  it('is small and plain: the order, what’s off, what’s compact, what was added', () => {
    let p = add(add(EMPTY, 'morning', note), 'morning', xmas);
    p = setSize(setOn(move(p, 'morning', 'cycle', -1), 'money', false), 'plan', 'compact');
    expect(p).toEqual({
      v: 1,
      order: ['x-xmas1', 'x-note1', 'streaks', 'plan', 'calendar', 'cycle', 'shop', 'habits', 'train', 'food', 'money'],
      off: ['money'],
      size: { plan: 'compact' },
      added: [{ id: 'x-note1', kind: 'note', paper: 'bright' }, { id: 'x-xmas1', kind: 'countdown', title: 'Christmas', date: '2026-12-25', yearly: true, occasion: 'christmas' }],
    });
    expect(clean(JSON.parse(JSON.stringify(p)))).toEqual(p);   // saved and read back: the same
  });
  it('what comes back is tidied: titles trimmed, a made-up paper or occasion dropped, a day that isn’t one refused', () => {
    const p = clean({ added: [
      { id: 'x-aaa', kind: 'countdown', title: `  Trip   to Goa ${'!'.repeat(80)}`, date: '2027-01-05', yearly: 'yes', occasion: 'payday', extra: 1 },
      { id: 'x-bbb', kind: 'countdown', title: '', date: '2027-02-29' },
      { id: 'x-ccc', kind: 'countdown', title: '', date: '2028-02-29' },
      { id: 'x-ddd', kind: 'note', paper: 'neon', text: 'kept elsewhere' },
      { id: 'x-eee', kind: 'weather' },
      { id: 'not ours', kind: 'note' },
    ] });
    expect(p.added).toEqual([
      { id: 'x-aaa', kind: 'countdown', title: `Trip to Goa ${'!'.repeat(28)}`, date: '2027-01-05' },
      { id: 'x-ccc', kind: 'countdown', title: 'Countdown', date: '2028-02-29' },
      { id: 'x-ddd', kind: 'note', paper: 'plain' },
    ]);
  });
  it('ids from a newer version of the planner are kept, not drawn', () => {
    const p = clean({ order: ['weather', 'plan'], off: ['weather'], size: { weather: 'compact' } });
    expect(p).toMatchObject({ order: ['weather', 'plan'], off: ['weather'], size: { weather: 'compact' } });
    expect(order(p)).not.toContain('weather');
    expect(setOn(p, 'food', false).off).toEqual(['weather', 'food']);
  });
  it('a widget of a kind this version doesn’t know is carried along untouched, so a change made here doesn’t lose it', () => {
    const moon = { id: 'x-moon1', kind: 'moon', phase: 'full' };
    const p = clean({ order: ['x-moon1', 'plan'], size: { 'x-moon1': 'compact' }, added: [note, moon, { id: 'x-junk1' }, 'junk'] });
    expect(p.added).toEqual([note]);
    expect(p.kept).toEqual([moon]);
    expect(order(p)).not.toContain('x-moon1');
    let q = setSize(setOn(add(p, 'night', xmas), 'money', false), 'calendar', 'compact');
    q = putBack(remove(change(q, { ...xmas, title: 'Xmas' }), 'x-note1'), 'night');
    expect(q.kept).toEqual([moon]);
    expect(q.size['x-moon1']).toBe(undefined);   // "put it back" resets sizes it doesn't know, but the widget is still there
    expect(clean(JSON.parse(JSON.stringify(setOn(p, 'food', false))))).toMatchObject({ kept: [moon], size: { 'x-moon1': 'compact' } });
    expect(clean({ added: [] }).kept).toBe(undefined);
  });
});

describe('the race timer', () => {
  const gym: Added = { id: 'x-race1', kind: 'race', race: 'gym', title: 'Up to first set' };
  const door: Added = { id: 'x-race2', kind: 'race', race: 'manual', title: 'Out the door' };
  it('is added like the others, at the top, named on the arrange list by its own name; several can be on the page', () => {
    const p = add(add(EMPTY, 'night', gym), 'night', door);
    expect(order(p).slice(0, 2)).toEqual(['x-race2', 'x-race1']);
    expect(arrange(p, 'night').slice(0, 2).map(i => [i.name, i.resizable])).toEqual([['Out the door', true], ['Up to first set', true]]);
    expect(canAdd(p, 'race')).toBe(true);
    expect(ADDED.race.max).toBeGreaterThan(1);
  });
  it('is moved, made small (two side by side) and taken off like the others', () => {
    let p = add(add(EMPTY, 'night', gym), 'night', door);
    p = setSize(setSize(p, 'x-race1', 'compact'), 'x-race2', 'compact');
    expect(shown(p)[0]).toBe('x-race2+x-race1');
    p = move(p, 'night', 'x-race1', 1);
    expect(order(p).slice(0, 3)).toEqual(['x-race2', 'streaks', 'x-race1']);
    expect(order(remove(p, 'x-race1'))).not.toContain('x-race1');
  });
  it('is saved small and plain: which race and its name, nothing else (the times are kept in their own docs)', () => {
    const p = add(EMPTY, 'night', door);
    expect(p.added).toEqual([{ id: 'x-race2', kind: 'race', race: 'manual', title: 'Out the door' }]);
    expect(clean(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(change(p, { ...door, title: 'Kids to bed' } as Added).added[0]).toMatchObject({ title: 'Kids to bed', race: 'manual' });
  });
  it('what comes back is tidied: a name trimmed, an empty one becomes the race’s own name, a race without a kind refused', () => {
    const p = clean({ added: [
      { id: 'x-rc1', kind: 'race', race: 'gym', title: '', times: [1, 2] },
      { id: 'x-rc2', kind: 'race', race: 'manual', title: `   Kids   to bed ${'z'.repeat(60)}` },
      { id: 'x-rc3', kind: 'race' },
      { id: 'x-rc4', kind: 'race', race: 7 },
    ] });
    expect(p.added).toEqual([
      { id: 'x-rc1', kind: 'race', race: 'gym', title: 'Up to Start workout' },
      { id: 'x-rc2', kind: 'race', race: 'manual', title: `Kids to bed ${'z'.repeat(28)}` },
    ]);
    expect(p.kept).toBe(undefined);
  });
  it('a kind of race from a newer version is carried along untouched, not drawn and not lost', () => {
    const later = { id: 'x-rc9', kind: 'race', race: 'daycare', title: 'Kiaan up to drop-off' };
    const p = clean({ order: ['x-rc9', 'plan'], added: [gym, later] });
    expect(p.added).toEqual([gym]);
    expect(p.kept).toEqual([later]);
    expect(order(p)).not.toContain('x-rc9');
    expect(clean(JSON.parse(JSON.stringify(remove(p, 'x-race1')))).kept).toEqual([later]);
  });
  it('an older phone (no race timer at all) keeps one it doesn’t know the same way', () => {
    // what that phone's version did with any kind it didn't know
    expect(clean({ added: [{ id: 'x-moon2', kind: 'moon' }] }).kept).toEqual([{ id: 'x-moon2', kind: 'moon' }]);
  });
});

describe('the countdown', () => {
  it('counts whole days across the end of a month and of a year', () => {
    expect(daysBetween('2026-11-11', '2026-12-25')).toBe(44);
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-11-30', '2026-12-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-12-25', '2027-12-25')).toBe(365);
    expect(daysBetween('2027-12-25', '2028-12-25')).toBe(366);   // 2028 has a 29th of February
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);     // over the weekend the clocks change: still two days
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-11', '2026-11-10')).toBe(-1);
  });
  it('shows the days left in big type, with the words beside it', () => {
    expect(countdownView('2026-12-25', '2026-11-11')).toEqual({ days: 44, state: 'coming', big: '44', small: 'days to go' });
    expect(countdownView('2027-01-01', '2026-12-30')).toMatchObject({ big: '2', small: 'days to go' });
    expect(countdownView('2027-01-01', '2026-12-31')).toMatchObject({ big: '1', small: 'day to go · tomorrow', state: 'coming' });
  });
  it('says "today!" on the day', () => {
    expect(countdownView('2026-12-25', '2026-12-25')).toMatchObject({ days: 0, state: 'today', big: 'today!' });
    expect(countdownView('2027-01-01', '2027-01-01')).toMatchObject({ state: 'today', big: 'today!' });
  });
  it('and after it has passed, how long ago', () => {
    expect(countdownView('2026-12-25', '2026-12-26')).toMatchObject({ days: -1, state: 'passed', big: '', small: 'was yesterday' });
    expect(countdownView('2026-12-25', '2027-01-02')).toMatchObject({ days: -8, state: 'passed', small: 'was 8 days ago' });
  });
  it('a yearly one that has passed offers the same day next year', () => {
    expect(nextTime({ date: '2026-11-05', yearly: true }, '2026-11-11')).toBe('2027-11-05');
    expect(nextTime({ date: '2026-12-31', yearly: true }, '2027-01-01')).toBe('2027-12-31');
    expect(nextTime({ date: '2024-11-12', yearly: true }, '2026-11-11')).toBe('2026-11-12');   // left for two years: the next one, not last year’s
    expect(nextTime({ date: '2024-11-11', yearly: true }, '2026-11-11')).toBe('2026-11-11');
    expect(nextTime({ date: '2026-11-05', yearly: true, occasion: 'birthday' }, '2026-11-11')).toBe('2027-11-05');
  });
  it('a 29th of February comes round on the 28th in the years without one', () => {
    expect(yearOn('2028-02-29')).toBe('2029-02-28');
    expect(yearOn('2028-02-29', 4)).toBe('2032-02-29');
    expect(nextTime({ date: '2028-02-29', yearly: true }, '2028-03-01')).toBe('2029-02-28');
  });
  it('an occasion whose day moves gets its own next day, not the same date a year on', () => {
    expect(nextTime({ date: '2026-12-25', yearly: true, occasion: 'christmas' }, '2026-12-26')).toBe('2027-12-25');
    expect(nextTime({ date: '2027-03-28', yearly: true, occasion: 'easter' }, '2027-03-29')).toBe('2028-04-16');
    expect(nextTime({ date: '2026-11-08', yearly: true, occasion: 'diwali' }, '2026-11-11')).toBe('2027-10-29');
    expect(nextTime({ date: '2032-11-02', yearly: true, occasion: 'diwali' }, '2032-11-03')).toBe(null);   // not known that far ahead: no guess
  });
  it('a one-off that has passed has no next time: it can only be removed or given a new day', () => {
    expect(nextTime({ date: '2026-11-05' }, '2026-11-11')).toBe(null);
  });
  it('knows a real day from one that isn’t', () => {
    for (const d of ['2026-12-25', '2028-02-29', '2027-01-01']) expect(isDay(d)).toBe(true);
    for (const d of ['2027-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '26-11-11', '2026-11-11T10:00', '', null, 20261111]) expect(isDay(d)).toBe(false);
  });
});

describe('the mini calendar’s page', () => {
  it('starts each month under the right weekday, Sunday first', () => {
    const nov = monthCells('2026-11');   // the 1st of November 2026 is a Sunday
    expect(nov[0]).toBe('2026-11-01');
    expect(nov).toHaveLength(30);
    const dec = monthCells('2026-12');   // the 1st is a Tuesday: two gaps
    expect(dec.slice(0, 3)).toEqual([null, null, '2026-12-01']);
    expect(dec[dec.length - 1]).toBe('2026-12-31');
    expect(monthCells('2027-01').slice(0, 6)).toEqual([null, null, null, null, null, '2027-01-01']);   // a Friday
  });
  it('February has 28 days, or 29', () => {
    expect(monthCells('2027-02').filter(Boolean)).toHaveLength(28);
    expect(monthCells('2028-02').filter(Boolean)).toHaveLength(29);
    expect(monthCells('2028-02').slice(-1)).toEqual(['2028-02-29']);
  });
});
