// src/pages/CardPage.tsx — a MainstreetAI rep's digital business card: /card/<slug>. Public (no login).
// Save contact (.vcf), call / text / email, the rep's links and the campaign's link, and "Share my info", which sends
// the owner's details to the rep as a lead. The look is one of four styles in the campaign's colour.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cardTheme, cardUrl, photoUrl, publicCard, shareMyInfo, vcard, type Card } from '../v2/lib/repCard';

const initials = (n: string) => n.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

export const CardView: React.FC<{ card: Card; preview?: boolean }> = ({ card, preview }) => {
  const t = cardTheme(card.style, card.campaign.color);
  const url = cardUrl(card.slug);
  const photo = photoUrl(card.photo_path);
  const [form, setForm] = useState(false);
  const [f, setF] = useState({ name: '', business: '', address: '', phone: '', email: '', note: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const save = () => {
    const blob = new Blob([vcard(card, url)], { type: 'text/vcard' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${card.name.replace(/[^a-z0-9]+/gi, '-')}.vcf`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const send = async () => {
    if (preview) return;
    setErr('');
    if (!f.name.trim()) { setErr('Add your name'); return; }
    if (!f.phone.trim() && !f.email.trim()) { setErr('Add a phone number or an email'); return; }
    setBusy(true);
    try { await shareMyInfo(card.slug, f); setSent(true); setForm(false); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t send that. Try again.'); }
    finally { setBusy(false); }
  };
  const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 14px', borderRadius: 12,
    fontWeight: 700, fontSize: 15, textDecoration: 'none', border: 0, cursor: 'pointer', width: '100%' };
  const solid: React.CSSProperties = { ...btn, background: card.style === 'bold' ? '#ffffff' : t.accent, color: card.style === 'bold' ? t.accent : '#ffffff' };
  const ghost: React.CSSProperties = { ...btn, background: t.card, color: t.fg, border: card.style === 'minimal' || card.style === 'classic' ? '1.5px solid #e5e7eb' : '0' };
  const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1.5px solid #d1d5db', fontSize: 15, marginTop: 8, background: '#fff', color: '#111827' };
  const tel = card.phone ? card.phone.replace(/[^0-9+]/g, '') : '';
  return (
    <div style={{ minHeight: preview ? undefined : '100vh', background: t.bg, color: t.fg, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', padding: preview ? 0 : '0 0 32px' }}>
        <div style={{ background: t.head, color: t.headFg, padding: '22px 20px 54px', textAlign: 'center', borderBottom: card.style === 'minimal' ? `3px solid ${t.accent}` : undefined }}>
          <div style={{ fontWeight: 900, letterSpacing: '.02em', fontSize: 18, color: card.style === 'minimal' ? t.accent : t.headFg }}>{card.campaign.name}</div>
        </div>
        <div style={{ textAlign: 'center', marginTop: -46, padding: '0 20px' }}>
          {photo
            ? <img src={photo} alt={card.name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: `4px solid ${t.bg}`, background: '#e5e7eb' }} />
            : <div aria-hidden="true" style={{ width: 96, height: 96, borderRadius: '50%', margin: '0 auto', border: `4px solid ${t.bg}`, background: t.accent === '#ffffff' ? 'rgba(255,255,255,.25)' : t.accent,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 32 }}>{initials(card.name)}</div>}
          <h1 style={{ margin: '10px 0 2px', fontSize: 24, lineHeight: 1.2 }}>{card.name}</h1>
          {card.title && <div style={{ color: t.mut, fontSize: 15 }}>{card.title} · {card.campaign.name}</div>}
          {card.about && <p style={{ margin: '12px auto 0', maxWidth: 360, lineHeight: 1.5, fontSize: 15 }}>{card.about}</p>}
        </div>
        <div style={{ padding: '18px 20px 0', display: 'grid', gap: 10 }}>
          <button type="button" style={solid} onClick={save}>Save my contact</button>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${[tel, tel, card.email].filter(Boolean).length || 1}, 1fr)`, gap: 10 }}>
            {tel && <a style={ghost} href={`tel:${tel}`}>Call</a>}
            {tel && <a style={ghost} href={`sms:${tel}`}>Text</a>}
            {card.email && <a style={ghost} href={`mailto:${card.email}`}>Email</a>}
          </div>
          {card.links.map(l => <a key={l.url} style={ghost} href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url.replace(/^https:\/\/(www\.)?/, '').split('/')[0]}</a>)}
          {card.campaign.info_url && /^https?:\/\//.test(card.campaign.info_url) &&
            <a style={ghost} href={card.campaign.info_url} target="_blank" rel="noopener noreferrer">About {card.campaign.name}</a>}

          {sent ? (
            <div style={{ ...ghost, cursor: 'default', flexDirection: 'column', textAlign: 'center', padding: 16 }}>
              <b>Thanks! {card.name.split(' ')[0]} has your details.</b><span style={{ color: t.mut, fontWeight: 400, fontSize: 14 }}>They’ll be in touch soon.</span>
            </div>
          ) : !form ? (
            <button type="button" style={{ ...ghost, border: `2px dashed ${card.style === 'bold' ? 'rgba(255,255,255,.6)' : t.accent}` }} onClick={() => setForm(true)}>Share my info with {card.name.split(' ')[0]}</button>
          ) : (
            <div style={{ background: '#ffffff', color: '#111827', borderRadius: 14, padding: 14 }}>
              <b>Share your info with {card.name.split(' ')[0]}</b>
              <input style={input} placeholder="Your name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" aria-label="Your name" />
              <input style={input} placeholder="Business name" value={f.business} onChange={e => setF({ ...f, business: e.target.value })} autoComplete="organization" aria-label="Business name" />
              <input style={input} placeholder="Business address (optional)" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} autoComplete="street-address" aria-label="Business address" />
              <input style={input} placeholder="Phone" type="tel" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} autoComplete="tel" aria-label="Phone" />
              <input style={input} placeholder="Email" type="email" inputMode="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" aria-label="Email" />
              <textarea style={{ ...input, minHeight: 64 }} placeholder="Anything else? (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} aria-label="Message" />
              <input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} aria-hidden="true"
                style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
              {err && <div style={{ color: '#b91c1c', fontSize: 14, marginTop: 8 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" style={{ ...btn, background: '#f3f4f6', color: '#111827' }} onClick={() => setForm(false)}>Cancel</button>
                <button type="button" style={{ ...btn, background: t.accent === '#ffffff' ? '#111827' : t.accent, color: '#fff' }} onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
              </div>
            </div>
          )}
        </div>
        {!preview && <div style={{ textAlign: 'center', color: t.mut, fontSize: 12, marginTop: 22 }}>Digital business card · MainstreetAI</div>}
      </div>
    </div>
  );
};

const CardPage: React.FC = () => {
  const { slug = '' } = useParams();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  useEffect(() => { publicCard(slug).then(setCard).catch(() => setCard(null)); }, [slug]);
  useEffect(() => { if (card) document.title = `${card.name} · ${card.campaign.name}`; }, [card]);
  if (card === undefined) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#6b7280' }}>Loading…</div>;
  if (!card) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#6b7280', padding: 20, textAlign: 'center' }}>This card isn’t available.</div>;
  return <CardView card={card} />;
};
export default CardPage;
