// src/v2/features/benny/BennyPanel.tsx — The Benny: how you open it and its panel.
//   variant "bar": "Ask the Benny" + mic in the top bar (super admins), panel on the right / bottom sheet on a phone.
//   variant "fab": a round orange button on the route manager map (route managers, and super admins on any manager's map),
//                  opening a bottom sheet; "my team" = the map that's open.
// Mic: tap = listen until you pause, then send; hold = talk while held, let go to send.
// Answers are read out only when the question was spoken (and the speaker is on).
// Changes come as a card under the answer: nothing happens until you tap its button.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Mic, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { askBenny, canListen, demoDue, listen, primeVoice, readDemo, speak, stopSpeaking, watchErrors, writeDemo, type BennyMsg } from '../../lib/benny';
import { describe, doProposal, emailsPreset, payoutsStart, type BennyProposal } from '../../lib/bennyActions';
import { BennyMapCard } from './BennyMap';
import './benny.css';

const MUTE = 'benny.mute';
const HOLD_MS = 350;
const keyFor = (variant: string) => `benny.chat.v2.${variant}`;
const load = (k: string): BennyMsg[] => { try { return JSON.parse(sessionStorage.getItem(k) || '[]'); } catch { return []; } };
const save = (k: string, m: BennyMsg[]) => { try { sessionStorage.setItem(k, JSON.stringify(m.slice(-30))); } catch { /* private mode */ } };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
watchErrors();

/** Light formatting: **bold** and line breaks. */
const Rich: React.FC<{ text: string }> = ({ text }) => <>{text.split('\n').map((line, i) => (
  <React.Fragment key={i}>{i > 0 && <br />}{line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p)}</React.Fragment>
))}</>;

