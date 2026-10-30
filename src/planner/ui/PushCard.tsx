// src/planner/ui/PushCard.tsx — Settings card: turn routine reminders on or off on this phone.
import { useEffect, useState } from 'react';
import { Bell, BellOff, Smartphone } from 'lucide-react';
import { Card, Button } from './primitives';
import { disablePush, enablePush, pushState, sendTest, type PushState } from '../lib/push';
import { clock, hhmm, minutesOf, routineNow } from '../lib/routine';

export function PushCard() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const r = routineNow();

  const refresh = () => { void pushState().then(setState); };
  useEffect(refresh, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Something went wrong', bad: true }); }
    finally { setBusy(false); refresh(); }
  };

  const reminders = [
    { at: r.wake, what: 'Bed Brief' },
    { at: hhmm(minutesOf(r.eatOpen) - 15), what: `Eating window opens at ${clock(r.eatOpen)}` },
    { at: hhmm(minutesOf(r.gym) - 20), what: `Gym at ${clock(r.gym)}` },
    { at: r.shake, what: 'Shake, then Miracle Night' },
    { at: hhmm(minutesOf(r.lightsOut) - 15), what: 'Lights out in 15' },
  ];

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
        {state === 'on' && <Button ghost disabled={busy} onClick={() => void run(async () => { const r = await sendTest(); if (!r.sent) throw new Error('Nothing was delivered — try turning them off and on again.'); }, 'Test sent.')}>Send a test</Button>}
      </div>
      {msg && <p className={msg.bad ? 'pl-error' : 'pl-muted'} style={{ fontSize: 13 }}>{msg.text}</p>}

      <div>
        <p className="pl-eyebrow" style={{ marginBottom: 6 }}>What you'll get</p>
        <div className="pl-list">
          {reminders.map(x => (
            <div key={x.what} className="pl-item" style={{ padding: '8px 0' }}>
              <span className="pl-num" style={{ minWidth: 72, fontWeight: 600 }}>{clock(x.at)}</span>
              <span className="pl-muted">{x.what}</span>
            </div>
          ))}
        </div>
        <p className="pl-muted" style={{ fontSize: 12, marginTop: 6 }}>Times follow your routine. A reminder is skipped once that step is ticked off.</p>
      </div>
    </Card>
  );
}
