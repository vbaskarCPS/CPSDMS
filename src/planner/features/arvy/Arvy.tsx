// src/planner/features/arvy/Arvy.tsx — Arvy's chat panel, on every signed-in screen. The RV button in the bottom bar
// (ui/Shell.tsx) opens and closes it, and held down it opens it listening; type, or tap the mic and talk (it sends
// when you pause). Spoken questions get a
// spoken answer (a woman's voice for Rosh, a man's for Vijay) unless the speaker is off. Arvy can open screens for you;
// the chat stays open over them. The conversation is kept between visits and on every device (chat.ts), and starts
// with what was in the old Coach chat; "Start over" clears it.
// Changes Arvy makes show under its reply: small ones are already done (Undo), bigger ones wait for Confirm.
// Arvy is the coach too: screens open it with openArvy() (Train's "Ask Arvy"), and on the Train screens it offers
// coaching questions. A thumbs-down under a reply, an Undo, or an error goes in Arvy's improvements log (log.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Mic, Send, Sparkles, ThumbsDown, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { getPass } from '../../lib/auth';
import { NO_CONNECTION, arvyIsOpen, ask, canListen, canUndo, cancelChange, COACH_ASKS, confirmChange, isWaiting, listen, onArvyChange, onOpenArvy, primeVoice, setArvyHearing, setArvyOpen, speak, stopSpeaking, undoChange, TOOL_LABEL, type ChangeState, type ChangeView, type ChatLine } from './arvy';
import { logArvy } from './log';
import { flushChat, loadChat, newer, saveChat } from './chat';
import './arvy.css';

const MUTE = 'arvy.mute';
const keyFor = (u: string) => `arvy.chat.${u}`;
const load = (k: string): ChatLine[] => { try { return JSON.parse(sessionStorage.getItem(k) || '[]'); } catch { return []; } };
const save = (k: string, m: ChatLine[]) => { try { sessionStorage.setItem(k, JSON.stringify(m.slice(-40))); } catch { /* private mode */ } };
const SUGGEST = ['How’s my day looking?', 'What’s on this weekend?', 'How’s the budget this month?', 'Add milk and eggs to the list'];

/** A light touch of formatting: **bold** and "- " list lines. */
function Rich({ text }: { text: string }) {
  const parts = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const lines = text.split('\n');
  return <>{lines.map((l, i) => /^\s*[-•*]\s+/.test(l)
    ? <div key={i} className="arvy-li">{parts(l.replace(/^\s*[-•*]\s+/, ''))}</div>
    : l.trim() ? <p key={i}>{parts(l)}</p> : null)}</>;
}

/** A page's site, for its link under a reply: "nhs.uk". */
const siteOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

const NOTE: Partial<Record<ChangeState, string>> = { cancelled: 'Cancelled', undone: 'Undone', failed: 'Didn’t work', expired: 'Not confirmed' };

