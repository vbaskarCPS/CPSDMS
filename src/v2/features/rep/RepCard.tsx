// src/v2/features/rep/RepCard.tsx — the rep's digital business card: share it (QR code to scan at the door, the link
// to copy, text or email) and edit it (photo, title, phone, email, about, links, style) with a live preview.
// Plus "From your card": owners who sent their details back from the card, to call, email or add to the map.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Copy, Mail, MapPin, MessageSquare, Pencil, Phone, Share2, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  CARD_STYLES, cardCampaigns, cardLeads, cardUrl, markCardLead, myCard, photoUrl, saveCard, uploadCardPhoto,
  type Card, type CardLink, type CardStyle,
} from '../../lib/repCard';
import { CardView } from '../../../pages/CardPage';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import { useRep } from './repContext';

export const RepCardScreen: React.FC = () => {
  const camps = useLoad(() => cardCampaigns(), []);
  const [camp, setCamp] = useState<string | null>(null);
  const campaign = camp || camps.data?.[0]?.id || null;
  const card = useLoad(() => (campaign ? myCard(campaign) : Promise.resolve(null)), [campaign]);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState<Card | null>(null);
  useEffect(() => { if (card.data) setCurrent(card.data); }, [card.data]);

  if (camps.loading && !camps.data) return <Loading label="Loading your card…" />;
  if (camps.error) return <ErrorBox error={camps.error} />;
  if (!camps.data?.length) return <><h1>My business card</h1><div className="v2-rep-zone v2-mut">You’re not on a campaign yet, so there’s no card to show.</div></>;
  return (
    <>
      <h1>My business card</h1>
      {camps.data.length > 1 && (
        <div className="v2-rep-kinds" style={{ marginBottom: 10 }}>
          {camps.data.map(c => <button key={c.id} type="button" className={`v2-rep-pill${c.id === campaign ? ' on' : ''}`} onClick={() => { setCamp(c.id); setEditing(false); }}>{c.name}</button>)}
        </div>)}
      <ErrorBox error={card.error} />
      {!current ? <Loading /> : editing
        ? <CardEditor card={current} campaign={campaign!} onDone={c => { if (c) setCurrent(c); setEditing(false); }} />
        : <CardShare card={current} onEdit={() => setEditing(true)} />}
    </>
  );
};

