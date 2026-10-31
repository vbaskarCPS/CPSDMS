// src/planner/screens/Settings.tsx — my routine (the times the day runs on), units, PIN, sign out.
import { useEffect, useState, type FormEvent } from 'react';
import { loadRoutine, routineNow, saveRoutine, type Routine } from '../lib/routine';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { changePin, saveSettings, signOut, type PlannerPass } from '../lib/auth';
import { PushCard } from '../ui/PushCard';

export function Settings({ pass }: { pass: PlannerPass }) {
  const s = pass.user.settings;
  const [units, setUnits] = useState<'lb' | 'kg'>(s.units === 'kg' ? 'kg' : 'lb');
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [rSaving, setRSaving] = useState(false);
  const [rSaved, setRSaved] = useState(false);
  const [rErr, setRErr] = useState<string | null>(null);
  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  const morningP = routine.profile === 'morning';
  const r = <K extends keyof Routine>(k: K, v: Routine[K]) => { setRoutine(x => ({ ...x, [k]: v })); setRSaved(false); };
  const saveR = async (e: FormEvent) => {
    e.preventDefault();
    setRSaving(true); setRErr(null);
    try { await saveRoutine({ ...routine, profile: routineNow().profile }); setRSaved(true); }
    catch (x) { setRErr(x instanceof Error ? x.message : 'Could not save'); }
    finally { setRSaving(false); }
  };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null); setSaved(false);
    try { await saveSettings({ ...s, units }); setSaved(true); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  const doChangePin = async (e: FormEvent) => {
    e.preventDefault();
    setPinMsg(null);
    const r = await changePin(oldPin, newPin);
    setPinMsg(r === 'ok' ? 'PIN changed. Other devices are signed out.' : r === 'short' ? 'New PIN needs at least 4 digits.' : 'Current PIN is wrong.');
    if (r === 'ok') { setOldPin(''); setNewPin(''); }
  };

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 16 }}>
      <header className="pl-row">
        <Link to="/" className="pl-btn pl-btn--ghost" aria-label="Back" style={{ minHeight: 40, padding: '0 8px' }}><ChevronLeft /></Link>
        <h1>Settings</h1>
      </header>

      <form className="pl-card pl-stack" onSubmit={saveR}>
        <h3>My routine</h3>
        <p className="pl-muted" style={{ fontSize: 13 }}>{morningP
          ? 'The times the Today screen, reminders and the evening wind-down run on.'
          : 'The times the Today screen, reminders, the fast and Miracle Night run on. The planner\'s day rolls over at 4 am, so 1:00 am still counts as tonight.'}</p>
        <div className="pl-grid-2">
          <label className="pl-field"><span className="pl-label">{morningP ? 'Up' : 'Up with Kiaan'}</span><input className="pl-input" type="time" value={routine.wake} onChange={e => r('wake', e.target.value)} required /></label>
          <label className="pl-field"><span className="pl-label">Grace (min)</span><input className="pl-input" type="number" min={0} max={120} value={routine.wakeGrace} onChange={e => r('wakeGrace', Number(e.target.value) || 0)} /></label>
          {morningP && <>
            <label className="pl-field"><span className="pl-label">Stretch (min)</span><input className="pl-input" type="number" min={0} max={60} value={routine.stretchMin} onChange={e => r('stretchMin', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="pl-field"><span className="pl-label">Meditate (min)</span><input className="pl-input" type="number" min={0} max={60} value={routine.meditateMin} onChange={e => r('meditateMin', Math.max(0, Number(e.target.value) || 0))} /></label>
            <label className="pl-field"><span className="pl-label">Light workout (min)</span><input className="pl-input" type="number" min={0} max={90} value={routine.workoutMin} onChange={e => r('workoutMin', Math.max(0, Number(e.target.value) || 0))} /></label>
          </>}
          <label className="pl-field"><span className="pl-label">{morningP ? 'Morning Brief (min)' : 'Bed Brief (min)'}</span><input className="pl-input" type="number" min={1} max={60} value={routine.briefMinutes} onChange={e => r('briefMinutes', Math.max(1, Number(e.target.value) || 10))} /></label>
          {morningP && <label className="pl-field"><span className="pl-label">Kiaan up</span><input className="pl-input" type="time" value={routine.kiaanUp} onChange={e => r('kiaanUp', e.target.value)} required /></label>}
          <label className="pl-field"><span className="pl-label">Kiaan → daycare</span><input className="pl-input" type="time" value={routine.daycare} onChange={e => r('daycare', e.target.value)} required /></label>
          <label className="pl-field"><span className="pl-label">{routine.fast ? 'Dinner · fast ends' : 'Dinner'}</span><input className="pl-input" type="time" value={routine.eatOpen} onChange={e => r('eatOpen', e.target.value)} required /></label>
          {!morningP && <label className="pl-field"><span className="pl-label">Gym</span><input className="pl-input" type="time" value={routine.gym} onChange={e => r('gym', e.target.value)} required /></label>}
          {!morningP && <label className="pl-field"><span className="pl-label">Shake{routine.fast ? ' · window closes' : ''}</span><input className="pl-input" type="time" value={routine.shake} onChange={e => { r('shake', e.target.value); if (routine.fast) r('eatClose', e.target.value); }} required /></label>}
          {routine.fast && morningP && <label className="pl-field"><span className="pl-label">Window closes</span><input className="pl-input" type="time" value={routine.eatClose} onChange={e => r('eatClose', e.target.value)} required /></label>}
          {!morningP && <label className="pl-field"><span className="pl-label">Day review</span><input className="pl-input" type="time" value={routine.review} onChange={e => r('review', e.target.value)} required /></label>}
          {!morningP && <label className="pl-field"><span className="pl-label">Sauna after gym (min, 0 = none)</span><input className="pl-input" type="number" min={0} max={60} value={routine.saunaMin} onChange={e => r('saunaMin', Math.max(0, Number(e.target.value) || 0))} /></label>}
          {!morningP && <label className="pl-field"><span className="pl-label">Hard stop · teeth & bed</span><input className="pl-input" type="time" value={routine.windDown} onChange={e => r('windDown', e.target.value)} required /></label>}
          {morningP && <label className="pl-field"><span className="pl-label">Unwind cap (min, 0 = none)</span><input className="pl-input" type="number" min={0} max={240} value={routine.unwindCap} onChange={e => r('unwindCap', Math.max(0, Number(e.target.value) || 0))} /></label>}
          <label className="pl-field"><span className="pl-label">{morningP ? 'Bed with Kiaan' : 'Lights out'}</span><input className="pl-input" type="time" value={routine.lightsOut} onChange={e => r('lightsOut', e.target.value)} required /></label>
        </div>
        <label className="pl-row" style={{ gap: 10 }}>
          <input type="checkbox" checked={routine.fast} onChange={e => r('fast', e.target.checked)} style={{ width: 20, height: 20 }} />
          <span><b>Follow an eating window</b><br /><span className="pl-muted" style={{ fontSize: 13 }}>{routine.fast ? `Fast until ${routine.eatOpen}, last food ${routine.eatClose}. Off = plain calorie tracking.` : 'Off: plain calorie tracking, no fasting card or streak.'}</span></span>
        </label>
        {rErr && <p className="pl-error">{rErr}</p>}
        <button className="pl-btn pl-btn--primary" disabled={rSaving}>{rSaving ? 'Saving…' : rSaved ? 'Saved' : 'Save routine'}</button>
      </form>

      <PushCard />

      <form className="pl-card pl-stack" onSubmit={save}>
        <label className="pl-field">
          <span className="pl-label">Weights in</span>
          <select className="pl-input" value={units} onChange={e => setUnits(e.target.value as 'lb' | 'kg')}>
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </label>
        {err && <p className="pl-error">{err}</p>}
        <button className="pl-btn pl-btn--primary" disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</button>
      </form>

      <form className="pl-card pl-stack" onSubmit={doChangePin}>
        <h3>Change PIN</h3>
        <label className="pl-field"><span className="pl-label">Current PIN</span>
          <input className="pl-input pl-input--pin" type="password" inputMode="numeric" autoComplete="current-password" value={oldPin} onChange={e => setOldPin(e.target.value)} required /></label>
        <label className="pl-field"><span className="pl-label">New PIN</span>
          <input className="pl-input pl-input--pin" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={e => setNewPin(e.target.value)} required minLength={4} /></label>
        {pinMsg && <p className={pinMsg.startsWith('PIN changed') ? 'pl-muted' : 'pl-error'}>{pinMsg}</p>}
        <button className="pl-btn" disabled={!oldPin || !newPin}>Change PIN</button>
      </form>

      <button className="pl-btn pl-btn--block" onClick={() => void signOut()}>Sign out on this device</button>
      <p className="pl-muted" style={{ fontSize: 12, textAlign: 'center' }}>Signed in as {pass.user.username}</p>
    </main>
  );
}