/** One change under a reply: what it does, and Undo or Confirm/Cancel. */
function ChangeCard({ c, onAct }: { c: ChangeView; onAct: (id: string, what: 'confirm' | 'cancel' | 'undo') => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const state: ChangeState = c.state === 'waiting' && !isWaiting(c.id) ? 'expired' : c.state;
  const act = (what: 'confirm' | 'cancel' | 'undo') => { setWorking(true); onAct(c.id, what).finally(() => setWorking(false)); };
  return (
    <div className={`arvy-change ${state}`}>
      <div className="arvy-change-lines">
        {state === 'done' && <Check className="arvy-change-tick" aria-label="Done" />}
        <div>{c.lines.map((l, i) => <div key={i}>{l}</div>)}{c.error && <div className="arvy-error">{c.error}</div>}</div>
      </div>
      {state === 'waiting' && (
        <div className="arvy-change-btns">
          <button type="button" className="arvy-confirm" disabled={working} onClick={() => act('confirm')}>{working ? 'Saving…' : 'Confirm'}</button>
          <button type="button" className="arvy-cancel" disabled={working} onClick={() => act('cancel')}>Cancel</button>
        </div>)}
      {state === 'done' && canUndo(c.id) && (
        <button type="button" className="arvy-undo" disabled={working} onClick={() => act('undo')}><Undo2 aria-hidden />Undo</button>)}
      {NOTE[state] && <div className="arvy-change-note">{NOTE[state]}</div>}
    </div>
  );
}

export function Arvy() {
  const pass = getPass();
  const user = pass?.user.username || 'me';
  const first = (pass?.user.display_name || user).split(/\s+/)[0];
  const nav = useNavigate();
  const loc = useLocation();
  const open = useSyncExternalStore(onArvyChange, arvyIsOpen);   // the bar's RV button opens and closes it
  const [lines, setLines] = useState<ChatLine[]>(() => load(keyFor(user)));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTE) === '1'; } catch { return false; } });
  const [offer, setOffer] = useState<string[] | null>(null);   // chips asked for by the screen that opened the chat
  const [pending, setPending] = useState<string | null>(null);  // a question to send as soon as the chat is open
  const [wantMic, setWantMic] = useState(false);                // asked to start listening as soon as the chat is open
  const rec = useRef<ReturnType<typeof listen> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // the box you type in grows with what's in it and shrinks back once it's sent. How tall it may get is in arvy.css
  // (about a third of the screen: less with the keyboard up, so the chat stays in view); past that it scrolls
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 3}px`;   // + the border
  }, [text, open, hearing]);

  // the saved chat (other visits, other devices); the first time, the Coach chat comes over and this visit's lines follow it
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let on = true;
    loadChat().then(r => { if (on) setLines(cur => (r.carried ? [...r.lines, ...cur] : newer(cur, r.lines))); })
      .catch(() => undefined).finally(() => { if (on) setReady(true); });
    return () => { on = false; };
  }, [user]);
  useEffect(() => { save(keyFor(user), lines); if (ready) saveChat(lines); }, [lines, user, ready]);
  useEffect(() => () => { void flushChat(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines, busy, step, open]);
  useEffect(() => () => { rec.current?.cancel(); stopSpeaking(); setArvyOpen(false); setArvyHearing(false); }, []);
  useEffect(() => { setArvyHearing(hearing !== null); }, [hearing]);   // the RV button shows a mic while it listens
  // closed (its X, or the RV button again): stop listening and talking, and save the chat
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) { rec.current?.cancel(); stopSpeaking(); setOffer(null); void flushChat(); }
    wasOpen.current = open;
  }, [open]);

  const send = useCallback(async (q: string, spoken: boolean) => {
    const question = q.trim();
    if (!question || busy) return;
    setError(null); setText(''); setBusy(true); setStep(null);
    const before = lines;
    const asked: ChatLine = { role: 'user', text: question, at: new Date().toISOString() };
    setLines([...before, asked]);
    try {
      const t = await ask(before, question, loc.pathname, spoken, tools => setStep(tools.map(n => TOOL_LABEL[n] || n).join(', ')));
      setLines(cur => [...cur, { role: 'assistant', text: t.reply, at: new Date().toISOString(), used: t.used, ...(t.changes.length ? { changes: t.changes } : {}), ...(t.sources?.length ? { sources: t.sources } : {}), ...(t.choices?.length ? { choices: t.choices } : {}) }]);
      if (t.navigate && t.navigate !== loc.pathname) nav(t.navigate);
      if (spoken && !muted) speak(t.reply).catch(e => setError(`Couldn’t speak: ${e instanceof Error ? e.message : e}`));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setError(msg);
      if (msg !== NO_CONNECTION) void logArvy({ type: 'error', title: `Arvy couldn’t answer: ${msg}`.slice(0, 160), question, path: loc.pathname });
    } finally { setBusy(false); setStep(null); }
  }, [busy, lines, loc.pathname, muted, nav]);

  // a screen's own button opened the chat (Train's "Ask Arvy"): offer its questions, or send one straight away
  // (the RV button held down opens it listening: `mic`)
  useEffect(() => onOpenArvy(o => { primeVoice(); setArvyOpen(true); if (o.mic) { setWantMic(true); return; } setOffer(o.suggest?.length ? o.suggest : null); if (o.ask) setPending(o.ask); }), []);
  useEffect(() => { if (pending && open && !busy) { const q = pending; setPending(null); void send(q, false); } }, [pending, open, busy, send]);

  const startMic = () => {
    primeVoice(); stopSpeaking(); setError(null); setHearing('');
    const r = listen(t => setHearing(t));
    rec.current = r;
    r.done.then(said => { setHearing(null); rec.current = null; if (said) void send(said, true); })
      .catch(e => { setHearing(null); rec.current = null; setError(e instanceof Error ? e.message : String(e)); });
  };
  const mic = () => { if (hearing !== null) rec.current?.stop(); else startMic(); };
  // asked to listen (RV held): start now, unless it's already listening, mid-answer, or this browser can't. Never later:
  // a mic that turns itself on after the answer would be a surprise
  useEffect(() => {
    if (!wantMic || !open) return;
    setWantMic(false);
    if (!busy && hearing === null && canListen()) startMic();
  });
  const toggleMute = () => {
    const m = !muted; setMuted(m);
    try { localStorage.setItem(MUTE, m ? '1' : '0'); } catch { /* private mode */ }
    if (m) stopSpeaking(); else primeVoice();
  };
  const clear = () => { stopSpeaking(); setLines([]); setError(null); };
  const setState = (id: string, state: ChangeState, err?: string) => setLines(cur => cur.map(l => (l.changes?.some(c => c.id === id)
    ? { ...l, changes: l.changes.map(c => (c.id === id ? { ...c, state, ...(err ? { error: err } : { error: undefined }) } : c)) } : l)));
  const onAct = async (id: string, what: 'confirm' | 'cancel' | 'undo') => {
    try {
      if (what === 'cancel') { cancelChange(id); setState(id, 'cancelled'); }
      else if (what === 'confirm') { const go = await confirmChange(id); setState(id, 'done'); if (go) nav(go.to, { state: go.state }); }
      else {
        const at = lines.findIndex(l => l.changes?.some(c => c.id === id));
        const question = at > 0 ? [...lines.slice(0, at)].reverse().find(l => l.role === 'user')?.text : undefined;
        await undoChange(id, { lines: lines[at]?.changes?.find(c => c.id === id)?.lines, question });
        setState(id, 'undone');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (what === 'undo') setError(`Couldn’t undo: ${msg}`); else setState(id, 'failed', msg);
    }
  };

  /** Thumbs down under a reply: the question, the reply and the tools used go in the improvements log. */
  const thumbsDown = (i: number) => {
    const l = lines[i]; if (!l || l.down) return;
    const question = [...lines.slice(0, i)].reverse().find(x => x.role === 'user')?.text;
    void logArvy({ type: 'feedback', title: `Not helpful: ${question || l.text}`.slice(0, 160), question, reply: l.text, tools: l.used, path: loc.pathname });
    setLines(cur => cur.map((x, j) => (j === i ? { ...x, down: true } : x)));
  };
  const training = loc.pathname.startsWith('/workout');
  const chips = offer || (training ? COACH_ASKS : SUGGEST);

  if (!pass) return null;
  return (
    <>
      {open && (
        <div className="arvy-sheet" role="dialog" aria-label="Arvy">
          <header className="arvy-head">
            <div className="arvy-avatar" aria-hidden><Sparkles /></div>
            <div className="arvy-title"><b>Arvy</b><span>{busy ? (step ? `Checking ${step}…` : 'Thinking…') : 'Your assistant and coach'}</span></div>
            <button type="button" className="arvy-icon" onClick={toggleMute} aria-label={muted ? 'Turn Arvy’s voice on' : 'Turn Arvy’s voice off'} title={muted ? 'Voice off' : 'Voice on'}>
              {muted ? <VolumeX /> : <Volume2 />}
            </button>
            <button type="button" className="arvy-icon" onClick={() => setArvyOpen(false)} aria-label="Close"><X /></button>
          </header>
          <div className="arvy-body">
            {!lines.length && (
              <div className="arvy-hello">
                <p><b>Hi {first}! I’m Arvy.</b> {training
                  ? 'I’m your coach too: I see every set and note, your sleep, food, habits and days. Ask for a session, a change, a fix for a stuck lift, or how today went.'
                  : <>Ask me anything about your planner: your day, the calendar, food, training, habits, money{pass.user.settings?.profile === 'morning' ? ', your cycle' : ''} or the shopping list. I can add things too, like to-dos, meals, shopping and events, and I’m your coach for training.</>} {canListen() ? 'Tap the mic to just talk, or hold RV from any screen.' : ''}</p>
                <div className="arvy-chips">{chips.map(s => <button key={s} type="button" onClick={() => send(s, false)}>{s}</button>)}</div>
              </div>)}
            {lines[0]?.old && <div className="arvy-carried">Carried over from your Coach chat</div>}
            {lines.map((l, i) => (
              <div key={i} className={`arvy-msg ${l.role}`}>
                {l.role === 'assistant' ? <Rich text={l.text} /> : l.text}
                {l.changes?.map(c => <ChangeCard key={c.id} c={c} onAct={onAct} />)}
                {!!l.sources?.length && (
                  <div className="arvy-sources"><span>From the web</span>
                    {l.sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title}>{siteOf(s.url)}</a>)}
                  </div>)}
                {/* buttons to pick from, until they've answered */}
                {!!l.choices?.length && i === lines.length - 1 && !busy && (
                  <div className="arvy-chips arvy-choices">{l.choices.map(c => <button key={c.label} type="button" onClick={() => send(c.send || c.label, false)}>{c.label}</button>)}</div>)}
                {l.role === 'assistant' && !l.old && (l.down
                  ? <div className="arvy-down-note">Thanks, noted in my log.</div>
                  : <button type="button" className="arvy-down" onClick={() => thumbsDown(i)} aria-label="This wasn’t helpful" title="Not helpful"><ThumbsDown aria-hidden /></button>)}
              </div>))}
            {lines.length > 0 && offer && !busy && <div className="arvy-chips">{offer.slice(0, 2).map(s => <button key={s} type="button" onClick={() => send(s, false)}>{s}</button>)}</div>}
            {busy && <div className="arvy-msg assistant arvy-typing" aria-label="Arvy is thinking"><i /><i /><i /></div>}
            {error && <div className="arvy-error" role="alert">{error}</div>}
            {lines.length > 0 && !busy && <button type="button" className="arvy-clear" onClick={clear}>Start over</button>}
            <div ref={endRef} />
          </div>
          <form className="arvy-input" onSubmit={e => { e.preventDefault(); void send(text, false); }}>
            {hearing !== null
              ? <div className="arvy-hearing" aria-live="polite">{hearing || 'Listening…'}</div>
              : <textarea ref={boxRef} rows={1} value={text} onChange={e => setText(e.target.value)} placeholder="Ask Arvy…" aria-label="Ask Arvy" disabled={busy} enterKeyHint="send"
                  // Enter (the keyboard's Send) sends; Shift+Enter starts a new line
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim()) void send(text, false); } }} />}
            {canListen() && (
              <button type="button" className={`arvy-mic${hearing !== null ? ' on' : ''}`} onClick={mic} disabled={busy} aria-label={hearing !== null ? 'Stop listening' : 'Talk to Arvy'}><Mic /></button>)}
            {hearing === null && <button type="submit" className="arvy-send" disabled={busy || !text.trim()} aria-label="Send"><Send /></button>}
          </form>
        </div>)}
    </>
  );
}
