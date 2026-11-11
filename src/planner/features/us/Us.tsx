// src/planner/features/us/Us.tsx — the chat between the two of them, in the same place above the bar as Arvy's.
// RV dragged up and to the right opens it (ui/Shell.tsx); Arvy's panel has a button for it too. Words, photos and
// short videos. Arvy reads along: under a message it may offer to add something to the shopping list, the calendar
// or a to-do, and waits for a Confirm tap (either of them for the shared things; a to-do only the person it's for).
// The list, sending and confirming are in us.ts; a message and a proposal are defined in planner-chat/chat.ts.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ImagePlus, Play, Send, Smile, Sparkles, X } from 'lucide-react';
import { calendarKey, getDocs } from '../../lib/docs';
import { birthdaysFrom, countdown, upcoming, type Birthday } from './occasions';
import { STICKERS, Sticker, stickerOf, stickerText, type StickerDef } from './stickers';
import { getPass } from '../../lib/auth';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { setArvyOpen } from '../arvy/arvy';
import { imagesFrom } from '../arvy/pics';
import { canConfirm, type ChatMsg, type Proposal } from '../../../../supabase/functions/planner-chat/chat';
import { answer, filesProblem, mediaUrl, onUs, otherName, say, setUsOpen, usIsOpen, usLoaded, usRows, usVersion, type Row } from './us';
import '../arvy/arvy.css';
import './us.css';

