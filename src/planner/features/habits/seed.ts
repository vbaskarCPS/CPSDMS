// src/planner/features/habits/seed.ts — the four habits the routine runs on, written once when the
// list is empty (prefs/habitsSeeded remembers it). The user can archive any of them.
import { getDoc, putDoc, putDocs } from '../../lib/docs';
import { loadRoutine } from '../../lib/routine';
import { uid } from '../../ui/primitives';
import { ALL_DAYS, type Habit } from './types';

export async function seedHabitsIfEmpty(existing: Habit[]): Promise<Habit[]> {
  if (existing.length) return [];
  const flag = await getDoc<{ seeded?: boolean }>('prefs', 'habitsSeeded').catch(() => null);
  if (flag?.seeded) return [];
  const r = await loadRoutine();
  const now = new Date().toISOString();
  const mk = (order: number, h: Omit<Habit, 'id' | 'createdAt' | 'order' | 'days'>): Habit => ({ id: uid(), createdAt: now, order, days: [...ALL_DAYS], ...h });
  const habits: Habit[] = [
    mk(0, { name: 'Bed Brief before getting up', identity: "someone who decides the day before the day decides him", cue: { time: r.wake, place: 'in bed' }, stack: 'After I wake up with Kiaan', twoMinute: 'Write one word and one priority', why: 'Ten minutes in bed beats a day on autopilot.', auto: 'brief', anchor: { block: 'wake', when: 'after' } }),
    mk(1, { name: 'No food before 6', identity: 'someone who eats with intention', cue: { time: r.eatOpen, place: 'kitchen' }, stack: '', twoMinute: 'Drink a glass of water instead', why: 'The fast keeps the day simple and dinner satisfying.', auto: 'fast', anchor: { block: 'dinner', when: 'before' } }),
    mk(2, { name: 'Shake after gym', identity: 'someone who finishes the session properly', cue: { time: r.shake, place: 'kitchen' }, stack: 'After I get home from the gym', twoMinute: 'Scoop, water, shake', why: 'Protein after training is where the work pays off.', auto: 'shake', anchor: { block: 'gym', when: 'after' } }),
    mk(3, { name: 'Lights out by 1', identity: 'someone who protects his mornings the night before', cue: { time: r.lightsOut, place: 'bedroom' }, stack: 'After the evening review', twoMinute: 'Phone on the charger, face down', why: 'Kiaan wakes at 8 either way.', auto: 'lightsOut', anchor: { block: 'unwind', when: 'after' } }),
  ];
  await putDocs(habits.map(h => ({ kind: 'habit', key: h.id, data: h })));
  await putDoc('prefs', 'habitsSeeded', { seeded: true, at: now });
  return habits;
}
