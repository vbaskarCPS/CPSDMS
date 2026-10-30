// src/planner/screens/Settings.tsx — units, wake time, PIN, sign out.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { changePin, saveSettings, signOut, type PlannerPass } from '../lib/auth';

export function Settings({ pass }: { pass: PlannerPass }) {
  const s = pass.user.settings;
  const [units, setUnits] = useState<'lb' | 'kg'>(s.units === 'kg' ? 'kg' : 'lb');
  const [wake, setWake] = useState(s.wake_time || '05:00');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null); setSaved(false);
    try { await saveSettings({ ...s, units, wake_time: wake }); setSaved(true); }
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

      <form className="pl-card pl-stack" onSubmit={save}>
        <label className="pl-field">
          <span className="pl-label">Weights in</span>
          <select className="pl-input" value={units} onChange={e => setUnits(e.target.value as 'lb' | 'kg')}>
            <option value="lb">Pounds (lb)</option>
            <option value="kg">Kilograms (kg)</option>
          </select>
        </label>
        <label className="pl-field">
          <span className="pl-label">Wake target</span>
          <input className="pl-input" type="time" value={wake} onChange={e => setWake(e.target.value)} required />
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
