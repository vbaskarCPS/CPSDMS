// src/v2/features/mail/MailApp.tsx — the inbox: folders (Inbox, Unread, Starred, Sent, Archived, and
// Unsorted for admins), search, the list, and a conversation with its messages, attachments and a
// reply box. Two panes on a wide screen, one at a time on a phone. Used by the rep app (their
// businesses' mail) and by MainstreetAI admins (everyone's). The open conversation is ?t=<id>.
import type { LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, ArrowLeft, Download, Inbox as InboxIcon, Loader2, Mail, MailOpen, Paperclip, PenSquare, RefreshCw, Reply,
  Search, Send, Star, AlertTriangle, FolderInput,
} from 'lucide-react';
import { useLoad } from '../../lib/data';
import {
  attachmentUrl, fileSize, fileThread, flagThread, inbox, inboxCounts, initials, mailWhen, reSubject, thread as loadThread,
  type Box, type Message, type ThreadRow,
} from '../../lib/mail';
import { Composer, type ComposeInit } from './Composer';
import './mail.css';

const BOXES: { key: Box; label: string; icon: LucideIcon }[] = [
  { key: 'inbox', label: 'Inbox', icon: InboxIcon }, { key: 'unread', label: 'Unread', icon: Mail },
  { key: 'starred', label: 'Starred', icon: Star }, { key: 'sent', label: 'Sent', icon: Send }, { key: 'archived', label: 'Archived', icon: Archive },
];
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const Avatar: React.FC<{ name?: string | null; email?: string | null; me?: boolean }> = ({ name, email, me }) => (
  <span className={`av${me ? ' me' : ''}`} style={me ? undefined : { background: `hsl(${hue(email || name || '?')} 55% 92%)`, color: `hsl(${hue(email || name || '?')} 45% 32%)` }} aria-hidden="true">
    {initials(name, email)}</span>
);

export const MailApp: React.FC<{ admin?: boolean; quick?: string[] }> = ({ admin, quick }) => {
  const [sp, setSp] = useSearchParams();
  const box = (sp.get('box') as Box) || 'inbox';
  const open = sp.get('t');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const list = useLoad(() => inbox(box, search), [box, search, tick]);
  const counts = useLoad(() => inboxCounts(), [tick]);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const go = (p: { box?: Box; t?: string | null }) => {
    const n = new URLSearchParams(sp);
    if (p.box) { n.set('box', p.box); n.delete('t'); }
    if (p.t !== undefined) { if (p.t) n.set('t', p.t); else n.delete('t'); }
    setSp(n, { replace: p.t === null });
  };
  const boxes = admin ? [...BOXES, { key: 'unsorted' as Box, label: 'Unsorted', icon: FolderInput }] : BOXES;
  const refresh = () => setTick(x => x + 1);

  return (
    <div className={`v2-mail v2-mail-app${open ? ' has-open' : ''}`}>
      <aside className="side">
        <button type="button" className="compose-btn" onClick={() => setCompose({ key: 'new', title: 'New message', quick })}><PenSquare size={17} />Compose</button>
        <nav aria-label="Folders">
          {boxes.map(b => {
            const n = b.key === 'inbox' || b.key === 'unread' ? counts.data?.unread : b.key === 'unsorted' ? counts.data?.unsorted : 0;
            return (
              <button key={b.key} type="button" className={box === b.key ? 'on' : ''} onClick={() => go({ box: b.key })} aria-current={box === b.key ? 'page' : undefined}>
                <b.icon size={17} /><span>{b.label}</span>{!!n && <em>{n}</em>}</button>);
          })}
        </nav>
      </aside>

      <section className="list" aria-label="Conversations">
        <div className="searchbar">
          <Search size={16} />
          <input placeholder="Search mail" value={q} onChange={e => setQ(e.target.value)} aria-label="Search mail" />
          <button type="button" className="icon" onClick={refresh} aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        <div className="boxes-sm" role="tablist">
          {boxes.map(b => <button key={b.key} type="button" role="tab" aria-selected={box === b.key} className={box === b.key ? 'on' : ''} onClick={() => go({ box: b.key })}>
            {b.label}{(b.key === 'inbox' && counts.data?.unread) ? ` ${counts.data.unread}` : ''}{(b.key === 'unsorted' && counts.data?.unsorted) ? ` ${counts.data.unsorted}` : ''}</button>)}
        </div>
        {list.error ? <div className="empty err">{list.error instanceof Error ? list.error.message : 'Couldn’t load the mail'}</div>
          : list.loading && !list.data ? <div className="empty"><Loader2 size={18} className="spin" /></div>
          : !list.data?.length ? <EmptyBox box={box} search={search} />
          : (
            <ul className="rows">
              {list.data.map(t => <Row key={t.id} t={t} admin={admin} on={t.id === open} onOpen={() => go({ t: t.id })}
                onStar={async () => { await flagThread(t.id, { starred: !t.starred }); refresh(); }} />)}
            </ul>)}
      </section>

      <section className="reader" aria-label="Conversation">
        {open ? <ThreadView key={open} id={open} admin={admin} quick={quick} onBack={() => go({ t: null })} onChanged={refresh} />
          : <div className="empty big"><MailOpen size={34} /><span>Pick a conversation</span></div>}
      </section>

      {!open && <button type="button" className="compose-fab" onClick={() => setCompose({ key: 'new', title: 'New message', quick })}><PenSquare size={18} />Compose</button>}
      {compose && <Composer init={compose} onClose={() => setCompose(null)} onSent={id => { setCompose(null); refresh(); go({ t: id }); }} />}
    </div>
  );
};

