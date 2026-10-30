// src/planner/features/habits/useHabits.ts — every habit plus the last 12 weeks of logs, and marking.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocs, putDoc, dayKey } from '../../lib/docs';
import { addDays, type Logs } from './streak';
import type { Habit, HabitLog, HabitMark } from './types';

export const LOG_DAYS = 84;

export function useHabits() {
  const today = dayKey();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<Logs>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [hs, ls] = await Promise.all([
        getDocs<Habit>('habit'),
        getDocs<HabitLog>('habitlog', addDays(today, -(LOG_DAYS - 1)), today),
      ]);
      setHabits(hs.map(d => ({ ...d.data, id: d.data.id || d.key })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt)));
      setLogs(Object.fromEntries(ls.map(d => [d.key, d.data || {}])));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [today]);

  useEffect(() => { void reload(); }, [reload]);

  /** Set (or clear with undefined) one habit's mark for a day. Optimistic; the log doc is rewritten whole. */
  const mark = useCallback(async (habitId: string, m: HabitMark | undefined, key = today) => {
    let next: HabitLog = {};
    setLogs(prev => {
      next = { ...(prev[key] || {}) };
      if (m) next[habitId] = m; else delete next[habitId];
      return { ...prev, [key]: next };
    });
    try { await putDoc('habitlog', key, next); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); void reload(); }
  }, [today, reload]);

  const saveHabit = useCallback(async (h: Habit) => {
    setHabits(prev => { const i = prev.findIndex(x => x.id === h.id); const n = i < 0 ? [...prev, h] : prev.map(x => (x.id === h.id ? h : x)); return n; });
    await putDoc('habit', h.id, h);
  }, []);

  const active = useMemo(() => habits.filter(h => !h.archived), [habits]);
  return { today, habits, active, logs, loading, error, reload, mark, saveHabit };
}
