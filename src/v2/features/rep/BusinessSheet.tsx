// src/v2/features/rep/BusinessSheet.tsx — one business: directions, call, hours, the pitch kit, send
// info (text or email with the rep's code), log a visit (with photos, and a business card read into
// the contact), and the rep's own history there. Works with no signal: the visit waits on the phone.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { BookOpen, Camera, ChevronLeft, Copy, ExternalLink, Globe, Mail, MapPin, MessageCircle, MessageSquare, Navigation, Phone, Presentation, QrCode, ScanLine, Send, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  hereNow, kindLabel, OUTCOMES, outcomeOf, photoUrls, repBusiness, repKit, shrinkPhoto, stateAfter, visitArgs, visitProblem, whenLabel,
  type Kit, type LoggedVisit, type Outcome, type PinState, type RepBusinessView,
} from '../../lib/rep';
import {
  DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT, DEFAULT_SMS, fillTemplate, followUpIcs, hoursToday, mailHref, newId, openAt, parseCard, refLink, smsHref,
} from '../../lib/repField';
import { cacheGet, cacheSet, sendOrQueue, type QPhoto } from '../../lib/repQueue';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import { download, useRep } from './repContext';

/** What's known from the map, for when the business can't be loaded (no signal). */
export interface SheetFallback { id: string; name: string; address?: string | null; kind: string; lat: number; lng: number; hours?: unknown; lead?: boolean }
export interface SavedVisit { business: string; outcome: Outcome; state: PinState; here: { lat: number; lng: number } | null; queued: boolean }

async function kitFor(campaign: string): Promise<Kit> {
  try { const k = await repKit(campaign); cacheSet(`kit:${campaign}`, k); return k; }
  catch (e) { const c = await cacheGet<Kit>(`kit:${campaign}`); if (c) return c.data; throw e; }
}