const EmptyBox: React.FC<{ box: Box; search: string }> = ({ box, search }) => (
  <div className="empty">
    <InboxIcon size={28} />
    <span>{search ? `Nothing matches “${search}”.` : box === 'inbox' ? 'No mail yet. Email a business from its card, or press Compose.'
      : box === 'unsorted' ? 'Nothing to sort. Mail that can’t be matched to a business lands here.' : 'Nothing here.'}</span>
  </div>
);

const Row: React.FC<{ t: ThreadRow; admin?: boolean; on: boolean; onOpen: () => void; onStar: () => void }> = ({ t, admin, on, onOpen, onStar }) => {
  const who = t.contact_name || t.contact_email || t.business || 'Unknown';
  return (
    <li className={`row${t.unread ? ' unread' : ''}${on ? ' on' : ''}`}>
      <button type="button" className="hit" onClick={onOpen}>
        <Avatar name={t.contact_name} email={t.contact_email} />
        <span className="main">
          <span className="l1"><span className="who">{t.last_dir === 'out' && !t.unread ? <span className="mut">To: </span> : null}{who}</span>
            {t.messages > 1 && <span className="n">{t.messages}</span>}<span className="when">{mailWhen(t.last_at)}</span></span>
          <span className="l2">{t.subject || '(no subject)'}</span>
          <span className="l3">{t.snippet}</span>
          <span className="tags">
            {t.business ? <span className="tag"><i style={{ background: t.color || '#0f766e' }} />{t.business}</span> : <span className="tag warn">Unsorted</span>}
            {admin && t.rep && <span className="tag mut">{t.rep}</span>}
          </span>
        </span>
      </button>
      <button type="button" className={`star${t.starred ? ' on' : ''}`} onClick={onStar} aria-label={t.starred ? 'Unstar' : 'Star'} aria-pressed={t.starred}><Star size={16} /></button>
    </li>
  );
};

