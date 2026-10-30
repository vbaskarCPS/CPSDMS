// src/planner/features/workout/Coach.tsx — /workout/coach: chat with the coach, who sees the last 4 weeks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, RotateCcw } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { coach, type ChatMessage } from '../../lib/ai';
import { getDoc, putDoc, dayKey } from '../../lib/docs';
import { Page, Header, Button, Chip } from '../../ui/primitives';
import { daysAgo, loadBodyWeights, loadTemplates, loadWorkouts } from './store';
import { e1rm, type CoachChat, type Template, type Workout } from './types';
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

  useEffect(() => {
    void getDoc<CoachChat>('coachchat', 'current').then(d => setMsgs(d?.messages || []));
    void Promise.all([loadWorkouts(daysAgo(28)), loadTemplates(), loadBodyWeights(daysAgo(90))]).then(([workouts, templates, weights]) => setCtx({ workouts, templates, weights }));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  const context = useMemo(() => ctx && ({
    today: dayKey(), units, weekday: new Date().toLocaleDateString([], { weekday: 'long' }),
    templates: ctx.templates.filter(t => !t.archived).map(t => ({ name: t.name, days: t.days, exercises: t.exercises.map(e => `${e.name} ${e.targetSets}x${e.targetReps}`) })),
    last4weeks: condense(ctx.workouts),
    bodyWeight: ctx.weights.slice(-10),
  }), [ctx, units]);

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
        {msgs.map((m, i) => <div key={i} className={`pl-bubble ${m.role === 'user' ? 'pl-bubble--me' : 'pl-bubble--coach'}`}>{m.content}</div>)}
        {busy && <div className="pl-bubble pl-bubble--coach"><span className="wo-typing"><span /><span /><span /></span></div>}
        {err && <p className="pl-error">{err}</p>}
        {msgs.length > 0 && !busy && <div className="pl-chips">{PROMPTS.slice(0, 2).map(p => <Chip key={p} onClick={() => void send(p)}>{p}</Chip>)}</div>}
        <div ref={end} />
      </div>
      <form className="wo-chat__bar" onSubmit={e => { e.preventDefault(); void send(text); }}>
        <input className="pl-input" placeholder="Ask your coach…" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
        <Button primary type="submit" aria-label="Send" disabled={busy || !text.trim()}><Send size={18} /></Button>
      </form>
    </Page>
  );
}
