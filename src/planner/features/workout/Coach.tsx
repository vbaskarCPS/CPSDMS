// src/planner/features/workout/Coach.tsx — /workout/coach: chat with the coach, who sees the last 4 weeks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, RotateCcw, ListPlus, Play } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { coach, type ChatMessage } from '../../lib/ai';
import { getDoc, putDoc, dayKey } from '../../lib/docs';
import { loadRoutine, routineNow, type Routine } from '../../lib/routine';
import { Page, Header, Button, Chip, Sheet, Field, Input, useToast } from '../../ui/primitives';
import { daysAgo, loadBodyWeights, loadCustomExercises, loadTemplates, loadWorkouts, planFromCoach, saveCustomExercise, saveTemplate, saveWorkout, startFromTemplate } from './store';
import { e1rm, fmtSec, type CoachChat, type Exercise, type Template, type Workout } from './types';
import { useUnits } from './WorkoutHome';

const PROMPTS = ['Plan my next session', "I'm sore — adjust today", 'Why am I stuck on bench?', 'Write me a 4-week plan'];

function condense(ws: Workout[]) {
  return ws.filter(w => w.endedAt).slice(0, 20).map(w => ({
    date: w.date, name: w.name, notes: w.notes || undefined,
    exercises: w.exercises.map(e => { const d = e.sets.filter(s => s.done); const top = d.reduce<typeof d[0] | null>((a, b) => (!a || e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a), null); return { name: e.name, sets: d.length, top: top ? `${top.weight}x${top.reps}${top.rpe ? `@${top.rpe}` : ''}` : null }; }),
  }));
}

