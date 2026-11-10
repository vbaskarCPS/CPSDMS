// src/v2/features/benny/BennyPanel.tsx — The Benny: the top-bar buttons ("Ask the Benny" + mic) and its panel
// (right side on a computer, a bottom sheet on a phone). Super admins only for now.
// Mic: tap = listen until you pause, then send; hold = talk while held, let go to send.
// Answers are read out only when the question was spoken (and the speaker is on).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Mic, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { askBenny, canListen, listen, speak, stopSpeaking, type BennyMsg } from '../../lib/benny';
import { BennyMapCard } from './BennyMap';
import './benny.css';

const KEY = 'benny.chat.v1', MUTE = 'benny.mute';
const load = (): BennyMsg[] => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (m: BennyMsg[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(m.slice(-30))); } catch { /* private mode */ } };
const HOLD_MS = 350;
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Light formatting: **bold** and line breaks. */
const Rich: React.FC<{ text: string }> = ({ text }) => <>{text.split('\n').map((line, i) => (
  <React.Fragment key={i}>{i > 0 && <br />}{line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p)}</React.Fragment>
))}</>;

export const Benny: React.FC = () => {
  const { profile, center } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<BennyMsg[]>(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState<null | 'tap' | 'hold'>(null);
  const [mute, setMute] = useState(() => { try { return localStorage.getItem(MUTE) === '1'; } catch { return false; } });
  const rec = useRef<ReturnType<typeof listen> | null>(null);
  const held = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mic = canListen();

  useEffect(() => { save(msgs); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { try { localStorage.setItem(MUTE, mute ? '1' : '0'); } catch { /* none */ } if (mute) stopSpeaking(); }, [mute]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.benny-fullmap')) setOpen(false); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [open]);
  useEffect(() => () => { rec.current?.cancel(); stopSpeaking(); }, []);

  const send = useCallback(async (q: string, spoken: boolean) => {
    const ask = q.trim(); if (!ask || busy) return;
    const next: BennyMsg[] = [...msgs, { role: 'user', text: ask, spoken }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await askBenny(next.slice(-16), { center_id: center?.id, center_name: center?.display_name, today: todayLocal(), path: loc.pathname });
      setMsgs(m => [...m, { role: 'assistant', text: r.reply || 'Done.', map: r.map }]);
      if (spoken && !mute) speak(r.reply);
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong', error: true }]);
    } finally { setBusy(false); }
  }, [msgs, busy, center, loc.pathname, mute]);

  const startHearing = (mode: 'tap' | 'hold') => {
    stopSpeaking(); rec.current?.cancel();
    setHearing(mode); setText('');
    const r = listen(t => setText(t)); rec.current = r;
    r.done.then(words => { if (rec.current === r) { rec.current = null; setHearing(null); if (words) void send(words, true); } })
      .catch(e => { rec.current = null; setHearing(null); setMsgs(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'The mic didn’t work', error: true }]); });
  };
  // tap vs hold on the mic button
  const micDown = (e: React.PointerEvent) => {
    if (!mic || busy) return;
    e.preventDefault();
    if (hearing) { rec.current?.stop(); return; }           // tap again = done talking
    if (!open) setOpen(true);
    startHearing('tap');
    held.current = window.setTimeout(() => { held.current = null; setHearing('hold'); }, HOLD_MS);
  };
  const micUp = () => {
    if (held.current) { window.clearTimeout(held.current); held.current = null; return; }  // short tap: keep listening till a pause
    if (hearing === 'hold') rec.current?.stop();                                           // let go = send
  };

  if (!profile?.is_super_admin) return null;
  const micBtn = (big?: boolean) => mic ? (
    <button type="button" className={`benny-mic${big ? ' big' : ''}${hearing ? ' on' : ''}`} onPointerDown={micDown} onPointerUp={micUp} onPointerLeave={micUp}
      onContextMenu={e => e.preventDefault()} aria-label={hearing ? 'Stop listening' : 'Talk to the Benny (tap, or hold and let go to send)'} title="Tap to talk · hold to talk, let go to send" disabled={busy}>
      <Mic size={big ? 18 : 16} />
    </button>
  ) : null;

  return (
    <>
      <button type="button" className={`benny-ask${open ? ' on' : ''}`} onClick={() => { setOpen(o => !o); setTimeout(() => input.current?.focus(), 50); }} aria-expanded={open} aria-label="Ask the Benny">
        <Sparkles size={15} /><span className="v2-hide-sm">Ask the Benny</span>
      </button>
      <span className="v2-hide-sm">{micBtn()}</span>
      {open && (
        <aside className="benny-panel" aria-label="The Benny">
          <div className="benny-h">
            <span className="benny-dot" aria-hidden="true"><Sparkles size={14} /></span><b>The Benny</b>
            {center && <span className="v2-small benny-mut">{center.display_name}</span>}
            <span className="v2-spacer" />
            {mic && <button type="button" className="benny-icon" onClick={() => setMute(m => !m)} aria-pressed={!mute} aria-label={mute ? 'Turn spoken answers on' : 'Turn spoken answers off'} title={mute ? 'Speaker off' : 'Speaker on (spoken questions get spoken answers)'}>
              {mute ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}
            {msgs.length > 0 && <button type="button" className="benny-link" onClick={() => { setMsgs([]); stopSpeaking(); }}>Clear</button>}
            <button type="button" className="benny-icon" onClick={() => { setOpen(false); rec.current?.cancel(); stopSpeaking(); }} aria-label="Close the Benny"><X size={18} /></button>
          </div>
          <div className="benny-list" ref={list} aria-live="polite">
            {!msgs.length && (
              <div className="benny-hello">
                <p>Ask about today, people, bookings or maps. I can only look things up for now — changes come next.</p>
                {['Who’s booked today?', 'How many open prebooks in Surrey?', 'Show me where the prebooks in Surrey are', 'What’s Chris Hinch’s number?'].map(s =>
                  <button key={s} type="button" className="benny-chip" onClick={() => void send(s, false)}>{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`benny-msg ${m.role}${m.error ? ' err' : ''}`}>
                <div className="benny-bubble"><Rich text={m.text} /></div>
                {m.map && <BennyMapCard spec={m.map} />}
              </div>
            ))}
            {busy && <div className="benny-msg assistant"><div className="benny-bubble benny-typing" aria-label="The Benny is thinking"><i /><i /><i /></div></div>}
          </div>
          <form className="benny-in" onSubmit={e => { e.preventDefault(); void send(text, false); }}>
            <label htmlFor="benny-ask" className="benny-sr">Ask the Benny</label>
            <input id="benny-ask" ref={input} value={text} onChange={e => setText(e.target.value)} disabled={!!hearing}
              placeholder={hearing === 'hold' ? 'Listening… let go to send' : hearing ? 'Listening… pause when you’re done' : 'Ask the Benny…'} autoComplete="off" />
            {text.trim() && !hearing
              ? <button type="submit" className="benny-mic big" disabled={busy} aria-label="Send"><Send size={17} /></button>
              : micBtn(true)}
          </form>
        </aside>
      )}
    </>
  );
};
