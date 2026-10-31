// src/planner/features/plan/Brief.tsx — the Bed Brief: four questions from bed, under ten minutes, then today's list
// drafted from them (star the must-dos; they're the day's priorities).
// One question per screen, big input, a countdown in the corner that never blocks. Saves every step.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { loadRoutine, routineNow, type Routine } from '../../lib/routine';
import { Button, useToast } from '../../ui/primitives';
import { nowHM } from './dates';
import { emptyDay, normalizeDay, syncPriorities, type Day } from './types';
import { autoMark } from '../habits/auto';
import { briefHints, todosFromBrief, type BriefHints } from '../../lib/ai';
import { TodoList } from './TodoList';
import { useFrequentTodos } from './useFrequentTodos';
import { uid } from '../../ui/primitives';
import { getDoc, getDocs, putDoc } from '../../lib/docs';
import { Sparkles } from 'lucide-react';

/** Coach Claude starts suggesting once it has seen a few finished days. */
const KNOWS_YOU_AFTER = 3;

type Hints = BriefHints | null;
type Extras = { frequent: { text: string; time?: string }[]; coachMust: string[] };
type Step = { title: string; hint?: string; render: (d: Day, set: (fn: (d: Day) => Day) => void, focus: React.RefObject<HTMLInputElement | HTMLTextAreaElement>, x: Extras) => JSX.Element; hints?: (h: BriefHints, d: Day, set: (fn: (d: Day) => Day) => void) => { label: string; apply: () => void }[] };

const setBrief = (set: (fn: (d: Day) => Day) => void, k: keyof Day['brief'], v: string) => set(d => ({ ...d, brief: { ...d.brief, [k]: v } }));

const STEPS: Step[] = [
  { title: 'One word for today', hint: 'The kind of man you want to be from now until lights out.',
    render: (d, set, focus) => <input ref={focus as React.RefObject<HTMLInputElement>} className="pl-input brief-word" placeholder="Calm · Sharp · Present…" value={d.brief.word} maxLength={24} onChange={e => setBrief(set, 'word', e.target.value)} />,
    hints: (h, _d, set) => h.words.map(w => ({ label: w, apply: () => setBrief(set, 'word', w) })) },
  { title: 'Who needs me on my A-game today?', hint: 'Kiaan, Roshini, a client, the crew…',
    render: (d, set, focus) => <textarea className="pl-input pl-textarea" ref={focus as React.RefObject<HTMLTextAreaElement>} rows={2} placeholder="Name and why" value={d.brief.aGame} onChange={e => setBrief(set, 'aGame', e.target.value)} />,
    hints: (h, _d, set) => (h.aGame ? [{ label: h.aGame, apply: () => setBrief(set, 'aGame', h.aGame) }] : []) },
  { title: 'What might stress me — and how my best self responds', hint: 'Decide now, so it is already handled when it shows up.',
    render: (d, set, focus) => (
      <div className="pl-stack">
        <textarea className="pl-input pl-textarea" ref={focus as React.RefObject<HTMLTextAreaElement>} rows={2} placeholder="The thing that might stress me…" value={d.brief.stress} onChange={e => setBrief(set, 'stress', e.target.value)} />
        <textarea className="pl-input pl-textarea" rows={2} placeholder="…and how my best self handles it" value={d.brief.stressResponse} onChange={e => setBrief(set, 'stressResponse', e.target.value)} />
      </div>),
    hints: (h, _d, set) => [
      ...(h.stress ? [{ label: h.stress, apply: () => setBrief(set, 'stress', h.stress) }] : []),
      ...(h.stressResponse ? [{ label: `↳ ${h.stressResponse}`, apply: () => setBrief(set, 'stressResponse', h.stressResponse) }] : []),
    ] },
  { title: "One thing I'm looking forward to", hint: 'Dinner with Kiaan, the gym with the boys, a win at work…',
    render: (d, set, focus) => <textarea className="pl-input pl-textarea" ref={focus as React.RefObject<HTMLTextAreaElement>} rows={2} placeholder="Something good about today" value={d.brief.excited} onChange={e => setBrief(set, 'excited', e.target.value)} />,
    hints: (h, _d, set) => (h.excited ? [{ label: h.excited, apply: () => setBrief(set, 'excited', h.excited) }] : []) },
  { title: "Today's list", hint: 'From bed to dinner, this is the day. Star the must-dos; order it the way you\'ll tackle it; a time is a reminder.',
    render: (d, set, _f, x) => <TodoList day={d} set={set} suggestions={[...x.coachMust.map(t => ({ text: t, must: true })), ...x.frequent]} /> },
];

