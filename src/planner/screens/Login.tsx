// src/planner/screens/Login.tsx — username + PIN. The pass is remembered on this device for a year.
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signIn } from '../lib/auth';

export function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState(() => { try { return localStorage.getItem('vijay-planner-username') || ''; } catch { return ''; } });
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const r = await signIn(username, pin);
    setBusy(false);
    if (r.ok) {
      try { localStorage.setItem('vijay-planner-username', username.trim()); } catch { /* fine */ }
      const from = (location.state as { from?: string } | null)?.from;
      nav(from && from !== '/login' ? from : '/', { replace: true });
      return;
    }
    setPin('');
    if (r.reason === 'locked') {
      const until = r.until ? new Date(r.until) : null;
      setError(until ? `Too many tries. Try again at ${until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'Too many tries. Wait 15 minutes.');
    } else if (r.reason === 'unavailable') setError("Can't reach the server right now.");
    else setError('Wrong username or PIN.');
  };

  return (
    <form className="pl-login pl-fade" onSubmit={submit}>
      <div className="pl-stack" style={{ gap: 14 }}>
        <img className="pl-logo" src="/vijayplanner/icon-192.png" alt="" />
        <div>
          <p className="pl-eyebrow">Vijay Planner</p>
          <h1>Own the morning.</h1>
        </div>
      </div>
      <div className="pl-stack">
        <label className="pl-field">
          <span className="pl-label">Username</span>
          <input className="pl-input" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={e => setUsername(e.target.value)} required />
        </label>
        <label className="pl-field">
          <span className="pl-label">PIN</span>
          <input className="pl-input pl-input--pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value)} required />
        </label>
        {error && <p className="pl-error" role="alert">{error}</p>}
        <button className="pl-btn pl-btn--primary pl-btn--block" disabled={busy || !username || !pin}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="pl-muted" style={{ fontSize: 13, textAlign: 'center' }}>You stay signed in on this device.</p>
      </div>
    </form>
  );
}
