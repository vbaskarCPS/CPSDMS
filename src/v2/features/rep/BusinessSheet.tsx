// src/v2/features/rep/BusinessSheet.tsx — one business, as a full page: directions, call, hours; the
// Present (the deck: pitch, questions, proposal, booking); log a visit (with photos, and a business
// card read into the contact); the email conversations with it; and the rep's own history there.
// The questionnaire and proposal saved from the deck can be seen again, reopened in the deck filled in, and emailed
// to the owner (on its own, or with a follow-up: the copy opens in the email composer to check before sending).
// Works with no signal: the visit waits on the phone.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, ChevronRight, ClipboardList, ExternalLink, Globe, Mail, MapPin, Navigation, Phone, Presentation, ScanLine, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { inbox, mailWhen } from '../../lib/mail';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  DOOR_OUTCOMES, hereNow, kindLabel, outcomeOf, photoUrls, repBusiness, repKit, shrinkPhoto, stateAfter, visitArgs, visitProblem, whenLabel,
  type Kit, type LoggedVisit, type Outcome, type PinState, type RepBusinessView,
} from '../../lib/rep';
import {
  followUpIcs, newId, parseCard,
} from '../../lib/repField';
import { LOST_REASONS, markPitched, setLost } from '../../lib/msPipeline';
import { cacheGet, cacheSet, sendOrQueue, type QPhoto } from '../../lib/repQueue';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import { BookOnboarding } from './BookOnboarding';
import { hasAnswers, repDeckAnswers, saveDeckAnswers, type DeckAnswers } from '../../lib/meetings';
import { deckEmail, followupNoFigures } from '../../lib/deckEmail';
import { AnswersPanel } from '../meetings/shared';
import { Composer, type ComposeInit } from '../mail/Composer';
import { DoNotKnock, People } from './People';
import { StageCard, TimelineToggle } from './Stage';
import { dnkLabel, loadOcr } from '../../lib/msField';
import { download, useRep } from './repContext';

/** What's known from the map, for when the business can't be loaded (no signal). */
export interface SheetFallback { id: string; name: string; address?: string | null; kind: string; lat: number; lng: number; hours?: unknown; lead?: boolean }
export interface SavedVisit { business: string; outcome: Outcome; state: PinState; here: { lat: number; lng: number } | null; queued: boolean }

/** The contact email from the rep's latest visit with one. */
function lastEmail(d: { visits?: { contact_email?: string }[] }): string {
  return d.visits?.find(v => v.contact_email)?.contact_email || '';
}

async function kitFor(campaign: string): Promise<Kit> {
  try { const k = await repKit(campaign); cacheSet(`kit:${campaign}`, k); return k; }
  catch (e) { const c = await cacheGet<Kit>(`kit:${campaign}`); if (c) return c.data; throw e; }
}