// ───────────── one conversation ─────────────
const ThreadView: React.FC<{ id: string; admin?: boolean; quick?: string[]; onBack: () => void; onChanged: () => void }> = ({ id, admin, quick, onBack, onChanged }) => {
  const [tick, setTick] = useState(0);
  const th = useLoad(() => loadThread(id), [id, tick]);
  const [reply, setReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filing, setFiling] = useState(false);
  const first = useRef(true);
  useEffect(() => { if (th.data && first.current) { first.current = false; onChanged(); } }, [th.data, onChanged]);
  const t = th.data;
  const flag = async (f: { starred?: boolean; archived?: boolean; unread?: boolean }) => {
    setBusy(true);
    try { await flagThread(id, f); onChanged(); if (f.archived || f.unread) onBack(); else setTick(x => x + 1); } finally { setBusy(false); }
  };
  if (th.error) return <div className="empty err">{th.error instanceof Error ? th.error.message : 'Couldn’t open it'}</div>;
  if (!t) return <div className="empty"><Loader2 size={18} className="spin" /></div>;
  const last = [...t.messages].reverse().find(m => m.dir === 'in');
  const replyTo = last?.from_email || t.contact_email;
  return (
    <div className="thread">
      <div className="bar">
        <button type="button" className="icon back" onClick={onBack} aria-label="Back to the list"><ArrowLeft size={19} /></button>
        <span style={{ flex: 1 }} />
        <button type="button" className="icon" disabled={busy} onClick={() => flag({ archived: !t.archived })} aria-label={t.archived ? 'Move to inbox' : 'Archive'} title={t.archived ? 'Move to inbox' : 'Archive'}>
          {t.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}</button>
        <button type="button" className="icon" disabled={busy} onClick={() => flag({ unread: true })} aria-label="Mark unread" title="Mark unread"><Mail size={18} /></button>
        <button type="button" className={`icon star${t.starred ? ' on' : ''}`} disabled={busy} onClick={() => flag({ starred: !t.starred })} aria-label={t.starred ? 'Unstar' : 'Star'}><Star size={18} /></button>
      </div>
      <div className="scroll">
        <h2>{t.subject || '(no subject)'}</h2>
        <div className="about">
          {t.business ? <span className="tag"><i style={{ background: t.campaign?.color || '#0f766e' }} />{t.business.name}{t.campaign ? ` · ${t.campaign.name}` : ''}</span>
            : <span className="tag warn">Unsorted</span>}
          {admin && !t.business && <button type="button" className="link" onClick={() => setFiling(true)}>File under a business…</button>}
          {t.opted_out && <span className="tag bad"><AlertTriangle size={12} />Unsubscribed: no more email</span>}
        </div>
        {filing && <FileUnder id={id} onDone={() => { setFiling(false); setTick(x => x + 1); onChanged(); }} />}
        <Messages messages={t.messages} />
        {!reply && !t.opted_out && replyTo && (
          <div className="reply-row">
            <button type="button" className="reply-btn" onClick={() => setReply(true)}><Reply size={16} />Reply</button>
          </div>)}
        {reply && replyTo && (
          <Composer docked init={{
            key: `thread:${t.id}`, title: `Reply to ${t.contact_name || replyTo}`, thread_id: t.id, to: [replyTo], subject: reSubject(t.subject || ''),
            context: t.business ? `${t.business.name}${t.campaign ? ` · ${t.campaign.name}` : ''}` : undefined,
            quick: ['Answer their question and suggest a quick call', 'Thank them and confirm the time', ...(quick || []).slice(0, 2)],
          }} onClose={() => setReply(false)} onSent={() => { setReply(false); setTick(x => x + 1); onChanged(); }} />)}
      </div>
    </div>
  );
};

