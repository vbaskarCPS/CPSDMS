import { describe, it, expect } from 'vitest';
import { frequentTodos, moveTodo, toggleTodo, toggleMust, emptyDay } from './types';

describe('todos', () => {
  const day = { ...emptyDay(), priorities: [{ text: 'A', done: false }, { text: '', done: false }, { text: '', done: false }], todos: [{ id: '1', text: 'A', done: false, must: true }, { id: '2', text: 'B', done: false }, { id: '3', text: 'C', done: false }] };
  it('moves an item up and down and stops at the ends', () => {
    expect(moveTodo(day, '3', -1).todos.map(t => t.id)).toEqual(['1', '3', '2']);
    expect(moveTodo(day, '1', -1).todos.map(t => t.id)).toEqual(['1', '2', '3']);
  });
  it('the must-dos are the priorities', () => {
    const d = toggleTodo(day, '1');
    expect(d.todos[0].done).toBe(true); expect(d.priorities[0]).toEqual({ text: 'A', done: true });
    const e = toggleMust(d, '3');
    expect(e.priorities.map(p => p.text)).toEqual(['A', 'C', '']);
  });
  it('finds what keeps showing up, with its usual time', () => {
    const mk = (texts: [string, string?][]) => ({ todos: texts.map(([text, time], i) => ({ id: String(i), text, done: false, time })) });
    const days = [mk([['Take Kiaan to daycare', '09:30'], ['Dishes']]), mk([['take kiaan to daycare', '09:30'], ['Litter']]), mk([['Take Kiaan to daycare', '09:45'], ['Dishes']])];
    const f = frequentTodos(days);
    expect(f[0]).toEqual({ text: 'Take Kiaan to daycare', days: 3, time: '09:30' });
    expect(f[1]).toEqual({ text: 'Dishes', days: 2, time: undefined });
    expect(frequentTodos(days, ['dishes']).map(x => x.text)).toEqual(['Take Kiaan to daycare']);
  });
});
