// The menu pages behind Health and Lifestyle (screens/Hub.tsx): the one-line headline on each tile.
import { describe, expect, it } from 'vitest';
import { trainLine, trainToday } from '../features/workout/store';
import type { Template, Workout } from '../features/workout/types';
import { planLine } from '../features/plan/TodayCard';
import { emptyDay } from '../features/plan/types';
import { calendarLine } from '../features/calendar/TodayCard';
import type { CalEvent } from '../features/calendar/types';

const NOW = new Date(2026, 10, 11, 9, 0);   // Wed Nov 11 2026, 9 am
const ex = (name: string) => ({ exerciseId: name, name, targetSets: 1, targetReps: '10', restSec: 60 });
const tpl = (name: string, more: Partial<Template> = {}): Template => ({ id: name, name, exercises: [ex('a'), ex('b')], order: 0, ...more } as Template);
const done = (name: string, date: string, mins = 40): Workout => ({ id: name, name, date, startedAt: `${date}T10:00:00.000Z`, endedAt: new Date(new Date(`${date}T10:00:00.000Z`).getTime() + mins * 60000).toISOString(), exercises: [] } as unknown as Workout);

describe('Train tile', () => {
  it('a home session planned for a no-gym day', () => {
    const t = trainToday([tpl('Home stretch (easy)', { plannedFor: '2026-11-11', home: true }), tpl('Powerful Chest', { plannedFor: '2026-11-12' })], [], true, NOW);
    expect(t.head).toBe('Home stretch (easy)');
    expect(trainLine(t)).toBe('Home stretch (easy) · 2 exercises · at home');
  });
  it('a gym session planned for today', () => {
    expect(trainLine(trainToday([tpl('Powerful Chest', { plannedFor: '2026-11-11', exercises: [ex('a')] })], [], false, NOW))).toBe('Powerful Chest · 1 exercise');
  });
  it('a session under way wins over everything', () => {
    const going = { ...done('Full body', '2026-11-11'), endedAt: undefined } as unknown as Workout;
    expect(trainLine(trainToday([tpl('Powerful Chest', { plannedFor: '2026-11-11' })], [going], false, NOW))).toBe('Full body in progress');
  });
  it('done today', () => {
    expect(trainLine(trainToday([tpl('Powerful Chest', { plannedFor: '2026-11-11' })], [done('Powerful Chest', '2026-11-11', 62)], false, NOW))).toBe('Done: Powerful Chest · 62 min');
  });
  it('no gym and nothing planned: a rest day, with the last session', () => {
    const t = trainToday([tpl('Powerful Chest', { plannedFor: '2026-11-12' })], [done('Lungs', '2026-11-10')], true, NOW);
    expect(t.head).toBe('Rest day');
    expect(trainLine(t)).toMatch(/^Rest day · last: Lungs, /);
  });
  it('nothing at all yet', () => {
    expect(trainLine(trainToday([], [], true, NOW))).toBe('No sessions yet');
  });
});

describe('Plan tile', () => {
  it('counts the list', () => {
    const d = { ...emptyDay(), todos: [{ id: '1', text: 'a', done: true }, { id: '2', text: 'b', done: false }, { id: '3', text: 'c', done: false }] } as ReturnType<typeof emptyDay>;
    expect(planLine(d)).toBe('1 of 3 done on today’s list');
  });
  it('falls back to the priorities, then to the Brief', () => {
    const d = emptyDay();
    expect(planLine(d)).toBe('Brief not done yet');
    expect(planLine({ ...d, brief: { ...d.brief, finishedAt: '2026-11-11T12:00:00.000Z' } })).toBe('Brief done · no list yet');
    expect(planLine({ ...d, priorities: [{ text: 'Ship it', done: true }, { text: ' ', done: false }, { text: 'Call', done: false }] })).toBe('1 of 2 priorities done');
  });
});

describe('Calendar tile', () => {
  const ev = (title: string, date: string, time?: string): CalEvent => ({ id: title, title, date, time, who: 'both', repeat: 'none' } as unknown as CalEvent);
  it('today first, earliest timed event, and how many more', () => {
    expect(calendarLine([ev('Dentist', '2026-11-11', '15:30'), ev('Swim lesson', '2026-11-11', '14:00'), ev('Dinner', '2026-11-12', '18:00')], '2026-11-11', '2026-11-12')).toBe('Today: 2:00 pm Swim lesson · 1 more');
  });
  it('tomorrow when today is clear', () => {
    expect(calendarLine([ev('Dinner at Mum’s', '2026-11-12', '18:00')], '2026-11-11', '2026-11-12')).toBe('Tomorrow: 6:00 pm Dinner at Mum’s');
  });
  it('nothing on', () => {
    expect(calendarLine([], '2026-11-11', '2026-11-12')).toBe('Nothing on today or tomorrow');
  });
});
