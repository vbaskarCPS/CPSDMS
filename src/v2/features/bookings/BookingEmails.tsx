// src/v2/features/bookings/BookingEmails.tsx — Master Bookings › Send booking emails (RUN_69).
//
//   1. Pick the email (Day before / Next try), the day (tomorrow or the day after), and the routes on the map
//      (the same picker as Start session: open a map, tap route numbers or take the whole map).
//   2. Write them: each is the centre's saved template for the customer, plus one personal paragraph Claude
//      writes from what we know of them (years with us, their plan, a missed visit's reason).
//   3. Read them all, change or untick any, then Send. They go out from the centre's customer mailbox
//      (replies come back there) and each booking remembers it was emailed for that day, so nobody gets two.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { listBookings, type Booking } from '../../lib/bookings';
import { centerAreas, routeShapes, type Area } from '../../lib/territory';
import type { PlanManager, PlanRoute } from '../../lib/startSession';
import { MapRoutePicker } from '../workerbook/MapRoutePicker';
import { aiBookingNotes, boxName, emailTemplates, myBoxes, sendMail, dateFriendly } from '../../lib/mail';
import { alreadySent, emailsOf, KIND_LABEL, markEmailed, nextDays, noteHtml, renderDraft, type BookingDraft, type BookingEmailKind } from '../../lib/bookingEmails';
import { useLists } from './BookingsPage';
import { Btn, ErrorBox, Field, Loading, Tag } from '../../ui';