export const BusinessSheet: React.FC<{
  id: string; campaign: string; fallback?: SheetFallback | null; onClose: () => void; onSaved: (v: SavedVisit) => void;
  /** it came off the list (do not knock) */
  onGone?: () => void;
  /** its stage changed here without a visit (presenting the deck makes it Pitched) */
  onStage?: (stage: string) => void;
}> = ({ id, campaign, fallback, onClose, onSaved, onGone, onStage }) => {
  const { session } = useAuth();
  const { toast } = useRep();
  const b = useLoad(() => repBusiness(id, campaign), [id, campaign]);
  const kit = useLoad(() => kitFor(campaign), [campaign]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lostWhy, setLostWhy] = useState('');
  const [notes, setNotes] = useState('');
  const [cName, setCName] = useState(''); const [cPhone, setCPhone] = useState(''); const [cEmail, setCEmail] = useState('');
  const [when, setWhen] = useState('');
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mail = useLoad(() => inbox('inbox', undefined, id).catch(() => []), [id]);
  const [presenting, setPresenting] = useState(false);
  const [booking, setBooking] = useState(false);
  const booked = React.useRef(false);
  // the deck's questions screen: the latest answers, saved on the business when the deck closes (and before booking)
  const answers = React.useRef<DeckAnswers | null>(null);
  const savedAnswers = React.useRef('');
  const [peopleTick, setPeopleTick] = useState(0);
  const keepAnswers = useCallback(() => {
    const a = answers.current; if (!hasAnswers(a)) return;
    const k = JSON.stringify(a); if (k === savedAnswers.current) return;
    savedAnswers.current = k;
    saveDeckAnswers(id, campaign, a).then(() => setPeopleTick(t => t + 1)).catch(() => { savedAnswers.current = ''; });
  }, [id, campaign]);
  // what the rep typed on the deck fills the visit and booking forms
  const onDeckAnswers = useCallback((a: DeckAnswers) => {
    answers.current = a;
    const c = a.contact;
    if (c) { if (c.name) setCName(c.name); if (c.phone) setCPhone(c.phone); if (c.email) setCEmail(c.email); }
  }, []);
  useEffect(() => () => photos.forEach(p => URL.revokeObjectURL(p.url)), []);   // eslint-disable-line react-hooks/exhaustive-deps
  // the questionnaire and proposal saved on the business (from this visit or an earlier one)
  const saved = useLoad(() => repDeckAnswers(id, campaign).catch(() => null), [id, campaign, peopleTick]);
  useEffect(() => {
    const s = saved.data?.data; if (!hasAnswers(s)) return;
    if (!answers.current) { answers.current = s; savedAnswers.current = JSON.stringify(s); }
    const c = s.contact;   // the contact they gave in the deck fills an empty visit form
    if (c) { setCName(n => n || c.name || ''); setCPhone(p => p || c.phone || ''); setCEmail(e => e || c.email || ''); }
  }, [saved.data]);
  const [showAnswers, setShowAnswers] = useState(false);
  const [emailCopy, setEmailCopy] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const afterCompose = React.useRef<null | (() => void)>(null);

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
      const createWorker = await loadOcr();
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

  // a copy of the questionnaire and proposal, as an email to the owner, opened in the composer to check
  // with a proposal: a copy of their answers and proposal. Without one: a short follow-up with no figures.
  const copyInit = useCallback((to: string, followUpAt: string | null): ComposeInit | null => {
    if (!d) return null;
    const a = answers.current;
    const e = hasAnswers(a) && a.proposal
      ? deckEmail({ business: d.name, campaign: kit.data?.name || 'taxifi', answers: a, contactName: cName, followUpAt })
      : followupNoFigures({ business: d.name, campaign: kit.data?.name || 'taxifi', contactName: cName || a?.contact?.name, followUpAt, infoUrl: kit.data?.info_url });
    return { key: `deckcopy:${id}:${campaign}:${Date.now()}`, business_id: id, campaign_id: campaign,
      title: hasAnswers(a) && a.proposal ? 'Questionnaire & proposal' : 'Follow-up email',
      to: to ? [to] : [], subject: e.subject, html: e.html, context: `${d.name} · ${kit.data?.name || ''}`.replace(/ · $/, '') };
  }, [d, id, campaign, kit.data, cName]);

  const save = useCallback(async () => {
    if (!outcome || !d) return;
    if (outcome === 'follow_up' && emailCopy && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail.trim())) { setError(new Error('Add their email to send them the copy.')); return; }
    if (outcome === 'not_interested' && !lostWhy) { setError(new Error('Pick why they’re not interested.')); return; }
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
      // Not interested is Lost, with the reason (when there's signal; without it the stage still reads it from the visit)
      if (outcome === 'not_interested' && r.sent) await setLost(id, campaign, lostWhy).catch(() => undefined);
      const msg = !r.sent ? `${o.label} saved on your phone. It sends when you have signal.`
        : outcome === 'closed' ? 'Deal saved.'
        : res?.far ? `${o.label} saved. ${here ? `You were ${res.distance_m} m away, so an admin will see it.` : 'Your location wasn’t available, so an admin will see it.'}`
        : `${o.label} saved.`;
      if (outcome === 'follow_up' && input.follow_up_at) {
        const ics = followUpIcs({ uid: client_id, title: `Follow up: ${d.name}`, at: input.follow_up_at, where: d.address,
          notes: [cName && `Ask for ${cName}`, cPhone, notes].filter(Boolean).join('\n') });
        toast({ msg, actions: [{ label: 'Add to calendar', onClick: () => download(`follow-up-${d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`, ics) }] });
      } else toast(msg);
      const done = () => onSaved({ business: id, outcome, state: stateAfter(outcome), here: here ? { lat: here.lat, lng: here.lng } : null, queued: !r.sent });
      // the copy of their questionnaire and proposal: checked in the composer first, then the visit closes
      const copy = outcome === 'follow_up' && emailCopy ? copyInit(cEmail.trim(), input.follow_up_at) : null;
      if (copy && r.sent) { afterCompose.current = done; setCompose(copy); return; }
      if (copy) toast('No signal: the visit is saved. Send the email later from this business once you have signal.');
      done();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }, [outcome, lostWhy, notes, cName, cPhone, cEmail, when, photos, id, campaign, d, session, toast, onSaved, emailCopy, copyInit]);
  const closeCompose = (sent: boolean) => {
    setCompose(null);
    if (sent) toast('Copy sent.');
    const f = afterCompose.current; afterCompose.current = null; f?.();
  };
  const view = hasAnswers(answers.current) ? answers.current : saved.data?.data;



  if (!d) return (
    <Sheet onClose={onClose} label="Business"><ErrorBox error={b.error} />{!b.error && <Loading />}</Sheet>);

  const dirs = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;
  return (
    <Sheet onClose={onClose} label={d.name}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="v2-rep-bname">{d.name}</h1>
          <div className="v2-small v2-mut">{kindLabel(d.kind)}{d.plaza ? ` · ${d.plaza}` : ''}{d.lead ? ' · a lead you added' : ''}</div>
          {d.address && <div className="v2-small">{d.address}</div>}
        </div>
      </div>
      {offline && <div className="v2-rep-note">No signal: you can still log a visit, it sends later.</div>}
      <div className="v2-rep-acts">
        <a href={dirs} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a>
        {d.phone && <a href={`tel:${d.phone.replace(/[^0-9+]/g, '')}`}><Phone size={15} />{d.phone}</a>}
        {d.website && <a href={/^https?:/i.test(d.website) ? d.website : `https://${d.website}`} target="_blank" rel="noreferrer"><Globe size={15} />Website<ExternalLink size={12} /></a>}
      </div>

      {!offline && <StageCard business={id} campaign={campaign} tick={peopleTick} />}
      <div className="v2-rep-cards">
        <button type="button" className="v2-rep-card present" disabled={!kit.data?.present_url} onClick={() => {
          setPresenting(true);
          // showing the deck is the pitch: the stage (and the pin) move to Pitched now
          markPitched(id, campaign).then(st => { setPeopleTick(t => t + 1); onStage?.(st.stage); }).catch(() => undefined);
        }}>
          <Presentation size={26} /><span><b>Present</b><em>{kit.data && !kit.data.present_url ? 'No presentation for this campaign yet' : hasAnswers(view) ? 'Opens with their answers filled in' : 'Show the owner and book a call'}</em></span><ChevronRight size={20} />
        </button>
        {hasAnswers(view) && (
          <button type="button" className="v2-rep-card" onClick={() => setShowAnswers(true)}>
            <ClipboardList size={26} /><span><b>Questionnaire &amp; proposal</b><em>{view.proposal ? `About $${Math.round(view.proposal.yearly).toLocaleString('en-CA')} a year · ` : ''}See it or email it to them</em></span><ChevronRight size={20} />
          </button>)}
      </div>
      {showAnswers && hasAnswers(view) && (
        <div className="v2-rep-sheet-bg" onClick={() => setShowAnswers(false)}>
          <div className="v2-rep-sheet" role="dialog" aria-label="Questionnaire and proposal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ flex: 1 }}>Questionnaire &amp; proposal</h2>
              <button type="button" aria-label="Close" onClick={() => setShowAnswers(false)} className="v2-rep-x"><X size={20} /></button></div>
            {saved.data && <div className="v2-small v2-mut" style={{ margin: '2px 0 8px' }}>Saved {whenLabel(saved.data.updated_at)}{saved.data.updated_by ? ` by ${saved.data.updated_by}` : ''}</div>}
            <AnswersPanel a={view} open />
            <div className="v2-rep-acts" style={{ marginTop: 10 }}>
              {kit.data?.present_url && <button type="button" onClick={() => { setShowAnswers(false); setPresenting(true); }}><Presentation size={15} />Open in the deck</button>}
              <button type="button" onClick={() => { const c = copyInit(cEmail || view.contact?.email || lastEmail(d), null); if (c) { setShowAnswers(false); setCompose(c); } }}><Mail size={15} />Email it to them</button>
            </div>
          </div>
        </div>)}
      {compose && <Composer init={compose} onClose={() => closeCompose(false)} onSent={() => closeCompose(true)} />}
      {presenting && kit.data?.present_url && <Presenter url={kit.data.present_url} code={kit.data.ref} fill={hasAnswers(answers.current) ? answers.current : null}
        onClose={() => { keepAnswers(); setPresenting(false); }} onBook={() => setBooking(true)} onAnswers={onDeckAnswers}
        onEmail={() => { keepAnswers(); const c = copyInit(cEmail || answers.current?.contact?.email || lastEmail(d), null); if (c) { setPresenting(false); setCompose(c); } }} />}
      {booking && <BookOnboarding campaign={campaign} business={id} businessName={d.name} answers={answers.current}
        owner={{ name: cName, phone: cPhone || d.phone || '', email: cEmail || lastEmail(d) }}
        onBooked={() => { booked.current = true; }}
        onClose={() => {
          setBooking(false);
          // once booked, the visit is saved as a closed deal: close the deck and the business like any saved visit
          if (booked.current) { booked.current = false; keepAnswers(); setPresenting(false); toast('Onboarding booked. It’s won once the host closes it on the call.'); onSaved({ business: id, outcome: 'closed', state: stateAfter('closed'), here: null, queued: false }); }
        }} />}

      {!!mail.data?.length && (
        <div className="v2-rep-mail">
          <div className="v2-rep-row"><b style={{ fontSize: 14 }}>Emails</b><Link to="/app/rep/inbox" className="v2-rep-mini">Inbox</Link></div>
          {mail.data.slice(0, 4).map(t => (
            <Link key={t.id} to={`/app/rep/inbox?t=${t.id}`} className={`v2-rep-mailrow${t.unread ? ' unread' : ''}`}>
              <span className="s">{t.subject || '(no subject)'}</span><span className="w">{mailWhen(t.last_at)}</span>
              <span className="p">{t.last_dir === 'in' ? `${t.contact_name || t.contact_email}: ` : 'You: '}{t.snippet}</span>
            </Link>))}
        </div>)}

      <div style={{ fontWeight: 800, marginTop: 10 }}>What happened?</div>
      <div className="v2-rep-outs">
        {/* the rest moves the stage by itself: Present (pitched), booking onboarding (booked, the deal), the host (won / lost) */}
        {DOOR_OUTCOMES.map(o => (
          <button key={o.key} type="button" className={`v2-rep-out${outcome === o.key ? ' on' : ''}`} onClick={() => { setOutcome(o.key); setError(null); }} aria-pressed={outcome === o.key}>
            <b><i className="v2-rep-dot" style={{ background: o.color }} />{o.label}</b><span>{o.hint}</span>
          </button>))}
      </div>
      {outcome === 'not_interested' && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 8 }}>Why? <span className="v2-mut" style={{ fontWeight: 400 }}>(marks it lost)</span></div>
          <div className="v2-rep-kinds" style={{ marginTop: 6 }}>
            {LOST_REASONS.map(r => <button key={r} type="button" className={`v2-rep-pill${lostWhy === r ? ' on' : ''}`} onClick={() => { setLostWhy(lostWhy === r ? '' : r); setError(null); }} aria-pressed={lostWhy === r}>{r}</button>)}
          </div>
        </>)}
      {outcome === 'follow_up' && (
        <Field label="Follow up on"><input className="v2-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>)}
      {outcome === 'follow_up' && (
        <label className="v2-rep-check">
          <input type="checkbox" checked={emailCopy} onChange={e => { setEmailCopy(e.target.checked); setError(null); }} />
          {hasAnswers(view) && view.proposal
            ? <span><b>Email them a copy of their questionnaire &amp; proposal</b>
                <span className="v2-small v2-mut">Opens in your email after you save, with the follow-up time, to check before you send it.</span></span>
            : <span><b>Email them a follow-up</b>
                <span className="v2-small v2-mut">A short thank-you with no figures and when you’ll be back. Opens in your email after you save, to check before you send it.</span></span>}
        </label>)}
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
        {busy ? 'Saving…' : outcome === 'closed' ? 'Save deal' : 'Save visit'}</Btn>}

      <People business={id} campaign={campaign} offline={offline} tick={peopleTick} />
      {!offline && <History d={d as RepBusinessView} loading={b.loading && !b.data} />}
      {!offline && <TimelineToggle business={id} campaign={campaign} tick={peopleTick} />}
      {!offline && <DoNotKnock business={id} campaign={campaign} name={d.name}
        onDone={r => { toast(`${d.name}: ${dnkLabel(r).toLowerCase()}. It’s off every rep’s list.`); (onGone || onClose)(); }} />}
    </Sheet>
  );
};