export function Coach({ pass }: { pass: PlannerPass }) {
  const units = useUnits(pass);
  const [msgs, setMsgs] = useState<CoachChat['messages']>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ workouts: Workout[]; templates: Template[]; weights: { date: string; weight: number }[] } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const [toast, say] = useToast();
  const [custom, setCustom] = useState<Exercise[]>([]);
  const [parsing, setParsing] = useState<number | null>(null);
  const [plan, setPlan] = useState<{ template: Template; created: Exercise[]; replace: string } | null>(null);
  useEffect(() => { void loadCustomExercises().then(setCustom); }, []);

  const parse = async (i: number) => {
    const m = msgs[i]; if (!m || parsing !== null) return null;
    setParsing(i);
    try { return await planFromCoach(m.content, units, custom); }
    catch (e) { say(e instanceof Error ? e.message : "Couldn't read that plan", 'bad'); return null; }
    finally { setParsing(null); }
  };
  const addToPlan = async (i: number) => { const r = await parse(i); if (r) setPlan({ ...r, replace: '' }); };
  const startNow = async (i: number) => {
    const r = await parse(i); if (!r) return;
    try {
      for (const e of r.created) await saveCustomExercise(e);
      const w = startFromTemplate({ ...r.template, id: '' }, ctx?.workouts || [], units, [...custom, ...r.created]);
      delete w.templateId;
      await saveWorkout(w); nav(`/workout/live/${w.id}`);
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't start", 'bad'); }
  };
  const savePlan = async () => {
    if (!plan) return;
    try {
      for (const e of plan.created) await saveCustomExercise(e);
      const existing = ctx?.templates.find(t => t.id === plan.replace);
      const t: Template = existing ? { ...existing, name: plan.template.name, exercises: plan.template.exercises } : { ...plan.template, order: (ctx?.templates.length || 0) };
      await saveTemplate(t);
      setCtx(c => c && ({ ...c, templates: existing ? c.templates.map(x => (x.id === t.id ? t : x)) : [...c.templates, t] }));
      setCustom(c => [...c, ...plan.created]); setPlan(null); say(existing ? `Updated "${t.name}"` : `Saved "${t.name}"`, 'good');
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't save", 'bad'); }
  };

  const [routine, setRoutine] = useState<Routine>(() => routineNow());
  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  useEffect(() => {
    void getDoc<CoachChat>('coachchat', 'current').then(d => setMsgs(d?.messages || []));
    void Promise.all([loadWorkouts(daysAgo(28)), loadTemplates(), loadBodyWeights(daysAgo(90))]).then(([workouts, templates, weights]) => setCtx({ workouts, templates, weights }));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  const context = useMemo(() => ctx && ({
    today: dayKey(), units, weekday: new Date().toLocaleDateString([], { weekday: 'long' }),
    routine: { gym: routine.gym, eatOpen: routine.eatOpen, shake: routine.shake, lightsOut: routine.lightsOut, pattern: 'fasts until dinner, trains at night, sleeps ~1 am–8:30 am' },
    templates: ctx.templates.filter(t => !t.archived).map(t => ({ name: t.name, days: t.days, exercises: t.exercises.map(e => `${e.name} ${e.targetSets}x${e.targetReps}`) })),
    last4weeks: condense(ctx.workouts),
    bodyWeight: ctx.weights.slice(-10),
  }), [ctx, units, routine]);

  const send = async (t: string) => {
    const content = t.trim();
    if (!content || busy) return;
    setErr(null); setText('');
    const next = [...msgs, { role: 'user' as const, content, at: new Date().toISOString() }];
    setMsgs(next); setBusy(true);
    try {
      const reply = await coach(next.slice(-20).map(m => ({ role: m.role, content: m.content }) as ChatMessage), context);
      const done = [...next, { role: 'assistant' as const, content: reply, at: new Date().toISOString() }].slice(-40);
      setMsgs(done); void putDoc('coachchat', 'current', { messages: done });
    } catch (e) { setErr(e instanceof Error ? e.message : 'The coach is unavailable right now.'); }
    finally { setBusy(false); }
  };
  const reset = () => { setMsgs([]); void putDoc('coachchat', 'current', { messages: [] }); };

  return (
    <Page>
      <Header back="/workout" eyebrow="Train" title="Coach" right={msgs.length > 0 && <Button small ghost onClick={reset}><RotateCcw size={14} /> New chat</Button>} />
      <div className="wo-chat">
        {!msgs.length && (
          <>
            <p className="pl-muted">Your coach can see your last four weeks of sessions, your plans and your body weight. Ask for a session, a fix, or a plan.</p>
            <div className="pl-chips">{PROMPTS.map(p => <Chip key={p} onClick={() => void send(p)}>{p}</Chip>)}</div>
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`pl-bubble ${m.role === 'user' ? 'pl-bubble--me' : 'pl-bubble--coach'}`}>{m.content}</div>
            {m.role === 'assistant' && /\d\s*[x×]\s*\d|sets?|reps?|min/i.test(m.content) && (
              <div className="wo-msgbtns">
                <Button small ghost disabled={parsing !== null} onClick={() => void addToPlan(i)}><ListPlus size={14} /> {parsing === i ? 'Reading…' : 'Add to my plan'}</Button>
                <Button small primary disabled={parsing !== null} onClick={() => void startNow(i)}><Play size={14} /> Start this now</Button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="pl-bubble pl-bubble--coach"><span className="wo-typing"><span /><span /><span /></span></div>}
        {err && <p className="pl-error">{err}</p>}
        {msgs.length > 0 && !busy && <div className="pl-chips">{PROMPTS.slice(0, 2).map(p => <Chip key={p} onClick={() => void send(p)}>{p}</Chip>)}</div>}
        <div ref={end} />
      </div>
      <Sheet open={!!plan} onClose={() => setPlan(null)} title="Add to my plan">
        {plan && (
          <>
            <Field label="Name"><Input value={plan.template.name} onChange={e => setPlan({ ...plan, template: { ...plan.template, name: e.target.value } })} /></Field>
            <Field label="Save as">
              <select className="pl-input" value={plan.replace} onChange={e => setPlan({ ...plan, replace: e.target.value })}>
                <option value="">New template</option>
                {(ctx?.templates || []).filter(t => !t.archived).map(t => <option key={t.id} value={t.id}>Replace: {t.name}</option>)}
              </select>
            </Field>
            <div>
              {plan.template.exercises.map((e, i) => (
                <div key={i} className="wo-plan-ex">
                  <div><b>{e.name}</b>{e.note && <small>{e.note}</small>}</div>
                  <div style={{ textAlign: 'right' }}>{e.mode === 'time' ? `${e.targetSets} × ${fmtSec(e.targetSec || 60)}` : `${e.targetSets} × ${e.targetReps}`}<small>rest {e.restSec}s</small></div>
                </div>
              ))}
              {plan.created.length > 0 && <p className="pl-muted" style={{ fontSize: 12, marginTop: 6 }}>New exercises: {plan.created.map(e => e.name).join(', ')}</p>}
            </div>
            <div className="pl-row"><Button ghost onClick={() => setPlan(null)}>Cancel</Button><Button primary className="pl-grow" onClick={() => void savePlan()} disabled={!plan.template.exercises.length}>Save</Button></div>
          </>
        )}
      </Sheet>
      {toast}
      <form className="wo-chat__bar" onSubmit={e => { e.preventDefault(); void send(text); }}>
        <input className="pl-input" placeholder="Ask your coach…" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
        <Button primary type="submit" aria-label="Send" disabled={busy || !text.trim()}><Send size={18} /></Button>
      </form>
    </Page>
  );
}
