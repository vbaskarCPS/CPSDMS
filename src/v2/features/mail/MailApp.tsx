// src/v2/features/mail/MailApp.tsx — the inbox, Gmail style: Compose and folders on the left, a search
// bar across the top, the conversation list and the reading pane side by side (one at a time on a phone).
// Two kinds of mail use it:
//   • MainstreetAI (rep app, MainstreetAI admins): conversations belong to businesses; admins also see
//     Unsorted.
//   • Staff email (staff): a manager's own private mailbox, ben@propertystars.app (RUN_65).
// The open conversation is ?t=<id>, the folder ?box=, the mailbox (staff, when they have several) ?mb=.
// Sent (staff) also lists groups (RUN_70): each booking-email campaign and each session's receipts is one row,
// opened with ?g=<key>&gb=<mailbox> — every email in it with Delivered / Bounced / Marked as spam / Didn't send.
// Inbox (staff) shows conversations someone has written in; To approve: Claude has a suggested reply (and booking
// change) waiting on a customer's email to a centre's mailbox (RUN_71, SuggestionCard).
import type { LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, ArrowLeft, Download, Forward, Inbox as InboxIcon, Loader2, Mail, MailOpen, Paperclip, PenSquare, RefreshCw, Reply,
  ReplyAll, Search, Send, Star, AlertTriangle, FolderInput, X, Layers, Sparkles,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  attachmentUrl, boxName, fileSize, fileThread, flagThread, htmlToText, inbox, inboxCounts, initials, mailCounts, mailInbox, mailWhen, myBoxes, reSubject,
  thread as loadThread, type Box, type Message, type ThreadRow,
  mailGroups, mailGroup, groupWaiting, emailState, type MailGroup,
} from '../../lib/mail';
import { Composer, type ComposeInit } from './Composer';
import { PushToggle } from './PushToggle';
import { SuggestionCard } from './SuggestionCard';
import './mail.css';

