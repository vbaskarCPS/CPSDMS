// src/planner/features/workout/parts.tsx — pieces shared by the workout screens: steppers, rest timer, exercise picker.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, Play, Pause } from 'lucide-react';
import { Button, Input, Sheet, uid } from '../../ui/primitives';
import { LIBRARY, MUSCLES, groupLabel, searchExercises } from './library';
import { saveCustomExercise } from './store';
import type { Exercise, Muscle, Equipment } from './types';

export function Stepper({ value, min = 0, onChange, suffix, disabled }: { value: number; step?: number; min?: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean }) {
  // a plain number box: tap, type, done (the ± buttons were cramped on a phone)
  const [txt, setTxt] = useState<string | null>(null);
  const commit = () => { if (txt !== null) { const n = parseFloat(txt); if (isFinite(n)) onChange(Math.max(min, n)); setTxt(null); } };
  return (
    <div className="wo-stepper">
      <input inputMode="decimal" disabled={disabled} value={txt ?? (suffix ? `${value}${suffix}` : String(value))}
        onFocus={e => { setTxt(String(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={e => setTxt(e.target.value.replace(/[^0-9.]/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

export function beep() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach(t => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    window.setTimeout(() => { void ctx.close(); }, 1200);
  } catch { /* no audio */ }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* no vibration */ }
}

/** Rest countdown. `endsAt` is an epoch ms; null hides it. */
export function RestTimer({ endsAt, total, onDone, onExtend, onSkip }: { endsAt: number | null; total: number; onDone: () => void; onExtend: () => void; onSkip: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef<number | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  useEffect(() => {
    if (!endsAt) { fired.current = null; return; }
    if (now >= endsAt && fired.current !== endsAt) { fired.current = endsAt; beep(); onDone(); }
  }, [now, endsAt, onDone]);
  if (!endsAt) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const pct = total > 0 ? Math.min(100, Math.round(((total - left) / total) * 100)) : 100;
  return (
    <div className="wo-rest" role="timer" aria-live="off">
      <div className="wo-rest__bar" style={{ width: `${pct}%` }} />
      <div className="wo-rest__time">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
      <div className="pl-grow" style={{ fontSize: 13, opacity: 0.85 }}>Rest</div>
      <button type="button" onClick={onExtend}>+30s</button>
      <button type="button" onClick={onSkip}>Skip</button>
    </div>
  );
}

export function ExercisePicker({ open, onClose, onPick, custom, onCustomAdded }: { open: boolean; onClose: () => void; onPick: (e: Exercise) => void; custom: Exercise[]; onCustomAdded?: (e: Exercise) => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<Muscle>('chest');
  const [equipment, setEquipment] = useState<Equipment>('dumbbell');
  const results = useMemo(() => searchExercises(q, custom), [q, custom]);
  const grouped = useMemo(() => {
    const g = new Map<string, Exercise[]>();
    for (const e of results) { const k = groupLabel(e); if (!g.has(k)) g.set(k, []); g.get(k)!.push(e); }
    return [...g.entries()];
  }, [results]);
  useEffect(() => { if (!open) { setQ(''); setAdding(false); } }, [open]);

  const addCustom = async () => {
    if (!name.trim()) return;
    const e: Exercise = { id: `custom-${uid()}`, name: name.trim(), muscles: [muscle], equipment, type: equipment === 'cardio' ? 'cardio' : 'strength', defaultStep: 5, custom: true, timed: equipment === 'cardio' };
    await saveCustomExercise(e);
    onCustomAdded?.(e); setName(''); setAdding(false); onPick(e);
  };

  return (
    <Sheet open={open} onClose={onClose} title={adding ? 'New exercise' : 'Add exercise'}>
      {adding ? (
        <div className="pl-stack">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} autoFocus />
          <select className="pl-input" value={muscle} onChange={e => setMuscle(e.target.value as Muscle)}>{MUSCLES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <select className="pl-input" value={equipment} onChange={e => setEquipment(e.target.value as Equipment)}>
            {(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'cardio'] as Equipment[]).map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <div className="pl-row"><Button ghost onClick={() => setAdding(false)}>Back</Button><Button primary className="pl-grow" onClick={() => void addCustom()} disabled={!name.trim()}>Add</Button></div>
        </div>
      ) : (
        <div className="wo-picker">
          <div className="pl-row"><Search size={18} style={{ color: 'var(--ink-2)' }} /><Input placeholder="Search exercises" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
          <div className="wo-picker__list">
            {grouped.map(([k, list]) => (
              <div key={k}>
                <div className="wo-picker__group">{k}</div>
                {list.map(e => <button key={e.id} type="button" className="wo-picker__item" onClick={() => onPick(e)}><span>{e.name}</span><small>{e.equipment}{e.custom ? ' · custom' : ''}</small></button>)}
              </div>
            ))}
            {!results.length && <p className="pl-muted" style={{ padding: 12 }}>Nothing matches "{q}".</p>}
          </div>
          <Button block onClick={() => { setAdding(true); setName(q); }}>+ Custom exercise{q ? ` "${q}"` : ''}</Button>
        </div>
      )}
    </Sheet>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec)) % 60).padStart(2, '0')}`;

/** A timed set: a big Start button that becomes a countdown. Finishing (or "Done early") reports the seconds spent. */
export function TimedSet({ target, done, onTarget, onDone, disabled }: { target: number; done: boolean; onTarget: (sec: number) => void; onDone: (seconds: number) => void; disabled?: boolean }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [pausedLeft, setPausedLeft] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState<string | null>(null);
  const total = useRef(target);
  const fired = useRef(false);
  useEffect(() => { if (!endsAt) return; const id = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(id); }, [endsAt]);
  const left = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : pausedLeft;
  useEffect(() => {
    if (endsAt && now >= endsAt && !fired.current) { fired.current = true; beep(); setEndsAt(null); setPausedLeft(null); onDone(total.current); }
  }, [now, endsAt, onDone]);
  const start = () => { fired.current = false; total.current = target; setEndsAt(Date.now() + target * 1000); setPausedLeft(null); };
  const pause = () => { if (endsAt) { setPausedLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))); setEndsAt(null); } };
  const resume = () => { if (pausedLeft !== null) { setEndsAt(Date.now() + pausedLeft * 1000); setPausedLeft(null); } };
  const extend = () => { total.current += 30; if (endsAt) setEndsAt(endsAt + 30000); else if (pausedLeft !== null) setPausedLeft(pausedLeft + 30); };
  const early = () => { const spent = total.current - (left ?? 0); setEndsAt(null); setPausedLeft(null); fired.current = true; onDone(Math.max(1, spent)); };
  const commitEdit = () => { if (editing !== null) { const m = editing.match(/^(\d+):(\d{1,2})$/); const sec = m ? Number(m[1]) * 60 + Number(m[2]) : Number(editing) * 60; if (isFinite(sec) && sec > 0) onTarget(Math.round(sec)); setEditing(null); } };

  if (done) return <div className="wo-timed is-done"><span className="wo-timed__time">{mmss(target)}</span><span className="pl-muted" style={{ fontSize: 13 }}>done</span></div>;
  const running = endsAt !== null || pausedLeft !== null;
  if (!running) {
    return (
      <div className="wo-timed">
        {editing !== null
          ? <input className="pl-input wo-timed__edit" autoFocus value={editing} inputMode="numeric" onChange={e => setEditing(e.target.value)} onBlur={commitEdit} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); }} />
          : <button type="button" className="wo-timed__time" onClick={() => !disabled && setEditing(mmss(target))} title="Tap to change">{mmss(target)}</button>}
        <button type="button" className="wo-timed__start" disabled={disabled} onClick={start}><Play size={18} /> Start</button>
      </div>
    );
  }
  return (
    <div className="wo-timed is-running">
      <span className="wo-timed__time">{mmss(left ?? 0)}</span>
      <div className="wo-timed__btns">
        {endsAt ? <button type="button" onClick={pause}><Pause size={16} /></button> : <button type="button" onClick={resume}><Play size={16} /></button>}
        <button type="button" onClick={extend}>+30s</button>
        <button type="button" onClick={early}>Done</button>
      </div>
    </div>
  );
}

export function CheckBig({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={`wo-check ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled}><Check /></button>;
}

export const LIB = LIBRARY;
