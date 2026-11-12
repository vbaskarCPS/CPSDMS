// src/planner/ui/PushCard.tsx — Settings card: turn routine reminders on or off on this phone, and switch single
// reminders off for good (Routine.quiet: no notification, the block stays in the day).
import { useEffect, useState } from 'react';
import { Bell, BellOff, Smartphone } from 'lucide-react';
import { Card, Button } from './primitives';
import { checkPush, disablePush, enablePush, pushAdvice, pushState, type PushCheck, type PushState } from '../lib/push';
import { app, appBase, appId } from '../lib/app';
import { clock, hhmm, loadRoutine, minutesOf, onRoutineChange, routineNow, planAt, saveRoutine, type Routine } from '../lib/routine';
import { reminderList } from '../../../supabase/functions/planner-push/reminders';

/** The reminders a routine gives, as shown before turning them on (the sending is supabase/functions/planner-push). */
export function reminderTimes(r: Routine): { at: string; what: string }[] {
  return r.profile === 'morning' ? [
    { at: r.wake, what: r.stretchMin + r.meditateMin + r.workoutMin > 0 ? 'Miracle Morning, then the Brief' : 'Up, then the Brief' },
    { at: hhmm(minutesOf(r.lightsOut) - 30), what: 'Evening review, then bed' },
    { at: hhmm(minutesOf(r.lightsOut) - 10), what: 'Lights out' },
  ] : [
    { at: r.wake, what: 'Up — straight to the gym' },
    { at: planAt(r), what: "Sauna: yesterday's review, the protein road, today's Brief" },
    ...(r.kitchenClose ? [{ at: hhmm(minutesOf(r.kitchenClose) - 30), what: `Kitchen closes at ${clock(r.kitchenClose)} — protein still to go` }] : []),
    ...(r.fast ? [{ at: hhmm(minutesOf(r.eatOpen) - 15), what: `Eating window opens at ${clock(r.eatOpen)}` }] : []),
    { at: hhmm(minutesOf(r.lightsOut) - 15), what: `Lights out at ${clock(r.lightsOut)} — up at ${clock(r.wake)}` },
  ];
}

export function PushCard() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [check, setCheck] = useState<PushCheck | 'running' | null>(null);   // "Check notifications": where they stop
  const [r, setR] = useState<Routine>(routineNow());
  useEffect(() => { void loadRoutine().then(setR); return onRoutineChange(setR); }, []);
  const [quietErr, setQuietErr] = useState<string | null>(null);
  // one reminder on or off: saved straight away to the routine, put back if it didn't save
  const flip = async (id: string, on: boolean) => {
    setQuietErr(null);
    const was = r;
    const quiet = [...new Set((was.quiet || []).filter(q => q !== id).concat(on ? [] : [id]))];
    setR({ ...was, quiet });
    try { await saveRoutine({ ...(await loadRoutine()), quiet }); }
    catch (e) { setR(was); setQuietErr(e instanceof Error ? e.message : 'That didn’t save. Try again.'); }
  };
  const runCheck = async () => {
    setMsg(null); setCheck('running');
    try { setCheck(await checkPush(app().name, `${appBase()}/icon-192.png`)); }
    catch (e) { setCheck(null); setMsg({ text: e instanceof Error ? e.message : 'The check didn’t run.', bad: true }); }
  };
  const found = check && check !== 'running' ? pushAdvice(check) : null;

  const refresh = () => { void pushState().then(setState); };
  useEffect(refresh, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Something went wrong', bad: true }); }
    finally { setBusy(false); refresh(); }
  };

  const list = reminderList(r, appId());

  return (
    <Card className="pl-stack">
      <div className="pl-row">
        {state === 'on' ? <Bell style={{ color: 'var(--good)' }} aria-hidden /> : <BellOff className="pl-muted" aria-hidden />}
        <div className="pl-grow">
          <h3>Reminders</h3>
          <p className="pl-muted" style={{ fontSize: 13 }}>
            {state === 'loading' ? 'Checking…'
              : state === 'on' ? 'On for this phone.'
              : state === 'off' ? 'Off on this phone.'
              : state === 'denied' ? 'Blocked by the browser — allow notifications for this site in its settings.'
              : state === 'ios-install' ? 'On iPhone: add the planner to your Home Screen first, then turn these on.'
              : 'This browser can’t show notifications.'}
          </p>
        </div>
      </div>

      {state === 'ios-install' && (
        <p className="pl-row pl-muted" style={{ fontSize: 13, alignItems: 'flex-start' }}>
          <Smartphone style={{ width: 16, height: 16, flex: 'none', marginTop: 2 }} aria-hidden />
          <span>Safari → Share → <b>Add to Home Screen</b>, then open the planner from there.</span>
        </p>
      )}

      <div className="pl-row" style={{ flexWrap: 'wrap' }}>
        {state === 'off' && <Button primary disabled={busy} onClick={() => void run(enablePush, 'Reminders are on.')}>Turn on notifications</Button>}
        {state === 'on' && <Button disabled={busy} onClick={() => void run(disablePush, 'Reminders are off.')}>Turn off</Button>}
        {state === 'on' && <Button ghost disabled={busy || check === 'running'} onClick={() => void runCheck()}>{check === 'running' ? 'Checking…' : 'Check notifications'}</Button>}
      </div>
      {msg && <p className={msg.bad ? 'pl-error' : 'pl-muted'} style={{ fontSize: 13 }}>{msg.text}</p>}
      {check === 'running' && <p className="pl-muted" style={{ fontSize: 13 }}>Putting one up from this phone, then sending one from the server. This can take 20 seconds.</p>}
      {found && (
        <div className="pl-stack" style={{ gap: 6, fontSize: 14 }} role="status">
          {found.lines.map(l => <div key={l.text} className="pl-row" style={{ alignItems: 'flex-start', gap: 8 }}><b style={{ color: l.ok ? 'var(--good)' : l.ok === false ? 'var(--bad)' : 'var(--ink-2)', flex: 'none' }}>{l.ok ? '✓' : l.ok === false ? '✗' : '?'}</b><span>{l.text}</span></div>)}
          {found.todo && <p className={found.ok ? 'pl-muted' : ''} style={{ fontSize: 13.5, fontWeight: found.ok ? 400 : 600 }}>{found.todo}</p>}
        </div>
      )}

      <div>
        <p className="pl-eyebrow" style={{ marginBottom: 6 }}>Reminders</p>
        <div className="pl-list">
          {list.map(x => (
            <div key={x.id} className="pl-item rem-item">
              <span className="pl-grow" id={`rem-${x.id}`}><b>{x.name}</b><small className="pl-num">{clock(x.at)}</small></span>
              <button type="button" role="switch" aria-checked={x.on} aria-labelledby={`rem-${x.id}`} className="rem-switch" onClick={() => void flip(x.id, !x.on)} />
            </div>
          ))}
        </div>
        {quietErr && <p className="pl-error" style={{ fontSize: 13 }}>{quietErr}</p>}
        <p className="pl-muted" style={{ fontSize: 12, marginTop: 6 }}>Off = no notification. The block stays in your day. Times follow your routine, and a reminder is skipped once that step is ticked off.</p>
      </div>
    </Card>
  );
}
