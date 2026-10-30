// src/planner/features/cycle/useCycle.ts — periods, prefs and the logged days in one load.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { calendarKey, getDoc, getDocs, putDoc } from '../../lib/docs';
import { DEFAULT_PREFS, type CyclePrefs, type DayLog, type Period } from './types';
import { marksFor, projections, stats, today as todayView } from './predict';
import { addDays } from './dates';

export function useCycle() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [prefs, setPrefs] = useState<CyclePrefs>(DEFAULT_PREFS);
  const [logs, setLogs] = useState<Record<string, DayLog>>({});
  const [loading, setLoading] = useState(true);
  const todayKey = calendarKey();

  const reload = useCallback(async () => {
    try {
      const [ps, pr, ls] = await Promise.all([
        getDocs<Period>('period'),
        getDoc<Partial<CyclePrefs>>('cycleprefs', 'settings'),
        getDocs<DayLog>('cyclelog', addDays(todayKey, -400), addDays(todayKey, 60)),
      ]);
      setPeriods(ps.map(d => d.data).filter(p => p && p.start && p.end).sort((a, b) => a.start.localeCompare(b.start)));
      setPrefs({ ...DEFAULT_PREFS, ...(pr || {}) });
      const m: Record<string, DayLog> = {};
      ls.forEach(d => { m[d.key] = d.data; });
      setLogs(m);
    } finally { setLoading(false); }
  }, [todayKey]);
  useEffect(() => { void reload(); }, [reload]);

  const view = useMemo(() => todayView(periods, prefs, todayKey), [periods, prefs, todayKey]);
  const st = useMemo(() => stats(periods, prefs), [periods, prefs]);
  const marks = useMemo(() => marksFor(periods, prefs), [periods, prefs]);
  const proj = useMemo(() => projections(periods, prefs), [periods, prefs]);

  const savePeriod = useCallback(async (p: Period, previousStart?: string) => {
    if (previousStart && previousStart !== p.start) await putDoc('period', previousStart, null);
    await putDoc('period', p.start, p);
    await reload();
  }, [reload]);
  const removePeriod = useCallback(async (start: string) => { await putDoc('period', start, null); await reload(); }, [reload]);
  const savePrefs = useCallback(async (p: CyclePrefs) => { await putDoc('cycleprefs', 'settings', p); setPrefs(p); }, []);

  return { periods, prefs, logs, loading, todayKey, view, stats: st, marks, projections: proj, savePeriod, removePeriod, savePrefs, reload };
}