const BOXES: { key: Box; label: string; icon: LucideIcon }[] = [
  { key: 'inbox', label: 'Inbox', icon: InboxIcon }, { key: 'unread', label: 'Unread', icon: Mail },
  { key: 'starred', label: 'Starred', icon: Star }, { key: 'sent', label: 'Sent', icon: Send }, { key: 'archived', label: 'Archived', icon: Archive },
];
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const Avatar: React.FC<{ name?: string | null; email?: string | null; me?: boolean; size?: number }> = ({ name, email, me, size }) => (
  <span className={`av${me ? ' me' : ''}`} style={{ ...(size ? { width: size, height: size } : {}), ...(me ? {} : { background: `hsl(${hue(email || name || '?')} 62% 88%)`, color: `hsl(${hue(email || name || '?')} 48% 28%)` }) }} aria-hidden="true">
    {initials(name, email)}</span>
);
const fwdSubject = (s: string) => (/^fwd?:/i.test(s.trim()) ? s.trim() : `Fwd: ${s.trim()}`);
const escHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const MailApp: React.FC<{ admin?: boolean; staff?: boolean; quick?: string[] }> = ({ admin, staff, quick }) => {
  const [sp, setSp] = useSearchParams();
  const box = (sp.get('box') as Box) || 'inbox';
  const open = sp.get('t');
  const g = sp.get('g'), gb = sp.get('gb');
  const mb = sp.get('mb');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const boxesList = useLoad(() => (staff ? myBoxes() : Promise.resolve([])), [staff, tick]);
  const mailbox = staff ? (boxesList.data?.find(b => b.id === mb) || boxesList.data?.[0] || null) : null;
  const list = useLoad(() => (staff ? mailInbox(box, search, mb) : inbox(box, search)), [staff, box, search, mb, tick]);
  const counts = useLoad(() => (staff ? mailCounts() : inboxCounts()), [staff, tick]);
  // Sent: the groups, in among the conversations by when they last sent
  const groups = useLoad(() => (staff && box === 'sent' && !search ? mailGroups(mb) : Promise.resolve([] as MailGroup[])), [staff, box, search, mb, tick]);
  type Item = { kind: 't'; at: string; t: ThreadRow } | { kind: 'g'; at: string; g: MailGroup };
  const items: Item[] | undefined = !list.data ? undefined : [
    ...list.data.map(t => ({ kind: 't' as const, at: t.last_at, t })),
    ...(groups.data || []).map(gr => ({ kind: 'g' as const, at: gr.last_at, g: gr })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 45000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  // ?compose=1 (the home page's Compose): open a new email once the mailbox is known
  useEffect(() => {
    if (sp.get('compose') && (!staff || boxesList.data)) {
      setCompose(newMessage());
      const n = new URLSearchParams(sp); n.delete('compose'); setSp(n, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, staff, boxesList.data]);

  const go = (p: { box?: Box; t?: string | null; mb?: string; g?: { key: string; box: string } | null }) => {
    const n = new URLSearchParams(sp);
    if (p.box) { n.set('box', p.box); n.delete('t'); n.delete('g'); n.delete('gb'); }
    if (p.mb) { n.set('mb', p.mb); n.delete('t'); n.delete('g'); n.delete('gb'); }
    if (p.g !== undefined) { n.delete('t'); if (p.g) { n.set('g', p.g.key); n.set('gb', p.g.box); } else { n.delete('g'); n.delete('gb'); } }
    if (p.t !== undefined) { if (p.t) n.set('t', p.t); else n.delete('t'); }
    setSp(n, { replace: p.t === null });
  };
  const folders = admin && !staff ? [...BOXES, { key: 'unsorted' as Box, label: 'Unsorted', icon: FolderInput }]
    : staff ? [BOXES[0], { key: 'approve' as Box, label: 'To approve', icon: Sparkles }, ...BOXES.slice(1)] : BOXES;
  const refresh = useCallback(() => setTick(x => x + 1), []);
  const unread = staff ? (mailbox?.unread ?? counts.data?.unread) : counts.data?.unread;
  const approveN = (counts.data as { approve?: number } | undefined)?.approve || 0;
  const newMessage = (): ComposeInit => ({ key: staff ? `new:${mailbox?.id || ''}` : 'new', title: 'New message', quick, staff, mailbox_id: mailbox?.id,
    context: staff && mailbox ? `From ${mailbox.label ? `${mailbox.label} <${mailbox.address}>` : mailbox.address}` : undefined });
  const title = folders.find(f => f.key === box)?.label || 'Inbox';

  return (
    <div className={`v2-mail v2-mail-app${open || g ? ' has-open' : ''}`}>
      <aside className="side">
        <button type="button" className="compose-btn" onClick={() => setCompose(newMessage())}><PenSquare size={20} />Compose</button>
        <nav aria-label="Folders">
          {folders.map(b => {
            const n = b.key === 'inbox' || b.key === 'unread' ? unread : b.key === 'unsorted' ? counts.data?.unsorted : b.key === 'approve' ? approveN : 0;
            return (
              <button key={b.key} type="button" className={box === b.key ? 'on' : ''} onClick={() => go({ box: b.key })} aria-current={box === b.key ? 'page' : undefined}>
                <b.icon size={18} /><span>{b.label}</span>{!!n && <em>{n}</em>}</button>);
          })}
        </nav>
        {staff && !!boxesList.data?.length && (
          <div className="boxes">
            <div className="h">{boxesList.data.length > 1 ? 'Mailboxes' : 'Your address'}</div>
            {boxesList.data.map(b => (
              <button key={b.id} type="button" className={mailbox?.id === b.id ? 'on' : ''} onClick={() => go({ mb: b.id })} disabled={boxesList.data!.length < 2}>
                <span className="addr" title={b.address}>{boxName(b)}</span>{!!b.unread && <em>{b.unread}</em>}</button>))}
          </div>)}
        <div className="side-foot"><PushToggle /></div>
      </aside>

      <div className="main">
        <header className="top">
          <label className="searchbar">
            <Search size={19} />
            <input placeholder={staff ? 'Search mail' : 'Search mail and businesses'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search mail" />
            {q && <button type="button" className="icon sm" onClick={() => setQ('')} aria-label="Clear search"><X size={16} /></button>}
          </label>
          <button type="button" className="icon" onClick={refresh} aria-label="Refresh" title="Refresh"><RefreshCw size={18} className={list.loading ? 'spin' : undefined} /></button>
        </header>

        <div className="panes">
          <section className="list" aria-label="Conversations">
            <div className="list-head">
              <b>{search ? `Results for “${search}”` : title}</b>
              {!search && !!items?.length && <span className="mut">{items.length}{(list.data?.length || 0) >= 60 ? '+' : ''}</span>}
            </div>
            {staff && (boxesList.data?.length || 0) > 1 && (
              <select className="box-pick" value={mailbox?.id || ''} onChange={e => go({ mb: e.target.value })} aria-label="Mailbox">
                {boxesList.data!.map(b => <option key={b.id} value={b.id}>{boxName(b)}{b.unread ? ` (${b.unread})` : ''}</option>)}
              </select>)}
            <div className="boxes-sm" role="tablist">
              {folders.map(b => <button key={b.key} type="button" role="tab" aria-selected={box === b.key} className={box === b.key ? 'on' : ''} onClick={() => go({ box: b.key })}>
                {b.label}{(b.key === 'inbox' && unread) ? <em>{unread}</em> : null}{(b.key === 'unsorted' && counts.data?.unsorted) ? <em>{counts.data.unsorted}</em> : null}{(b.key === 'approve' && approveN) ? <em>{approveN}</em> : null}</button>)}
            </div>
            <div className="push-sm"><PushToggle compact /></div>
            {list.error ? <div className="empty err">{list.error instanceof Error ? list.error.message : 'Couldn’t load the mail'}</div>
              : list.loading && !list.data ? <Skeleton />
              : !items?.length ? <EmptyBox box={box} search={search} staff={staff} />
              : (
                <ul className="rows">
                  {items.map(it => it.kind === 'g'
                    ? <GroupRow key={`g:${it.g.mailbox_id}:${it.g.key}`} g={it.g} on={g === it.g.key && gb === it.g.mailbox_id} onOpen={() => go({ g: { key: it.g.key, box: it.g.mailbox_id } })} />
                    : <Row key={it.t.id} t={it.t} admin={admin} staff={staff} on={it.t.id === open} onOpen={() => go({ t: it.t.id })}
                        onFlag={async f => { await flagThread(it.t.id, f); refresh(); }} />)}
                </ul>)}
          </section>

          <section className="reader" aria-label="Conversation">
            {open ? <ThreadView key={open} id={open} admin={admin} staff={staff} quick={quick} mailboxAddress={mailbox?.address}
                onBack={() => go({ t: null })} onChanged={refresh} onCompose={setCompose} />
              : g && gb ? <GroupView key={`${gb}:${g}:${tick}`} box={gb} gkey={g} onBack={() => go({ g: null })} onOpen={id => go({ t: id })} />
              : <div className="empty big"><MailOpen size={40} strokeWidth={1.4} /><span>{list.data?.length ? 'Pick a conversation to read it here.' : 'Nothing open.'}</span></div>}
          </section>
        </div>
      </div>

      {!open && !g && <button type="button" className="compose-fab" onClick={() => setCompose(newMessage())}><PenSquare size={20} />Compose</button>}
      {compose && <Composer init={compose} onClose={() => setCompose(null)} onSent={id => { setCompose(null); refresh(); go({ t: id }); }} />}
    </div>
  );
};

const Skeleton: React.FC = () => (
  <ul className="rows skel" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="row"><span className="av" /><span className="main"><i /><i /><i /></span></li>)}</ul>
);

const EmptyBox: React.FC<{ box: Box; search: string; staff?: boolean }> = ({ box, search, staff }) => (
  <div className="empty">
    <InboxIcon size={34} strokeWidth={1.4} />
    <span>{search ? `Nothing matches “${search}”.`
      : box === 'inbox' ? (staff ? 'Your inbox is empty. Mail to your address lands here.' : 'No mail yet. Email a business from its card, or press Compose.')
      : box === 'unsorted' ? 'Nothing to sort. Mail that can’t be matched to a business lands here.'
      : box === 'starred' ? 'Star a conversation to keep it here.'
      : box === 'approve' ? 'Nothing to approve. When a customer writes back, Claude’s suggested reply waits here.' : 'Nothing here.'}</span>
  </div>
);

const Row: React.FC<{ t: ThreadRow; admin?: boolean; staff?: boolean; on: boolean; onOpen: () => void; onFlag: (f: { starred?: boolean; archived?: boolean; unread?: boolean }) => void }> = ({ t, admin, staff, on, onOpen, onFlag }) => {
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
          {t.suggestion && <span className="tags"><span className="tag sugg-tag"><Sparkles size={12} />{t.suggestion}</span></span>}
          {!staff && (
            <span className="tags">
              {t.business ? <span className="tag"><i style={{ background: t.color || '#0f766e' }} />{t.business}</span> : <span className="tag warn">Unsorted</span>}
              {admin && t.rep && <span className="tag mut">{t.rep}</span>}
            </span>)}
        </span>
      </button>
      <span className="acts">
        <button type="button" className="icon sm" onClick={() => onFlag({ archived: !t.archived })} aria-label={t.archived ? 'Move to inbox' : 'Archive'} title={t.archived ? 'Move to inbox' : 'Archive'}>
          {t.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button>
        <button type="button" className="icon sm" onClick={() => onFlag({ unread: !t.unread })} aria-label={t.unread ? 'Mark as read' : 'Mark as unread'} title={t.unread ? 'Mark as read' : 'Mark as unread'}>
          {t.unread ? <MailOpen size={17} /> : <Mail size={17} />}</button>
      </span>
      <button type="button" className={`star${t.starred ? ' on' : ''}`} onClick={() => onFlag({ starred: !t.starred })} aria-label={t.starred ? 'Unstar' : 'Star'} aria-pressed={t.starred}><Star size={18} /></button>
    </li>
  );
};

// ───────────── a group in Sent: one campaign, or one session's receipts (RUN_70) ─────────────
const Counts: React.FC<{ g: MailGroup }> = ({ g }) => {
  const waiting = groupWaiting(g);
  const bits: [number, string, string][] = [
    [g.delivered, 'delivered', 'ok'], [g.bounced, 'bounced', 'bad'], [g.complained, 'marked as spam', 'bad'],
    [g.failed, 'didn’t send', 'bad'], [g.delayed, 'delayed', 'warn'], [g.sending + waiting, 'waiting', 'mut'],
  ];
  return <span className="gcounts">{bits.filter(([n]) => n > 0).map(([n, l, tone]) => <span key={l} className={`gc ${tone}`}>{n} {l}</span>)}</span>;
};

const GroupRow: React.FC<{ g: MailGroup; on: boolean; onOpen: () => void }> = ({ g, on, onOpen }) => (
  <li className={`row group${on ? ' on' : ''}`}>
    <button type="button" className="hit" onClick={onOpen}>
      <span className="av grp" aria-hidden="true"><Layers size={18} /></span>
      <span className="main">
        <span className="l1"><span className="who">{g.label || 'Group'}</span><span className="n">{g.emails} email{g.emails === 1 ? '' : 's'}</span>
          <span className="when">{mailWhen(g.last_at)}</span></span>
        <span className="l2"><Counts g={g} /></span>
      </span>
    </button>
  </li>
);

const GroupView: React.FC<{ box: string; gkey: string; onBack: () => void; onOpen: (threadId: string) => void }> = ({ box, gkey, onBack, onOpen }) => {
  const list = useLoad(() => mailGroup(box, gkey), [box, gkey]);
  const rows = list.data || [];
  const label = rows[0]?.label || 'Group';
  const sum: MailGroup = {
    key: gkey, mailbox_id: box, mailbox: '', emails: rows.length, first_at: '', last_at: '',
    delivered: rows.filter(r => r.delivery === 'delivered' && r.status === 'sent').length, delayed: rows.filter(r => r.delivery === 'delayed').length,
    bounced: rows.filter(r => r.delivery === 'bounced').length, complained: rows.filter(r => r.delivery === 'complained').length,
    failed: rows.filter(r => r.status === 'failed').length, sending: rows.filter(r => r.status === 'sending').length,
  };
  return (
    <div className="thread group-view">
      <div className="bar">
        <button type="button" className="icon back" onClick={onBack} aria-label="Back to the list"><ArrowLeft size={20} /></button>
        <span style={{ flex: 1 }} />
      </div>
      <div className="scroll">
        <h2>{label}</h2>
        {!list.loading && <div className="about"><span className="tag">{rows.length} email{rows.length === 1 ? '' : 's'}</span><Counts g={sum} /></div>}
        {list.error ? <div className="err">{list.error instanceof Error ? list.error.message : 'Couldn’t load this group'}</div>
          : list.loading && !list.data ? <Skeleton />
          : (
            <ul className="rows gemails">
              {rows.map(e => {
                const st = emailState(e);
                return (
                  <li key={e.id} className="row">
                    <button type="button" className="hit" onClick={() => onOpen(e.thread_id)}>
                      <Avatar name={e.contact_name} email={e.to[0]} />
                      <span className="main">
                        <span className="l1"><span className="who">{e.contact_name || e.to[0] || 'Unknown'}</span><span className="when">{mailWhen(e.at)}</span></span>
                        <span className="l2">{e.contact_name && e.to[0] ? <span className="mut">{e.to.join(', ')}</span> : e.subject}</span>
                        <span className="l3"><span className={`gc ${st.tone}`}>{st.label}</span>{(e.delivery_reason || (st.tone === 'bad' && e.error)) && <span className="why"> — {e.delivery_reason || e.error}</span>}</span>
                      </span>
                    </button>
                  </li>);
              })}
            </ul>)}
      </div>
    </div>
  );
};

// ───────────── one conversation ─────────────
const ThreadView: React.FC<{
  id: string; admin?: boolean; staff?: boolean; quick?: string[]; mailboxAddress?: string;
  onBack: () => void; onChanged: () => void; onCompose: (c: ComposeInit) => void;
}> = ({ id, admin, staff, quick, mailboxAddress, onBack, onChanged, onCompose }) => {
  const { profile } = useAuth();
  const [tick, setTick] = useState(0);
  const th = useLoad(() => loadThread(id), [id, tick]);
  const [reply, setReply] = useState<null | 'reply' | 'all'>(null);
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
  if (!t) return <div className="empty"><Loader2 size={20} className="spin" /></div>;

  // the app's own addresses aren't people to reply to (staff: other staff are)
  const mine = (a: string) => (staff ? a === mailboxAddress : /@(reply\.)?propertystars\.app$/i.test(a));
  const lastIn = [...t.messages].reverse().find(m => m.dir === 'in');
  const replyTo = lastIn?.from_email || t.contact_email;
  const everyone = lastIn ? [lastIn.from_email || '', ...lastIn.to, ...(lastIn.cc || [])].filter(a => a && !mine(a)) : [];
  const others = [...new Set(everyone)].filter(a => a !== replyTo);
  const ctx = t.business ? `${t.business.name}${t.campaign ? ` · ${t.campaign.name}` : ''}` : staff && mailboxAddress ? `From ${mailboxAddress}` : undefined;
  const forward = () => {
    const last = t.messages[t.messages.length - 1];
    const quoted = `<p></p><p>---------- Forwarded message ----------<br>From: ${escHtml(last.from_name || last.from_email || '')}${last.from_email ? ` &lt;${escHtml(last.from_email)}&gt;` : ''}<br>`
      + `Date: ${escHtml(new Date(last.at).toLocaleString('en-CA'))}<br>Subject: ${escHtml(last.subject || t.subject || '')}<br>To: ${escHtml(last.to.join(', '))}</p>`
      + (last.html ? last.html.replace(/<\/?(html|head|body|!doctype)[^>]*>/gi, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '') : `<p>${escHtml(last.text || '').replace(/\n/g, '<br>')}</p>`);
    onCompose({ key: `fwd:${t.id}:${last.id}`, title: 'Forward', subject: fwdSubject(t.subject || ''), html: quoted, staff, context: ctx,
      business_id: t.business?.id, campaign_id: t.campaign?.id, attachments: staff ? last.attachments : undefined });
  };

  return (
    <div className="thread">
      <div className="bar">
        <button type="button" className="icon back" onClick={onBack} aria-label="Back to the list"><ArrowLeft size={20} /></button>
        <button type="button" className="icon" disabled={busy} onClick={() => flag({ archived: !t.archived })} aria-label={t.archived ? 'Move to inbox' : 'Archive'} title={t.archived ? 'Move to inbox' : 'Archive'}>
          {t.archived ? <ArchiveRestore size={19} /> : <Archive size={19} />}</button>
        <button type="button" className="icon" disabled={busy} onClick={() => flag({ unread: true })} aria-label="Mark as unread" title="Mark as unread"><Mail size={19} /></button>
        <span style={{ flex: 1 }} />
        <button type="button" className={`icon star${t.starred ? ' on' : ''}`} disabled={busy} onClick={() => flag({ starred: !t.starred })} aria-label={t.starred ? 'Unstar' : 'Star'} title={t.starred ? 'Unstar' : 'Star'}><Star size={19} /></button>
      </div>
      <div className="scroll">
        <h2>{t.subject || '(no subject)'}</h2>
        <div className="about">
          {t.business ? <span className="tag"><i style={{ background: t.campaign?.color || '#0f766e' }} />{t.business.name}{t.campaign ? ` · ${t.campaign.name}` : ''}</span>
            : !staff ? <span className="tag warn">Unsorted</span> : <span className="tag">Inbox</span>}
          {admin && !staff && !t.business && <button type="button" className="link" onClick={() => setFiling(true)}>File under a business…</button>}
          {t.opted_out && !staff && <span className="tag bad"><AlertTriangle size={12} />Unsubscribed: no more email</span>}
        </div>
        {filing && <FileUnder id={id} onDone={() => { setFiling(false); setTick(x => x + 1); onChanged(); }} />}
        <Messages messages={t.messages} meName={profile?.full_name} onReply={() => setReply('reply')} />
        {staff && <SuggestionCard threadId={t.id} subject={t.subject || ''} replyTo={replyTo} tick={tick} onChanged={() => { setTick(x => x + 1); onChanged(); }} />}
        {!reply && !(t.opted_out && !staff) && replyTo && (
          <div className="reply-row">
            <button type="button" className="reply-btn" onClick={() => setReply('reply')}><Reply size={17} />Reply</button>
            {others.length > 0 && <button type="button" className="reply-btn" onClick={() => setReply('all')}><ReplyAll size={17} />Reply all</button>}
            <button type="button" className="reply-btn" onClick={forward}><Forward size={17} />Forward</button>
          </div>)}
        {reply && replyTo && (
          <Composer docked init={{
            key: `thread:${t.id}`, title: reply === 'all' ? 'Reply all' : `Reply to ${t.contact_name || replyTo}`, thread_id: t.id,
            to: [replyTo], cc: reply === 'all' ? others : [], subject: reSubject(t.subject || ''), context: ctx, staff,
            quick: staff ? ['Thank them and confirm', 'Answer their question', 'Ask for a good time to talk'] : ['Answer their question and suggest a quick call', 'Thank them and confirm the time', ...(quick || []).slice(0, 2)],
          }} onClose={() => setReply(null)} onSent={() => { setReply(null); setTick(x => x + 1); onChanged(); }} />)}
      </div>
    </div>
  );
};

const Messages: React.FC<{ messages: Message[]; meName?: string; onReply: () => void }> = ({ messages, meName, onReply }) => {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(messages.slice(-1).map(m => m.id).concat(messages.filter(m => m.status === 'failed').map(m => m.id))));
  const hidden = messages.length > 4 ? messages.slice(1, -2).filter(m => !openIds.has(m.id)) : [];
  const shown = messages.filter(m => !hidden.includes(m));
  return (
    <div className="msgs">
      {shown.map((m, i) => (
        <React.Fragment key={m.id}>
          {i === 1 && hidden.length > 0 && (
            <button type="button" className="more" onClick={() => setOpenIds(new Set(messages.map(x => x.id)))}><span>{hidden.length}</span>older message{hidden.length === 1 ? '' : 's'}</button>)}
          <MessageCard m={m} meName={meName} open={openIds.has(m.id)} last={i === shown.length - 1} onReply={onReply}
            onToggle={() => setOpenIds(s => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} />
        </React.Fragment>))}
    </div>
  );
};

const MessageCard: React.FC<{ m: Message; meName?: string; open: boolean; last: boolean; onToggle: () => void; onReply: () => void }> = ({ m, meName, open, last, onToggle, onReply }) => {
  const out = m.dir === 'out';
  const name = out ? (m.by || m.from_name || 'You') : (m.from_name || m.from_email || 'Unknown');
  const who = out && meName && name === meName ? 'me' : name;
  const when = new Date(m.at);
  const whenFull = when.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <article className={`msg${out ? ' out' : ''}${open ? ' open' : ''}`}>
      <div className="mh" role="button" tabIndex={0} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }} aria-expanded={open}>
        <Avatar name={out ? m.by || m.from_name : m.from_name} email={out ? (m.from_email || 'me') : m.from_email} me={out} size={40} />
        <span className="who">
          <span className="nm"><b>{who}</b>{open && m.from_email && <span className="em">&lt;{m.from_email}&gt;</span>}</span>
          <span className="to">{open ? `to ${m.to.join(', ')}${m.cc?.length ? `, cc ${m.cc.join(', ')}` : ''}` : (m.text || htmlToText(m.html || '')).replace(/\s+/g, ' ').slice(0, 140)}</span>
        </span>
        <span className="when">
          {!!m.attachments?.length && <Paperclip size={14} />}
          {m.status === 'failed' ? <span className="bad">Didn’t send</span> : m.status === 'sending' ? 'Sending…' : <span title={whenFull}>{open ? whenFull : mailWhen(m.at)}</span>}
          {out && m.status === 'sent' && m.delivery && (open || m.delivery !== 'delivered') && (() => { const st = emailState(m); return <span className={`gc ${st.tone}`} title={m.delivery_reason || undefined}>{st.label}</span>; })()}
          {open && last && <button type="button" className="icon sm" onClick={e => { e.stopPropagation(); onReply(); }} aria-label="Reply" title="Reply"><Reply size={17} /></button>}
        </span>
      </div>
      {open && (
        <div className="mb">
          {m.error && <div className="err">{m.error}</div>}
          <Body html={m.html} text={m.text} />
          {!!m.attachments?.length && (
            <div className="atts-wrap">
              <div className="atts-h">{m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</div>
              <div className="atts">{m.attachments.map(a => <AttachmentChip key={a.path} a={a} />)}</div>
            </div>)}
        </div>)}
    </article>
  );
};

/** Mail as sent: inside a sealed frame (no scripts, links open in a new tab), sized to its content. */
const Body: React.FC<{ html?: string; text?: string }> = ({ html, text }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(60);
  const doc = useMemo(() => {
    const body = html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${(text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`;
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;color:#1f1f1f;font:14.5px/1.6 "Google Sans Text",Inter,Roboto,-apple-system,"Segoe UI",Arial,sans-serif;overflow-wrap:anywhere}
      img{max-width:100%;height:auto} a{color:#0b57d0} p{margin:0 0 10px} blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #dadce0;color:#5f6368}
      table{max-width:100%}</style></head><body>${body}</body></html>`;
  }, [html, text]);
  const fit = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.body) setH(Math.min(5000, Math.max(30, d.documentElement.scrollHeight + 2)));
  }, []);
  return <iframe ref={ref} className="body" title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => { fit(); setTimeout(fit, 300); setTimeout(fit, 1200); }} />;
};

const extOf = (n: string) => (/\.([a-z0-9]{1,5})$/i.exec(n)?.[1] || 'file').toUpperCase();
const AttachmentChip: React.FC<{ a: { name: string; size?: number; type?: string; path: string } }> = ({ a }) => {
  const [busy, setBusy] = useState(false);
  const openIt = async (download: boolean) => {
    setBusy(true);
    try { const url = await attachmentUrl(a.path, download ? a.name : undefined); window.open(url, '_blank', 'noopener'); } finally { setBusy(false); }
  };
  return (
    <span className="att">
      <button type="button" className="n" onClick={() => openIt(false)} disabled={busy} title={a.name}>
        <span className="ext">{extOf(a.name)}</span><span className="nm">{a.name}</span><span className="s">{fileSize(a.size)}</span></button>
      <button type="button" className="icon sm" onClick={() => openIt(true)} disabled={busy} aria-label={`Download ${a.name}`} title="Download"><Download size={16} /></button>
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

