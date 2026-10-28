// src/v2/app/EmailCard.tsx — the home page's Email card, first on the dashboard: your address, how many
// are unread, and the newest conversations (unread ones in bold). A row opens that conversation.
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Mail, PenSquare } from 'lucide-react';
import { useLoad } from '../lib/data';
import { initials, mailInbox, mailWhen, myBoxes } from '../lib/mail';

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export const EmailCard: React.FC = () => {
  const nav = useNavigate();
  const boxes = useLoad(() => myBoxes().catch(() => []), []);
  const list = useLoad(() => mailInbox('inbox').then(r => r.slice(0, 5)).catch(() => []), []);
  useEffect(() => {
    const t = setInterval(() => { boxes.reload(); list.reload(); }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!boxes.data?.length) return null;                 // no mailbox: no card
  const unread = boxes.data.reduce((n, b) => n + b.unread, 0);
  const address = boxes.data[0].address;

  return (
    <section className="v2-card v2-stat v2-mailcard" aria-label="Email">
      <div className="v2-stat-h">
        <span className="ib" style={{ background: '#0b57d01a' }}><Mail size={22} color="#0b57d0" /></span>
        <span style={{ minWidth: 0 }}>
          <b>Email</b>
          <span className="cap">{address}</span>
        </span>
        <button className="open" onClick={() => nav('/app/email')}>Open<ChevronRight size={15} /></button>
      </div>
      <div className="v2-mailcard-top">
        <button type="button" className="v2-kpi-box link" onClick={() => nav('/app/email?box=unread')}>
          <span className="l">Unread</span><span className={`n${unread ? ' blue' : ''}`}>{unread}</span></button>
        <button type="button" className="v2-mailcard-new" onClick={() => nav('/app/email?compose=1')}><PenSquare size={16} />Compose</button>
      </div>
      {list.loading && !list.data ? <div className="v2-mailcard-list">{[0, 1, 2].map(i => <div key={i} className="row skel" />)}</div>
        : !list.data?.length ? <div className="v2-stat-msg">No mail yet. Mail to {address} shows up here.</div>
        : (
          <ul className="v2-mailcard-list">
            {list.data.map(t => {
              const who = t.contact_name || t.contact_email || 'Unknown';
              return (
                <li key={t.id}>
                  <button type="button" className={`row${t.unread ? ' unread' : ''}`} onClick={() => nav(`/app/email?t=${t.id}`)}>
                    <span className="av" style={{ background: `hsl(${hue(t.contact_email || who)} 62% 88%)`, color: `hsl(${hue(t.contact_email || who)} 48% 28%)` }}>{initials(t.contact_name, t.contact_email)}</span>
                    <span className="m">
                      <span className="l1"><span className="who">{t.last_dir === 'out' && !t.unread ? 'To: ' : ''}{who}</span><span className="when">{mailWhen(t.last_at)}</span></span>
                      <span className="l2"><b>{t.subject || '(no subject)'}</b>{t.snippet ? <span> — {t.snippet}</span> : null}</span>
                    </span>
                    {!!t.unread && <i className="dot" aria-label="Unread" />}
                  </button>
                </li>);
            })}
          </ul>)}
    </section>
  );
};
