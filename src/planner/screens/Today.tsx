// src/planner/screens/Today.tsx — the home screen: the day as a timeline of the routine (up with
// Kiaan → Bed Brief → daycare → work, fasting → dinner → gym → shake → Miracle Night → lights out),
// the current block highlighted, each one tickable. Streaks on top; the feature cards below.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings as Cog, Check, Sunrise, Moon, Flame, ChevronRight } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { dayKey, getDocs } from '../lib/docs';
import { useDoc } from '../lib/useDoc';
import { blocks, clock, currentBlock, fastState, loadRoutine, minutesOf, routineNow, type BlockId, type Routine } from '../lib/routine';
import { InstallHint } from '../ui/InstallHint';
import { Stat } from '../ui/primitives';
import { addDays, emptyDay, lightsOutStreak, normalizeDay, nowHM, wakeStreak, type Day } from '../features/plan';
import { HabitsTodayCard } from '../features/habits';
import { WorkoutTodayCard } from '../features/workout';
import { FoodTodayCard } from '../features/food';
import { MoneyTodayCard } from '../features/money';

function greeting(h: number): string {
  if (h < 4) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

type TickId = Exclude<BlockId, 'brief' | 'work' | 'night'>;
const TICKS: TickId[] = ['wake', 'daycare', 'dinner', 'gym', 'shake', 'lightsOut'];
const tickKey = (id: TickId): keyof Day['ticks'] => (id === 'wake' ? 'up' : id);

/** Per day: did every meal land inside the eating window? Meal keys are `${day}~${HH:MM}~${id}`.
 *  Days with nothing logged are absent (can't say). */
async function fastByDay(from: string, to: string, eatOpen: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    const meals = await getDocs<{ time?: string }>('meal', `${from}~`, `${to}~~`);
    for (const m of meals) {
      const [d, t = m.data?.time || ''] = m.key.split('~');
      const ok = !t || minutesOf(t) >= minutesOf(eatOpen) || minutesOf(t) < 240;   // after-midnight = still "today"
      out[d] = (out[d] ?? true) && ok;
    }
  } catch { /* unknown */ }
  return out;
}