const nameOf = (username: string) => username.charAt(0).toUpperCase() + username.slice(1);
/** When a message was sent: the time today, the day and time before that. */
export function sentAt(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

function ProposalCard({ row, p, user }: { row: Row; p: Proposal; user: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (how: 'done' | 'dismissed') => {
    setWorking(true); setError(null);
    try { await answer(row.key, p, how); } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t save.'); }
    finally { setWorking(false); }
  };
  return (
    <div className={`arvy-change ${p.state === 'dismissed' ? 'cancelled' : p.state}`}>
      <div className="arvy-change-lines">
        {p.state === 'done' && <Check className="arvy-change-tick" aria-label="Added" />}
        <div>{p.lines.map((l, i) => <div key={i}>{l}</div>)}{error && <div className="arvy-error">{error}</div>}</div>
      </div>
      {p.state === 'waiting' && (canConfirm(p, user)
        ? <div className="arvy-change-btns">
            <button type="button" className="arvy-confirm" disabled={working} onClick={() => void act('done')}>{working ? 'Saving…' : 'Confirm'}</button>
            <button type="button" className="arvy-cancel" disabled={working} onClick={() => void act('dismissed')}>No thanks</button>
          </div>
        : <div className="arvy-change-note">Waiting for {nameOf(p.for || '')} to confirm</div>)}
      {p.state === 'done' && <div className="arvy-change-note">Added{p.by ? ` · ${p.by === user ? 'you' : nameOf(p.by)} confirmed` : ''}</div>}
      {p.state === 'dismissed' && <div className="arvy-change-note">Not added</div>}
    </div>
  );
}

function Message({ row, user }: { row: Row; user: string }) {
  const m: ChatMsg = row.msg;
  const mine = m.by === user;
  const sticker = !m.media?.length ? stickerOf(m.text) : null;   // a message that is only one of our emoji: drawn as the sticker
  const [playing, setPlaying] = useState<number | null>(null);
  return (
    <div className={`us-msg ${mine ? 'mine' : 'theirs'}`}>
      {!!m.media?.length && (
        <div className={`us-media n${Math.min(m.media.length, 4)}`}>
          {m.media.map((x, i) => {
            const url = row.local?.[i] || (x.path ? mediaUrl(x.path) : undefined);
            if (x.kind === 'video') {
              return playing === i && url
                ? <video key={i} src={url} controls autoPlay playsInline />
                : <button key={i} type="button" className="us-video" onClick={() => setPlaying(i)} aria-label="Play the video">
                    {x.thumb ? <img src={x.thumb} alt="" /> : <span className="us-blank" />}
                    <i><Play aria-hidden /></i>{!!x.seconds && <small>{Math.floor(x.seconds / 60)}:{String(x.seconds % 60).padStart(2, '0')}</small>}
                  </button>;
            }
            return url
              ? <a key={i} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Photo" /></a>
              : x.thumb ? <img key={i} src={x.thumb} alt="Photo" className="is-thumb" /> : <span key={i} className="us-blank" />;
          })}
        </div>)}
      {sticker ? <div className="us-sticker"><Sticker s={sticker} size={112} /></div> : m.text && <div className="us-bubble">{m.text}</div>}
      <div className="us-meta">{row.sending ? 'Sending…' : sentAt(m.at)}</div>
      {m.arvy && m.arvy.state !== 'none' && !row.sending && (
        <div className="us-arvy">
          {m.arvy.state === 'reading' && Date.now() - Date.parse(m.at) < 90_000 && <div className="us-arvy-line"><Sparkles aria-hidden /> Arvy is reading…</div>}
          {m.arvy.note && <div className="us-arvy-line"><Sparkles aria-hidden /> {m.arvy.note}</div>}
          {!!m.arvy.proposals?.length && <div className="us-arvy-line"><Sparkles aria-hidden /> Arvy</div>}
          {m.arvy.proposals?.map(p => <ProposalCard key={p.id} row={row} p={p} user={user} />)}
        </div>)}
    </div>
  );
}

export function Us() {
  const user = getPass()?.user.username || '';
  const other = otherName(user);
  useSyncExternalStore(onUs, usVersion);   // any change to the chat redraws it (new messages, a link to a photo arriving)
  const open = usIsOpen(), rows = usRows(), loaded = usLoaded();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // the sticker tray: the occasion coming up next first. Birthdays are read off the calendar the first time it opens
  const [tray, setTray] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[] | null>(null);
  useEffect(() => {
    if (!tray || birthdays) return;
    getDocs<{ title?: string; date?: string; repeat?: string }>('event').then(d => setBirthdays(birthdaysFrom(d.map(x => x.data).filter(Boolean)))).catch(() => setBirthdays([]));
  }, [tray, birthdays]);
  const occasions = useMemo(() => upcoming(calendarKey(), birthdays || []), [birthdays, tray]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) void pushState().then(setPush); }, [open]);
  // a picture pasted while the chat is open (a screenshot on the clipboard) is added like one chosen with the button
  const pasted = useRef<(list: File[]) => void>(() => undefined);
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => { const list = imagesFrom(e.clipboardData); if (!list.length) return; e.preventDefault(); pasted.current(list); };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);
  // the newest message stays in view: when one arrives, and when Arvy's offer lands under the last one
  const last = rows[rows.length - 1]?.msg;
  const tail = `${rows.length}:${last?.arvy?.state || ''}:${last?.arvy?.proposals?.length || 0}`;
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [open, tail, sending]);
  if (!open) return null;

  const send = async () => {
    const t = text, f = files;
    if (sending || (!t.trim() && !f.length)) return;
    setSending(true); setError(null); setText(''); setFiles([]);
    try { await say(t, f); }
    catch (e) { setError(e instanceof Error ? e.message : 'That didn’t send.'); setText(t); setFiles(f); }
    finally { setSending(false); }
  };
  const sendSticker = async (s: StickerDef) => {
    if (sending) return;
    setTray(false); setSending(true); setError(null);
    try { await say(stickerText(s), []); }
    catch (e) { setError(e instanceof Error ? e.message : 'That didn’t send.'); }
    finally { setSending(false); }
  };
  const pick = (list: File[]) => {
    const all = [...files, ...list];
    const problem = filesProblem(all);
    if (problem) { setError(problem); return; }
    setError(null); setFiles(all);
  };
  pasted.current = pick;
  const turnOn = async () => {
    try { await enablePush(); } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t work.'); }
    void pushState().then(setPush);
  };

  return (
    <div className="arvy-sheet us-sheet" role="dialog" aria-label={`Chat with ${other}`}>
      <header className="arvy-head">
        <div className="arvy-avatar us-avatar" aria-hidden>{other.charAt(0)}</div>
        <div className="arvy-title"><b>{other}</b><span>Arvy reads along</span></div>
        <button type="button" className="arvy-icon" onClick={() => setArvyOpen(true)} aria-label="Switch to Arvy" title="Arvy"><Sparkles /></button>
        <button type="button" className="arvy-icon" onClick={() => setUsOpen(false)} aria-label="Close"><X /></button>
      </header>
      <div className="arvy-body">
        {push === 'off' && <div className="us-push">Turn on notifications to know when {other} writes.<button type="button" onClick={() => void turnOn()}>Turn on</button></div>}
        {(push === 'denied' || push === 'ios-install') && <div className="us-push">{push === 'denied' ? 'Notifications are blocked for this site, so you won’t hear when a message comes in. Allow them in the browser’s site settings.' : 'To hear when a message comes in on iPhone, add the planner to your Home Screen, then turn on reminders in Settings.'}</div>}
        {loaded && !rows.length && (
          <div className="arvy-hello">
            <p><b>This is your chat with {other}.</b> Write, or send a photo or a short video.</p>
            <p>Arvy reads along. When one of you asks for something (“can you get apples”, “dentist Thursday at 3”), it offers to put it on the shopping list, the calendar or a to-do list, and waits for a tap. Nothing is added by itself.</p>
          </div>)}
        {!loaded && <div className="us-meta">Loading…</div>}
        {rows.map(r => <Message key={r.msg.id} row={r} user={user} />)}
        {error && <div className="arvy-error" role="alert">{error}</div>}
        <div ref={endRef} />
      </div>
      {files.length > 0 && (
        <div className="us-picked">
          {files.map((f, i) => <span key={i}>{f.type.startsWith('video/') ? 'Video' : 'Photo'} {i + 1}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Take it off"><X /></button></span>)}
        </div>)}
      {tray && (
        <div className="us-tray">
          {occasions.map((o, i) => (
            <section key={`${o.id}:${o.name}`} className={i === 0 ? 'is-next' : ''}>
              <h4>{i === 0 && Number.isFinite(o.days) ? 'Coming up: ' : ''}{o.name}{countdown(o) && <em>{countdown(o)}</em>}</h4>
              <div className="us-tray-row">
                {STICKERS.filter(s => s.occasion === o.id).map(s => <button key={s.id} type="button" disabled={sending} onClick={() => void sendSticker(s)} aria-label={`Send the ${s.name} sticker`}><Sticker s={s} size={56} /></button>)}
              </div>
            </section>))}
          {birthdays && !birthdays.length && <p className="us-meta">Put your birthdays on the calendar as yearly events (“Rosh’s birthday”) and they count down here too.</p>}
        </div>)}
      <form className="arvy-input" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input ref={pickRef} type="file" accept="image/*,video/*" multiple hidden onChange={e => { const list = Array.from(e.target.files || []); e.target.value = ''; pick(list); }} />
        <button type="button" className="arvy-mic" onClick={() => pickRef.current?.click()} disabled={sending} aria-label="Add a photo or a video"><ImagePlus /></button>
        <button type="button" className={`arvy-mic${tray ? ' us-on' : ''}`} onClick={() => setTray(t => !t)} aria-label="Stickers" aria-expanded={tray}><Smile /></button>
        <textarea rows={1} value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${other}…`} aria-label={`Message ${other}`} enterKeyHint="send"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <button type="submit" className="arvy-send" disabled={sending || (!text.trim() && !files.length)} aria-label="Send"><Send /></button>
      </form>
    </div>
  );
}
