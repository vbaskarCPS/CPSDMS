// src/v2/features/rep/RepSettings.tsx — the rep app's Settings (the gear in the header): follow-up emails.
// Two switches, both off to start: an email when the rep sets a follow-up (with Add to calendar links), and an 8 AM
// email listing that day's follow-ups. Both go to the rep's login email; saving also saves the phone's time zone.
import React, { useEffect, useState } from 'react';
import { repNotify, setRepNotify, type RepNotify } from '../../lib/rep';
import { ErrorBox, Loading } from '../../ui';

const Switch: React.FC<{ on: boolean; busy: boolean; label: string; hint: string; onChange: (v: boolean) => void }> = ({ on, busy, label, hint, onChange }) => (
  <label className="v2-rep-switch">
    <span className="t"><b>{label}</b><span className="v2-small v2-mut">{hint}</span></span>
    <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={e => onChange(e.target.checked)} aria-label={label} />
    <i aria-hidden="true" />
  </label>
);

export const RepSettings: React.FC = () => {
  const [s, setS] = useState<RepNotify | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; repNotify().then(r => { if (live) setS(r); }).catch(e => { if (live) setError(e); }); return () => { live = false; }; }, []);

  const save = async (next: { followup_set: boolean; followup_morning: boolean }) => {
    if (!s) return;
    const before = s;
    setS({ ...s, ...next }); setBusy(true); setError(null);
    try { setS(await setRepNotify(next.followup_set, next.followup_morning)); }
    catch (e) { setS(before); setError(e); } finally { setBusy(false); }
  };

  if (!s && !error) return <Loading label="Loading your settings…" />;
  return (
    <>
      <h1>Settings</h1>
      <ErrorBox error={error} />
      {s && (
        <div className="v2-rep-zone">
          <div style={{ fontWeight: 800, marginBottom: 2 }}>Follow-up emails</div>
          <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>
            Sent to <b>{s.email || 'your login email'}</b>, with buttons to add each follow-up to Google Calendar or Outlook (and a calendar file for Apple Calendar).
          </div>
          <Switch on={s.followup_set} busy={busy} label="Email me when I set a follow-up"
            hint="A couple of minutes after you save it (or once it syncs, if you had no signal)."
            onChange={v => save({ followup_set: v, followup_morning: s.followup_morning })} />
          <Switch on={s.followup_morning} busy={busy} label="Morning reminder"
            hint={`At 8 AM on the day, a list of that day’s follow-ups (${s.timezone.replace(/_/g, ' ')} time).`}
            onChange={v => save({ followup_set: s.followup_set, followup_morning: v })} />
        </div>
      )}
    </>
  );
};
