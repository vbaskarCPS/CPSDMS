// src/planner/features/watch/WatchSettings.tsx — Settings › Watch (/settings/watch): type the code the watch shows to
// connect it, see the watches connected, sign one out.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Watch } from 'lucide-react';
import { claimWatch, cleanCode, forgetWatch, seenWhen, watches, type WatchSession } from './watch';

/** The tile on the Settings screen. */
export function WatchTile() {
  return (
    <Link className="pl-tile" to="/settings/watch">
      <Watch aria-hidden />
      <div className="pl-grow"><b>Watch</b><small>Connect your Galaxy Watch: log sets, tick habits and run timers from your wrist</small></div>
      <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
    </Link>
  );
}

export function WatchSettings() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [list, setList] = useState<WatchSession[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  const load = useCallback(async () => {
    try { setList(await watches()); setLoadErr(false); } catch { setLoadErr(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 4) return;
    setBusy(true); setMsg(null);
    try {
      const r = await claimWatch(code);
      if (r === 'ok') {
        setMsg({ text: 'Connected. Your watch opens the planner in a few seconds.' });
        setCode('');
        // the watch collects its pass on its next check (every few seconds)
        window.setTimeout(() => { void load(); }, 6000);
      } else if (r === 'wait') setMsg({ text: 'Too many wrong codes. Try again in 10 minutes.', bad: true });
      else setMsg({ text: 'That code didn’t match. Check the watch: a code lasts 5 minutes.', bad: true });
    } catch { setMsg({ text: 'Couldn’t reach the planner. Try again.', bad: true }); }
    finally { setBusy(false); }
  };

  const signOut = async (id: string) => {
    try { await forgetWatch(id); await load(); } catch { setMsg({ text: 'Couldn’t sign that watch out. Try again.', bad: true }); }
  };

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 16 }}>
      <header className="pl-row">
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Back" style={{ minHeight: 40, padding: '0 8px' }}><ChevronLeft /></Link>
        <h1>Watch</h1>
      </header>

      <form className="pl-card pl-stack" onSubmit={connect}>
        <h3>Connect a watch</h3>
        <p className="pl-muted" style={{ fontSize: 13 }}>Open the planner on your watch. It shows a 4-digit code: type it here.</p>
        <label className="pl-field"><span className="pl-label">Code on the watch</span>
          <input className="pl-input pl-input--pin" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={e => setCode(cleanCode(e.target.value))} placeholder="0000" /></label>
        {msg && <p className={msg.bad ? 'pl-error' : 'pl-muted'}>{msg.text}</p>}
        <button className="pl-btn pl-btn--primary" disabled={busy || code.length !== 4}>{busy ? 'Connecting…' : 'Connect'}</button>
      </form>

      <section className="pl-card pl-stack">
        <h3>Connected</h3>
        {loadErr && <p className="pl-error">Couldn’t load your watches.</p>}
        {list && list.length === 0 && <p className="pl-muted">No watch yet.</p>}
        {list?.map(w => (
          <div key={w.id} className="pl-row" style={{ gap: 12 }}>
            <Watch aria-hidden />
            <div className="pl-grow"><b>Watch</b><br /><small className="pl-muted">Connected {seenWhen(w.since)} · last used {seenWhen(w.last_seen)}</small></div>
            <button type="button" className="pl-btn" onClick={() => void signOut(w.id)}>Sign out</button>
          </div>
        ))}
      </section>

      <p className="pl-muted" style={{ fontSize: 13 }}>What you do on the watch is saved to your planner straight away: sets, heart rate, ticks, timers, and each day’s steps and sleep. Changing your PIN signs your watch out too.</p>
    </main>
  );
}
