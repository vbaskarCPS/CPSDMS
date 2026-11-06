import { describe, expect, it } from 'vitest';
import { alreadyLoggedFor, likelySame } from './dupes';
import type { Meal } from './model';
import type { ProteinSlot } from '../plan/types';

const meal = (time: string, name: string, note?: string, items = [name]): Meal => ({ id: time + name, date: '2026-11-06', time, name, note,
  items: items.map(n => ({ name: n, portion: '', kcal: 100, protein: 20, carbs: 0, fat: 0 })), totals: { kcal: 100, protein: 20, carbs: 0, fat: 0 }, source: 'photo' });
const slot = (kind: 'meal' | 'shake', what: string, eaten?: string): ProteinSlot => ({ id: what, kind, label: kind === 'shake' ? 'Shake 1' : 'Meal 1', time: '09:00', what, protein: 25, eaten });
const SHAKE = 'Chocolate milk protein drink (Lactantia-style)';

describe('alreadyLoggedFor', () => {
  it('finds the shake logged from Food before Ate it (the 7:10 / 7:19 double)', () => {
    expect(alreadyLoggedFor(slot('shake', SHAKE), [meal('07:10', SHAKE)], [], '07:19').map(m => m.time)).toEqual(['07:10']);
  });
  it('finds breakfast for Meal 1 even with a different name (the 8:36 / 11:19 double)', () => {
    expect(alreadyLoggedFor(slot('meal', '4 eggs'), [meal('07:10', SHAKE), meal('08:36', 'Breakfast', undefined, ['Scrambled eggs (5 large)'])], [], '11:19').map(m => m.name)).toEqual(['Breakfast']);
  });
  it('skips meals another slot already counts, road-logged meals, and old ones', () => {
    const m = meal('07:10', SHAKE);
    expect(alreadyLoggedFor(slot('shake', SHAKE), [m], [slot('shake', 'x', '2026-11-06~07:10~' + m.id)], '07:19')).toEqual([]);
    expect(alreadyLoggedFor(slot('shake', SHAKE), [meal('07:10', SHAKE, 'Protein road · Shake 1')], [], '07:19')).toEqual([]);
    expect(alreadyLoggedFor(slot('meal', '4 eggs'), [meal('06:00', 'Breakfast')], [], '11:19')).toEqual([]);
  });
});

describe('likelySame', () => {
  it('catches the same food twice within 90 minutes', () => {
    expect(likelySame({ name: SHAKE, time: '07:19', items: [{ name: SHAKE }] }, [meal('07:10', SHAKE)])?.time).toBe('07:10');
    expect(likelySame({ name: SHAKE, time: '11:30', items: [{ name: SHAKE }] }, [meal('07:10', SHAKE)])).toBeNull();
  });
  it('catches a protein-road tick of the same kind', () => {
    expect(likelySame({ name: 'Breakfast', time: '08:36', items: [{ name: 'Scrambled eggs' }] }, [meal('08:00', '4 eggs', 'Protein road · Meal 1'), meal('07:10', SHAKE, 'Protein road · Shake 1')])?.name).toBe('4 eggs');
  });
});
