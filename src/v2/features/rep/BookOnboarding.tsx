// The deck's "Book onboarding" button: the rep and the owner pick a day and an open time, confirm the owner's name,
// phone and email, and book. A free host is picked for the call; the owner and the host get an email with the
// Zoom link and a calendar invite; the rep's visit is saved as a closed deal ("Onboarding booked").
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarCheck, X } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { hereNow } from '../../lib/rep';
import { db, must } from '../../lib/client';
import { hasAnswers, bookMeeting, longDay, meetingSlots, notifyMeeting, slotsByDay, timeLabel, type DeckAnswers, type Meeting } from '../../lib/meetings';
import { Btn, ErrorBox, Field, Loading } from '../../ui';

export const BookOnboarding: React.FC<{
  campaign: string; business: string; businessName: string; answers?: DeckAnswers | null; owner: { name: string; phone: string; email: string };
  onClose: () => void; onBooked: (m: Meeting) => void;
}> = ({ campaign, business, businessName, answers, owner, onClose, onBooked }) => {
  const [tick, setTick] = useState(0);
  const slots = useLoad(() => meetingSlots(campaign, null, 14), [campaign, tick]);
  const days = useMemo(() => (slots.data ? slotsByDay(slots.data) : []), [slots.data]);
  const tz = slots.data?.timezone;
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState(owner.name); const [phone, setPhone] = useState(owner.phone); const [email, setEmail] = useState(owner.email);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ m: Meeting; mail: string } | null>(null);

  useEffect(() => { if (days.length && (!day || !days.some(d => d.day === day))) setDay(days[0].day); }, [days, day]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const today = days.find(d => d.day === day);
  const book = async () => {
    if (!start) return;
    if (!name.trim()) { setError(new Error('The owner’s name is needed.')); return; }
    if (!email.trim() && !phone.trim()) { setError(new Error('An email or a phone number for the owner is needed.')); return; }
    setBusy(true); setError(null);
    try {
      // the deck's answers go with the call (the host sees them in their email)
      if (hasAnswers(answers)) must(await db.rpc('ms_save_deck_answers', { p_business: business, p_campaign: campaign, p_data: answers }));
      const here = await hereNow(5000);
      const m = await bookMeeting({ campaign, business, start, name, phone, email, notes, lat: here?.lat, lng: here?.lng, accuracy: here?.accuracy });
      const r = await notifyMeeting(m.id, 'booked');
      const mail = 'error' in r ? `The emails didn’t go out (${r.error}). An admin can resend them from Meetings.`
        : r.sent.includes('owner') ? `${m.owner_name.split(' ')[0]} has an email with the Zoom link and a calendar invite.`
        : 'No email for the owner, so tell them the time now. The host has been emailed.';
      setDone({ m, mail });
      onBooked(m);
    } catch (e) {
      setError(e);
      if (/taken|too soon/i.test(e instanceof Error ? e.message : '')) { setStart(null); setTick(t => t + 1); }
    } finally { setBusy(false); }
  };

  return (
    <div className="v2-rep-sheet-bg v2-rep-book" role="dialog" aria-label="Book onboarding" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="v2-rep-sheet">
        <div className="v2-rep-row" style={{ marginTop: 0 }}>
          {start && !done
            ? <button type="button" className="v2-rep-back" onClick={() => setStart(null)}><ArrowLeft size={15} />Times</button>
            : <h2>Book onboarding</h2>}
          <button type="button" className="v2-rep-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {done ? (
          <div className="v2-rep-booked">
            <CalendarCheck size={40} />
            <h2>Booked</h2>
            <div><b>{longDay(done.m.starts_at, done.m.timezone)}</b> at <b>{timeLabel(done.m.starts_at, done.m.timezone)}</b></div>
            <div className="v2-small v2-mut">{done.m.length_min} minutes on Zoom with {done.m.host.name}</div>
            <p className="v2-small">{done.mail}</p>
            <p className="v2-small v2-mut">Saved as a closed deal for {businessName}: it shows in Deals as onboarding booked.</p>
            <Btn onClick={onClose}>Done</Btn>
          </div>
        ) : !start ? (
          <>
            <div className="v2-small v2-mut" style={{ margin: '2px 0 10px' }}>{businessName}{slots.data ? ` · ${slots.data.length_min}-minute Zoom call` : ''}</div>
            {slots.loading && !slots.data ? <Loading label="Finding open times…" /> : slots.error ? <ErrorBox error={slots.error} />
              : !days.length ? <div className="v2-rep-note">{slots.data?.hosts ? 'No open times in the next two weeks. Log a follow-up and ask an admin to open more hours.' : 'No one is set up to take onboarding calls for this campaign yet. Ask an admin (MainstreetAI › Meetings).'}</div>
              : (
                <>
                  <div className="v2-rep-bookdays">
                    {days.map(d => <button key={d.day} type="button" className={d.day === day ? 'on' : ''} onClick={() => setDay(d.day)}>
                      <b>{d.label.split(',')[0]}</b><span>{d.label.split(',').slice(1).join(',').trim() || d.label}</span></button>)}
                  </div>
                  {today && <>
                    <div className="v2-small v2-mut" style={{ margin: '10px 0 6px' }}>{longDay(today.slots[0].start, tz)} · times in {tz?.split('/')[1]?.replace('_', ' ')} time</div>
                    <div className="v2-rep-booktimes">
                      {today.slots.map(s => <button key={s.start} type="button" onClick={() => { setStart(s.start); setError(null); }}>{timeLabel(s.start, tz)}</button>)}
                    </div>
                  </>}
                </>)}
            <ErrorBox error={error} />
          </>
        ) : (
          <>
            <div className="v2-rep-bookwhen"><CalendarCheck size={18} /><span><b>{longDay(start, tz)}</b> at <b>{timeLabel(start, tz)}</b></span></div>
            <Field label="Owner’s name"><input className="v2-input" value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
            <Field label="Phone"><input className="v2-input" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="off" /></Field>
            <Field label="Email" hint="The Zoom link and calendar invite go here."><input className="v2-input" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" /></Field>
            <Field label="Notes for the host (optional)"><textarea className="v2-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything the host should know" /></Field>
            <ErrorBox error={error} />
            <Btn style={{ width: '100%', justifyContent: 'center', padding: '13px 0', fontSize: 16, marginTop: 6 }} disabled={busy} onClick={book}>{busy ? 'Booking…' : 'Book the call'}</Btn>
          </>
        )}
      </div>
    </div>
  );
};