export const BusinessSheet: React.FC<{
  id: string; campaign: string; fallback?: SheetFallback | null; onClose: () => void; onSaved: (v: SavedVisit) => void;
}> = ({ id, campaign, fallback, onClose, onSaved }) => {
  const { session } = useAuth();
  const { toast } = useRep();
  const b = useLoad(() => repBusiness(id, campaign), [id, campaign]);
  const kit = useLoad(() => kitFor(campaign), [campaign]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [cName, setCName] = useState(''); const [cPhone, setCPhone] = useState(''); const [cEmail, setCEmail] = useState('');
  const [when, setWhen] = useState('');
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pitch, setPitch] = useState<null | 'menu' | 'kit' | 'share'>(null);
  const [presenting, setPresenting] = useState(false);
  useEffect(() => () => photos.forEach(p => URL.revokeObjectURL(p.url)), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const d: (RepBusinessView | (SheetFallback & { phone?: null; website?: null; plaza?: null; visits: []; sends: [] })) | null =
    b.data || (fallback ? { ...fallback, phone: null, website: null, plaza: null, visits: [], sends: [] } : null);
  const offline = !b.data && !!fallback && !!b.error;

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const add = [...files].slice(0, 6 - photos.length).map(file => ({ file, url: URL.createObjectURL(file) }));
    setPhotos(p => [...p, ...add]);
  };

  // a business card: the photo is read on the phone and fills the contact
  const scanCard = async (files: FileList | null) => {
    const file = files?.[0]; if (!file) return;
    setScanning(true); setError(null);
    try {
      setPhotos(p => (p.length < 6 ? [...p, { file, url: URL.createObjectURL(file) }] : p));
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker('eng');
      const { data } = await w.recognize(await shrinkPhoto(file, 2000));
      await w.terminate();
      const c = parseCard(data.text || '');
      if (c.name && !cName) setCName(c.name);
      if (c.phone && !cPhone) setCPhone(c.phone);
      if (c.email && !cEmail) setCEmail(c.email);
      if (!c.name && !c.phone && !c.email) setError(new Error('Couldn’t read the card. Type the contact in instead.'));
      else if (c.title) setNotes(n => n || c.title || '');
    } catch { setError(new Error('Couldn’t read the card here (it needs signal the first time). Type the contact in instead.')); }
    finally { setScanning(false); }
  };

  const save = useCallback(async () => {
    if (!outcome || !d) return;
    const input = { outcome, notes, contact_name: cName, contact_phone: cPhone, contact_email: cEmail,
      follow_up_at: when ? new Date(when).toISOString() : null };
    const problem = visitProblem(input);
    if (problem) { setError(new Error(problem)); return; }
    setBusy(true); setError(null);
    try {
      const uid = session?.user.id;
      const client_id = newId();
      const at = new Date().toISOString();
      const here = await hereNow();
      const qp: QPhoto[] = [];
      for (const [i, p] of photos.entries()) {
        const blob = await shrinkPhoto(p.file);
        const ext = blob.type === 'image/jpeg' ? 'jpg' : (p.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        qp.push({ name: `${uid}/${client_id}-${i + 1}.${ext}`, blob, type: blob.type || p.file.type || 'image/jpeg' });
      }
      const args = visitArgs(id, campaign, { ...input, lat: here?.lat, lng: here?.lng, accuracy: here?.accuracy, at, client_id, photos: qp.map(p => p.name) });
      const o = outcomeOf(outcome)!;
      const r = await sendOrQueue({ id: client_id, rpc: 'ms_rep_log_visit', args, photos: qp, label: `${d.name}: ${o.label}`, queued_at: Date.now() });
      const res = r.data as LoggedVisit | undefined;
      const msg = !r.sent ? `${o.label} saved on your phone. It sends when you have signal.`
        : outcome === 'closed' ? 'Deal saved: it’s with an admin to approve.'
        : res?.far ? `${o.label} saved. ${here ? `You were ${res.distance_m} m away, so an admin will see it.` : 'Your location wasn’t available, so an admin will see it.'}`
        : `${o.label} saved.`;
      if (outcome === 'follow_up' && input.follow_up_at) {
        const ics = followUpIcs({ uid: client_id, title: `Follow up: ${d.name}`, at: input.follow_up_at, where: d.address,
          notes: [cName && `Ask for ${cName}`, cPhone, notes].filter(Boolean).join('\n') });
        toast({ msg, actions: [{ label: 'Add to calendar', onClick: () => download(`follow-up-${d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`, ics) }] });
      } else toast(msg);
      onSaved({ business: id, outcome, state: stateAfter(outcome), here: here ? { lat: here.lat, lng: here.lng } : null, queued: !r.sent });
    } catch (e) { setError(e); } finally { setBusy(false); }
  }, [outcome, notes, cName, cPhone, cEmail, when, photos, id, campaign, d, session, toast, onSaved]);

  if (!d) return (
    <Sheet onClose={onClose} label="Business"><ErrorBox error={b.error} />{!b.error && <Loading />}</Sheet>);

  const dirs = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;
  const open = openAt(d.hours);
  const today = hoursToday(d.hours);
  return (
    <Sheet onClose={onClose} label={d.name}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{d.name}</h2>
          <div className="v2-small v2-mut">{kindLabel(d.kind)}{d.plaza ? ` · ${d.plaza}` : ''}{d.lead ? ' · a lead you added' : ''}</div>
          {d.address && <div className="v2-small">{d.address}</div>}
          {today && <div className="v2-small" style={{ marginTop: 2 }}>
            {open != null && <b style={{ color: open ? '#15803d' : '#b91c1c' }}>{open ? 'Open now' : 'Closed now'} · </b>}<span className="v2-mut">Today {today}</span></div>}
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="v2-rep-x"><X size={20} /></button>
      </div>
      {offline && <div className="v2-rep-note">No signal: you can still log a visit, it sends later.</div>}
      <div className="v2-rep-acts">
        <a href={dirs} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a>
        {d.phone && <a href={`tel:${d.phone.replace(/[^0-9+]/g, '')}`}><Phone size={15} />{d.phone}</a>}
        {d.website && <a href={/^https?:/i.test(d.website) ? d.website : `https://${d.website}`} target="_blank" rel="noreferrer"><Globe size={15} />Website<ExternalLink size={12} /></a>}
        <button type="button" onClick={() => setPitch(pitch ? null : 'menu')} className={pitch ? 'on' : ''} aria-expanded={!!pitch}><BookOpen size={15} />Pitch kit</button>
      </div>
      {pitch && (
        <div className="v2-rep-pitch">
          {pitch === 'menu' ? (
            <div className="v2-rep-pitch-menu">
              <button type="button" onClick={() => setPitch('kit')}><BookOpen size={22} /><b>Kit</b><span>Pitch, objections, one-pager</span></button>
              <button type="button" disabled={!kit.data?.present_url} onClick={() => setPresenting(true)}><Presentation size={22} /><b>Present</b>
                <span>{kit.data && !kit.data.present_url ? 'No presentation yet' : 'Show the owner, book a call'}</span></button>
              <button type="button" onClick={() => setPitch('share')}><Send size={22} /><b>Share info</b><span>Text, email, WhatsApp, QR</span></button>
            </div>
          ) : (
            <>
              <button type="button" className="v2-rep-back" onClick={() => setPitch('menu')}><ChevronLeft size={15} />Pitch kit</button>
              {pitch === 'kit' && <KitPanel kit={kit.data} error={kit.error} />}
              {pitch === 'share' && <SendInfo kit={kit.data} error={kit.error} business={d.name} businessId={id} campaign={campaign}
                phone={cPhone || d.phone || ''} email={cEmail} contact={cName} />}
            </>
          )}
        </div>)}
      {presenting && kit.data?.present_url && <Presenter url={kit.data.present_url} code={kit.data.ref} onClose={() => setPresenting(false)} />}

      <div style={{ fontWeight: 800, marginTop: 10 }}>What happened?</div>
      <div className="v2-rep-outs">
        {OUTCOMES.map(o => (
          <button key={o.key} type="button" className={`v2-rep-out${outcome === o.key ? ' on' : ''}`} onClick={() => { setOutcome(o.key); setError(null); }} aria-pressed={outcome === o.key}>
            <b><i className="v2-rep-dot" style={{ background: o.color }} />{o.label}</b><span>{o.hint}</span>
          </button>))}
      </div>
      {outcome === 'follow_up' && (
        <Field label="Follow up on"><input className="v2-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>)}
      {(outcome === 'follow_up' || outcome === 'interested' || outcome === 'closed') && (
        <>
          <div className="v2-rep-row">
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>{outcome === 'follow_up' ? 'Who to ask for' : 'Decision-maker'}</span>
            <label className={`v2-rep-mini${scanning ? ' busy' : ''}`}>
              <ScanLine size={14} />{scanning ? 'Reading the card…' : 'Scan a business card'}
              <input type="file" accept="image/*" capture="environment" hidden disabled={scanning} onChange={e => { scanCard(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <input className="v2-input" placeholder="Name" value={cName} onChange={e => setCName(e.target.value)} autoComplete="off" style={{ marginBottom: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Phone"><input className="v2-input" type="tel" value={cPhone} onChange={e => setCPhone(e.target.value)} autoComplete="off" /></Field>
            <Field label="Email"><input className="v2-input" type="email" value={cEmail} onChange={e => setCEmail(e.target.value)} autoComplete="off" /></Field>
          </div>
        </>)}
      {outcome && (
        <>
          <Field label={outcome === 'cant_sell' ? 'Why can’t you sell here?' : 'Notes'}>
            <textarea className="v2-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
          <div className="v2-rep-photos">
            {photos.map((p, i) => (
              <div key={p.url} className="ph"><img src={p.url} alt={`Photo ${i + 1}`} />
                <button type="button" aria-label="Remove photo" onClick={() => { URL.revokeObjectURL(p.url); setPhotos(ps => ps.filter(x => x !== p)); }}><X size={12} /></button></div>))}
            {photos.length < 6 && (
              <label className="add"><Camera size={18} /><span>Photo</span>
                <input type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} /></label>)}
          </div>
        </>)}
      <ErrorBox error={error} />
      {outcome && <Btn onClick={save} disabled={busy || scanning} style={{ width: '100%', justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e', marginTop: 6 }}>
        {busy ? 'Saving…' : outcome === 'closed' ? 'Save deal for approval' : 'Save visit'}</Btn>}

      {!offline && <History d={d as RepBusinessView} loading={b.loading && !b.data} />}
    </Sheet>
  );
};

const Sheet: React.FC<{ onClose: () => void; label: string; children: React.ReactNode }> = ({ onClose, label, children }) => (
  <div className="v2-rep-sheet-bg" onClick={onClose}>
    <div className="v2-rep-sheet" role="dialog" aria-label={label} onClick={e => e.stopPropagation()}>{children}</div>
  </div>
);

// ───────────── the pitch kit ─────────────
const KitPanel: React.FC<{ kit: Kit | null; error: unknown }> = ({ kit, error }) => {
  if (!kit) return error ? <ErrorBox error={error} /> : <Loading />;
  const empty = !kit.pitch && !kit.objections.length && !kit.onepager_url;
  return (
    <div className="v2-rep-kit">
      {empty && <div className="v2-small v2-mut">No pitch kit for {kit.name} yet. Your admin adds it.</div>}
      {kit.pitch && <div className="pitch">{kit.pitch}</div>}
      {kit.objections.map((o, i) => (
        <details key={i}><summary>“{o.q}”</summary><div>{o.a}</div></details>))}
      {kit.onepager_url && <a href={kit.onepager_url} target="_blank" rel="noreferrer" className="v2-rep-mini"><ExternalLink size={13} />Open the one-pager</a>}
    </div>
  );
};

// ───────────── share info: every channel, each one logged ─────────────
type Channel = 'sms' | 'email' | 'whatsapp' | 'link' | 'qr';
const SendInfo: React.FC<{ kit: Kit | null; error: unknown; business: string; businessId: string; campaign: string; phone: string; email: string; contact: string }> =
  ({ kit, error, business, businessId, campaign, phone, email, contact }) => {
    const { profile } = useAuth();
    const [to, setTo] = useState('');
    const [qr, setQr] = useState<string | null>(null);
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);
    const link = kit ? refLink(kit.info_url, kit.ref) : '';
    const rep = profile?.full_name?.split(' ')[0] || '';
    const vars = { business, link, rep, contact: contact.split(' ')[0] || undefined };
    const typed = to.trim();
    const mobile = (typed && !/@/.test(typed) ? typed : phone).trim();
    const mail = (typed && /@/.test(typed) ? typed : email).trim();
    const sms = kit ? fillTemplate(kit.info_sms || DEFAULT_SMS, vars) : '';
    const subj = kit ? fillTemplate(kit.info_email_subject || DEFAULT_EMAIL_SUBJECT, vars) : '';
    const body = kit ? fillTemplate(kit.info_email_body || DEFAULT_EMAIL_BODY, vars) : '';
    const digits = mobile.replace(/[^0-9]/g, '');
    const wa = `https://wa.me/${digits.length === 10 ? `1${digits}` : digits}?text=${encodeURIComponent(sms)}`;
    const log = (channel: Channel, dest: string) => {
      sendOrQueue({ id: newId(), rpc: 'ms_rep_log_send', args: { p_business: businessId, p_campaign: campaign, p_channel: channel, p_to: dest || null },
        label: `Sent info to ${business}`, queued_at: Date.now() }).catch(() => {});
    };
    useEffect(() => {
      if (!showQr || !link) return;
      QRCode.toDataURL(link, { width: 260, margin: 1 }).then(setQr).catch(() => setQr(null));
    }, [showQr, link]);
    const copy = async () => {
      try { await navigator.clipboard.writeText(sms || link); setCopied(true); setTimeout(() => setCopied(false), 1800); log('link', ''); } catch { /* the link is shown to select by hand */ }
    };
    if (!kit) return error ? <ErrorBox error={error} /> : <Loading />;
    if (!link) return <div className="v2-small v2-mut">Your admin hasn’t added the {kit.name} link yet.</div>;
    return (
      <div className="v2-rep-send">
        <div className="v2-rep-row"><b style={{ fontSize: 13.5 }}>Share info</b><span className="v2-small v2-mut">Your code {kit.ref} is on the link</span></div>
        <input className="v2-input" placeholder={phone || email || 'Their mobile or email'} value={to} onChange={e => setTo(e.target.value)} inputMode="email" autoComplete="off" aria-label="Their mobile or email" />
        <div className="v2-rep-channels">
          <a className={mobile ? '' : 'off'} href={mobile ? smsHref(mobile, sms) : undefined} onClick={() => mobile && log('sms', mobile)} aria-disabled={!mobile}><MessageSquare size={18} />Text</a>
          <a className={mail ? '' : 'off'} href={mail ? mailHref(mail, subj, body) : undefined} onClick={() => mail && log('email', mail)} aria-disabled={!mail}><Mail size={18} />Email</a>
          <a className={digits.length >= 10 ? '' : 'off'} href={digits.length >= 10 ? wa : undefined} target="_blank" rel="noreferrer" onClick={() => digits.length >= 10 && log('whatsapp', mobile)} aria-disabled={digits.length < 10}><MessageCircle size={18} />WhatsApp</a>
          <button type="button" onClick={copy}><Copy size={18} />{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" className={showQr ? 'on' : ''} onClick={() => { if (!showQr) log('qr', ''); setShowQr(!showQr); }}><QrCode size={18} />QR</button>
        </div>
        {!mobile && !mail && <div className="v2-small v2-mut">Type their mobile or email above to text, email or WhatsApp. Ask first: Canada’s anti-spam law needs their OK.</div>}
        {showQr && <div className="v2-rep-qr">{qr ? <img src={qr} alt="QR code for the information link" /> : <Loading />}<div className="v2-small v2-mut">They scan it with their camera.</div></div>}
        <div className="v2-small v2-mut" style={{ overflowWrap: 'anywhere', marginTop: 6 }}>{link}</div>
      </div>
    );
  };

// ───────────── present: the campaign's deck, full screen ─────────────
const Presenter: React.FC<{ url: string; code: string; onClose: () => void }> = ({ url, code, onClose }) => {
  const src = `${url}#embed=1&ref=${encodeURIComponent(code)}`;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="v2-rep-present" role="dialog" aria-label="Presentation">
      <iframe src={src} title="Presentation" />
      <button type="button" className="close" onClick={onClose} aria-label="Close the presentation"><X size={20} /></button>
    </div>
  );
};

// ───────────── the rep's history here ─────────────
const History: React.FC<{ d: RepBusinessView; loading: boolean }> = ({ d, loading }) => {
  const paths = useMemo(() => d.visits.flatMap(v => v.photos || []), [d.visits]);
  const urls = useLoad(() => photoUrls(paths), [paths.join('|')]);
  if (loading) return <Loading />;
  return (
    <>
      <div style={{ fontWeight: 800, margin: '16px 0 2px' }}>Your visits</div>
      {!d.visits.length && <div className="v2-small v2-mut">None yet.</div>}
      {d.visits.map(v => {
        const o = outcomeOf(v.outcome);
        return (
          <div key={v.id} className="v2-rep-visit">
            <div className="h"><i className="v2-rep-dot" style={{ background: o?.color }} /><b>{o?.label}</b><span className="v2-mut v2-small">{whenLabel(v.at)}</span>
              {v.far && <span className="v2-small" style={{ color: '#b45309', marginLeft: 'auto' }}><MapPin size={12} /> {v.distance_m != null ? `${v.distance_m} m away` : 'no location'}</span>}</div>
            {v.deal && <div className="v2-small" style={{ color: v.deal === 'approved' ? '#15803d' : v.deal === 'rejected' ? '#7e22ce' : '#6b7280' }}>
              Deal {v.deal === 'pending' ? 'waiting for approval' : v.deal === 'approved' ? 'approved' : 'not approved'}{v.deal_note ? `: ${v.deal_note}` : ''}</div>}
            {v.follow_up_at && <div className="v2-small">Follow up {whenLabel(v.follow_up_at)}</div>}
            {(v.contact_name || v.contact_phone || v.contact_email) && <div className="v2-small">{[v.contact_name, v.contact_phone, v.contact_email].filter(Boolean).join(' · ')}</div>}
            {v.notes && <div className="v2-small v2-mut">{v.notes}</div>}
            {!!v.photos?.length && <div className="v2-rep-photos sm">{v.photos.map(p => urls.data?.[p]
              ? <a key={p} className="ph" href={urls.data[p]} target="_blank" rel="noreferrer"><img src={urls.data[p]} alt="Visit photo" /></a>
              : <div key={p} className="ph" />)}</div>}
            {v.resolution && <div className="v2-small v2-mut">{v.resolution === 'removed' ? 'An admin took it off the list.' : 'An admin put it back on your list.'}</div>}
          </div>);
      })}
      {!!d.sends.length && (
        <>
          <div style={{ fontWeight: 800, margin: '14px 0 2px' }}>Info sent</div>
          {d.sends.map((s, i) => <div key={i} className="v2-small v2-rep-visit">{({ sms: 'Text', email: 'Email', whatsapp: 'WhatsApp', link: 'Link copied', qr: 'QR shown' } as Record<string, string>)[s.channel] || s.channel}{s.to ? ` to ${s.to}` : ''} · {whenLabel(s.at)}</div>)}
        </>)}
    </>
  );
};