/** the picker's one "manager": routes are just picked */
const PICKER: PlanManager[] = [{ id: 'pick', full_name: 'Email', username: '', phone: null }];
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export const BookingEmails: React.FC = () => {
  const { center, can } = useAuth();
  const { lists, sorted, list, setPick } = useLists(center?.id);
  const days = nextDays();
  const [kind, setKind] = useState<BookingEmailKind>('day_before');
  const [date, setDate] = useState(days.tomorrow);
  const [routes, setRoutes] = useState<Map<string, PlanRoute>>(new Map());
  const [drafts, setDrafts] = useState<BookingDraft[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const boxes = useLoad(() => myBoxes(), []);
  const box = boxes.data?.find(b => b.center_id === center?.id && b.role === 'client') || null;
  const templates = useLoad(() => (center ? emailTemplates(center.id) : Promise.resolve([])), [center?.id]);
  const template = templates.data?.find(t => t.type === kind && t.active) || null;
  // the centre's digital maps, picked like Start session's routes
  const mapAreas = useLoad(() => (center ? centerAreas(center.id) : Promise.resolve([] as Area[])), [center?.id]);
  const shapes = useLoad(() => routeShapes((mapAreas.data || []).map(a => a.name)), [mapAreas.data]);
  const status = kind === 'next_try' ? 'tried' : 'open';
  const codes = [...routes.keys()].sort();
  const picked = useLoad(async () => {
    if (!list || !codes.length) return [] as Booking[];
    const got = await Promise.all(codes.map(route => listBookings(list.id, { route, status }, 0, 1000)));
    const seen = new Set<string>();
    return got.flatMap(g => g.rows).filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
  }, [list?.id, status, codes.join('|')]);

  const chosen = picked.data || [];
  const ready = chosen.filter(b => emailsOf(b).length && !alreadySent(b, kind, date));
  const noEmail = chosen.filter(b => !emailsOf(b).length).length;
  const sentBefore = chosen.filter(b => emailsOf(b).length && alreadySent(b, kind, date)).length;

  if (!can('bookings')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to Master Bookings.</div></div>;
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card v2-mut">Pick a center in the top bar.</div></div>;
  const company = box?.label || 'Property Stars';

  const write = async () => {
    setError(null); setDone(null); setBusy('Writing the personal lines…');
    try {
      const notes: Record<string, string> = {};
      for (let i = 0; i < ready.length; i += 25) {
        setBusy(`Writing the personal lines… ${Math.min(i + 25, ready.length)} of ${ready.length}`);
        Object.assign(notes, await aiBookingNotes({ kind, date: dateFriendly(date), ids: ready.slice(i, i + 25).map(b => b.id) }));
      }
      setDrafts(ready.map(b => ({ booking: b, to: emailsOf(b), subject: '', note: notes[b.id] || '', include: true })));
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const send = async () => {
    if (!drafts || !template || !box) return;
    setError(null);
    let ok = 0, bad = 0;
    const next = [...drafts];
    const total = next.filter(x => x.include && x.status !== 'sent').length;
    for (let i = 0; i < next.length; i++) {
      const d = next[i];
      if (!d.include || d.status === 'sent') continue;
      setBusy(`Sending ${ok + bad + 1} of ${total}…`);
      next[i] = { ...d, status: 'sending' }; setDrafts([...next]);
      try {
        const e = renderDraft(template, d, date, company);
        const r = await sendMail({ staff: true, mailbox_id: box.id, to: d.to, cc: [], subject: e.subject, html: e.html, text: e.text, attachments: [] });
        await markEmailed(d.booking.id, kind, date, r.thread_id);
        next[i] = { ...d, status: 'sent' }; ok++;
      } catch (err) { next[i] = { ...d, status: 'failed', error: err instanceof Error ? err.message : String(err) }; bad++; }
      setDrafts([...next]);
    }
    setBusy(null);
    setDone(`${ok} sent from ${box.address}${bad ? `, ${bad} didn’t send (shown below; press Send again to retry them)` : ''}.`);
    picked.reload();
  };

  const left = drafts?.filter(d => d.include && d.status !== 'sent').length || 0;
  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Send booking emails</span><span className="v2-spacer" />
        <Link className="v2-link" to="/app/bookings/templates">Templates ›</Link>
        <Link className="v2-link" to="/app/bookings/list">Bookings ›</Link></div>
      <ErrorBox error={lists.error || templates.error || boxes.error || mapAreas.error || picked.error || error} />
      {!boxes.loading && !box && <div className="v2-err" style={{ marginBottom: 10 }}>You’re not on {center.display_name}’s customer mailbox, so you can’t send from it. The Super Admin sets it up in Centers › Email and adds you.</div>}
      {!templates.loading && !template && <div className="v2-err" style={{ marginBottom: 10 }}>There’s no {KIND_LABEL[kind]} template saved for {center.display_name}. <Link to="/app/bookings/templates">Make one</Link> first.</div>}

      {!drafts ? (
        <>
          <div className="v2-card" style={{ marginBottom: 10 }}>
            <div className="v2-grid2" style={{ gap: 10 }}>
              <Field label="Booking list">
                <select className="v2-sel" value={list?.id || ''} onChange={e => { setPick(e.target.value); setRoutes(new Map()); }}>
                  {sorted.map(l => <option key={l.id} value={l.id}>{l.name} {l.year}</option>)}
                </select>
              </Field>
              <Field label="Email">
                <div className="v2-row" style={{ gap: 6 }}>
                  {(['day_before', 'next_try'] as BookingEmailKind[]).map(k => <Btn key={k} size="sm" kind={kind === k ? undefined : 'o'} onClick={() => setKind(k)}>{KIND_LABEL[k]}</Btn>)}
                </div>
              </Field>
              <Field label="For">
                <div className="v2-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Btn size="sm" kind={date === days.tomorrow ? undefined : 'o'} onClick={() => setDate(days.tomorrow)}>Tomorrow · {dateFriendly(days.tomorrow)}</Btn>
                  <Btn size="sm" kind={date === days.after ? undefined : 'o'} onClick={() => setDate(days.after)}>Day after · {dateFriendly(days.after)}</Btn>
                </div>
              </Field>
            </div>
          </div>
          {(mapAreas.data || []).length === 0 && !mapAreas.loading ? (
            <div className="v2-card v2-mut">No digital maps are assigned to {center.display_name} yet.</div>
          ) : (
            <MapRoutePicker areas={mapAreas.data || []} shapes={shapes.data || []} managers={PICKER} routes={routes} active={PICKER[0].id} centerId={center.id}
              single="Email" onActive={() => undefined} onChange={setRoutes}
              footer={
                <div className="v2-card" style={{ padding: 12 }}>
                  {!routes.size ? <div className="v2-mut v2-small">Pick the routes you’re doing {date === days.tomorrow ? 'tomorrow' : 'the day after'}: open a map, then tap route numbers or “Email whole map”.</div>
                    : picked.loading ? <Loading label="Finding the bookings…" />
                    : <div className="v2-small">
                        <b>{routes.size} route{routes.size === 1 ? '' : 's'}</b> · {chosen.length} {kind === 'next_try' ? 'tried' : 'open'} booking{chosen.length === 1 ? '' : 's'}
                        <div className="v2-mut" style={{ marginTop: 4 }}>{ready.length} to write{noEmail ? ` · ${noEmail} have no email` : ''}{sentBefore ? ` · ${sentBefore} already got the ${KIND_LABEL[kind].toLowerCase()} email for ${dateFriendly(date)}` : ''}</div>
                      </div>}
                  <Btn icon={Sparkles} onClick={write} disabled={!!busy || !ready.length || !template || !box} style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}>
                    {busy || `Write ${ready.length || ''} email${ready.length === 1 ? '' : 's'}`}</Btn>
                </div>} />
          )}
        </>
      ) : (
        <>
          <div className="v2-card v2-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <Mail size={16} /><b>{KIND_LABEL[kind]} · {dateFriendly(date)}</b><span className="v2-mut">from {box ? boxName(box) : '—'} &lt;{box?.address}&gt;</span>
            <span className="v2-spacer" />
            <Btn kind="o" size="sm" onClick={() => { setDrafts(null); setDone(null); }} disabled={!!busy}>Back</Btn>
            <Btn icon={Send} onClick={send} disabled={!!busy || !left || !template || !box}>{busy || `Send ${left}`}</Btn>
          </div>
          {done && <div className="v2-ok" style={{ marginBottom: 10 }}>{done}</div>}
          <div className="v2-stack">
            {drafts.map((d, i) => {
              const e = template ? renderDraft(template, d, date, company) : null;
              const set = (p: Partial<BookingDraft>) => setDrafts(ds => ds!.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={d.booking.id} className="v2-card" style={{ opacity: d.include ? 1 : 0.55 }}>
                  <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input type="checkbox" checked={d.include} disabled={d.status === 'sent'} onChange={ev => set({ include: ev.target.checked })} aria-label="Send this one" />
                    <b>{d.booking.house_no} {d.booking.street_name}</b><span className="v2-mut">{d.booking.route_code}</span>
                    <span className="v2-mut v2-small">to {d.to.join(', ')}</span><span className="v2-spacer" />
                    {d.status === 'sent' ? <Tag tone="g">Sent</Tag> : d.status === 'sending' ? <Tag tone="b">Sending…</Tag> : d.status === 'failed' ? <Tag tone="r">Didn’t send</Tag> : null}
                  </div>
                  {d.error && <div className="v2-err v2-small" style={{ marginTop: 6 }}>{d.error}</div>}
                  <div className="v2-small" style={{ margin: '6px 0 4px' }}><b>{e?.subject}</b></div>
                  <Field label="Personal line">
                    <textarea className="v2-input" rows={2} style={{ width: '100%' }} value={plain(d.note)} disabled={d.status === 'sent'}
                      placeholder="(none)" onChange={ev => set({ note: noteHtml(ev.target.value) })} />
                  </Field>
                  <details><summary className="v2-small v2-link" style={{ cursor: 'pointer' }}>See the whole email</summary>
                    <iframe title="Email" sandbox="" style={{ width: '100%', height: 300, border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 6 }}
                      srcDoc={`<!DOCTYPE html><html><body style="margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;">${e?.html || ''}</body></html>`} />
                  </details>
                </div>);
            })}
          </div>
        </>
      )}
    </div>
  );
};
