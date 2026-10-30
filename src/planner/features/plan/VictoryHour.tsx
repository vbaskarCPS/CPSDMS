// src/planner/features/plan/VictoryHour.tsx — the 20/20/20 timer: Move, Reflect, Grow. Finishing a
// block ticks it on today's day page; the first start sets "woke at" if it's empty.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dumbbell, Brain, BookOpen, Play, Pause, SkipForward, RotateCcw, Check } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { Page, Header, Button, Card, Input } from '../../ui/primitives';
import { nowHM } from './dates';
import { defaultVictoryPrefs, emptyDay, normalizeDay, type Day, type VictoryPrefs } from './types';

type BlockKey = 'move' | 'reflect' | 'grow';
const BLOCKS: { key: BlockKey; label: string; Icon: typeof Dumbbell; blurb: string }[] = [
  { key: 'move', label: 'Move', Icon: Dumbbell, blurb: 'Sweat. Intense exercise flushes cortisol and floods the brain with BDNF, dopamine and serotonin.' },
  { key: 'reflect', label: 'Reflect', Icon: Brain, blurb: 'Silence and stillness. Meditate, say your affirmations, visualize the day going well, and write a page.' },
  { key: 'grow', label: 'Grow', Icon: BookOpen, blurb: 'Read, study or listen to something that makes you better at your craft or your life.' },
];

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach(t => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
    });
    window.setTimeout(() => { void ctx.close(); }, 1200);
  } catch { /* no audio */ }
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch { /* none */ }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function VictoryHour() {
  const today = dayKey();
  const { data: prefsRaw, update: updatePrefs } = useDoc<VictoryPrefs>('prefs', 'victory', defaultVictoryPrefs());
  const prefs = useMemo(() => ({ ...defaultVictoryPrefs(), ...prefsRaw }), [prefsRaw]);
  const { data: dayRaw, update: updateDay, flush } = useDoc<Day>('day', today, emptyDay(), 300);
  const day = useMemo(() => normalizeDay(dayRaw), [dayRaw]);

  const [idx, setIdx] = useState(0);                     // 0..2 current block, 3 = all done
  const [left, setLeft] = useState(prefs.move * 60);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const endAt = useRef<number | null>(null);
  const tick = useRef<number | undefined>(undefined);

  // a block's length follows the prefs until it's been started
  useEffect(() => { if (!started && idx < 3) setLeft(prefs[BLOCKS[idx].key] * 60); }, [prefs, idx, started]);

  const finishBlock = (completed: boolean) => {
    window.clearInterval(tick.current); endAt.current = null; setRunning(false);
    if (completed) { beep(); const k = BLOCKS[idx].key; updateDay(d => ({ ...normalizeDay(d), victory: { ...normalizeDay(d).victory, [k]: true } })); }
    const next = idx + 1;
    setIdx(next); setStarted(false);
    if (next < 3) setLeft(prefs[BLOCKS[next].key] * 60);
    else void flush();
  };

  const start = () => {
    if (idx >= 3) return;
    if (!day.victory.wokeAt) updateDay(d => ({ ...normalizeDay(d), victory: { ...normalizeDay(d).victory, wokeAt: nowHM() } }));
    setStarted(true); setRunning(true);
    endAt.current = Date.now() + left * 1000;
  };
  const pause = () => { window.clearInterval(tick.current); endAt.current = null; setRunning(false); };

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      const s = Math.max(0, Math.round(((endAt.current ?? Date.now()) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) finishBlock(true);
    }, 250);
    return () => window.clearInterval(tick.current);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the screen on while a block runs (where supported)
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    if (running && 'wakeLock' in navigator) (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen').then(l => { lock = l; }).catch(() => undefined);
    return () => { void lock?.release(); };
  }, [running]);

  const reset = () => { pause(); setIdx(0); setStarted(false); setLeft(prefs.move * 60); };
  const block = idx < 3 ? BLOCKS[idx] : null;
  const total = block ? prefs[block.key] * 60 : 1;

  return (
    <Page>
      <Header eyebrow="5 AM Club" title="Victory hour" back="/plan" />
      <Card className="plan-timer">
        <div className="plan-timer__steps" aria-hidden>
          {BLOCKS.map((b, i) => <span key={b.key} className={i < idx || day.victory[b.key] ? 'is-done' : i === idx ? 'is-now' : ''} />)}
        </div>
        {block ? (
          <>
            <div className="pl-row" style={{ gap: 8 }}><block.Icon aria-hidden style={{ color: 'var(--accent)' }} /><h2>{block.label}</h2><span className="pl-muted">· {idx + 1} of 3</span></div>
            <div className="pl-bigtimer" aria-live="polite">{fmt(left)}</div>
            <div className="pl-progress" style={{ width: '100%' }}><div className="pl-progress__bar" style={{ width: `${100 - Math.round((left / total) * 100)}%` }} /></div>
            <p className="plan-timer__do">{block.blurb}</p>
            <div className="plan-timer__ctrl">
              {running ? <Button onClick={pause}><Pause /> Pause</Button> : <Button primary onClick={start}><Play /> {started ? 'Resume' : 'Start'}</Button>}
              <Button ghost onClick={() => finishBlock(started)}><SkipForward /> {started ? 'Done, next' : 'Skip'}</Button>
            </div>
          </>
        ) : (
          <>
            <Check aria-hidden style={{ width: 48, height: 48, color: 'var(--good)' }} />
            <h2>Victory hour done.</h2>
            <p className="plan-timer__do">Own the morning, own the day. Your blocks are ticked on today's page.</p>
            <Button ghost onClick={reset}><RotateCcw /> Again</Button>
          </>
        )}
      </Card>

      {!started && idx === 0 && (
        <Card>
          <p className="pl-label" style={{ marginBottom: 8 }}>Minutes per block</p>
          <div className="plan-mins">
            {BLOCKS.map(b => (
              <label key={b.key} className="pl-field"><span className="pl-label">{b.label}</span>
                <Input type="number" inputMode="numeric" min={1} max={120} value={prefs[b.key]} onChange={e => { const n = Math.max(1, Math.min(120, Number(e.target.value) || 1)); updatePrefs(p => ({ ...defaultVictoryPrefs(), ...p, [b.key]: n })); }} /></label>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}
