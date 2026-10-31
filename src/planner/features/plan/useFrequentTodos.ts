// src/planner/features/plan/useFrequentTodos.ts — what keeps showing up on past lists, for the suggestion chips.
import { useEffect, useState } from 'react';
import { dayKey, getDocs } from '../../lib/docs';
import { addDays } from './dates';
import { frequentTodos, type Day } from './types';

export function useFrequentTodos(exclude: string[] = []) {
  const [days, setDays] = useState<Partial<Day>[]>([]);
  useEffect(() => {
    const today = dayKey();
    getDocs<Day>('day', addDays(today, -60), addDays(today, -1)).then(ds => setDays(ds.map(d => d.data))).catch(() => undefined);
  }, []);
  return frequentTodos(days, exclude);
}
