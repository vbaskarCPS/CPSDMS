// src/planner/screens/Today.tsx — the home screen: the day as a timeline of the routine (night profile, the 5 am
// club: up → gym → sauna (yesterday looked back, the protein road, today's Brief) → the list, with the protein road's
// shakes and meals at their times ("Ate it" logs them) → kitchen closed → lights out; morning profile:
// Miracle Morning → Brief → … → bed at 9),
// the current block highlighted, each one tickable. Streaks on top; the feature cards below.
// A day can differ from the routine (Day.adjust, set by Arvy from the conversation: sick, so no gym, no sauna, up at 7,
// a stretch at 7): the timeline shows that day's blocks, a note on top says what changed, "Back to normal" clears it.
// Below the greeting the blocks (streaks, the plan, the cards) are handed by name to features/widgets, which draws
// them in the person's own order with the widgets they added (Settings › Arrange Today); untouched, it's this order.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings as Cog, Check, Sunrise, Moon, Flame, ChevronRight } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { dayKey, docsChanged, getDocs, putDoc } from '../lib/docs';
import { loadTemplates, releaseHeld, saveTemplate } from '../features/workout/store';
import { useDoc } from '../lib/useDoc';
import { adjustWords, blocks, clock, currentBlock, fastState, loadRoutine, minutesOf, onRoutineChange, routineFor, routineMin, routineMinutes, routineNow, type Block, type BlockId, type Routine } from '../lib/routine';
import { InstallHint } from '../ui/InstallHint';
import { Stat } from '../ui/primitives';
import { addDays, emptyDay, lightsOutStreak, normalizeDay, nowHM, reviewDone, streakOf, todosDone, wakeStreak, TodoList, MissedBedtime, isMorningHours, type Day } from '../features/plan';
import { HabitsTodayCard, SlotHabits, SlotHabitsProvider, autoMark } from '../features/habits';
import { WorkoutTodayCard, MissedGym, GymStatus } from '../features/workout';
import { GuessMeals } from '../features/food/GuessMeals';
import { FoodTodayCard, alreadyLoggedFor, fromRoad, mealKey, saveMeal, slotMeal } from '../features/food';
import type { Meal } from '../features/food/model';
import type { ProteinSlot } from '../features/plan';
import { MoneyTodayCard } from '../features/money';
import { CycleTodayCard } from '../features/cycle';
import { CalendarTodayCard } from '../features/calendar';
import { ShopTodayCard } from '../features/shop';
import { TodayWidgets, foldsAway, useTodayWidgets } from '../features/widgets';
import { MailTodos } from '../features/mail';