const ProposalCard: React.FC<{ p: BennyProposal; outcome: BennyMsg['outcome']; busy: boolean; onDo: () => void; onNo: () => void; onChange?: () => void }> = ({ p, outcome, busy, onDo, onNo, onChange }) => {
  const d = describe(p);
  return (
    <div className={`benny-card${outcome ? ` ${outcome.state}` : ''}`}>
      <b className="benny-card-t">{d.title}</b>
      <ul>{d.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {outcome && <div className={`benny-card-out ${outcome.state}`} role="status">{outcome.state === 'done' && <Check size={15} />}{outcome.text}</div>}
      {(!outcome || outcome.state === 'failed') && (
        <div className="benny-card-b">
          <button type="button" className="benny-go" onClick={onDo} disabled={busy}>{busy ? 'Working…' : outcome ? 'Try again' : d.action}</button>
          {onChange && <button type="button" className="benny-alt" onClick={onChange} disabled={busy}>Change</button>}
          <button type="button" className="benny-alt" onClick={onNo} disabled={busy}>Not now</button>
        </div>
      )}
    </div>
  );
};

export const Benny: React.FC<{
  variant?: 'bar' | 'fab'; rmManager?: string | null; rmName?: string | null; centerId?: string | null;
  /** the floater map: the managers followed there (rmManager is then the floater's own id), and the center it is open at */
  following?: { id: string; name: string }[] | null; centerLabel?: string | null;
}> = ({ variant = 'bar', rmManager, rmName, centerId, following, centerLabel }) => {
  const { profile, center, can } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const floating = variant === 'fab' && !!following?.length;
  const KEY = keyFor(floating ? 'fab.floater' : variant);   // the floater map keeps its own chat: its cards are the floater's, not a manager's
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<BennyMsg[]>(() => load(KEY));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState<number | null>(null);
  const [hearing, setHearing] = useState<null | 'tap' | 'hold'>(null);
  const [mute, setMute] = useState(() => { try { return localStorage.getItem(MUTE) === '1'; } catch { return false; } });
  const rec = useRef<ReturnType<typeof listen> | null>(null);
  const held = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mic = canListen();
  const allowed = variant === 'bar' ? !!profile?.is_super_admin : !!profile && (profile.is_super_admin || can('route_manager') || can('rm_floater'));
  const userId = profile?.id || '';
  // the first-time demo: 0 = not showing, 1 = meet the Benny, 2 = try a question, 3 = three things to know
  const [demo, setDemo] = useState<0 | 1 | 2 | 3>(0);
  const cid = centerId || center?.id || null;
  const centerName = centerLabel || (center && center.id === cid ? center.display_name : undefined);
  const followKey = (following || []).map(f => f.id).join(',');

  useEffect(() => { save(KEY, msgs); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, KEY]);
  useEffect(() => { try { localStorage.setItem(MUTE, mute ? '1' : '0'); } catch { /* none */ } if (mute) stopSpeaking(); }, [mute]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.benny-fullmap')) setOpen(false); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [open]);
  useEffect(() => () => { rec.current?.cancel(); stopSpeaking(); }, []);
  useEffect(() => {
    if (!allowed || !userId) return;
    const seen = readDemo(userId);
    if (!demoDue(seen)) return;
    const t = window.setTimeout(() => {
      const now = readDemo(userId);            // the other Benny (top bar / RM map) may have shown it meanwhile
      if (!demoDue(now)) return;
      writeDemo(userId, { ...now, opens: now.opens + 1 });
      setDemo(1); setOpen(true);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [allowed, userId]);
  const endDemo = () => { if (userId) writeDemo(userId, { opens: 3, done: true }); setDemo(0); };

  // The Benny speaks with Google's voice. If that can't be had it stays quiet (never the phone's own voice) and says why, once.
  const voiceTold = useRef(false);
  const say = useCallback((line: string) => {
    speak(line).catch(e => {
      if (voiceTold.current) return;
      voiceTold.current = true;
      setMsgs(m => [...m, { role: 'assistant', text: `I can’t speak right now: ${e instanceof Error ? e.message : 'the voice didn’t answer'}`, error: true }]);
    });
  }, []);

  const send = useCallback(async (q: string, spoken: boolean) => {
    const ask = q.trim(); if (!ask || busy) return;
    const next: BennyMsg[] = [...msgs, { role: 'user', text: ask, spoken }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await askBenny(next.slice(-16), {
        center_id: cid || undefined, center_name: centerName, today: todayLocal(), path: loc.pathname,
        screen: variant === 'fab' ? 'rm' : undefined, rm_manager: rmManager || undefined, user_name: profile?.full_name,
        ...(floating ? { following: following!.map(f => f.id), following_names: following!.map(f => f.name) } : {}),
      });
      setMsgs(m => [...m, { role: 'assistant', text: r.reply || 'Done.', map: r.map, proposal: r.proposal }]);
      setDemo(d => (d === 1 || d === 2 ? 3 : d));
      if (spoken && !mute) say(r.reply);
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'Something went wrong', error: true }]);
    } finally { setBusy(false); }
  }, [msgs, busy, cid, centerName, loc.pathname, mute, variant, rmManager, followKey, profile?.full_name, say]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the mic's "done talking" arrives later: it must send with the chat as it is then, not as it was when listening began
  const sendRef = useRef(send);
  sendRef.current = send;

  const settle = (i: number, outcome: NonNullable<BennyMsg['outcome']>) => setMsgs(m => m.map((x, j) => j === i ? { ...x, outcome } : x));
  const confirm = async (i: number) => {
    const p = msgs[i]?.proposal; if (!p || !cid || doing !== null) return;
    // booking emails: nothing changes here. The Send booking emails screen opens with the day and routes picked and writes
    // the emails; the person reads them and presses Send there.
    if (p.kind === 'booking_emails') {
      settle(i, { state: 'dismissed', text: 'Opened Send booking emails with these routes. Nothing is sent until you press Send there.' });
      stopSpeaking(); setOpen(false);
      nav('/app/bookings/emails', { state: { benny: emailsPreset(p.check) } });
      return;
    }
    // payouts: nothing is paid out here either. The payout screen opens at the first one; the person presses Finalize on
    // each and it moves to the next.
    if (p.kind === 'payouts') {
      const href = payoutsStart(p.check);
      if (!href) { settle(i, { state: 'failed', text: 'There’s no payout to open. Ask me again.' }); return; }
      settle(i, { state: 'dismissed', text: `Opened the first of ${p.check.carts.length}. Nobody is paid out until you press Finalize there.` });
      stopSpeaking(); setOpen(false);
      nav(href);
      return;
    }
    setDoing(i);
    try {
      const done = await doProposal(p, { id: cid, region: center?.id === cid ? center.region : null, services: center?.id === cid ? center.services : null });
      settle(i, { state: 'done', text: done });
      const spoke = [...msgs.slice(0, i)].reverse().find(m => m.role === 'user')?.spoken;
      if (spoke && !mute) say(done);
      window.dispatchEvent(new CustomEvent('benny:changed', { detail: p.kind }));
    } catch (e) {
      settle(i, { state: 'failed', text: e instanceof Error ? e.message : 'That didn’t work' });
    } finally { setDoing(null); }
  };

  const startHearing = (mode: 'tap' | 'hold') => {
    stopSpeaking(); rec.current?.cancel();
    setHearing(mode); setText('');
    const r = listen(t => setText(t)); rec.current = r;
    r.done.then(words => { if (rec.current === r) { rec.current = null; setHearing(null); if (words) void sendRef.current(words, true); } })
      .catch(e => { rec.current = null; setHearing(null); setMsgs(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : 'The mic didn’t work', error: true }]); });
  };
  // tap vs hold on the mic button
  const micDown = (e: React.PointerEvent) => {
    if (!mic || busy) return;
    e.preventDefault();
    if (!mute) primeVoice();                                // this tap is what lets the answer be heard later
    if (hearing) { rec.current?.stop(); return; }           // tap again = done talking
    if (!open) setOpen(true);
    startHearing('tap');
    held.current = window.setTimeout(() => { held.current = null; setHearing('hold'); }, HOLD_MS);
  };
  const micUp = () => {
    if (held.current) { window.clearTimeout(held.current); held.current = null; return; }  // short tap: keep listening till a pause
    if (hearing === 'hold') rec.current?.stop();                                           // let go = send
  };

  // the map's round button: tap = open to type, hold = talk (let go to send)
  const fabDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!mute) primeVoice();
    let talking = false;
    const t = window.setTimeout(() => { if (!mic) return; talking = true; setOpen(true); startHearing('hold'); }, HOLD_MS);
    const up = () => {
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      window.clearTimeout(t);
      if (talking) rec.current?.stop();
      else { setOpen(true); setTimeout(() => input.current?.focus(), 50); }
    };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };

  if (!allowed) return null;
  const micBtn = (cls = '') => mic ? (
    <button type="button" className={`benny-mic${cls}${hearing ? ' on' : ''}`} onPointerDown={micDown} onPointerUp={micUp} onPointerLeave={micUp}
      onContextMenu={e => e.preventDefault()} aria-label={hearing ? 'Stop listening' : 'Talk to the Benny (tap, or hold and let go to send)'} title="Tap to talk · hold to talk, let go to send" disabled={busy}>
      <Mic size={cls.includes('big') ? 18 : 16} />
    </button>
  ) : null;
  const demoAsk = variant === 'fab' ? ['Who’s on my team today?', 'Which of my routes have prebooks?'] : ['Who’s booked today?', 'How many open prebooks do we have?'];
  const whose = floating ? (following!.length === 1 ? `${following![0].name}’s team` : `${following!.length} managers’ teams`) : rmName ? `${rmName}’s team` : 'Your team';
  const suggestions = floating
    ? ['Who’s out today?', 'Plan my check order', 'Drop a pin here called Meet', 'Something’s broken on the map']
    : variant === 'fab'
    ? ['Who’s on my team today?', 'Find a free route connected to Kyle’s', 'Which of my routes have prebooks?', 'Something’s broken on the map']
    : ['Who’s booked today?', 'How many open prebooks in Surrey?', 'Show me where the prebooks in Surrey are', 'Start tomorrow with me, solo, North Van 1'];

  return (
    <span className="benny-root" style={{ display: 'contents' }}>
      {variant === 'bar' ? <>
        <button type="button" className={`benny-ask${open ? ' on' : ''}`} onClick={() => { setOpen(o => !o); setTimeout(() => input.current?.focus(), 50); }} aria-expanded={open} aria-label="Ask the Benny">
          <Sparkles size={15} /><span className="v2-hide-sm">Ask the Benny</span>
        </button>
        <span className="v2-hide-sm">{micBtn()}</span>
      </> : !open && (
        <button type="button" className="benny-fab" onPointerDown={fabDown} onContextMenu={e => e.preventDefault()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); setTimeout(() => input.current?.focus(), 50); } }}
          aria-label="The Benny: tap to type, hold to talk" title="Tap to type · hold to talk">
          <Sparkles size={24} />
        </button>
      )}
      {/* on the page's top layer, so the top bar's own stacking doesn't trap it */}
      {open && createPortal(
        <div className="benny-root"><aside className={`benny-panel${variant === 'fab' ? ' sheet' : ''}`} aria-label="The Benny">
          <div className="benny-h">
            <span className="benny-dot" aria-hidden="true"><Sparkles size={14} /></span><b>The Benny</b>
            {(variant === 'fab' ? <span className="v2-small benny-mut" title={floating ? following!.map(f => f.name).join(', ') : undefined}>{whose}</span>
              : centerName && <span className="v2-small benny-mut">{centerName}</span>)}
            <span className="v2-spacer" />
            {mic && <button type="button" className="benny-icon" onClick={() => { if (mute) { primeVoice(); voiceTold.current = false; say('Voice on.'); } setMute(m => !m); }} aria-pressed={!mute} aria-label={mute ? 'Turn spoken answers on' : 'Turn spoken answers off'} title={mute ? 'Voice off' : 'Voice on (spoken questions get spoken answers)'}>
              {mute ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>}
            {msgs.length > 0 && <button type="button" className="benny-link" onClick={() => { setMsgs([]); stopSpeaking(); }}>Clear</button>}
            <button type="button" className="benny-icon" onClick={() => { setOpen(false); setDemo(0); rec.current?.cancel(); stopSpeaking(); }} aria-label="Close the Benny"><X size={18} /></button>
          </div>
          <div className="benny-list" ref={list} aria-live="polite">
            {!msgs.length && demo === 0 && (
              <div className="benny-hello">
                <p>{floating ? `Ask about the team${following!.length === 1 ? '' : 's'} you’re following (${following!.map(f => f.name.split(' ')[0]).join(', ')}), or tell me a change: “give Wilson route 35”, “drop a pin at Wilson”, “plan my pickup order”. You confirm every change first.`
                  : variant === 'fab' ? 'Ask about your team and routes, or tell me a change: “partner up Wilson with Michael A”, “give Wilson route 35”. You confirm every change first.'
                  : 'Ask about today, people, bookings or maps, or start a day. You confirm every change first. Tell me when something’s broken and I’ll let Vijay know.'}</p>
                {suggestions.map(s => <button key={s} type="button" className="benny-chip" onClick={() => void send(s, false)}>{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`benny-msg ${m.role}${m.error ? ' err' : ''}`}>
                <div className="benny-bubble"><Rich text={m.text} /></div>
                {m.map && <BennyMapCard spec={m.map} centerId={cid} />}
                {m.proposal && <ProposalCard p={m.proposal} outcome={m.outcome} busy={doing === i} onDo={() => void confirm(i)}
                  onNo={() => settle(i, { state: 'dismissed', text: 'Not done.' })}
                  onChange={m.proposal.kind === 'start_day' ? () => { const d = (m.proposal as Extract<BennyProposal, { kind: 'start_day' }>).check.date; settle(i, { state: 'dismissed', text: 'Opened Start session to change it.' }); nav(`/app/workerbook/days/${d}/start`); }
                    : m.proposal.kind === 'booking' ? () => { settle(i, { state: 'dismissed', text: 'Opened Bookings › List to change it there.' }); nav('/app/bookings/list'); } : undefined} />}
              </div>
            ))}
            {busy && <div className="benny-msg assistant"><div className="benny-bubble benny-typing" aria-label="The Benny is thinking"><i /><i /><i /></div></div>}
            {demo === 1 && (
              <div className="benny-demo" role="group" aria-label="Meet the Benny">
                <span className="benny-demo-step">Quick demo · 1 of 3</span>
                <b>Meet the Benny</b>
                <p>{variant === 'fab'
                  ? 'I’m the assistant built into the app. Ask me about your team, your routes and your prebooks, or tell me a change, like you’d text a person.'
                  : 'I’m the assistant built into the app. Ask me about the day, people, bookings and maps, or tell me a change, like you’d text a person.'}</p>
                <div className="benny-card-b">
                  <button type="button" className="benny-go" onClick={() => setDemo(2)}>Show me</button>
                  <button type="button" className="benny-alt" onClick={endDemo}>Skip</button>
                </div>
              </div>
            )}
            {demo === 2 && !busy && (
              <div className="benny-demo" role="group" aria-label="Try the Benny">
                <span className="benny-demo-step">Quick demo · 2 of 3</span>
                <b>Try it: tap a question</b>
                <p>It’s a real question, answered from today’s data.</p>
                {demoAsk.map(q => <button key={q} type="button" className="benny-chip" onClick={() => void send(q, false)}>{q}</button>)}
                <button type="button" className="benny-link" onClick={endDemo}>Skip the demo</button>
              </div>
            )}
            {demo === 3 && !busy && (
              <div className="benny-demo" role="group" aria-label="Three things to know">
                <span className="benny-demo-step">Quick demo · 3 of 3</span>
                <b>That’s it. Three things to know</b>
                <ol>
                  <li>{mic ? <><b>Talk instead of typing.</b> Tap the mic and pause when you’re done, or hold it and let go.</> : <><b>Type it like a text.</b> Short and plain works best.</>}</li>
                  <li><b>Changes wait for you.</b> {variant === 'fab' ? 'Say “give Wilson route 35”, “drop a pin at Wilson called Lunch” or “plan my pickup order”' : 'Say “start tomorrow with me, North Van 1” or “give Wilson route 35”'} and I show a card. Nothing happens until you tap it.</li>
                  <li><b>Something broken?</b> Tell me what happened and it goes straight into Vijay’s bug log.</li>
                </ol>
                <div className="benny-card-b"><button type="button" className="benny-go" onClick={endDemo}>Got it</button></div>
              </div>
            )}
          </div>
          <form className="benny-in" onSubmit={e => { e.preventDefault(); void send(text, false); }}>
            <label htmlFor={`benny-ask-${variant}`} className="benny-sr">Ask the Benny</label>
            <input id={`benny-ask-${variant}`} ref={input} value={text} onChange={e => setText(e.target.value)} disabled={!!hearing}
              placeholder={hearing === 'hold' ? 'Listening… let go to send' : hearing ? 'Listening… pause when you’re done' : 'Ask or tell the Benny…'} autoComplete="off" />
            {text.trim() && !hearing
              ? <button type="submit" className="benny-mic big" disabled={busy} aria-label="Send"><Send size={17} /></button>
              : micBtn(' big')}
          </form>
        </aside></div>, document.body)}
    </span>
  );
};
