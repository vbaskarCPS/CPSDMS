// src/v2/features/mail/PushToggle.tsx — "Get notified of new mail" on this phone or computer. Shows the
// right next step for the device: turn on, add to Home Screen first (iPhone), or unblock in settings.
import React, { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2, Share } from 'lucide-react';
import { disablePush, enablePush, pushState, type PushState } from '../../lib/push';

export const PushToggle: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [later, setLater] = useState(() => { try { return !!compact && localStorage.getItem('push-not-now') === '1'; } catch { return false; } });
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  if (!state || state === 'unsupported') return null;
  // in the inbox, don't nag: once dismissed (or blocked) it lives on the Me / settings card only
  if (compact && (later || state === 'denied') && state !== 'on') return null;
  if (compact && state === 'on') return null;
  const notNow = () => { try { localStorage.setItem('push-not-now', '1'); } catch { /* fine */ } setLater(true); };

  const on = async () => {
    setBusy(true); setError(null);
    try { await enablePush(); setState('on'); } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t turn them on'); setState(await pushState()); }
    finally { setBusy(false); }
  };
  const off = async () => {
    setBusy(true); setError(null);
    try { await disablePush(); setState('off'); } catch { /* leave it */ } finally { setBusy(false); }
  };

  return (
    <div className={`v2-push${compact ? ' compact' : ''}${state === 'on' ? ' is-on' : ''}`}>
      <span className="ic">{state === 'on' ? <BellRing size={17} /> : state === 'denied' ? <BellOff size={17} /> : <Bell size={17} />}</span>
      <span className="tx">
        {state === 'on' && <><b>Notifications on</b><span>New mail shows on this device.</span></>}
        {state === 'off' && <><b>Get notified of new mail</b><span>On this phone or computer, even when the app is closed.</span></>}
        {state === 'denied' && <><b>Notifications are blocked</b><span>Allow them for this site in your browser’s settings, then reload.</span></>}
        {state === 'ios-install' && <><b>Want new-mail alerts?</b><span>Tap <Share size={12} style={{ verticalAlign: -2 }} /> Share, then “Add to Home Screen”, and open the app from there.</span></>}
        {error && <span className="bad">{error}</span>}
      </span>
      {state === 'off' && <button type="button" className="go" onClick={on} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : 'Turn on'}</button>}
      {compact && (state === 'off' || state === 'ios-install') && <button type="button" className="ghost x" onClick={notNow} aria-label="Not now" title="Not now">Not now</button>}
      {state === 'on' && <button type="button" className="ghost" onClick={off} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : 'Turn off'}</button>}
    </div>
  );
};