// ───────────── share: the QR code, the link ─────────────
const CardShare: React.FC<{ card: Card; onEdit: () => void }> = ({ card, onEdit }) => {
  const { toast } = useRep();
  const url = cardUrl(card.slug);
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr('')); }, [url]);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); } };
  const share = async () => {
    try { await navigator.share({ title: `${card.name} · ${card.campaign.name}`, text: `Here’s my card: ${card.name}, ${card.campaign.name}`, url }); }
    catch { /* cancelled or not supported */ }
  };
  const msg = encodeURIComponent(`Hi, it’s ${card.name.split(' ')[0]} from ${card.campaign.name}. Here’s my card: ${url}`);
  return (
    <>
      <div className="v2-rep-zone" style={{ textAlign: 'center' }}>
        <div className="v2-small v2-mut" style={{ marginBottom: 6 }}>Let them scan this with their phone camera</div>
        {qr ? <img src={qr} alt={`QR code for ${url}`} style={{ width: 'min(260px, 70vw)', height: 'auto', imageRendering: 'pixelated' }} /> : <Loading />}
        <div className="v2-small" style={{ wordBreak: 'break-all', marginTop: 6 }}>{url.replace(/^https:\/\//, '')}</div>
        <div className="v2-rep-acts" style={{ justifyContent: 'center', marginTop: 10 }}>
          {typeof navigator.share === 'function' && <button type="button" onClick={share}><Share2 size={15} />Share</button>}
          <button type="button" onClick={copy}><Copy size={15} />Copy link</button>
          <a href={`sms:?&body=${msg}`}><MessageSquare size={15} />Text it</a>
          <a href={`mailto:?subject=${encodeURIComponent(`${card.name} · ${card.campaign.name}`)}&body=${msg}`}><Mail size={15} />Email it</a>
        </div>
      </div>
      <div className="v2-rep-row" style={{ margin: '14px 0 6px' }}>
        <b>How it looks</b>
        <button type="button" className="v2-rep-mini" onClick={onEdit}><Pencil size={13} />Edit my card</button>
      </div>
      <div className="v2-rep-cardframe"><CardView card={card} preview /></div>
    </>
  );
};

// ───────────── edit, with a live preview ─────────────
const CardEditor: React.FC<{ card: Card; campaign: string; onDone: (c: Card | null) => void }> = ({ card, campaign, onDone }) => {
  const { session } = useAuth();
  const { toast } = useRep();
  const [f, setF] = useState({ title: card.title || '', phone: card.phone || '', email: card.email || '', about: card.about || '', style: card.style });
  const [photo, setPhoto] = useState<string | null>(card.photo_path);
  const [links, setLinks] = useState<CardLink[]>(card.links.length ? card.links : []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cleanLinks = (ls: CardLink[]) => ls.map(l => ({ label: l.label.trim(), url: l.url.trim() && !/^https?:\/\//i.test(l.url.trim()) ? `https://${l.url.trim()}` : l.url.trim().replace(/^http:/i, 'https:') }))
    .filter(l => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(l.url));
  const preview: Card = useMemo(() => ({ ...card, ...f, title: f.title || null, phone: f.phone || null, email: f.email || null, about: f.about || null, photo_path: photo, links: cleanLinks(links) }), [card, f, photo, links]);
  const pick = async (files: FileList | null) => {
    const file = files?.[0]; if (!file || !session?.user.id) return;
    setUploading(true); setError(null);
    try { setPhoto(await uploadCardPhoto(session.user.id, file)); } catch (e) { setError(e); } finally { setUploading(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { const c = await saveCard(campaign, { ...f, photo_path: photo, links: cleanLinks(links) }); toast('Card saved.'); onDone(c); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const setLink = (i: number, k: keyof CardLink, v: string) => setLinks(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const purl = photoUrl(photo);
  return (
    <>
      <div className="v2-rep-zone">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          {purl ? <img src={purl} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e5e7eb' }} />}
          <div>
            <label className={`v2-rep-mini${uploading ? ' busy' : ''}`}>{uploading ? 'Uploading…' : purl ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/*" hidden disabled={uploading} onChange={e => { pick(e.target.files); e.target.value = ''; }} /></label>
            {purl && <button type="button" className="v2-rep-mini" style={{ marginLeft: 6 }} onClick={() => setPhoto(null)}>Remove</button>}
          </div>
        </div>
        <Field label="Title"><input className="v2-input" value={f.title} maxLength={60} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Business Advisor" /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Phone"><input className="v2-input" type="tel" value={f.phone} maxLength={30} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><input className="v2-input" type="email" value={f.email} maxLength={120} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <Field label={`About you (${240 - f.about.length} left)`}>
          <textarea className="v2-input" rows={2} value={f.about} maxLength={240} onChange={e => setF({ ...f, about: e.target.value })} placeholder="One or two lines about how you help local businesses." />
        </Field>
        <div style={{ fontWeight: 700, fontSize: 13.5, margin: '8px 0 4px' }}>Links <span className="v2-mut" style={{ fontWeight: 400 }}>(up to 4)</span></div>
        {links.map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.4fr auto', gap: 6, marginBottom: 6 }}>
            <input className="v2-input" placeholder="Label (LinkedIn)" value={l.label} maxLength={40} onChange={e => setLink(i, 'label', e.target.value)} aria-label="Link label" />
            <input className="v2-input" placeholder="https://…" value={l.url} onChange={e => setLink(i, 'url', e.target.value)} aria-label="Link address" inputMode="url" />
            <button type="button" className="v2-rep-x" aria-label="Remove link" onClick={() => setLinks(ls => ls.filter((_, j) => j !== i))}><X size={16} /></button>
          </div>))}
        {links.length < 4 && <button type="button" className="v2-rep-mini" onClick={() => setLinks(ls => [...ls, { label: '', url: '' }])}>Add a link</button>}
        <div style={{ fontWeight: 700, fontSize: 13.5, margin: '12px 0 4px' }}>Style</div>
        <div className="v2-rep-kinds">
          {CARD_STYLES.map(s => <button key={s.key} type="button" className={`v2-rep-pill${f.style === s.key ? ' on' : ''}`} onClick={() => setF({ ...f, style: s.key as CardStyle })}>{s.label}</button>)}
        </div>
        <ErrorBox error={error} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Btn kind="o" onClick={() => onDone(null)} disabled={busy}>Cancel</Btn>
          <Btn onClick={save} disabled={busy || uploading} style={{ flex: 1, justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e' }}>{busy ? 'Saving…' : 'Save card'}</Btn>
        </div>
      </div>
      <div style={{ fontWeight: 700, margin: '14px 0 6px' }}>Preview</div>
      <div className="v2-rep-cardframe"><CardView card={preview} preview /></div>
    </>
  );
};

// ───────────── owners who sent their details from the card ─────────────
export const CardLeads: React.FC = () => {
  const { toast } = useRep();
  const [tick, setTick] = useState(0);
  const list = useLoad(() => cardLeads().catch(() => []), [tick]);
  if (!list.data?.length) return null;
  const dismiss = async (id: string) => { try { await markCardLead(id, 'dismissed'); setTick(t => t + 1); } catch { toast('Couldn’t update that. Try again.'); } };
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="v2-rep-group">From your card · {list.data.length}</div>
      {list.data.map(l => (
        <div key={l.id} className="v2-rep-item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="n">{l.business || l.name}</div>
            <div className="a">{[l.business ? l.name : null, l.phone, l.email].filter(Boolean).join(' · ')}</div>
            {l.address && <div className="a">{l.address}</div>}
            {l.note && <div className="a" style={{ fontStyle: 'italic' }}>“{l.note}”</div>}
          </div>
          <div className="v2-rep-acts" style={{ width: '100%', margin: '6px 0 0' }}>
            {l.phone && <a href={`tel:${l.phone.replace(/[^0-9+]/g, '')}`}><Phone size={14} />Call</a>}
            {l.email && <a href={`mailto:${l.email}`}><Mail size={14} />Email</a>}
            <Link to={`/app/rep?cardlead=${l.id}`}><MapPin size={14} />Add to map</Link>
            <button type="button" onClick={() => dismiss(l.id)}>Dismiss</button>
          </div>
        </div>))}
    </div>
  );
};