function greeting(h: number): string {
  if (h < 4) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

type TickId = Exclude<BlockId, 'brief' | 'work' | 'night' | 'morning' | 'evening' | 'unwind' | 'windDown' | 'kitchen' | `x:${string}`>;
const TICKS: Record<'night' | 'morning', TickId[]> = {
  night: ['wake', 'gym', 'sauna', 'dinner', 'lightsOut'],
  morning: ['wake', 'kiaanUp', 'dinner', 'lightsOut'],
};
const tickKey = (id: TickId): keyof Day['ticks'] => (id === 'wake' ? 'up' : id);
/** Consecutive days the Miracle Morning was finished. */
const morningStreak = (days: Record<string, Day>) => streakOf(days, d => !!d?.morningRoutine.finishedAt, d => !!d?.morningRoutine.finishedAt);

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
  const { data, update, loading, loadError } = useDoc<Day>('day', today, emptyDay(), 400);
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  // today's changes to the routine, and the routine as it runs today (times moved, links skipped)
  const adj = day.adjust;
  const eff = useMemo(() => routineFor(routine, adj), [routine, adj]);
  const [streaks, setStreaks] = useState<{ up: number; lights: number; fast: number | null; morning: number } | null>(null);
  const isMorning = routine.profile === 'morning';
  const [askBed, setAskBed] = useState(false);   // lights out tapped in the morning: ask for last night's time
  const [yReviewed, setYReviewed] = useState(false);   // 5 am club: yesterday looked back, in the sauna
  // this person's own arrangement of the page (features/widgets): the order of the blocks below, which show, their
  // sizes, and the widgets they added. Nothing arranged = the page as it has always been.
  const widgets = useTodayWidgets(pass, routine.profile);
  const [unfolded, setUnfolded] = useState(false);   // the compact plan, opened up for now

  useEffect(() => { void loadRoutine().then(setRoutine); return onRoutineChange(setRoutine); }, []);   // and when Arvy changes the routine
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
      if (on) setYReviewed(!!map[addDays(today, -1)] && reviewDone(map[addDays(today, -1)]));
      // fast kept: consecutive logged days with no meal before the window, ending today or yesterday
      let fast: number | null = null;
      if (routine.fast) {
        const kept = await fastByDay(addDays(today, -60), today, routine.eatOpen);   // past days: the standing window
        fast = 0;
        let k = kept[today] === undefined ? addDays(today, -1) : today;
        if (kept[today] === false) fast = 0;
        else while (kept[k] === true) { fast++; k = addDays(k, -1); }
      }
      if (on) setStreaks({ up: wakeStreak(map, routine), lights: lightsOutStreak(map, routine), fast, morning: morningStreak(map) });
    })();
    return () => { on = false; };
  }, [loading, today, routine, day.ticks.up, day.ticks.lightsOut, day.morningRoutine.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = blocks(routine, adj);
  // the protein road's shakes and meals, in among the blocks at their times (blocks first on a tie)
  type Row = { b: Block; i: number; s?: undefined } | { s: ProteinSlot; b?: undefined };
  const rows: Row[] = [
    ...list.map((b, i) => ({ b, i, t: routineMin(b.at), o: 0 })),
    ...(isMorning ? [] : (day.protein?.slots || []).map(s => ({ s, t: routineMin(s.time || '12:00'), o: 1 }))),
  ].sort((a, b) => a.t - b.t || a.o - b.o);
  // "Ate it" on a protein-road slot. If that food is probably already in the log (logged from Food first), ask
  // whether to count that one instead of logging it twice.
  const [already, setAlready] = useState<{ slotId: string; meals: Meal[] } | null>(null);
  const setSlot = (id: string, eaten: string | undefined) => set(d => ({ ...d, protein: d.protein ? { ...d.protein, slots: d.protein.slots.map(x => (x.id === id ? { ...x, eaten } : x)) } : d.protein }));
  const logSlot = async (s: ProteinSlot) => {
    setAlready(null);
    const m = slotMeal(s, today, nowHM());
    setSlot(s.id, mealKey(m));
    try { await saveMeal(m); } catch { setSlot(s.id, undefined); }
  };
  const ateIt = async (s: ProteinSlot) => {
    if (s.eaten) {
      setSlot(s.id, undefined);
      // only remove the meal the slot logged itself; one logged from Food stays in the log
      const m = (await getDocs<Meal>('meal', s.eaten, s.eaten).catch(() => []))[0]?.data;
      if (m && fromRoad(m)) await putDoc('meal', s.eaten, null).catch(() => undefined);
      return;
    }
    const meals = (await getDocs<Meal>('meal', `${today}~`, `${today}~~`).catch(() => [])).map(d => d.data).filter(Boolean);
    const hits = alreadyLoggedFor(s, meals, day.protein?.slots || [], nowHM());
    if (hits.length) { setAlready({ slotId: s.id, meals: hits.slice(0, 2) }); return; }
    await logSlot(s);
  };
  const cur = currentBlock(routine, now, adj);
  const curIdx = list.findIndex(b => b.id === cur);
  const fast = fastState(eff, now);
  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const t = day.ticks;

  const tick = (id: TickId) => {
    const k = tickKey(id);
    const on = !day.ticks[k];
    if (id === 'lightsOut' && on && isMorningHours()) { setAskBed(true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    set(d => ({ ...d, ticks: { ...d.ticks, [k]: on ? nowHM() : undefined } }));
    // habits tied to this tick
    if (id === 'wake') void autoMark('wake', on);
    else if (id === 'gym' || id === 'sauna' || id === 'shake' || id === 'lightsOut') void autoMark(id, on);
    else if (id === 'dinner') {
      void autoMark('dinner', on);
      if (routine.fast) void fastByDay(today, today, eff.eatOpen).then(k2 => autoMark('fast', on && k2[today] !== false));
    }
  };
  // a block added for today only: ticked on the block itself
  const tickAdded = (id: string) => set(d => (d.adjust?.added ? { ...d, adjust: { ...d.adjust, added: d.adjust.added.map(x => (x.id === id ? { ...x, done: x.done ? undefined : nowHM() } : x)) } } : d));
  // "Back to normal": today runs as the routine says again. A rest day that came with the change goes too.
  const backToNormal = () => {
    const planned = !!day.gym?.planned, held = adj?.held;
    set(d => ({ ...d, adjust: undefined, gym: d.gym?.planned ? undefined : d.gym }));
    if (planned) void autoMark('gym', false, today, 'skip');
    if (adj?.skip?.includes('sauna')) void autoMark('sauna', false, today, 'skip');
    // the gym session that was moved on when the gym came off today comes back
    if (held) void loadTemplates().then(ts => { const back = releaseHeld(ts, today, held); return back ? saveTemplate(back).then(() => docsChanged(['template'])) : undefined; }).catch(() => undefined);
  };
  const ticked = (id: BlockId): string | undefined => {
    if (id === 'brief') return day.brief.finishedAt ? 'done' : undefined;
    if (id === 'work') { if (day.todos.length) return todosDone(day) ? 'done' : undefined; const n = day.priorities.filter(p => p.text.trim()).length, d = day.priorities.filter(p => p.done).length; return n && d === n ? 'done' : undefined; }
    if (id === 'night') return (isMorning ? reviewDone(day) : yReviewed) ? 'done' : undefined;
    if (id === 'evening') return t.lightsOut ? 'done' : undefined;
    if (id === 'kitchen') return undefined;
    if (id === 'unwind' || id === 'windDown') return t.lightsOut ? 'done' : undefined;
    if (id === 'morning') return day.morningRoutine.finishedAt ? 'done' : undefined;
    return t[tickKey(id as TickId)];   // added blocks (x:…) carry their own tick and never get here
  };
  // the day's plan set to compact (Arrange Today): what's finished from earlier in the day folds into one line, which
  // opens it again. Anything not done yet stays in sight.
  const folded = (row: Row): boolean => foldsAway(widgets.compact('plan') && !unfolded, row.s
    ? { past: routineMin(row.s.time) <= routineMinutes(now), done: !!row.s.eaten }
    : { past: row.i < curIdx, now: row.b.id === cur, done: !!(row.b.added ? row.b.added.done : ticked(row.b.id)) });
  const nFolded = rows.filter(folded).length;

  return (
    <SlotHabitsProvider><main className="pl-page pl-stack pl-fade" style={{ gap: 14 }}>
      <header className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">{dateLine}</p>
          <h1>{greeting(now.getHours())}, {pass.user.display_name}.</h1>
        </div>
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Settings" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><Cog /></Link>
      </header>

      <MissedBedtime routine={eff} open={askBed} onClose={() => setAskBed(false)} />
      <MissedGym routine={routine} day={day} set={set} today={today} loading={loading} />
      <GuessMeals routine={eff} today={today} />
      <MailTodos />   {/* "From your email": only while the check has to-dos on offer. A prompt like the ones above it, not a block to arrange */}
      {loadError && <p className="pl-error" style={{ fontSize: 13 }}>Couldn't load this day — check the connection. Nothing typed is saved until it loads.</p>}
      {/* the blocks, by name: features/widgets draws them in the person's order (as written here when nothing is arranged) */}
      <TodayWidgets widgets={widgets} blocks={{ streaks: (
      <div className="pl-stats today-streaks">
        <Stat label={<span className="pl-row" style={{ gap: 4 }}><Sunrise aria-hidden style={{ width: 14, height: 14 }} /> Up on time</span>} value={streaks ? streaks.up : '–'} sub={`by ${clock(eff.wake)}`} tone={streaks && streaks.up > 0 ? 'good' : undefined} />
        <Stat label={<span className="pl-row" style={{ gap: 4 }}><Moon aria-hidden style={{ width: 14, height: 14 }} /> {isMorning ? 'In bed' : 'Lights out'}</span>} value={streaks ? streaks.lights : '–'} sub={`by ${clock(eff.lightsOut)}`} tone={streaks && streaks.lights > 0 ? 'good' : undefined} />
        {routine.fast
          ? <Stat label={<span className="pl-row" style={{ gap: 4 }}><Flame aria-hidden style={{ width: 14, height: 14 }} /> Fast kept</span>} value={streaks ? (streaks.fast ?? '–') : '–'} sub={fast.eating ? 'eating now' : `${Math.floor(fast.fastedFor / 60)}h ${fast.fastedFor % 60}m fasted`} tone={streaks && (streaks.fast ?? 0) > 0 ? 'good' : undefined} />
          : routine.stretchMin + routine.meditateMin + routine.workoutMin > 0 && <Stat label={<span className="pl-row" style={{ gap: 4 }}><Sunrise aria-hidden style={{ width: 14, height: 14 }} /> Morning routine</span>} value={streaks ? streaks.morning : '–'} sub="days in a row" tone={streaks && streaks.morning > 0 ? 'good' : undefined} />}
      </div>
      ), plan: (<>
      <section className="today-timeline pl-card" aria-label="Today's routine">
        {adj && (
          <div className="today-adjust" role="note">
            <div className="pl-grow"><b>{adj.why || 'Today is different'}</b><small>{adjustWords(adj).join(' · ')}</small></div>
            <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" onClick={backToNormal}>Back to normal</button>
          </div>
        )}
        {widgets.compact('plan') && (nFolded > 0 || unfolded) && <button type="button" className="wg-fold" aria-expanded={unfolded} onClick={() => setUnfolded(u => !u)}>{unfolded ? 'Fold away what’s done' : `${nFolded} done earlier · Show`}</button>}
        {rows.map(row => {
          if (folded(row)) return null;
          if (row.s) {
            const s = row.s, due = routineMin(s.time) <= routineMinutes(now);
            return (
              <div key={s.id} className={`today-block today-block--slot ${s.eaten ? 'is-done' : ''} ${due && !s.eaten ? 'is-due' : ''}`}>
                <div className="today-block__rail"><span className="today-block__dot">{s.eaten && <Check aria-hidden />}</span></div>
                <div className="today-block__body">
                  <div className="today-block__head"><span className="today-block__time">{clock(s.time)}</span>{s.protein ? <span className="rc-tag">{s.protein} g</span> : null}</div>
                  <b className="today-block__label">{s.label}{s.what ? <span className="pl-muted" style={{ fontWeight: 500 }}> · {s.what}</span> : null}</b>
                  <div className="today-block__actions">
                    {s.what
                      ? <button type="button" className={`pl-btn pl-btn--small ${s.eaten ? 'pl-btn--ghost' : due ? 'pl-btn--primary' : ''}`} onClick={() => void ateIt(s)}>{s.eaten ? 'Undo' : 'Ate it'}</button>
                      : <Link to="/plan/sauna" className="pl-btn pl-btn--small pl-btn--ghost">Plan it <ChevronRight /></Link>}
                    {!s.eaten && already?.slotId !== s.id && <Link to="/food/add" className="pl-btn pl-btn--small pl-btn--ghost">Ate something else</Link>}
                  </div>
                  {already?.slotId === s.id && (
                    <div className="today-already" role="group" aria-label="Already logged">
                      <small>Already in your log. Is it one of these?</small>
                      {already.meals.map(m => (
                        <button key={m.id} type="button" className="pl-btn pl-btn--small pl-btn--primary" onClick={() => { setSlot(s.id, mealKey(m)); setAlready(null); }}>
                          Count {m.name.length > 28 ? `${m.name.slice(0, 26)}…` : m.name} · {clock(m.time)}
                        </button>
                      ))}
                      <button type="button" className="pl-btn pl-btn--small" onClick={() => void logSlot(s)}>No, log {s.label} too</button>
                      <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" onClick={() => setAlready(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            );
          }
          const { b, i } = row;
          const isCur = b.id === cur;
          const past = i < curIdx;
          if (b.added) {
            const x = b.added;
            return (
              <div key={b.id} className={`today-block ${isCur ? 'is-now' : ''} ${past ? 'is-past' : ''} ${x.done ? 'is-done' : ''}`}>
                <div className="today-block__rail"><span className="today-block__dot">{x.done && <Check aria-hidden />}</span></div>
                <div className="today-block__body">
                  <div className="today-block__head">
                    <span className="today-block__time">{clock(b.at)}{b.until ? `–${clock(b.until)}` : ''} · today only</span>
                    {x.done && <span className="today-block__ticked">✓ {clock(x.done)}</span>}
                  </div>
                  <b className="today-block__label">{b.label}</b>
                  {b.blurb && (isCur || !x.done) && <small className="pl-muted">{b.blurb}</small>}
                  <div className="today-block__actions">
                    {x.session && !x.done && <Link to="/workout" className={`pl-btn pl-btn--small ${isCur ? 'pl-btn--primary' : ''}`}>Open session <ChevronRight /></Link>}
                    <button type="button" className={`pl-btn pl-btn--small ${x.done || x.session ? 'pl-btn--ghost' : isCur ? 'pl-btn--primary' : ''}`} onClick={() => tickAdded(x.id)}>{x.done ? 'Undo' : 'Done'}</button>
                  </div>
                </div>
              </div>
            );
          }
          const done = ticked(b.id);
          const canTick = (TICKS[isMorning ? 'morning' : 'night'] as string[]).includes(b.id);
          return (
            <div key={b.id} className={`today-block ${isCur ? 'is-now' : ''} ${past ? 'is-past' : ''} ${done ? 'is-done' : ''}`}>
              <div className="today-block__rail"><span className="today-block__dot">{done && <Check aria-hidden />}</span></div>
              <div className="today-block__body">
                <div className="today-block__head">
                  <span className="today-block__time">{clock(b.at)}{b.until ? `–${clock(b.until)}` : ''}</span>
                  {done && done !== 'done' && <span className="today-block__ticked">✓ {clock(done)}</span>}
                </div>
                <SlotHabits block={b.id} when="before" />
                <b className="today-block__label">{b.label}</b>
                {(isCur || !done) && <small className="pl-muted">{b.id === 'work' && routine.fast && !fast.eating ? `${b.blurb} · window opens ${clock(eff.eatOpen)}` : b.blurb}</small>}

                {b.id === 'work' && (isCur || day.todos.length > 0) && (
                  <div className="today-prios">
                    {day.todos.length > 0
                      ? <><TodoList day={day} set={set} edit={false} compact /><Link to="/plan" className="pl-btn pl-btn--small pl-btn--ghost" style={{ marginTop: 6 }}>Edit the list</Link></>
                      : <>
                          {day.priorities.map((p, j) => (
                            <div key={j} className={`plan-card-prio ${p.done ? 'is-done' : ''} ${p.text.trim() ? '' : 'is-empty'}`}>
                              <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} disabled={!p.text.trim()}
                                onClick={() => set(d => ({ ...d, priorities: d.priorities.map((x, k) => (k === j ? { ...x, done: !x.done } : x)) }))}><Check /></button>
                              <span>{p.text.trim() || (loading ? '…' : `Priority ${j + 1}`)}</span>
                            </div>
                          ))}
                          {!loading && day.priorities.every(p => !p.text.trim()) && <Link to="/plan/brief" className="pl-btn pl-btn--small pl-btn--ghost">Do the Brief → today's list</Link>}
                        </>}
                  </div>
                )}

                {b.id === 'gym' && <GymStatus day={day} set={set} today={today} />}
                <SlotHabits block={b.id} when="after" />
                <div className="today-block__actions">
                  {canTick && <button type="button" className={`pl-btn pl-btn--small ${done ? 'pl-btn--ghost' : isCur ? 'pl-btn--primary' : ''}`} onClick={() => tick(b.id as TickId)}>{done ? 'Undo' : b.id === 'wake' ? "I'm up" : b.id === 'lightsOut' ? (isMorning ? 'In bed' : 'Lights out') : b.id === 'kiaanUp' ? "He's up" : 'Done'}</button>}
                  {b.id === 'brief' && <Link to="/plan/brief" className={`pl-btn pl-btn--small ${done ? 'pl-btn--ghost' : 'pl-btn--primary'}`}>{done ? 'Edit' : 'Start'} <ChevronRight /></Link>}
                  {(b.id === 'evening' || b.id === 'windDown' || (b.id === 'night' && isMorning)) && <Link to="/plan/night" className={`pl-btn pl-btn--small ${isCur && !done ? 'pl-btn--primary' : 'pl-btn--ghost'}`}>Open <ChevronRight /></Link>}
                  {b.id === 'night' && !isMorning && <Link to="/plan/sauna" className={`pl-btn pl-btn--small ${!done && (isCur || cur === 'sauna' || cur === 'brief') ? 'pl-btn--primary' : 'pl-btn--ghost'}`}>{done ? 'Edit' : 'Start'} <ChevronRight /></Link>}
                  {b.id === 'morning' && <Link to="/plan/morning" className={`pl-btn pl-btn--small ${done ? 'pl-btn--ghost' : 'pl-btn--primary'}`}>{done ? 'Done' : 'Start'} <ChevronRight /></Link>}
                  {b.id === 'work' && <Link to="/plan" className="pl-btn pl-btn--small pl-btn--ghost">Day page</Link>}
                  {(b.id === 'dinner' || b.id === 'shake') && <Link to="/food/add" className="pl-btn pl-btn--small pl-btn--ghost">+ Log</Link>}
                  {b.id === 'kitchen' && <Link to="/food" className="pl-btn pl-btn--small pl-btn--ghost">Food</Link>}
                  {b.id === 'sauna' && !done && <Link to="/plan/sauna" className={`pl-btn pl-btn--small ${isCur ? 'pl-btn--primary' : 'pl-btn--ghost'}`}>Timer <ChevronRight /></Link>}
                  {b.id === 'gym' && <Link to="/workout" className="pl-btn pl-btn--small pl-btn--ghost">Start session</Link>}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <InstallHint />
      </>),
      calendar: <CalendarTodayCard />,
      shop: <ShopTodayCard />,
      cycle: <CycleTodayCard pass={pass} />,   // the morning planner only (features/widgets leaves it off the other)
      habits: <HabitsTodayCard pass={pass} />,
      train: <WorkoutTodayCard pass={pass} />,
      food: <FoodTodayCard pass={pass} />,
      money: <MoneyTodayCard pass={pass} />,
      }} />
    </main></SlotHabitsProvider>
  );
}
