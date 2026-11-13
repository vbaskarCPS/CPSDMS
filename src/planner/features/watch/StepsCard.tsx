// src/planner/features/watch/StepsCard.tsx — the Steps card on Today: today's steps from the watch, with the bar to
// 10,000 and the resting heart rate. Shows only on a planner with a watch connected (Settings › Watch); without one it
// draws nothing. Fresh when Today opens, when the app comes back, and every 5 minutes while it's open.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Footprints } from 'lucide-react';
import { getDoc } from '../../lib/docs';
import { useDocsChanged } from '../../lib/useDocsChanged';
import { calendarDate, stepsView, type StepsView } from './steps';
import { watches } from './watch';

// whether a watch is connected, asked once per visit (it rarely changes)
let pairedAsk: Promise<boolean> | null = null;
const isPaired = (): Promise<boolean> => (pairedAsk ??= watches().then(l => l.length > 0).catch(() => { pairedAsk = null; return false; }));

/** null while loading; `paired: false` = no watch, nothing to show. */
export function useWatchSteps(): { paired: boolean; view: StepsView } | null {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [view, setView] = useState<StepsView | null>(null);
  const load = useCallback(() => {
    getDoc('health', calendarDate()).then(d => setView(stepsView(d))).catch(() => undefined);
  }, []);
  useEffect(() => {
    let on = true;
    void isPaired().then(p => { if (on) setPaired(p); });
    return () => { on = false; };
  }, []);
  useEffect(() => {
    if (!paired) return;
    load();
    const t = window.setInterval(load, 5 * 60_000);
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [paired, load]);
  useDocsChanged(['health'], load);
  if (paired === null) return null;
  if (!paired) return { paired: false, view: stepsView(null) };
  return view ? { paired: true, view } : null;
}

export function StepsTodayCard() {
  const s = useWatchSteps();
  if (!s || !s.paired) return null;
  const v = s.view;
  return (
    <Link to="/health" className="pl-card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div className="pl-row" style={{ gap: 12 }}>
        <Footprints aria-hidden style={{ width: 22, height: 22, color: 'var(--accent)', flex: 'none' }} />
        <div className="pl-grow"><b>{v.head}</b><small className="pl-muted" style={{ display: 'block' }}>{v.line}{v.at ? ` · from your watch at ${v.at}` : ''}</small></div>
        <ChevronRight aria-hidden />
      </div>
      <div className="pl-progress" style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={v.goal} aria-valuenow={v.steps} aria-label="Steps to today’s goal">
        <div className={`pl-progress__bar${v.pct >= 100 ? ' is-good' : ''}`} style={{ width: `${v.pct}%` }} />
      </div>
    </Link>
  );
}
