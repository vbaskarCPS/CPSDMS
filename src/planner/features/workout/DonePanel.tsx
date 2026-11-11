// src/planner/features/workout/DonePanel.tsx — the Train hero after today's session is completed, until the
// day rolls over: Arvy's review (a paragraph or two), two questions with choices, and tomorrow's
// session, which one tap saves as a one-off template planned for tomorrow. Cached in doc kind 'dayplan'.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, CalendarCheck, Play } from 'lucide-react';
import { dayPlan, type DayPlan } from '../../lib/ai';
import { dayKey, getDoc, putDoc } from '../../lib/docs';
import { Button, Card } from '../../ui/primitives';
import { COACH_ASKS, openArvy } from '../arvy/arvy';
import { blocksOf, blockTitle, targetLine } from './format';
import { LIBRARY, findExercise } from './library';
import { saveCustomExercise, saveTemplate, saveWorkout, startFromTemplate, templateFromPlan } from './store';
import { durationMin, fmtSec, workoutKey, type Exercise, type Template, type TemplateExercise, type Units, type Workout } from './types';

const tomorrowKey = () => { const d = new Date(); d.setDate(d.getDate() + 1); return dayKey(d); };

export function DonePanel({ done, units, custom, templates, workouts, onTemplate }: { done: Workout; units: Units; custom: Exercise[]; templates: Template[]; workouts: Workout[]; onTemplate: (t: Template) => void }) {
  const nav = useNavigate();
  const today = dayKey();
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [busy, setBusy] = useState<'load' | 'answer' | 'save' | null>('load');
  const [err, setErr] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const planned = templates.find(t => t.plannedFor === tomorrowKey() && !t.archived);
  const library = [...custom, ...LIBRARY].map(e => ({ id: e.id, name: e.name }));

  const make = async (a?: Record<string, string>) => {
    setErr(null); setBusy(a ? 'answer' : 'load');
    try {
      const p = await dayPlan(library, units, a);
      // keep the questions already answered so they stay visible with the answers
      const merged: DayPlan = a && plan ? { ...p, questions: plan.questions, answers: a } : p;
      setPlan(merged); await putDoc('dayplan', today, merged);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach Arvy"); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    let on = true;
    getDoc<DayPlan>('dayplan', today).then(d => { if (!on) return; if (d?.review) { setPlan(d); setAnswers(d.answers || {}); setBusy(null); } else void make(); }).catch(() => { if (on) void make(); });
    return () => { on = false; };
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (id: string, choice: string) => {
    const next = { ...answers, [id]: choice };
    setAnswers(next);
    if (plan && plan.questions.every(q => next[q.id])) void make(next);
  };

  const saveTomorrow = async () => {
    if (!plan) return;
    setBusy('save');
    try {
      const { template, created } = templateFromPlan(plan.tomorrow, units, custom);
      for (const e of created) await saveCustomExercise(e);
      const t: Template = { ...template, name: plan.tomorrow.name, plannedFor: tomorrowKey(), focus: plan.tomorrow.focus, minutes: plan.tomorrow.minutes, order: -1, ...(planned ? { id: planned.id } : {}) };
      await saveTemplate(t); onTemplate(t);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(null); }
  };
  const startPlanned = async () => {
    if (!planned) return;
    const w = startFromTemplate(planned, workouts, units, custom);
    await saveWorkout(w); nav(`/workout/live/${w.id}`, { state: { key: workoutKey(w) } });
  };

  const t = plan?.tomorrow;
  // a session already set up for tomorrow that isn't this suggestion (made later in the Coach chat, or picked by hand)
  // is what tomorrow is: show it, and keep this panel's earlier idea one tap away instead of on top
  const other = planned && (!t || planned.name !== t.name) ? planned : null;
  const [showIdea, setShowIdea] = useState(false);
  // Arvy's idea as the session it would become, so both lists below read the same way (blocks, shaped sets, per side)
  const idea = useMemo(() => (t && t.exercises.length ? templateFromPlan(t, units, custom) : null), [t, units, custom]);
  /** A session as the Train page lists it: a superset, circuit, EMOM or AMRAP under its name; a pyramid, countdown
   *  or intervals spelled out; "per side" where it's logged left and right. */
  const sessionList = (exs: TemplateExercise[], made: Exercise[] = []) => (
    <div className="wo-hero__list">
      {blocksOf(exs).map((b, bi) => (
        <div key={bi} style={{ display: 'contents' }}>
          {b.kind !== 'single' && <div className="wo-hero__fmt">{blockTitle(b, exs)}</div>}
          {b.at.map(i => {
            const e = exs[i]; const lib = made.find(x => x.id === e.exerciseId) || findExercise(e.exerciseId, custom);
            const clocked = b.kind === 'emom' || b.kind === 'amrap';
            const w = e.weightBySet?.length ? e.weightBySet : null;
            const load = clocked || e.mode === 'time' ? '' : w ? ` · ${w[0] === w[w.length - 1] ? w[0] : `${w[0]}→${w[w.length - 1]}`}\u00a0${units}` : !e.style && e.startWeight ? ` @ ${e.startWeight}\u00a0${units}` : '';
            return <div className={`wo-hero__row${b.kind !== 'single' ? ' wo-hero__row--in' : ''}`} key={i}><span>{e.name} — {clocked ? (e.mode === 'time' ? fmtSec(e.targetSec || 30) : `${e.targetReps} reps`) : targetLine(e, lib)}{load}</span></div>;
          })}
        </div>
      ))}
    </div>
  );

  return (
    <Card accent>
      <p className="pl-eyebrow">Done for today · {done.name} · {durationMin(done)} min{done.prs?.length ? ` · ${done.prs.length} PR` : ''}</p>
      <h2 style={{ marginBottom: 6 }}><Sparkles size={18} aria-hidden style={{ verticalAlign: -3 }} /> Arvy</h2>
      {busy === 'load' && !plan && <p style={{ opacity: .8, fontStyle: 'italic' }}>Reading today's sets and notes…</p>}
      {err && <p className="pl-error">{err} <button type="button" className="pl-link" onClick={() => void make(plan?.answers)}>Try again</button></p>}
      {plan && (
        <>
          {plan.review.split(/\n{2,}/).map((p, i) => <p key={i} style={{ fontSize: 15, lineHeight: 1.45, margin: '0 0 10px' }}>{p}</p>)}

          {plan.questions.length > 0 && (
            <div className="wo-qa">
              {plan.questions.map(q => (
                <div key={q.id} className="wo-qa__q">
                  <b>{q.text}</b>
                  <div className="wo-qa__choices">
                    {q.choices.map(c => <button key={c} type="button" className={answers[q.id] === c ? 'is-on' : ''} disabled={busy === 'answer'} onClick={() => answer(q.id, c)}>{c}</button>)}
                  </div>
                </div>
              ))}
              {busy === 'answer' && <p style={{ fontSize: 13, opacity: .8, fontStyle: 'italic', margin: 0 }}>Reworking tomorrow with your answers…</p>}
            </div>
          )}

          {other && (
            <div className="wo-tomorrow">
              <p className="pl-eyebrow" style={{ marginBottom: 2 }}>Tomorrow{other.focus ? ` · ${other.focus}` : ''}{other.minutes ? ` · ~${other.minutes} min` : ''}</p>
              <b style={{ fontSize: 16 }}>{other.name}</b>
              <p style={{ fontSize: 13, margin: '2px 0 6px', opacity: .85 }}><CalendarCheck size={14} aria-hidden style={{ verticalAlign: -2 }} /> Set up for tomorrow. It'll be waiting on this page.</p>
              {sessionList(other.exercises)}
              <div className="pl-row" style={{ gap: 8, marginTop: 8 }}>
                <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} onClick={startPlanned}><Play size={14} /> Start it now</Button>
                {t && t.exercises.length > 0 && <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} onClick={() => setShowIdea(v => !v)}>{showIdea ? 'Hide' : 'See'} this morning's idea</Button>}
              </div>
            </div>
          )}

          {t && t.exercises.length > 0 && (!other || showIdea) && (
            <div className="wo-tomorrow">
              <p className="pl-eyebrow" style={{ marginBottom: 2 }}>{other ? 'Earlier idea' : 'Tomorrow'} · {t.focus} · ~{t.minutes} min</p>
              <b style={{ fontSize: 16 }}>{t.name}</b>
              <p style={{ fontSize: 13, margin: '2px 0 6px', opacity: .85 }}>{t.why}</p>
              {idea && sessionList(idea.template.exercises, idea.created)}
              {other
                ? <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)', marginTop: 8 }} disabled={busy === 'save'} onClick={saveTomorrow}>Use this instead of “{other.name}”</Button>
                : planned
                ? <>
                    <p style={{ fontSize: 13, margin: '8px 0 6px' }}><CalendarCheck size={14} aria-hidden style={{ verticalAlign: -2 }} /> Set up for tomorrow as “{planned.name}”. It'll be waiting on this page.</p>
                    <div className="pl-row" style={{ gap: 8 }}>
                      <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} disabled={busy === 'save'} onClick={saveTomorrow}>Replace with this</Button>
                      <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} onClick={startPlanned}><Play size={14} /> Start it now</Button>
                    </div>
                  </>
                : <Button block style={{ background: 'var(--accent-ink)', color: 'var(--accent)', border: 0, marginTop: 8 }} disabled={busy === 'save'} onClick={saveTomorrow}><CalendarCheck size={18} /> {busy === 'save' ? 'Saving…' : 'Set this up for tomorrow'}</Button>}
            </div>
          )}
          <div className="pl-row" style={{ gap: 8, marginTop: 10 }}>
            <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} onClick={() => nav(`/workout/live/${done.id}`, { state: { key: workoutKey(done) } })}>Today's session</Button>
            <Button small ghost style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} onClick={() => openArvy({ suggest: COACH_ASKS })}>Ask Arvy</Button>
          </div>
        </>
      )}
    </Card>
  );
}
