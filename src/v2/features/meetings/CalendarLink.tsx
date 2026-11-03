// The host's own calendar (Google or Outlook), by its private link: busy times there aren't offered to reps.
// The link is kept locked away on the server; this screen only ever shows whether it's connected and working.
import React, { useState } from 'react';
import { CalendarCheck, ChevronDown } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { calendarStatus, setCalendar, type CalendarStatus } from '../../lib/meetings';
import { Btn, Card, ErrorBox, Field } from '../../ui';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
};

export const CalendarLink: React.FC<{ host?: string | null }> = ({ host }) => {
  const st = useLoad(() => calendarStatus(host), [host]);
  const [edit, setEdit] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState<CalendarStatus | null>(null);
  const s = now || st.data;
  const save = async (v: string) => {
    setBusy(true); setError(null);
    try { setNow(await setCalendar(v, host)); setEdit(false); setUrl(''); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Your calendar">
      <div className="v2-small" style={{ marginBottom: 8 }}>
        Connect your Google or Outlook calendar and reps won’t be offered times you’re already busy. Only busy and free are used: never the titles or details of your events.
      </div>
      {s?.connected && !edit && (
        <div className={`v2-cal-status ${s.ok === false ? 'bad' : 'good'}`}>
          <CalendarCheck size={16} aria-hidden />
          <span style={{ flex: 1 }}>
            {s.ok === false ? <><b>Can’t read your calendar.</b> {s.error}</>
              : s.ok ? <><b>Connected.</b> {s.busy_count} busy time{s.busy_count === 1 ? '' : 's'} in the coming weeks{s.fetched_at ? `, checked ${ago(s.fetched_at)}` : ''}.</>
              : <><b>Connected.</b> Checking it now…</>}
          </span>
        </div>)}
      {(edit || !s?.connected) && (
        <>
          <Field label="Your calendar’s private link" hint="It starts with https:// or webcal:// and ends in .ics">
            <input className="v2-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" inputMode="url" autoCapitalize="none" autoCorrect="off" />
          </Field>
          <details className="v2-cal-how">
            <summary>Where do I find it? <ChevronDown size={14} aria-hidden /></summary>
            <p><b>Google Calendar</b> (on a computer): Settings (the gear) → under <i>Settings for my calendars</i>, click your calendar → <i>Integrate calendar</i> → copy <b>Secret address in iCal format</b>.</p>
            <p><b>Outlook / Microsoft 365</b>: Settings → Calendar → <i>Shared calendars</i> → <i>Publish a calendar</i> → pick your calendar and <b>Can view when I’m busy</b> → Publish → copy the <b>ICS</b> link.</p>
            <p>If you can’t find it, your company may have turned it off. Your weekly hours below still work on their own.</p>
          </details>
        </>)}
      <ErrorBox error={error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {(edit || !s?.connected)
          ? <><Btn size="sm" disabled={busy || !url.trim()} onClick={() => save(url)}>{busy ? 'Connecting…' : 'Connect calendar'}</Btn>
              {edit && <Btn size="sm" kind="o" disabled={busy} onClick={() => { setEdit(false); setUrl(''); setError(null); }}>Cancel</Btn>}</>
          : <><Btn size="sm" kind="o" disabled={busy} onClick={() => setEdit(true)}>Change link</Btn>
              <Btn size="sm" kind="o" disabled={busy} onClick={() => save('')}>{busy ? 'Removing…' : 'Disconnect'}</Btn></>}
      </div>
    </Card>
  );
};
