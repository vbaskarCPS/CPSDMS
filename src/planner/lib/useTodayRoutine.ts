// src/planner/lib/useTodayRoutine.ts — the routine as it runs today: the standing routine (Settings › My routine) with
// today's changes on top (Day.adjust: a block skipped, a time moved; see lib/routine.ts). Follows Arvy's changes to
// either as they're made.
import { useEffect, useMemo, useState } from 'react';
import { dayKey } from './docs';
import { loadDayAdjust, loadRoutine, onRoutineChange, routineFor, routineNow, type DayAdjust, type Routine } from './routine';
import { useDocsChanged } from './useDocsChanged';

/** r = today's times; base = the standing routine (tomorrow's wake time is base.wake); adjust = what's different today. */
export function useTodayRoutine(): { r: Routine; base: Routine; adjust?: DayAdjust } {
  const [base, setBase] = useState<Routine>(() => routineNow());
  const [adjust, setAdjust] = useState<DayAdjust | undefined>(undefined);
  const load = () => { void loadDayAdjust(dayKey()).then(setAdjust).catch(() => undefined); };
  useEffect(() => { void loadRoutine().then(setBase); load(); return onRoutineChange(setBase); }, []);
  useDocsChanged(['day'], load);
  const r = useMemo(() => routineFor(base, adjust), [base, adjust]);
  return { r, base, adjust };
}
