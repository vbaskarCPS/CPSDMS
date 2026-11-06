// src/v2/features/rep/LocationBanner.tsx — on the rep's map: a warning when the phone isn't sharing its location, with
// the steps to turn it on. Visits still save without it (placed at the business's address, flagged for an admin), but
// only a GPS location shows the rep was at the door.
import React, { useCallback, useEffect, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import { hereNow, locationSteps } from '../../lib/rep';

export const LocationBanner: React.FC = () => {
  const [state, setState] = useState<'checking' | 'ok' | 'off'>('checking');
  const [open, setOpen] = useState(false);
  const check = useCallback(() => { setState('checking'); hereNow(10000).then(p => setState(p ? 'ok' : 'off')).catch(() => setState('off')); }, []);
  useEffect(() => {
    check();
    // when the rep allows it in the browser, the banner goes away by itself
    let status: PermissionStatus | null = null;
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then(s => { status = s; s.onchange = () => check(); }).catch(() => {});
    const back = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', back);
    return () => { if (status) status.onchange = null; document.removeEventListener('visibilitychange', back); };
  }, [check]);
  if (state !== 'off') return null;
  const help = locationSteps(navigator.userAgent);
  return (
    <div className="v2-rep-note v2-rep-locoff" role="alert">
      <div className="v2-rep-locoff-head">
        <MapPinOff size={16} />
        <span><b>Location is off.</b> Visits save at the business’s address and can’t be verified.</span>
      </div>
      {open ? (
        <ol>{help.steps.map(s => <li key={s}>{s}</li>)}</ol>
      ) : null}
      <div className="v2-rep-locoff-btns">
        <button type="button" onClick={() => setOpen(o => !o)}>{open ? 'Hide steps' : `How to turn it on (${help.phone})`}</button>
        <button type="button" onClick={check}>Try again</button>
      </div>
    </div>
  );
};
