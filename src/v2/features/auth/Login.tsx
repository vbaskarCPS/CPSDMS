// src/v2/features/auth/Login.tsx — manager sign-in (username + password) and first-login password change.
import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Btn, Field, Loading } from '../../ui';

export const Login: React.FC = () => {
  const { session, profile, loading, signIn } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [tab, setTab] = useState<'manager' | 'worker'>('manager');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalized, setFinalized] = useState(false);

  if (session && profile) return <Navigate to={profile.must_change_password ? '/app/password' : (loc.state?.from || '/app')} replace />;

  /** The old app's accounts (workers, training, command-center and campaign logins, old RM accounts). */
  const tryLegacy = async (u: string, p: string, workersOnly: boolean): Promise<boolean> => {
    const { legacyLogin } = await import('../../../lib/legacyLogin');
    const res = await legacyLogin(u.trim(), p, { workersOnly });
    if (!res) return false;
    if ('finalized' in res) { setFinalized(true); return true; }
    nav(res.path, { replace: true });
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setFinalized(false); setBusy(true);
    try {
      if (tab === 'worker') {
        if (!(await tryLegacy(username, password, true))) setError('That CN # and first name don’t match anyone working today.');
        return;
      }
      try { await signIn(username, password); nav(loc.state?.from || '/app', { replace: true }); }
      catch (err) {
        // Not a new-app account: the old app's logins still work from here.
        if (!(await tryLegacy(username, password, false))) setError(/invalid login/i.test(err instanceof Error ? err.message : '') ? 'Wrong username or password.' : (err instanceof Error ? err.message : 'Sign-in failed'));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="v2"><div className="v2-login"><div className="v2-login-card">
      <img src="/icon-192.png" alt="Canadian Property Stars" className="v2-logo-lg" />
      <div style={{ fontSize: 22, fontWeight: 800 }}>Canadian Property Stars</div>
      <div className="v2-mut" style={{ marginBottom: 18 }}>Sign in to continue</div>
      <div className="v2-tabs" role="tablist">
        <button type="button" className={tab === 'manager' ? 'on' : ''} onClick={() => { setTab('manager'); setError(null); }}>Manager</button>
        <button type="button" className={tab === 'worker' ? 'on' : ''} onClick={() => { setTab('worker'); setError(null); }}>Worker</button>
      </div>
      <form className="v2-card" style={{ padding: 18 }} onSubmit={submit}>
        <Field label={tab === 'worker' ? 'CN #' : 'Username'}>
          <input className="v2-input" autoComplete="username" autoCapitalize={tab === 'worker' ? 'characters' : 'none'} placeholder={tab === 'worker' ? 'e.g. I1004' : ''}
            value={username} onChange={e => setUsername(e.target.value)} required /></Field>
        <Field label={tab === 'worker' ? 'First name' : 'Password'}>
          <input className="v2-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
        {finalized && <div className="v2-card" style={{ marginBottom: 12, background: '#ecfdf5', borderColor: '#a7f3d0' }}>
          <b>Your day is complete.</b><div className="v2-small">Your payout has been processed and your logsheet is closed for today. Great work!</div></div>}
        <Btn type="submit" disabled={busy || loading} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
        <div className="v2-note" style={{ textAlign: 'center' }}>
          {tab === 'worker' ? <>New? Try training mode: <b>Training</b> / <b>training</b></> : 'You stay signed in on this device until you sign out.'}
        </div>
      </form>
    </div></div></div>
  );
};

export const ChangePassword: React.FC = () => {
  const { session, profile, loading, changePassword, signOut } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <div className="v2"><Loading /></div>;
  if (!session || !profile) return <Navigate to="/app/login" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw !== pw2) { setError('The two passwords don’t match'); return; }
    setBusy(true);
    try { await changePassword(pw); nav('/app', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change password'); }
    finally { setBusy(false); }
  };

  return (
    <div className="v2"><div className="v2-login"><form className="v2-login-card v2-card" style={{ padding: 18 }} onSubmit={submit}>
      <div className="v2-h2" style={{ marginBottom: 4 }}>{profile.must_change_password ? 'Choose your own password' : 'Change password'}</div>
      <div className="v2-mut v2-small" style={{ marginBottom: 14 }}>Signed in as <b>{profile.username}</b>. At least 8 characters.</div>
      <Field label="New password"><input className="v2-input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required minLength={8} /></Field>
      <Field label="Type it again"><input className="v2-input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={8} /></Field>
      {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="v2-row"><Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Btn>
        <Btn kind="o" onClick={() => signOut().then(() => nav('/app/login'))}>Sign out</Btn></div>
    </form></div></div>
  );
};
