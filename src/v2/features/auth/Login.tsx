// src/v2/features/auth/Login.tsx — manager sign-in (username + password) and first-login password change.
import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { forgetPass, getPass, signInProblem, workerSignIn } from '../../../lib/workerPass';
import { useAuth } from '../../lib/auth';
import { completeSetup, setupInfo, useLoad } from '../../lib/data';
import { repForgot, repSignIn } from '../../lib/rep';
import { db } from '../../lib/client';
import { Btn, Field, Loading } from '../../ui';
import { MsLogo, MsTab } from '../../ui/MsLogo';

export const Login: React.FC = () => {
  const { session, profile, loading, signIn, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string }; search: string };
  // propertystars.app/mainstreet opens straight on the reps' sign-in, MainstreetAI only
  const msOnly = new URLSearchParams(loc.search).get('as') === 'mainstreet';
  const [tab, setTab] = useState<'manager' | 'worker' | 'mainstreet'>(msOnly ? 'mainstreet' : 'manager');
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalized, setFinalized] = useState(false);

  // Signing in lands on the home page, which sends a manager with a seat on today's session to their map.
  const target = loc.state?.from && !/^\/app\/?$/.test(loc.state.from) ? loc.state.from : '/app';
  if (session && profile && can('mainstreet_rep')) return <Navigate to="/app/rep" replace />;
  if (session && profile) return <Navigate to={profile.must_change_password ? '/app/password' : target} replace
    state={target === '/app' && !profile.must_change_password ? { fromLogin: true } : undefined} />;

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
      if (tab === 'mainstreet') {
        if (forgot) { await repForgot(username); setSent(true); return; }
        await repSignIn(username, password);
        // the auth state picks up the session; the redirect above sends the rep to their app
        await db.auth.getSession();
        return;
      }
      if (tab === 'worker') {
        // This year's contractor list gives the worker dashboard pass; a running session they're on
        // still takes them straight to their logsheet.
        forgetPass();   // a shared phone: the last worker's pass never carries over
        const pass = await workerSignIn(username, password);
        // a wrong PIN (or a locked one) stops here; a wrong first name may still be today's session's
        if (!pass.ok && (pass.reason === 'locked' || (pass.reason === 'wrong' && pass.hasPin))) { setError(signInProblem(pass)); return; }
        const { legacyLogin } = await import('../../../lib/legacyLogin');
        // a session problem (e.g. no day open yet) still lets a worker with a pass into their dashboard
        const res = await legacyLogin(username.trim(), password, { workersOnly: true }).catch(e => { if (pass.ok) return null; throw e; });
        if (res && 'path' in res && (res.path !== '/training' || !pass.ok)) { nav(res.path, { replace: true }); return; }
        if (pass.ok) { nav(res && 'finalized' in res ? '/app/worker?done=1' : '/app/worker', { replace: true }); return; }
        if (res && 'finalized' in res) { setFinalized(true); return; }
        setError(pass.reason === 'left' ? signInProblem(pass) : 'That CN # and PIN (or first name) don’t match anyone on this year’s contractor list or today’s session.');
        return;
      }
      if (username.includes('@')) { setError('MainstreetAI reps sign in on the MainstreetAI tab with their email.'); return; }
      try { await signIn(username, password); nav(target, { replace: true, state: target === '/app' ? { fromLogin: true } : undefined }); }
      catch (err) {
        // Not a new-app account: the old app's logins still work from here.
        if (!(await tryLegacy(username, password, false))) setError(/invalid login/i.test(err instanceof Error ? err.message : '') ? 'Wrong username or password.' : (err instanceof Error ? err.message : 'Sign-in failed'));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="v2"><div className="v2-login"><div className="v2-login-card">
      {msOnly ? <>
        <MsTab title="MainstreetAI · Sign in" />
        <div className="v2-ms-brand"><MsLogo size={30} tone="dark" stack /></div>
        <div className="v2-mut" style={{ marginBottom: 18 }}>Rep sign-in</div>
      </> : <>
        {tab === 'mainstreet' ? <>
          <MsTab title="MainstreetAI · Sign in" />
          <div className="v2-ms-brand"><MsLogo size={30} tone="dark" stack /></div>
          <div className="v2-mut" style={{ marginBottom: 18 }}>Rep sign-in</div>
        </> : <>
          <img src="/icon-192.png" alt="Canadian Property Stars" className="v2-logo-lg" />
          <div style={{ fontSize: 22, fontWeight: 800 }}>Canadian Property Stars</div>
          <div className="v2-mut" style={{ marginBottom: 18 }}>Sign in to continue</div>
        </>}
        <div className="v2-tabs" role="tablist">
          <button type="button" className={tab === 'manager' ? 'on' : ''} onClick={() => { setTab('manager'); setError(null); setForgot(false); }}>Manager</button>
          <button type="button" className={tab === 'worker' ? 'on' : ''} onClick={() => { setTab('worker'); setError(null); setForgot(false); }}>Worker</button>
          <button type="button" className={tab === 'mainstreet' ? 'on' : ''} onClick={() => { setTab('mainstreet'); setError(null); }}>MainstreetAI</button>
        </div>
      </>}
      {tab === 'worker' && getPass() && (() => { const w = getPass()!.worker; return (
        <Link to="/app/worker" className="v2-card v2-row" style={{ padding: 12, marginBottom: 10, textDecoration: 'none', color: 'inherit', gap: 8 }}>
          <span style={{ flex: 1 }}>Continue as <b>{w.first_name} {w.last_name}</b> <span className="v2-mut">({w.cn})</span></span><b className="v2-link">Open ›</b>
        </Link>); })()}
      {tab === 'mainstreet' ? (
      <form className="v2-card" style={{ padding: 18 }} onSubmit={submit}>
        <Field label="Email">
          <input className="v2-input" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" value={username} onChange={e => { setUsername(e.target.value); setSent(false); }} required /></Field>
        {!forgot && <Field label="Password">
          <input className="v2-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>}
        {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
        {sent && <div className="v2-card" style={{ marginBottom: 12, background: '#ecfdf5', borderColor: '#a7f3d0' }}>
          <b>Check your email.</b><div className="v2-small">If that email belongs to a MainstreetAI rep, a link to choose a new password is on its way. It works for 2 hours.</div></div>}
        <Btn type="submit" disabled={busy || loading} style={{ width: '100%', justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e' }}>
          {busy ? (forgot ? 'Sending…' : 'Signing in…') : forgot ? 'Email me a link' : 'Sign in'}</Btn>
        <div className="v2-note" style={{ textAlign: 'center' }}>
          <button type="button" className="v2-link" style={{ background: 'none', border: 0 }} onClick={() => { setForgot(f => !f); setError(null); setSent(false); }}>
            {forgot ? 'Back to sign in' : 'Forgot your password?'}</button>
        </div>
      </form>
      ) : (
      <form className="v2-card" style={{ padding: 18 }} onSubmit={submit}>
        <Field label={tab === 'worker' ? 'CN #' : 'Username'}>
          <input className="v2-input" autoComplete="username" autoCapitalize={tab === 'worker' ? 'characters' : 'none'} placeholder={tab === 'worker' ? 'e.g. I1004' : ''}
            value={username} onChange={e => setUsername(e.target.value)} required /></Field>
        <Field label={tab === 'worker' ? 'PIN (or first name if you haven’t made one)' : 'Password'}>
          <input className="v2-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
        {finalized && <div className="v2-card" style={{ marginBottom: 12, background: '#ecfdf5', borderColor: '#a7f3d0' }}>
          <b>Your day is complete.</b><div className="v2-small">Your payout has been processed and your logsheet is closed for today. Great work!</div></div>}
        <Btn type="submit" disabled={busy || loading} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
        <div className="v2-note" style={{ textAlign: 'center' }}>
          {tab === 'worker' ? <>New? Try training mode: <b>Training</b> / <b>training</b></> : 'You stay signed in on this device until you sign out.'}
        </div>
      </form>
      )}
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
    const forced = profile.must_change_password;
    try { await changePassword(pw); nav(forced ? '/app' : '/app/account', { replace: true }); }
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
        {profile.must_change_password
          ? <Btn kind="o" onClick={() => signOut().then(() => nav('/app/login'))}>Sign out</Btn>
          : <Btn kind="o" onClick={() => nav('/app/account')}>Cancel</Btn>}</div>
    </form></div></div>
  );
};

/**
 * /app/setup#t=… — the link in the account setup email: a new manager chooses their password, then
 * lands signed in. The code is in the #fragment, so it never reaches a server log.
 */
export const AccountSetup: React.FC = () => {
  const { signIn, signOut, session } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [code] = useState(() => new URLSearchParams(loc.hash.replace(/^#/, '')).get('t') || '');
  const info = useLoad(() => (code ? setupInfo(code) : Promise.resolve(null)), [code]);
  // a MainstreetAI rep's link: MainstreetAI look, and they sign in with their email
  const repEmail = useLoad(async () => { if (!code) return null; const { data } = await db.rpc('ms_setup_rep_email', { p_code: code }); return typeof data === 'string' && data ? data : null; }, [code]);
  const isRep = { data: !!repEmail.data, loading: repEmail.loading };
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (pw.length < 8) { setError('Use at least 8 characters'); return; }
    if (pw !== pw2) { setError('The two passwords don’t match'); return; }
    setBusy(true);
    try {
      const username = await completeSetup(code, pw);
      if (session) await signOut();   // someone else was signed in on this device
      window.history.replaceState(null, '', '/app/setup');   // the used code leaves the address bar
      if (repEmail.data) await repSignIn(repEmail.data, pw);   // a rep has no username: their email
      else await signIn(username, pw);
      if (isRep.data) nav('/app/rep', { replace: true });
      else nav('/app', { replace: true, state: { fromLogin: true } });
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not set your password'); }
    finally { setBusy(false); }
  };

  const shell = (body: React.ReactNode) => (
    <div className="v2"><div className="v2-login"><div className="v2-login-card">
      {isRep.data ? <div className="v2-ms-brand"><MsTab /><MsLogo size={30} tone="dark" stack /></div> : <>
        <img src="/icon-192.png" alt="Canadian Property Stars" className="v2-logo-lg" />
        <div style={{ fontSize: 22, fontWeight: 800 }}>Canadian Property Stars</div>
      </>}
      <div className="v2-mut" style={{ marginBottom: 18 }}>{isRep.data ? 'Choose your password' : 'Set up your account'}</div>
      {body}
    </div></div></div>
  );
  if (info.loading || isRep.loading) return shell(<Loading />);
  if (!info.data) return shell(
    <div className="v2-card" style={{ padding: 18 }}>
      <b>This setup link has expired or was already used.</b>
      <div className="v2-small v2-mut" style={{ margin: '6px 0 14px' }}>Ask whoever added you to send a new one. If you’ve already chosen your password, just sign in.</div>
      <Btn onClick={() => nav(isRep.data ? '/app/login?as=mainstreet' : '/app/login')}>Go to sign in</Btn>
    </div>);
  return shell(
    <form className="v2-card" style={{ padding: 18 }} onSubmit={submit}>
      <div className="v2-h2" style={{ marginBottom: 4 }}>Welcome, {info.data.full_name.split(/\s+/)[0]}</div>
      <div className="v2-small" style={{ marginBottom: 14 }}>{isRep.data
        ? <>You sign in with your email. Choose a password (at least 8 characters).</>
        : <>Your username is <b style={{ fontFamily: 'monospace', fontSize: 15 }}>{info.data.username}</b>. Choose a password (at least 8 characters).</>}</div>
      <input type="text" autoComplete="username" value={repEmail.data || info.data.username} readOnly hidden />
      <Field label="Password"><input className="v2-input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required minLength={8} /></Field>
      <Field label="Type it again"><input className="v2-input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={8} /></Field>
      {error && <div className="v2-err" style={{ marginBottom: 12 }}>{error}</div>}
      <Btn type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Setting up…' : 'Set password and sign in'}</Btn>
      <div className="v2-note" style={{ textAlign: 'center' }}>{isRep.data
        ? <>Next time, sign in at <b>propertystars.app/mainstreet</b> with your email and this password.</>
        : <>Next time, sign in with <b>{info.data.username}</b> and this password.</>}</div>
    </form>);
};
