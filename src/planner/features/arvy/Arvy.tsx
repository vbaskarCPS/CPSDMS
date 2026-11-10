// src/planner/features/arvy/Arvy.tsx — Arvy's floating button (every signed-in screen, above the tabs) and chat panel.
// Tap the button to open the chat; type, or tap the mic and talk (it sends when you pause). Spoken questions get a
// spoken answer (a woman's voice for Rosh, a man's for Vijay) unless the speaker is off. Arvy can open screens for you;
// the chat stays open over them. The conversation is kept for this visit (closing the app starts fresh).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mic, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { getPass } from '../../lib/auth';
import { ask, canListen, listen, primeVoice, speak, stopSpeaking, TOOL_LABEL, type ChatLine } from './arvy';
import './arvy.css';

const MUTE = 'arvy.mute';
const keyFor = (u: string) => `arvy.chat.${u}`;
const load = (k: string): ChatLine[] => { try { return JSON.parse(sessionStorage.getItem(k) || '[]'); } catch { return []; } };
const save = (k: string, m: ChatLine[]) => { try { sessionStorage.setItem(k, JSON.stringify(m.slice(-40))); } catch { /* private mode */ } };
const SUGGEST = ['How’s my day looking?', 'What’s on this weekend?', 'How’s the budget this month?', 'What’s on the shopping list?'];

/** A light touch of formatting: **bold** and "- " list lines. */
function Rich({ text }: { text: string }) {
  const parts = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const lines = text.split('\n');
  return <>{lines.map((l, i) => /^\s*[-•*]\s+/.test(l)
    ? <div key={i} className="arvy-li">{parts(l.replace(/^\s*[-•*]\s+/, ''))}</div>
    : l.trim() ? <p key={i}>{parts(l)}</p> : null)}</>;
}

export function Arvy() {
  const pass = getPass();
  const user = pass?.user.username || 'me';
  const first = (pass?.user.display_name || user).split(/\s+/)[0];
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>(() => load(keyFor(user)));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTE) === '1'; } catch { return false; } });
  const rec = useRef<ReturnType<typeof listen> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { save(keyFor(user), lines); }, [lines, user]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines, busy, step, open]);
  useEffect(() => () => { rec.current?.cancel(); stopSpeaking(); }, []);

  const send = useCallback(async (q: string, spoken: boolean) => {
    const question = q.trim();
    if (!question || busy) return;
    setError(null); setText(''); setBusy(true); setStep(null);
    const before = lines;
    const asked: ChatLine = { role: 'user', text: question, at: new Date().toISOString() };
    setLines([...before, asked]);
    try {
      const t = await ask(before, question, loc.pathname, spoken, tools => setStep(tools.map(n => TOOL_LABEL[n] || n).join(', ')));
      setLines(cur => [...cur, { role: 'assistant', text: t.reply, at: new Date().toISOString(), used: t.used }]);
      if (t.navigate && t.navigate !== loc.pathname) nav(t.navigate);
      if (spoken && !muted) speak(t.reply).catch(e => setError(`Couldn’t speak: ${e instanceof Error ? e.message : e}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally { setBusy(false); setStep(null); }
  }, [busy, lines, loc.pathname, muted, nav]);

  const mic = () => {
    if (hearing !== null) { rec.current?.stop(); return; }
    primeVoice(); stopSpeaking(); setError(null); setHearing('');
    const r = listen(t => setHearing(t));
    rec.current = r;
    r.done.then(said => { setHearing(null); rec.current = null; if (said) void send(said, true); })
      .catch(e => { setHearing(null); rec.current = null; setError(e instanceof Error ? e.message : String(e)); });
  };
  const toggleMute = () => {
    const m = !muted; setMuted(m);
    try { localStorage.setItem(MUTE, m ? '1' : '0'); } catch { /* private mode */ }
    if (m) stopSpeaking(); else primeVoice();
  };
  const clear = () => { stopSpeaking(); setLines([]); setError(null); };

  if (!pass) return null;
  return (
    <>
      {!open && (
        <button type="button" className="arvy-fab" aria-label="Ask Arvy" onClick={() => { primeVoice(); setOpen(true); }}>
          <Sparkles aria-hidden /><span>Arvy</span>
        </button>)}
      {open && (
        <div className="arvy-sheet" role="dialog" aria-label="Arvy">
          <header className="arvy-head">
            <div className="arvy-avatar" aria-hidden><Sparkles /></div>
            <div className="arvy-title"><b>Arvy</b><span>{busy ? (step ? `Checking ${step}…` : 'Thinking…') : 'Your planner assistant'}</span></div>
            <button type="button" className="arvy-icon" onClick={toggleMute} aria-label={muted ? 'Turn Arvy’s voice on' : 'Turn Arvy’s voice off'} title={muted ? 'Voice off' : 'Voice on'}>
              {muted ? <VolumeX /> : <Volume2 />}
            </button>
            <button type="button" className="arvy-icon" onClick={() => { rec.current?.cancel(); stopSpeaking(); setOpen(false); }} aria-label="Close"><X /></button>
          </header>
          <div className="arvy-body">
            {!lines.length && (
              <div className="arvy-hello">
                <p><b>Hi {first}! I’m Arvy.</b> Ask me anything about your planner: your day, the calendar, food, training, habits, money{pass.user.settings?.profile === 'morning' ? ', your cycle' : ''} or the shopping list. Tap the mic to just talk.</p>
                <div className="arvy-chips">{SUGGEST.map(s => <button key={s} type="button" onClick={() => send(s, false)}>{s}</button>)}</div>
              </div>)}
            {lines.map((l, i) => (
              <div key={i} className={`arvy-msg ${l.role}`}>{l.role === 'assistant' ? <Rich text={l.text} /> : l.text}</div>))}
            {busy && <div className="arvy-msg assistant arvy-typing" aria-label="Arvy is thinking"><i /><i /><i /></div>}
            {error && <div className="arvy-error" role="alert">{error}</div>}
            {lines.length > 0 && !busy && <button type="button" className="arvy-clear" onClick={clear}>Start over</button>}
            <div ref={endRef} />
          </div>
          <form className="arvy-input" onSubmit={e => { e.preventDefault(); void send(text, false); }}>
            {hearing !== null
              ? <div className="arvy-hearing" aria-live="polite">{hearing || 'Listening…'}</div>
              : <input value={text} onChange={e => setText(e.target.value)} placeholder="Ask Arvy…" aria-label="Ask Arvy" disabled={busy} enterKeyHint="send" />}
            {canListen() && (
              <button type="button" className={`arvy-mic${hearing !== null ? ' on' : ''}`} onClick={mic} disabled={busy} aria-label={hearing !== null ? 'Stop listening' : 'Talk to Arvy'}><Mic /></button>)}
            {hearing === null && <button type="submit" className="arvy-send" disabled={busy || !text.trim()} aria-label="Send"><Send /></button>}
          </form>
        </div>)}
    </>
  );
}
