// src/planner/features/us/Us.tsx — the chat between the two of them, in the same place above the bar as Arvy's.
// RV dragged up and to the right opens it (ui/Shell.tsx); Arvy's panel has a button for it too. Words, photos,
// short videos and our own emoji (emoji.tsx: a pack for each occasion). Arvy reads along: under a message it may offer to add something to the shopping list, the calendar
// or a to-do, and waits for a Confirm tap (either of them for the shared things; a to-do only the person it's for).
// A message swiped to the right is replied to: its quote sits above the box, and above the reply once it's sent (a
// tap on that quote goes back to the original). A message pressed and held is picked: more can be tapped, and the bar
// that takes the box's place offers Reply, Ask Arvy (do something with them: the same proposals, under the last one
// picked) and Copy. How a press, a swipe and a scroll are told apart: select.ts.
// The list, sending, asking and confirming are in us.ts; a message and a proposal are defined in planner-chat/chat.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react';
import { CalendarPlus, Check, Copy, Image as Picture, ImagePlus, Lightbulb, ListTodo, Play, Reply, Send, ShoppingCart, Smile, Sparkles, Video, X } from 'lucide-react';
import { calendarKey, getDocs } from '../../lib/docs';
import { birthdaysFrom, upcoming, type Birthday } from './occasions';
import { Emoji, EmojiText, bigEmoji, hasOurs, healDraft, putIn, type EmojiDef } from './emoji';
import { Tray } from './Tray';
import { getPass } from '../../lib/auth';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { setArvyOpen } from '../arvy/arvy';
import { imagesFrom } from '../arvy/pics';
import { canConfirm, MAX_ASK, MAX_ASK_WORDS, MAX_TEXT, quoteWords, type ChatMsg, type Proposal, type ReplyTo } from '../../../../supabase/functions/planner-chat/chat';
import { HOLD_MS, barFor, copyText, fingerIs, pickedRows, swipeOf, togglePick } from './select';
import { answer, askArvy, filesProblem, logIdea, mediaUrl, onUs, otherName, replyTo, say, setUsOpen, usIsOpen, usLoaded, usRows, usVersion, type Asking, type Row } from './us';
import { CallButton } from './call/CallButton';
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

const buzz = () => { try { navigator.vibrate?.(12); } catch { /* no buzz on this phone */ } };
/** What the finger now on the chat has done. `swiping` = it is swiping a message, so the list must not scroll under
 *  it; `spent` = it has already picked a message or swiped one, so the click that may follow as it lifts is not a
 *  tap (wherever it lands: what's on screen may have moved under the finger). */
interface Touching { swiping: boolean; spent: boolean }
/** A quote's one line: its words with our emoji drawn in them, or what the message was (Photo, Video). */
function QuoteLine({ q }: { q: Pick<ReplyTo, 'text' | 'media'> }) {
  const big = q.text ? bigEmoji(q.text) : null;   // one ordinary emoji we have a drawing of is ours here too
  return (
    <>
      {q.media && (q.media === 'video' ? <Video aria-hidden /> : <Picture aria-hidden />)}
      {q.text ? (big ? big.list.map((e, i) => <Emoji key={i} e={e} size="1.45em" still inline />) : <EmojiText text={q.text} />) : quoteWords(q)}
    </>
  );
}

/** One message. A finger on it is a tap, a press and hold (it's picked), a swipe to the right (reply) or the list
 *  scrolling: select.ts says which. While messages are being picked, a tap anywhere on it picks it or lets it go. */
