// src/v2/features/bookings/EmailTemplates.tsx — Master Bookings › Email templates (RUN_69): the centre's
// booking emails (Day before, Next try) and receipts. Write one yourself or press Generate with AI, read it,
// and save. A saved template is fixed: every email uses it as it is (the booking emails add one personal
// paragraph where {{note}} sits). Generating again only changes the draft until you save.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Sparkles } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { aiTemplate, BOOKING_TEMPLATES, emailTemplates, fillTemplate, RECEIPT_TEMPLATES, RECEIPT_VARS, saveEmailTemplate, type EmailTemplate } from '../../lib/mail';
import { Btn, Card, ErrorBox, Field, Loading, Tag } from '../../ui';

const SAMPLE: Record<string, string> = {
  firstName: 'Ann', lastName: 'Lee', fullName: 'Ann Lee', address: '12 Oak St, Surrey', dateFriendly: 'Thursday, October 30',
  services: 'aeration, fertilizer, overseeding and lime', reason: 'locked gate', note: '<p><em>(Here goes one personal line for each customer.)</em></p>',
  displayPrice: '$189.00', paymentMethod: 'Credit card', date: 'October 30, 2026', serviceName: 'Lawn Rejuvenation', workerName: 'Sam',
  ETRANSFER_INSTRUCTIONS_SECTION: '',
};

export const EmailTemplates: React.FC = () => {
  const { center, can } = useAuth();
  const list = useLoad(() => (center ? emailTemplates(center.id) : Promise.resolve([] as EmailTemplate[])), [center?.id]);
  const [pick, setPick] = useState<string>('day_before');
  if (!(can('bookings') || can('sa_users'))) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to email templates.</div></div>;
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card v2-mut">Pick a center in the top bar.</div></div>;
  const saved = (type: string) => list.data?.find(t => t.type === type);
  const all = [...BOOKING_TEMPLATES.map(t => ({ type: t.type, name: t.name, group: 'Booking emails' })), ...RECEIPT_TEMPLATES.map(t => ({ ...t, group: 'Receipts' }))];

  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Email templates</span><span className="v2-mut">{center.display_name}</span><span className="v2-spacer" />
        <Link className="v2-link" to="/app/bookings/emails">Send booking emails ›</Link></div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="v2-card" style={{ width: 260, padding: 6, flexShrink: 0 }}>
            {['Booking emails', 'Receipts'].map(g => (
              <div key={g}>
                <div className="v2-label" style={{ padding: '8px 10px 4px' }}>{g}</div>
                {all.filter(t => t.group === g).map(t => (
                  <button key={t.type} type="button" className={`v2-menu-item${pick === t.type ? ' on' : ''}`} onClick={() => setPick(t.type)}>
                    <span style={{ flex: 1 }}>{t.name}</span>{saved(t.type) ? (saved(t.type)!.active ? <Tag tone="g">Saved</Tag> : <Tag>Off</Tag>) : <Tag tone="a">None</Tag>}
                  </button>))}
              </div>))}
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            <Editor key={`${center.id}:${pick}`} centerId={center.id} type={pick} name={all.find(t => t.type === pick)?.name || pick} saved={saved(pick)}
              onSaved={() => list.reload()} />
          </div>
        </div>)}
    </div>
  );
};

const Editor: React.FC<{ centerId: string; type: string; name: string; saved?: EmailTemplate; onSaved: () => void }> = ({ centerId, type, name, saved, onSaved }) => {
  const booking = BOOKING_TEMPLATES.find(t => t.type === type);
  const vars = booking ? booking.vars : RECEIPT_VARS;
  const [subject, setSubject] = useState(saved?.subject || '');
  const [html, setHtml] = useState(saved?.html || '');
  const [active, setActive] = useState(saved?.active ?? true);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(!booking);
  const changed = subject !== (saved?.subject || '') || html !== (saved?.html || '') || active !== (saved?.active ?? true);
  const preview = useMemo(() => {
    const body = fillTemplate(html, { ...SAMPLE, companyName: 'Property Stars' }, ['note', 'ETRANSFER_INSTRUCTIONS_SECTION']);
    return /<html/i.test(body) ? body : `<!DOCTYPE html><html><body style="margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1c1b1a;">${body}<p style="margin:20px 0 0;color:#3d4148;font-size:14px;">Your name<br>Property Stars · your centre</p></body></html>`;
  }, [html]);

  const generate = async () => {
    setBusy('Writing…'); setError(null); setNotice(null);
    try {
      const r = await aiTemplate({ center_id: centerId, type, instruction: ask || undefined, subject: html ? subject : undefined, html: html || undefined });
      setSubject(r.subject || subject); setHtml(r.html);
      setNotice('Here’s a draft. Read it, change anything, then Save. Nothing is used until you save.');
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('Saving…'); setError(null); setNotice(null);
    try { await saveEmailTemplate(centerId, { type, name, subject, html, active }); setNotice('Saved. Every email of this kind now uses this template as it is.'); onSaved(); }
    catch (e) { setError(e); } finally { setBusy(null); }
  };

  return (
    <Card title={name} right={saved ? <span className="v2-mut v2-small">Saved {new Date(saved.updated_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span> : <Tag tone="a">Not set up</Tag>}>
      {booking && <p className="v2-note" style={{ marginTop: 0 }}>{booking.hint} Each email gets one personal line where <code>{'{{note}}'}</code> sits.</p>}
      <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input className="v2-input" style={{ flex: '1 1 240px' }} placeholder={html ? 'What to change (optional): shorter, mention the gate…' : 'What it should say (optional)'}
          value={ask} onChange={e => setAsk(e.target.value)} />
        <Btn icon={Sparkles} kind="o" onClick={generate} disabled={!!busy}>{busy === 'Writing…' ? busy : html ? 'Rework with AI' : 'Generate with AI'}</Btn>
      </div>
      <Field label="Subject"><input className="v2-input" value={subject} onChange={e => setSubject(e.target.value)} /></Field>
      <div className="v2-label" style={{ marginTop: 6 }}>Preview <span className="v2-mut v2-small">(with a sample customer)</span></div>
      <iframe title="Preview" sandbox="" srcDoc={preview} style={{ width: '100%', height: booking ? 320 : 520, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
      <button type="button" className="v2-link" style={{ border: 0, background: 'none', padding: '6px 0', cursor: 'pointer' }} onClick={() => setShowCode(s => !s)}>{showCode ? 'Hide' : 'Edit'} the HTML</button>
      {showCode && <textarea className="v2-input" style={{ width: '100%', minHeight: 200, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} value={html} onChange={e => setHtml(e.target.value)} />}
      <div className="v2-small v2-mut" style={{ marginTop: 6 }}>Fills in: {vars.map(v => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}</div>
      <label className="v2-check" style={{ border: 0 }}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        <span>{active ? 'On — emails use this template' : booking ? 'Off — booking emails of this kind can’t be sent' : 'Off — receipts use the plain built-in one'}</span></label>
      {notice && <div className="v2-ok" style={{ margin: '8px 0' }}>{notice}</div>}
      <ErrorBox error={error} />
      <div className="v2-row" style={{ gap: 8, marginTop: 8 }}>
        <span className="v2-spacer" />
        <Btn icon={Save} onClick={save} disabled={!!busy || !changed || !subject.trim() || !html.trim()}>{busy === 'Saving…' ? busy : 'Save template'}</Btn>
      </div>
    </Card>
  );
};