const Sheet: React.FC<{ onClose: () => void; label: string; children: React.ReactNode }> = ({ onClose, label, children }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.v2-mail-compose, .v2-rep-present')) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="v2-rep-page" role="dialog" aria-label={label}>
      <div className="v2-rep-page-top">
        <button type="button" onClick={onClose} aria-label="Back"><ArrowLeft size={21} /></button>
        <span className="t">{label}</span>
      </div>
      <div className="v2-rep-page-body"><div className="in">{children}</div></div>
    </div>
  );
};

// ───────────── present: the campaign's deck, full screen ─────────────
const Presenter: React.FC<{ url: string; code: string; fill?: DeckAnswers | null; onClose: () => void; onBook: () => void; onAnswers: (a: DeckAnswers) => void; onEmail: () => void }> = ({ url, code, fill, onClose, onBook, onAnswers, onEmail }) => {
  // the answers saved on the business go back into the deck once it has loaded (only the first answers it opened with)
  const fillAt = React.useRef(fill);
  const onLoad = () => { const f = fillAt.current; if (f) frame.current?.contentWindow?.postMessage({ type: 'ms-deck-fill', data: f }, new URL(url, location.href).origin); };
  const src = `${url}#embed=1&ref=${encodeURIComponent(code)}`;
  const frame = React.useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.v2-rep-book')) onClose(); };
    // the deck's last slide: "Book onboarding" (only from this deck's frame)
    const msg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type?: string; data?: DeckAnswers } | null;
      if (m?.type === 'ms-deck-answers' && m.data && typeof m.data === 'object') onAnswers(m.data);
      if (m?.type === 'ms-book-onboarding') onBook();
      if (m?.type === 'ms-email-proposal') onEmail();
    };
    window.addEventListener('keydown', esc); window.addEventListener('message', msg);
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('message', msg); };
  }, [onClose, onBook, onAnswers, onEmail]);
  return (
    <div className="v2-rep-present" role="dialog" aria-label="Presentation">
      <iframe ref={frame} src={src} title="Presentation" onLoad={onLoad} />
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
              {v.deal === 'pending' ? 'Onboarding booked' : v.deal === 'approved' ? 'Won' : 'Not a fit'}{v.deal_note ? `: ${v.deal_note}` : ''}</div>}
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

