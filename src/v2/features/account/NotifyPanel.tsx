// src/v2/features/account/NotifyPanel.tsx — Settings › Notifications, for staff (My account › Notifications) and for
// MainstreetAI reps (the rep app's Settings). This device on or off, a test, then every kind of notification the
// person's permissions allow, in groups: on or off, about whom (mine / my team / the whole center) and, for "nothing
// entered", how long. Quiet hours last. Each change saves at once; the list itself comes from the database.
import React, { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2, Moon, Send, Share } from 'lucide-react';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { clock, grouped, MINUTES, notifyGet, notifyQuietSet, notifySet, notifyTest, SCOPE_LABEL, type NotifyEvent, type NotifySettings, type Scope } from '../../lib/notify';
import { ErrorBox, Loading, Toggle } from '../../ui';

const Device: React.FC<{ devices: number; onOn: () => void }> = ({ devices, onOn }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  const on = async () => {
    setBusy(true); setNote(null);
    try { await enablePush(); setState('on'); onOn(); } catch (e) { setNote(e instanceof Error ? e.message : 'Couldn’t turn them on'); setState(await pushState().catch(() => 'off' as PushState)); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setNote(null);
    try { const r = await notifyTest(); setNote(r.ok ? `Sent to ${r.devices === 1 ? 'your device' : `your ${r.devices} devices`}. It should arrive in a few seconds.` : 'No device has notifications on yet.'); }
    catch (e) { setNote(e instanceof Error ? e.message : 'Couldn’t send it'); } finally { setBusy(false); }
  };
  if (!state) return null;
  const Icon = state === 'on' ? BellRing : state === 'denied' ? BellOff : Bell;
  return (
    <section className="v2-nt-card v2-nt-device">
      <span className={`v2-nt-ic${state === 'on' ? ' on' : ''}`}><Icon size={18} /></span>
      <div className="v2-nt-dt">
        {state === 'on' && <><b>On for this device</b><span>{devices > 1 ? `${devices} devices get your notifications.` : 'This device gets your notifications.'}</span></>}
        {state === 'off' && <><b>Off on this device</b><span>Turn them on to get the ones below, even with the app closed.</span></>}
        {state === 'denied' && <><b>Blocked on this device</b><span>Allow notifications for this site in the browser’s settings, then reload.</span></>}
        {state === 'ios-install' && <><b>Add the app to your Home Screen first</b><span>Tap <Share size={12} style={{ verticalAlign: -2 }} /> Share, then “Add to Home Screen”, and open it from there.</span></>}
        {state === 'unsupported' && <><b>This browser can’t show notifications</b><span>{devices ? `Your other ${devices === 1 ? 'device gets them' : `${devices} devices get them`}.` : 'Open the app on your phone to turn them on.'}</span></>}
        {note && <span className="v2-nt-note" role="status">{note}</span>}
      </div>
      {state === 'off' && <button type="button" className="v2-btn" onClick={() => void on()} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : 'Turn on'}</button>}
      {(state === 'on' || devices > 0) && <button type="button" className="v2-btn o" onClick={() => void test()} disabled={busy}><Send size={14} />Send a test</button>}
    </section>
  );
};

const Row: React.FC<{ e: NotifyEvent; busy: boolean; onChange: (next: Partial<NotifyEvent>) => void }> = ({ e, busy, onChange }) => (
  <div className={`v2-nt-row${e.on ? '' : ' off'}`}>
    <div className="v2-nt-rt">
      <b>{e.label}</b>
      {e.help && <span>{e.help}</span>}
      {e.on && e.scopes.length > 1 && (
        <div className="v2-nt-seg" role="radiogroup" aria-label={`${e.label}: about whom`}>
          {e.scopes.map(s => (
            <button key={s} type="button" role="radio" aria-checked={e.scope === s} className={e.scope === s ? 'on' : ''} disabled={busy}
              onClick={() => onChange({ scope: s })}>{SCOPE_LABEL[s]}</button>))}
        </div>
      )}
      {e.on && e.minutes != null && (
        <div className="v2-nt-seg" role="radiogroup" aria-label={`${e.label}: after how long`}>
          {MINUTES.map(m => (
            <button key={m} type="button" role="radio" aria-checked={e.minutes === m} className={e.minutes === m ? 'on' : ''} disabled={busy}
              onClick={() => onChange({ minutes: m })}>{m < 60 ? `${m} min` : m === 60 ? '1 hr' : `${m / 60} hr`}</button>))}
        </div>
      )}
    </div>
    <Toggle on={e.on} disabled={busy} label={e.label} onChange={v => onChange({ on: v })} />
  </div>
);

const Quiet: React.FC<{ s: NotifySettings; onSave: (q: NotifySettings['quiet']) => void; busy: boolean }> = ({ s, onSave, busy }) => {
  const q = s.quiet;
  return (
    <section className="v2-nt-card">
      <div className="v2-nt-row">
        <div className="v2-nt-rt"><b><Moon size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Quiet hours</b>
          <span>{q.on ? `Nothing from ${clock(q.from)} to ${clock(q.to)}. What happens then isn’t sent later.` : 'Notifications any time.'}</span></div>
        <Toggle on={q.on} disabled={busy} label="Quiet hours" onChange={v => onSave({ ...q, on: v })} />
      </div>
      {q.on && (
        <div className="v2-nt-times">
          <label>From <input type="time" className="v2-input" value={q.from} disabled={busy} onChange={e => e.target.value && onSave({ ...q, from: e.target.value })} /></label>
          <label>To <input type="time" className="v2-input" value={q.to} disabled={busy} onChange={e => e.target.value && onSave({ ...q, to: e.target.value })} /></label>
        </div>
      )}
    </section>
  );
};

export const NotifyPanel: React.FC = () => {
  const [s, setS] = useState<NotifySettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = () => notifyGet().then(setS).catch(setError);
  useEffect(() => { void load(); }, []);
  if (!s) return error ? <ErrorBox error={error} /> : <Loading label="Loading your notifications…" />;

  const change = async (e: NotifyEvent, next: Partial<NotifyEvent>) => {
    const before = s;
    setS({ ...s, events: s.events.map(x => x.key === e.key ? { ...x, ...next } : x) }); setBusy(true); setError(null);
    try { await notifySet(e.key, next.on ?? null, next.scope as Scope | undefined, next.minutes ?? null); }
    catch (err) { setS(before); setError(err); } finally { setBusy(false); }
  };
  const quiet = async (q: NotifySettings['quiet']) => {
    const before = s;
    setS({ ...s, quiet: q }); setBusy(true); setError(null);
    try { await notifyQuietSet(q); } catch (err) { setS(before); setError(err); } finally { setBusy(false); }
  };
  return (
    <div className="v2-nt">
      <Device devices={s.devices} onOn={() => void load()} />
      <ErrorBox error={error} />
      {grouped(s.events).map(g => (
        <section key={g.group} className="v2-nt-card">
          <h2 className="v2-nt-h">{g.label}</h2>
          {g.events.map(e => <Row key={e.key} e={e} busy={busy} onChange={next => void change(e, next)} />)}
        </section>
      ))}
      <Quiet s={s} onSave={q => void quiet(q)} busy={busy} />
      <p className="v2-nt-foot">You’re never told about a change you made yourself. Several of the same kind at once come as one notification.</p>
    </div>
  );
};

/** My account › Notifications. */
export const NotificationsPage: React.FC = () => (
  <div className="v2-main v2-narrow" style={{ maxWidth: 760 }}>
    <div className="v2-head"><span className="v2-h1">Notifications</span></div>
    <NotifyPanel />
  </div>
);