const fmt = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`;

export function Brief() {
  const nav = useNavigate();
  const today = dayKey();
  const { data, update, loading, loadError, flush } = useDoc<Day>('day', today, emptyDay(), 500);
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [step, setStep] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [toast, say] = useToast();
  const focus = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const started = useRef(false);
  const frequent = useFrequentTodos();
  // Coach Claude's suggestions: fetched once per day in the background, only once it knows a few of your days
  const [hints, setHints] = useState<Hints>(null);
  const [knows, setKnows] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const cached = await getDoc<BriefHints>('briefhints', today);
        if (cached?.madeAt) { if (on) { setHints(cached); setKnows(true); } return; }
        const days = await getDocs<Day>('day', undefined, today);
        const finished = days.filter(d => d.key !== today && d.data?.brief?.finishedAt).length;
        if (!on) return;
        if (finished < KNOWS_YOU_AFTER) { setKnows(false); return; }
        setKnows(true);
        const h = await briefHints('lb');
        if (on) { setHints(h); void putDoc('briefhints', today, h); }
      } catch { /* the brief works without suggestions */ }
    })();
    return () => { on = false; };
  }, [today]);

  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  // first open of the day: the brief starts, and "up" is ticked
  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    const t = nowHM();
    if (!day.brief.startedAt || !day.ticks.up) set(d => ({ ...d, brief: { ...d.brief, startedAt: d.brief.startedAt || new Date().toISOString() }, ticks: { ...d.ticks, up: d.ticks.up || t } }));
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => { window.setTimeout(() => focus.current?.focus(), 50); }, [step]);

  const startedAt = day.brief.startedAt ? new Date(day.brief.startedAt).getTime() : now;
  const left = routine.briefMinutes * 60 - Math.floor((now - startedAt) / 1000);
  const last = step === STEPS.length - 1;
  // the last step: draft the list from the answers the first time it's opened (the priorities are always on it)
  const [drafting, setDrafting] = useState(false);
  const draft = async (force = false) => {
    if (drafting) return;
    setDrafting(true);
    const prios = day.todos.filter(t => t.must).map(t => t.text.trim());
    try {
      const items = await todosFromBrief({ word: day.brief.word, aGame: day.brief.aGame, stress: day.brief.stress, stressResponse: day.brief.stressResponse, excited: day.brief.excited }, prios, frequent.map(f => f.text + (f.time ? ` (usually ${f.time})` : '')));
      set(d => {
        const keep = force ? d.todos.filter(t => t.from === 'me' || t.must) : d.todos;
        const have = new Set(keep.map(t => t.text.trim().toLowerCase()));
        const fresh = items.filter(i => !have.has(i.text.toLowerCase())).map(i => ({ id: uid(), text: i.text, done: false, time: i.time, note: i.note, from: 'coach' as const, must: i.priority !== undefined }));
        return syncPriorities({ ...d, todos: [...keep, ...fresh] });
      });
    } catch (e) {
      say(e instanceof Error ? e.message : "Couldn't reach Coach Claude — build the list by hand", 'bad');
    } finally { setDrafting(false); }
  };
  useEffect(() => { if (last && !loading && day.todos.length === 0) void draft(); }, [last, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    set(d => ({ ...d, brief: { ...d.brief, finishedAt: new Date().toISOString(), seconds: secs } }));
    void autoMark('brief', true);
    await flush();
    say(`Brief done in ${fmt(secs)}. ${day.todos.length ? `${day.todos.length} on the list.` : ''} Go get Kiaan.`, 'good');
    window.setTimeout(() => nav('/'), 700);
  };
  const skip = async () => { await flush(); nav('/'); };

  return (
    <main className="pl-page pl-page--bare brief pl-fade">
      <header className="brief__top">
        <button type="button" className="pl-btn pl-btn--ghost" style={{ border: 0, padding: '0 6px', minHeight: 40, marginLeft: -8 }} aria-label="Back" onClick={() => (step > 0 ? setStep(s => s - 1) : nav('/'))}><ChevronLeft /></button>
        <div className="brief__dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => <span key={i} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} />)}
        </div>
        <span className={`brief__clock ${left <= 120 ? 'is-amber' : ''} ${left < 0 ? 'is-over' : ''}`} title="Brief budget">{left < 0 ? '+' : ''}{fmt(left)}</span>
      </header>

      <section className="brief__body pl-fade" key={step}>
        <p className="pl-eyebrow">{routine.profile === 'morning' ? 'Morning Brief' : 'Bed Brief'} · {step + 1} of {STEPS.length}</p>
        <h1 className="brief__q">{STEPS[step].title}</h1>
        {STEPS[step].hint && <p className="pl-muted">{STEPS[step].hint}</p>}
        {loadError && <p className="pl-error" style={{ fontSize: 13 }}>Couldn't load this day — check the connection. Nothing typed is saved until it loads.</p>}
        {loading ? <p className="pl-muted">Loading…</p> : STEPS[step].render(day, set, focus, { frequent, coachMust: hints?.priorities || [] })}
        {last && !loading && (drafting
          ? <p className="pl-muted" style={{ fontSize: 13, marginTop: 8, fontStyle: 'italic' }}><Sparkles size={12} aria-hidden /> Coach Claude is drafting the list from your answers…</p>
          : <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" style={{ marginTop: 8 }} onClick={() => void draft(true)}><Sparkles size={14} /> Redraft with Coach Claude</button>)}
        {!loading && STEPS[step].hints && (
          hints
            ? (() => { const hs = STEPS[step].hints!(hints, day, set); return hs.length ? (
                <div className="brief__hints">
                  <p className="pl-muted" style={{ fontSize: 12, margin: '0 0 4px' }}><Sparkles size={12} aria-hidden /> Coach Claude suggests — tap to use{step === 0 && hints.noticed ? ` · ${hints.noticed}` : ''}</p>
                  <div className="brief__chips">{hs.map(x => <button key={x.label} type="button" onClick={x.apply}>{x.label}</button>)}</div>
                </div>) : null; })()
            : knows === false && step === 0
              ? <p className="pl-muted" style={{ fontSize: 12, marginTop: 10 }}><Sparkles size={12} aria-hidden /> Coach Claude will start suggesting here once it's seen a few of your days.</p>
              : null
        )}
      </section>

      <footer className="brief__foot">
        <button type="button" className="pl-btn pl-btn--ghost" style={{ border: 0 }} onClick={skip}>Skip</button>
        {last
          ? <Button primary onClick={finish}><Check /> Done</Button>
          : <Button primary onClick={() => setStep(s => s + 1)}>Next <ChevronRight /></Button>}
      </footer>
      {toast}
    </main>
  );
}