function Message({ row, user, picked, picking, flash, touch, onPick, onReply, onJump }: {
  row: Row; user: string; picked: boolean; picking: boolean; flash: boolean; touch: MutableRefObject<Touching>;
  onPick: (key: string) => void; onReply: (row: Row) => void; onJump: (key: string) => void;
}) {
  const m: ChatMsg = row.msg;
  const mine = m.by === user;
  const big = !m.media?.length ? bigEmoji(m.text) : null;   // a message that is only emoji of ours: drawn big, with no bubble
  const [playing, setPlaying] = useState<number | null>(null);
  const can = !!replyTo(row);                                // one still on its way can't be replied to or picked yet
  const el = useRef<HTMLDivElement>(null);
  const finger = useRef<{ id: number; x: number; y: number; mode: 'press' | 'swipe'; armed: boolean; touch: boolean } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const stop = () => {
    window.clearTimeout(timer.current); finger.current = null; touch.current.swiping = false;
    const n = el.current;
    if (n) { n.classList.remove('is-swiping', 'is-armed'); n.style.transform = ''; n.style.removeProperty('--pull'); }
  };
  const hold = () => { if (!finger.current) return; touch.current.spent = true; stop(); buzz(); onPick(row.key); };
  return (
    <div ref={el} data-key={row.key} className={`us-msg ${mine ? 'mine' : 'theirs'}${picked ? ' is-picked' : ''}${flash ? ' is-flash' : ''}${can ? ' can-pick' : ''}`}
      onPointerDown={e => {
        if (!can || (e.pointerType === 'mouse' && e.button !== 0) || (e.target as Element).closest('.us-arvy, video')) return;
        finger.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: 'press', armed: false, touch: e.pointerType !== 'mouse' };
        window.clearTimeout(timer.current);
        if (!picking) timer.current = window.setTimeout(hold, HOLD_MS);
      }}
      onPointerMove={e => {
        const f = finger.current, n = el.current;
        if (!f || f.id !== e.pointerId || !n) return;
        const dx = e.clientX - f.x;
        const now = fingerIs(f.mode, dx, e.clientY - f.y, f.touch && !picking);
        if (now === 'press') return;
        if (now === 'scroll') { stop(); return; }   // the list's, or nobody's: the press is off
        if (f.mode !== 'swipe') { f.mode = 'swipe'; touch.current.swiping = true; window.clearTimeout(timer.current); n.classList.add('is-swiping'); }
        const w = swipeOf(dx);
        n.style.transform = `translateX(${w.shift}px)`; n.style.setProperty('--pull', String(w.pull));
        if (w.armed !== f.armed) { f.armed = w.armed; n.classList.toggle('is-armed', w.armed); if (w.armed) buzz(); }
      }}
      onPointerUp={e => {
        const f = finger.current;
        if (!f || f.id !== e.pointerId) return;
        if (f.mode === 'swipe') touch.current.spent = true;
        const reply = f.mode === 'swipe' && f.armed;
        stop();
        if (reply) onReply(row);
      }}
      onPointerCancel={stop}
      onClickCapture={e => { if (picking && can && !(e.target as Element).closest('.us-arvy')) { e.preventDefault(); e.stopPropagation(); onPick(row.key); } }}
      onContextMenu={e => {
        // a phone's own long press (its menu for a link or a picture) is ours; so is a right click
        if (!can || (e.target as Element).closest('.us-arvy, video')) return;
        e.preventDefault();
        if (finger.current) hold(); else if (!picking && !touch.current.spent) onPick(row.key);
      }}>
      {can && <span className="us-swipe" aria-hidden><Reply /></span>}
      {picking && can && <span className="us-tick" role="img" aria-label={picked ? 'Selected' : 'Not selected'}>{picked && <Check aria-hidden />}</span>}
      {m.reply && (
        <button type="button" className="us-quote" onClick={() => onJump(m.reply!.key)} aria-label={`In reply to ${m.reply.name ? `${m.reply.name}: ` : ''}${quoteWords(m.reply)}. Show that message`}>
          <b><Reply aria-hidden />{m.reply.name || 'In reply to'}</b>
          <span><QuoteLine q={m.reply} /></span>
        </button>)}
      {!!m.media?.length && (
        <div className={`us-media n${Math.min(m.media.length, 4)}`}>
          {m.media.map((x, i) => {
            const url = row.local?.[i] || (x.path ? mediaUrl(x.path) : undefined);
            if (x.kind === 'video') {
              return playing === i && url
                ? <video key={i} src={url} controls autoPlay playsInline />
                : <button key={i} type="button" className="us-video" onClick={() => setPlaying(i)} aria-label="Play the video">
                    {x.thumb ? <img src={x.thumb} alt="" draggable={false} /> : <span className="us-blank" />}
                    <i><Play aria-hidden /></i>{!!x.seconds && <small>{Math.floor(x.seconds / 60)}:{String(x.seconds % 60).padStart(2, '0')}</small>}
                  </button>;
            }
            return url
              ? <a key={i} href={url} target="_blank" rel="noopener noreferrer" draggable={false}><img src={url} alt="Photo" draggable={false} /></a>
              : x.thumb ? <img key={i} src={x.thumb} alt="Photo" className="is-thumb" draggable={false} /> : <span key={i} className="us-blank" />;
          })}
        </div>)}
      {big ? <div className="us-sticker">{big.list.map((e, i) => <Emoji key={i} e={e} size={big.size} />)}</div> : m.text && <div className="us-bubble"><EmojiText text={m.text} /></div>}
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

/** What Arvy can be asked to do with the picked messages. The first three (and anything typed) come back as
 *  proposals under the last one picked; an idea goes straight into Arvy's log. */
function AskList({ about, user, other, busy, error, onAsk, onIdea }: {
  about: string; user: string; other: { username: string; name: string } | null; busy: boolean; error: string | null;
  onAsk: (a: Asking) => void; onIdea: () => void;
}) {
  const [words, setWords] = useState('');
  return (
    <div className="us-ask" role="group" aria-label={`Ask Arvy about ${about}`}>
      <h4><Sparkles aria-hidden /> Ask Arvy about {about}</h4>
      <button type="button" disabled={busy} onClick={() => onAsk({ what: 'shopping' })}><ShoppingCart aria-hidden /> Add to the shopping list</button>
      <div className="us-ask-two">
        <span><ListTodo aria-hidden /> Make it a to-do</span>
        <button type="button" disabled={busy} onClick={() => onAsk({ what: 'todo', for: user })}>For me</button>
        {other && <button type="button" disabled={busy} onClick={() => onAsk({ what: 'todo', for: other.username })}>For {other.name}</button>}
      </div>
      <button type="button" disabled={busy} onClick={() => onAsk({ what: 'calendar' })}><CalendarPlus aria-hidden /> Put it on the calendar</button>
      <button type="button" disabled={busy} onClick={onIdea}><Lightbulb aria-hidden /> Log it as an idea for the planner</button>
      <form onSubmit={e => { e.preventDefault(); if (words.trim() && !busy) onAsk({ what: 'words', words: words.trim() }); }}>
        <input value={words} onChange={e => setWords(e.target.value)} maxLength={MAX_ASK_WORDS} placeholder="Or ask something else…" aria-label={`Ask Arvy something else about ${about}`} enterKeyHint="send" />
        <button type="submit" className="arvy-send" disabled={busy || !words.trim()} aria-label="Ask Arvy"><Send /></button>
      </form>
      {busy ? <div className="us-arvy-line" role="status"><Sparkles aria-hidden /> Arvy is reading…</div> : error ? <div className="arvy-error" role="alert">{error}</div> : <p className="us-meta">Arvy offers it under the last one. Nothing is added until you tap Confirm.</p>}
    </div>
  );
}

/** Put words on the clipboard; false when this browser won't. */
async function toClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* an older browser, or not allowed: the old way */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

export function Us() {
  const user = getPass()?.user.username || '';
  const other = otherName(user);
  const otherUser = user === 'vijay' ? 'rosh' : user === 'rosh' ? 'vijay' : '';   // whose to-do "for the other one" is
  useSyncExternalStore(onUs, usVersion);   // any change to the chat redraws it (new messages, a link to a photo arriving)
  const open = usIsOpen(), rows = usRows(), loaded = usLoaded();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // the emoji tray (Tray.tsx): one theme at a time, opening on the occasion coming up next. Birthdays are read off the
  // calendar when the chat first opens, so the tray knows which is next by the time it is asked for. A tap puts the
  // emoji into the message where the caret is (or was: the box needn't be in use, so the keyboard stays down while picking)
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);      // where typing would land, as last seen
  const setCaret = useRef<number | null>(null);   // where to put the caret once the box has the new text
  useLayoutEffect(() => {
    const at = setCaret.current, el = boxRef.current;
    setCaret.current = null;
    if (at !== null && el && document.activeElement === el) el.setSelectionRange(at, at);
  }, [text]);
  const [tray, setTray] = useState(false);
  const [birthdays, setBirthdays] = useState<Birthday[] | null>(null);
  useEffect(() => {
    if (!open || birthdays) return;
    getDocs<{ title?: string; date?: string; repeat?: string }>('event').then(d => setBirthdays(birthdaysFrom(d.map(x => x.data).filter(Boolean)))).catch(() => setBirthdays([]));
  }, [open, birthdays]);
  const occasions = useMemo(() => upcoming(calendarKey(), birthdays || []), [birthdays, tray]); // eslint-disable-line react-hooks/exhaustive-deps

  // replying, and picking messages out. `answering` = the message the next one sent will be a reply to; `picks` =
  // the keys of the picked ones (the bar shows while there are any); `asking` = the list of things to ask Arvy is open
  const [answering, setAnswering] = useState<Row | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ line: string; ok: boolean } | null>(null);   // a small line after something was done ("Copied")
  const [flash, setFlash] = useState<string | null>(null);   // the message a tapped quote went to, lit for a moment
  const [goTo, setGoTo] = useState<string | null>(null);     // the message to bring into view once the screen has it
  const bodyRef = useRef<HTMLDivElement>(null);
  const touch = useRef<Touching>({ swiping: false, spent: false });   // what the finger on the chat has done so far
  const atEnd = useRef(true);       // the list is scrolled to its end (it stays there when what's under it grows)
  const saidTimer = useRef(0), flashTimer = useRef(0);
  const chosen = pickedRows(rows, picks), picking = chosen.length > 0;
  const bar = barFor(chosen.length);
  const leave = () => { setPicks([]); setAsking(false); setAskError(null); };
  const tellThem = (line: string, ok = true) => { setSaid({ line, ok }); window.clearTimeout(saidTimer.current); saidTimer.current = window.setTimeout(() => setSaid(null), 3500); };
  const nodeOf = (key: string) => [...(bodyRef.current?.querySelectorAll<HTMLElement>('.us-msg[data-key]') || [])].find(n => n.dataset.key === key);
  const jump = (key: string) => {
    const to = nodeOf(key);
    if (!to) return;   // too far back to be on this screen: the quote itself says what it was
    to.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setFlash(key); window.clearTimeout(flashTimer.current); flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  };
  useEffect(() => () => { window.clearTimeout(saidTimer.current); window.clearTimeout(flashTimer.current); }, []);
  useEffect(() => { if (!open) { setPicks([]); setAsking(false); setAskError(null); } }, [open]);   // closing the chat lets go of what was picked
  useEffect(() => {   // …and so does Escape, on a keyboard
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !askBusy) { setPicks([]); setAsking(false); setAskError(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, askBusy]);
  // a swipe is the message's, not the list's: some phones would still start scrolling halfway through one
  useEffect(() => {
    const b = bodyRef.current;
    if (!open || !b) return;
    const hush = (e: TouchEvent) => { if (touch.current.swiping && e.cancelable) e.preventDefault(); };
    b.addEventListener('touchmove', hush, { passive: false });
    return () => b.removeEventListener('touchmove', hush);
  }, [open]);
  // replying puts the caret in the box (from the finger lifting, so a phone brings its keyboard up)
  useLayoutEffect(() => { if (answering) boxRef.current?.focus(); }, [answering]);

  useEffect(() => { if (open) void pushState().then(setPush); }, [open]);
  // a picture pasted while the chat is open (a screenshot on the clipboard) is added like one chosen with the button
  const pasted = useRef<(list: File[]) => void>(() => undefined);
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => { const list = imagesFrom(e.clipboardData); if (!list.length) return; e.preventDefault(); pasted.current(list); };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);
  // the newest message stays in view: when one arrives, and when Arvy's offer lands under the last one. Not while
  // messages are being picked: the list stays where the finger left it
  const last = rows[rows.length - 1]?.msg;
  const tail = `${rows.length}:${last?.arvy?.state || ''}:${last?.arvy?.proposals?.length || 0}`;
  useEffect(() => { if (open && !picking) endRef.current?.scrollIntoView({ block: 'end' }); }, [open, tail, sending]); // eslint-disable-line react-hooks/exhaustive-deps
  // …and when the quote or the bar takes room from under it. The list of things to ask takes a lot: the last
  // picked message, the one Arvy's offer will land under, is kept in view above it
  useEffect(() => {
    if (!open) return;
    if (asking && chosen.length) nodeOf(chosen[chosen.length - 1].key)?.scrollIntoView({ block: 'nearest' });
    else if (atEnd.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, !!answering, picking, asking]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (goTo) { jump(goTo); setGoTo(null); } }, [goTo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const send = async () => {
    const t = text, f = files, to = answering;
    if (sending || (!t.trim() && !f.length)) return;
    setSending(true); setError(null); setText(''); setFiles([]); setAnswering(null); caret.current = null;
    try { await say(t, f, to); }
    catch (e) { setError(e instanceof Error ? e.message : 'That didn’t send.'); setText(t); setFiles(f); setAnswering(to); }
    finally { setSending(false); }
  };
  const putEmoji = (e: EmojiDef) => {
    const next = putIn(text, e, caret.current ?? text.length);
    if (next.text.length > MAX_TEXT) { setError('That message is full.'); return; }
    setError(null); setText(next.text); caret.current = setCaret.current = next.caret;
  };
  // typing: one backspace on an emoji of ours takes all of it (emoji.tsx healDraft)
  const typed = (el: HTMLTextAreaElement) => {
    const next = healDraft(el.value, el.selectionStart ?? el.value.length);
    if (next.text !== el.value) setCaret.current = next.caret;
    caret.current = next.caret; setText(next.text);
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
  // a message picked or let go (a press and hold on the first one, a tap on the rest)
  const pickMsg = (key: string) => {
    if (askBusy) return;
    const next = togglePick(picks.filter(k => chosen.some(r => r.key === k)), key);
    if (next.length === chosen.length && !picks.includes(key)) { tellThem(`${MAX_ASK} at a time at most.`, false); return; }
    setSaid(null); setAskError(null); setPicks(next);
    if (!next.length) setAsking(false);
  };
  const reply = (row: Row) => { leave(); setError(null); setAnswering(row); };
  const copy = async () => {
    const ok = await toClipboard(copyText(chosen.map(r => r.msg)));
    leave(); tellThem(ok ? 'Copied' : 'That couldn’t be copied here.', ok);
  };
  const ask = async (a: Asking) => {
    if (askBusy) return;
    setAskBusy(true); setAskError(null);
    try { const r = await askArvy(chosen.map(x => x.key), a); leave(); setGoTo(r.key); }
    catch (e) { setAskError(e instanceof Error ? e.message : 'Arvy didn’t answer. Try again.'); }
    finally { setAskBusy(false); }
  };
  const idea = async () => {
    if (askBusy) return;
    setAskBusy(true); setAskError(null);
    try { await logIdea(chosen); leave(); tellThem('Saved to Arvy’s log'); }
    catch { setAskError('That didn’t save. Try again.'); }
    finally { setAskBusy(false); }
  };
  const quote = answering ? replyTo(answering) : null;

  return (
    <div className={`arvy-sheet us-sheet${picking ? ' is-picking' : ''}`} role="dialog" aria-label={`Chat with ${other}`}>
      <header className="arvy-head">
        <div className="arvy-avatar us-avatar" aria-hidden>{other.charAt(0)}</div>
        <div className="arvy-title"><b>{other}</b><span>Arvy reads along</span></div>
        <CallButton />
        <button type="button" className="arvy-icon" onClick={() => setArvyOpen(true)} aria-label="Switch to Arvy" title="Arvy"><Sparkles /></button>
        <button type="button" className="arvy-icon" onClick={() => setUsOpen(false)} aria-label="Close"><X /></button>
      </header>
      <div className="arvy-body" ref={bodyRef} onScroll={e => { const b = e.currentTarget; atEnd.current = b.scrollHeight - b.scrollTop - b.clientHeight < 48; }}
        onPointerDownCapture={() => { touch.current.spent = false; }}
        onPointerUpCapture={() => { if (touch.current.spent) window.setTimeout(() => { touch.current.spent = false; }, 350); }}
        onClickCapture={e => { if (touch.current.spent) { touch.current.spent = false; e.preventDefault(); e.stopPropagation(); } }}>
        {push === 'off' && <div className="us-push">Turn on notifications to know when {other} writes.<button type="button" onClick={() => void turnOn()}>Turn on</button></div>}
        {(push === 'denied' || push === 'ios-install') && <div className="us-push">{push === 'denied' ? 'Notifications are blocked for this site, so you won’t hear when a message comes in. Allow them in the browser’s site settings.' : 'To hear when a message comes in on iPhone, add the planner to your Home Screen, then turn on reminders in Settings.'}</div>}
        {loaded && !rows.length && (
          <div className="arvy-hello">
            <p><b>This is your chat with {other}.</b> Write, or send a photo or a short video.</p>
            <p>Arvy reads along. When one of you asks for something (“can you get apples”, “dentist Thursday at 3”), it offers to put it on the shopping list, the calendar or a to-do list, and waits for a tap. Nothing is added by itself.</p>
          </div>)}
        {!loaded && <div className="us-meta">Loading…</div>}
        {rows.map(r => <Message key={r.msg.id} row={r} user={user} picked={picks.includes(r.key)} picking={picking} flash={flash === r.key} touch={touch} onPick={pickMsg} onReply={reply} onJump={jump} />)}
        {error && <div className="arvy-error" role="alert">{error}</div>}
        <div ref={endRef} />
      </div>
      {said && <div className="us-said" role="status">{said.ok && <Check aria-hidden />} {said.line}</div>}
      {picking ? (
        <>
          {asking && <AskList about={bar.about} user={user} other={otherUser ? { username: otherUser, name: other } : null} busy={askBusy} error={askError} onAsk={a => void ask(a)} onIdea={() => void idea()} />}
          <div className="us-bar" role="toolbar" aria-label="Selected messages">
            <button type="button" className="us-bar-x" onClick={leave} disabled={askBusy} aria-label="Stop selecting"><X /></button>
            <b role="status">{bar.label}</b>
            {bar.reply && <button type="button" onClick={() => reply(chosen[0])} disabled={askBusy}><Reply aria-hidden />Reply</button>}
            <button type="button" className={asking ? 'us-on' : ''} onClick={() => { setAskError(null); setAsking(a => !a); }} disabled={askBusy} aria-expanded={asking}><Sparkles aria-hidden />Ask Arvy</button>
            <button type="button" onClick={() => void copy()} disabled={askBusy}><Copy aria-hidden />Copy</button>
          </div>
        </>
      ) : (
        <>
          {files.length > 0 && (
            <div className="us-picked">
              {files.map((f, i) => <span key={i}>{f.type.startsWith('video/') ? 'Video' : 'Photo'} {i + 1}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Take it off"><X /></button></span>)}
            </div>)}
          {tray && <Tray occasions={occasions} noBirthdays={!!birthdays && !birthdays.length} onPick={putEmoji} />}
          {quote && answering && (
            <div className="us-replying">
              <Reply aria-hidden />
              <div><b>Replying to {answering.msg.by === user ? 'yourself' : answering.msg.name}</b><span><QuoteLine q={quote} /></span></div>
              <button type="button" onClick={() => setAnswering(null)} aria-label="Don’t reply to it"><X /></button>
            </div>)}
          {hasOurs(text) && <div className="us-preview" aria-label="How it will look"><span>Preview</span><div><EmojiText text={text} /></div></div>}
          <form className="arvy-input" onSubmit={e => { e.preventDefault(); void send(); }}>
            <input ref={pickRef} type="file" accept="image/*,video/*" multiple hidden onChange={e => { const list = Array.from(e.target.files || []); e.target.value = ''; pick(list); }} />
            <button type="button" className="arvy-mic" onClick={() => pickRef.current?.click()} disabled={sending} aria-label="Add a photo or a video"><ImagePlus /></button>
            <button type="button" className={`arvy-mic${tray ? ' us-on' : ''}`} onClick={() => setTray(t => !t)} aria-label="Emoji" aria-expanded={tray}><Smile /></button>
            <textarea ref={boxRef} rows={1} value={text} onChange={e => typed(e.target)} onSelect={e => { caret.current = e.currentTarget.selectionStart; }} placeholder={answering ? 'Your reply…' : `Message ${other}…`} aria-label={`Message ${other}`} enterKeyHint="send"
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
            <button type="submit" className="arvy-send" disabled={sending || (!text.trim() && !files.length)} aria-label="Send"><Send /></button>
          </form>
        </>
      )}
    </div>
  );
}