const Messages: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(messages.slice(-2).map(m => m.id)));
  const hidden = messages.length > 4 ? messages.slice(1, -2).filter(m => !openIds.has(m.id)) : [];
  const shown = messages.filter(m => !hidden.includes(m));
  return (
    <div className="msgs">
      {shown.map((m, i) => (
        <React.Fragment key={m.id}>
          {i === 1 && hidden.length > 0 && (
            <button type="button" className="more" onClick={() => setOpenIds(new Set(messages.map(x => x.id)))}>{hidden.length} older message{hidden.length === 1 ? '' : 's'}</button>)}
          <MessageCard m={m} open={openIds.has(m.id)} onToggle={() => setOpenIds(s => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
        </React.Fragment>))}
    </div>
  );
};

const MessageCard: React.FC<{ m: Message; open: boolean; onToggle: () => void }> = ({ m, open, onToggle }) => {
  const out = m.dir === 'out';
  const who = out ? `${m.by || m.from_name || 'You'}` : (m.from_name || m.from_email || 'Unknown');
  return (
    <article className={`msg${out ? ' out' : ''}${open ? ' open' : ''}`}>
      <button type="button" className="mh" onClick={onToggle} aria-expanded={open}>
        <Avatar name={out ? m.by || m.from_name : m.from_name} email={out ? 'me' : m.from_email} me={out} />
        <span className="who"><b>{who}</b>{!out && m.from_email && m.from_name && <span className="mut"> &lt;{m.from_email}&gt;</span>}
          <span className="to">{open ? `to ${m.to.join(', ')}${m.cc?.length ? `, cc ${m.cc.join(', ')}` : ''}` : (m.text || '').slice(0, 120)}</span></span>
        <span className="when">{m.status === 'failed' ? <span className="bad">Didn’t send</span> : m.status === 'sending' ? 'Sending…' : new Date(m.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          {!!m.attachments?.length && <Paperclip size={13} />}</span>
      </button>
      {open && (
        <div className="mb">
          {m.error && <div className="err">{m.error}</div>}
          <Body html={m.html} text={m.text} />
          {!!m.attachments?.length && <div className="atts">{m.attachments.map(a => <AttachmentChip key={a.path} a={a} />)}</div>}
        </div>)}
    </article>
  );
};

/** Mail as sent: inside a sealed frame (no scripts, links open in a new tab), sized to its content. */
const Body: React.FC<{ html?: string; text?: string }> = ({ html, text }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(80);
  const doc = useMemo(() => {
    const body = html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${(text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`;
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;color:#1c1b1a;font:15px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}
      img{max-width:100%;height:auto} a{color:#0b57d0} p{margin:0 0 10px} blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #e2e5e9;color:#5f6368}
      table{max-width:100%}</style></head><body>${body}</body></html>`;
  }, [html, text]);
  const fit = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.body) setH(Math.min(4000, Math.max(40, d.documentElement.scrollHeight + 4)));
  }, []);
  return <iframe ref={ref} className="body" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 300); }} />;
};

const AttachmentChip: React.FC<{ a: { name: string; size?: number; type?: string; path: string } }> = ({ a }) => {
  const [busy, setBusy] = useState(false);
  const openIt = async (download: boolean) => {
    setBusy(true);
    try { const url = await attachmentUrl(a.path, download ? a.name : undefined); window.open(url, '_blank', 'noopener'); } finally { setBusy(false); }
  };
  return (
    <span className="att">
      <button type="button" className="n" onClick={() => openIt(false)} disabled={busy}><Paperclip size={14} />{a.name}<span className="s">{fileSize(a.size)}</span></button>
      <button type="button" className="icon" onClick={() => openIt(true)} disabled={busy} aria-label={`Download ${a.name}`}><Download size={15} /></button>
    </span>
  );
};

// admins: put an unsorted conversation under a business
const FileUnder: React.FC<{ id: string; onDone: () => void }> = ({ id, onDone }) => {
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const found = useLoad(async () => {
    if (q.trim().length < 2) return [] as { id: string; name: string; address: string | null; campaign_id: string; campaign: string }[];
    const { db } = await import('../../lib/client');
    const { data } = await db.from('ms_businesses').select('id, name, address, zone_id').ilike('name', `%${q.trim()}%`).limit(8);
    const rows = (data || []) as { id: string; name: string; address: string | null; zone_id: string | null }[];
    const zones = rows.map(r => r.zone_id).filter(Boolean) as string[];
    const { data: zc } = zones.length ? await db.from('ms_zone_campaigns').select('zone_id, campaign_id, ms_campaigns(name)').in('zone_id', zones) : { data: [] };
    return rows.flatMap(r => ((zc || []) as unknown as { zone_id: string; campaign_id: string; ms_campaigns: { name: string } }[])
      .filter(z => z.zone_id === r.zone_id).map(z => ({ id: r.id, name: r.name, address: r.address, campaign_id: z.campaign_id, campaign: z.ms_campaigns?.name })));
  }, [q]);
  return (
    <div className="file-under">
      <input autoFocus placeholder="Business name" value={q} onChange={e => setQ(e.target.value)} aria-label="Find the business" />
      {error && <div className="err">{error}</div>}
      {found.data?.map(b => (
        <button key={`${b.id}-${b.campaign_id}`} type="button" onClick={async () => { try { await fileThread(id, b.id, b.campaign_id); onDone(); } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t file it'); } }}>
          <b>{b.name}</b><span>{b.address} · {b.campaign}</span></button>))}
      {q.trim().length >= 2 && !found.loading && !found.data?.length && <div className="mut">No business in a zone matches.</div>}
    </div>
  );
};
