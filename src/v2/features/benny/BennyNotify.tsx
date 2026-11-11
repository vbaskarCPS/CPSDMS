// src/v2/features/benny/BennyNotify.tsx — under an answer that logged something for them (a bug, a request the Benny
// couldn't do), or that told them it's live: the offer of a notification on this device for when it's live.
// One tap turns it on (the same switch as new-mail notifications); an iPhone needs the app on its Home Screen first.
// Nothing shows where the device can't do it or the person blocked it, and "Not now" is remembered on the device.
import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Share } from 'lucide-react';
import { enablePush, pushState, type PushState } from '../../lib/push';

const LATER = 'benny.push.later';

export const NotifyRow: React.FC<{ when: 'logged' | 'news' }> = ({ when }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justOn, setJustOn] = useState(false);
  const [later, setLater] = useState(() => { try { return localStorage.getItem(LATER) === '1'; } catch { return false; } });
  useEffect(() => { let gone = false; pushState().then(s => { if (!gone) setState(s); }).catch(() => undefined); return () => { gone = true; }; }, []);
  if (!state || state === 'unsupported' || state === 'denied') return null;
  if (state === 'on') {
    if (!justOn && when !== 'logged') return null;
    return <div className="benny-notify on" role="status"><BellRing size={15} /><span>{justOn ? 'Notifications are on for this device.' : 'You’ll get a notification on this device when it’s live.'}</span></div>;
  }
  if (later) return null;
  const notNow = () => { try { localStorage.setItem(LATER, '1'); } catch { /* it's offered again next time */ } setLater(true); };
  const on = async () => {
    setBusy(true); setError(null);
    try { await enablePush(); setJustOn(true); setState('on'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t turn them on'); setState(await pushState().catch(() => 'off' as PushState)); }
    finally { setBusy(false); }
  };
  return (
    <div className="benny-notify" role="group" aria-label="Notifications">
      <Bell size={15} />
      <span className="benny-notify-t">
        {state === 'ios-install'
          ? <>For a notification on this iPhone when {when === 'logged' ? 'it’s' : 'something you asked for is'} live: tap <Share size={12} /> Share, then “Add to Home Screen”, and open the app from there.</>
          : when === 'logged' ? 'Want a notification on this device when it’s live?' : 'Next time, get a notification on this device when it’s live.'}
        {error && <span className="benny-notify-err">{error}</span>}
      </span>
      {state === 'off' && <button type="button" className="benny-go" onClick={() => void on()} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>}
      <button type="button" className="benny-alt" onClick={notNow} disabled={busy}>Not now</button>
    </div>
  );
};