export function Today({ pass }: { pass: PlannerPass }) {
  const today = dayKey();
  const [now, setNow] = useState(() => new Date());
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const { data, update, loading } = useDoc<Day>('day', today, emptyDay(), 400);
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [streaks, setStreaks] = useState<{ up: number; lights: number; fast: number | null } | null>(null);

  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id); }, []);

  // streaks over the last 60 days (today's doc from this screen, so a fresh tick counts straight away)
  useEffect(() => {
    if (loading) return;
    let on = true;
    (async () => {
      const docs = await getDocs<Day>('day', addDays(today, -60), today).catch(() => []);
      const map: Record<string, Day> = {};
      docs.forEach(d => { map[d.key] = normalizeDay(d.data); });
      map[today] = day;
      // fast kept: consecutive logged days with no meal before the window, ending today or yesterday
      const kept = await fastByDay(addDays(today, -60), today, routine.eatOpen);
      let fast = 0;
      let k = kept[today] === undefined ? addDays(today, -1) : today;
      if (kept[today] === false) fast = 0;
      else while (kept[k] === true) { fast++; k = addDays(k, -1); }
      if (on) setStreaks({ up: wakeStreak(map, routine), lights: lightsOutStreak(map, routine), fast });
    })();
    return () => { on = false; };
  }, [loading, today, routine, day.ticks.up, day.ticks.lightsOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = blocks(routine);
  const cur = currentBlock(routine, now);
  const curIdx = list.findIndex(b => b.id === cur);
  const fast = fastState(routine, now);
  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const t = day.ticks;

  const tick = (id: TickId) => set(d => { const k = tickKey(id); return { ...d, ticks: { ...d.ticks, [k]: d.ticks[k] ? undefined : nowHM() } }; });
  const ticked = (id: BlockId): string | undefined => {
    if (id === 'brief') return day.brief.finishedAt ? 'done' : undefined;
    if (id === 'work') { const n = day.priorities.filter(p => p.text.trim()).length, d = day.priorities.filter(p => p.done).length; return n && d === n ? 'done' : undefined; }
    if (id === 'night') return t.lightsOut ? 'done' : undefined;
    return t[tickKey(id)];
  };

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 14 }}>
      <header className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">{dateLine}</p>
          <h1>{greeting(now.getHours())}, {pass.user.display_name}.</h1>
        </div>
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Settings" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><Cog /></Link>
      </header>

      <div className="pl-stats today-streaks">
        <Stat label={<span className="pl-row" style={{ gap: 4 }}><Sunrise aria-hidden style={{ width: 14, height: 14 }} /> Up on time</span>} value={streaks ? streaks.up : '–'} sub={`by ${clock(routine.wake)}`} tone={streaks && streaks.up > 0 ? 'good' : undefined} />
        <Stat label={<span className="pl-row" style={{ gap: 4 }}><Moon aria-hidden style={{ width: 14, height: 14 }} /> Lights out</span>} value={streaks ? streaks.lights : '–'} sub={`by ${clock(routine.lightsOut)}`} tone={streaks && streaks.lights > 0 ? 'good' : undefined} />
        <Stat label={<span className="pl-row" style={{ gap: 4 }}><Flame aria-hidden style={{ width: 14, height: 14 }} /> Fast kept</span>} value={streaks ? (streaks.fast ?? '–') : '–'} sub={fast.eating ? 'eating now' : `${Math.floor(fast.fastedFor / 60)}h ${fast.fastedFor % 60}m fasted`} tone={streaks && (streaks.fast ?? 0) > 0 ? 'good' : undefined} />
      </div>

      <section className="today-timeline pl-card" aria-label="Today's routine">
        {list.map((b, i) => {
          const done = ticked(b.id);
          const isCur = b.id === cur;
          const past = i < curIdx;
          const canTick = (TICKS as string[]).includes(b.id);
          return (
            <div key={b.id} className={`today-block ${isCur ? 'is-now' : ''} ${past ? 'is-past' : ''} ${done ? 'is-done' : ''}`}>
              <div className="today-block__rail"><span className="today-block__dot">{done && <Check aria-hidden />}</span></div>
              <div className="today-block__body">
                <div className="today-block__head">
                  <span className="today-block__time">{clock(b.at)}{b.until ? `–${clock(b.until)}` : ''}</span>
                  {done && done !== 'done' && <span className="today-block__ticked">✓ {clock(done)}</span>}
                </div>
                <b className="today-block__label">{b.label}</b>
                {(isCur || !done) && <small className="pl-muted">{b.id === 'work' && !fast.eating ? `${b.blurb} · window opens ${clock(routine.eatOpen)}` : b.blurb}</small>}

                {isCur && b.id === 'work' && (
                  <div className="today-prios">
                    {day.priorities.map((p, j) => (
                      <div key={j} className={`plan-card-prio ${p.done ? 'is-done' : ''} ${p.text.trim() ? '' : 'is-empty'}`}>
                        <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} disabled={!p.text.trim()}
                          onClick={() => set(d => ({ ...d, priorities: d.priorities.map((x, k) => (k === j ? { ...x, done: !x.done } : x)) }))}><Check /></button>
                        <span>{p.text.trim() || (loading ? '…' : `Priority ${j + 1}`)}</span>
                      </div>
                    ))}
                    {!loading && day.priorities.every(p => !p.text.trim()) && <Link to="/plan/brief" className="pl-btn pl-btn--small pl-btn--ghost">Set today's three</Link>}
                  </div>
                )}

                <div className="today-block__actions">
                  {canTick && <button type="button" className={`pl-btn pl-btn--small ${done ? 'pl-btn--ghost' : isCur ? 'pl-btn--primary' : ''}`} onClick={() => tick(b.id as TickId)}>{done ? 'Undo' : b.id === 'wake' ? "I'm up" : b.id === 'lightsOut' ? 'Lights out' : 'Done'}</button>}
                  {b.id === 'brief' && <Link to="/plan/brief" className={`pl-btn pl-btn--small ${done ? 'pl-btn--ghost' : 'pl-btn--primary'}`}>{done ? 'Edit' : 'Start'} <ChevronRight /></Link>}
                  {b.id === 'night' && <Link to="/plan/night" className={`pl-btn pl-btn--small ${isCur && !done ? 'pl-btn--primary' : 'pl-btn--ghost'}`}>Open <ChevronRight /></Link>}
                  {b.id === 'work' && <Link to="/plan" className="pl-btn pl-btn--small pl-btn--ghost">Day page</Link>}
                  {(b.id === 'dinner' || b.id === 'shake') && <Link to="/food/add" className="pl-btn pl-btn--small pl-btn--ghost">+ Log</Link>}
                  {b.id === 'gym' && <Link to="/workout" className="pl-btn pl-btn--small pl-btn--ghost">Start session</Link>}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <InstallHint />
      <HabitsTodayCard pass={pass} />
      <WorkoutTodayCard pass={pass} />
      <FoodTodayCard pass={pass} />
      <MoneyTodayCard pass={pass} />
    </main>
  );
}
