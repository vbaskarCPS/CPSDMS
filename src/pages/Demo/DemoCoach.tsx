// src/pages/Demo/DemoCoach.tsx — the /demo tour's coach, built for a phone: for each step the
// control to use flashes, a short explanation pops up, and "Got it" clears it away so the visitor
// can do it themselves on the real screen. A small pill stays in the corner (tap it to read the step
// again). When the data shows the step is done, the next step's explanation pops up. Mounted
// app-wide; shows only while a demo is on.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, HelpCircle, Loader, X } from 'lucide-react';
import { OFF_TRACK, STEPS, actIndex, demoExpired, fill, readDemo, withExits, writeDemo, type DemoState, type LegendRow, type Target } from '../../lib/demoTour';
import { becomeManager, becomeWorker } from './demoRoles';

const ACTS = ['Route Manager', 'Worker', 'Route Manager again'];
const PAGES: Record<'manager' | 'worker', string> = { manager: '/rm-logbook', worker: '/map-logsheet' };
const onTourPage = (role: 'manager' | 'worker', path: string) =>
  role === 'manager' ? path.startsWith('/rm-logbook') : (path.startsWith('/map-logsheet') || path.startsWith('/logsheet') || path.startsWith('/job-detail'));

// ── finding the control to flash ─────────────────────────────────────────────
const CLICKABLE = 'button, [role="button"], [role="switch"], a, label, select, [aria-label], [title]';
const inCoach = (el: Element) => !!el.closest('[data-demo-coach]');
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  // off to the side of the screen is gone; above or below can be scrolled to
  if (r.right < 0 || r.left > window.innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
};
/** In something laid over the screen (a sheet, a pop-up, a modal). */
const inOverlay = (el: Element) => {
  for (let e: Element | null = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed' && e.getBoundingClientRect().height > 80) return true;
  }
  return false;
};
const textOf = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim();
const onScreen = (t: string) => document.body.innerText.toLowerCase().includes(t.toLowerCase());

/** A form field by its label: the label's own input / drop-down / text box, or the row of choice buttons after it. */
export function findField(label: string): { control: Element; kind: 'value' | 'choice' } | null {
  const want = label.toLowerCase();
  const labels = Array.from(document.querySelectorAll('label')).filter(l => !inCoach(l)
    && ((l as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^\W+/, '').startsWith(want));
  for (const l of labels) {
    const box = l.parentElement;
    if (!box) continue;
    const ctl = box.querySelector('input:not([type=hidden]), select, textarea');
    if (ctl && visible(ctl)) return { control: ctl, kind: 'value' };
    const next = l.nextElementSibling;
    if (next && next.querySelector('button') && visible(next)) return { control: next, kind: 'choice' };
  }
  return null;
}
const hasValue = (el: Element) => String((el as HTMLInputElement).value ?? '').trim() !== '';
// while someone is typing in a field, it isn't finished: wait until they leave it or pause
const lastTyped = new WeakMap<Element, number>();
if (typeof document !== 'undefined') document.addEventListener('input', e => { if (e.target instanceof Element) lastTyped.set(e.target, Date.now()); }, true);
const filledIn = (el: Element) => hasValue(el) && (document.activeElement !== el || Date.now() - (lastTyped.get(el) || 0) > 1800);

export function findTarget(targets: Target[] | undefined, tapped?: Set<string>): { el: Element; t: Target } | null {
  for (const t of targets || []) {
    if (t.when && !onScreen(t.when)) continue;
    // a form field: flash it until it's filled in (or, for a row of choices, tapped), then move on
    if (t.field) {
      const f = findField(t.field);
      if (!f) continue;
      if (f.kind === 'value' ? filledIn(f.control) : tapped?.has(t.field)) continue;
      return { el: f.control, t };
    }
    let found: Element | null = null;
    const ok = (e: Element) => !inCoach(e) && visible(e) && (!t.overlay || inOverlay(e));
    if (t.sel) found = Array.from(document.querySelectorAll(t.sel)).find(e => ok(e) && !(t.input && filledIn(e))) || null;
    else if (t.text) {
      const want = t.text.toLowerCase();
      const all = Array.from(document.querySelectorAll(CLICKABLE)).filter(ok);
      const hits = all.filter(e => {
        const tx = textOf(e).toLowerCase();
        return t.exact ? tx === want || tx.split('\n')[0].trim() === want : tx.includes(want);
      });
      // the smallest match is the control itself, not a panel that contains it
      hits.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; });
      found = hits[0] || null;
    }
    if (found) return { el: found, t };
  }
  return null;
}

// ── the coach ────────────────────────────────────────────────────────────────
export const DemoCoach: React.FC = () => {
  const loc = useLocation();
  const nav = useNavigate();
  const [state, setState] = useState<DemoState | null>(() => readDemo());
  const [explain, setExplain] = useState(true);   // the explanation is open (vs. the visitor trying it)
  const [justDone, setJustDone] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number; hint: string; big: boolean } | null>(null);
  const checking = useRef(false);
  // rows of choice buttons the visitor has tapped during this step (they count as filled in)
  const tapped = useRef<Set<string>>(new Set());

  useEffect(() => {
    const sync = () => setState(readDemo());
    window.addEventListener('storage', sync);
    window.addEventListener('cpsdms:demo', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('cpsdms:demo', sync); };
  }, []);
  const save = useCallback((s: DemoState | null) => { writeDemo(s); setState(s); window.dispatchEvent(new Event('cpsdms:demo')); }, []);
  const step = state ? STEPS[state.step] : null;
  const last = !!state && state.step === STEPS.length - 1;

  // a new step opens with its explanation
  useEffect(() => { setExplain(true); setError(null); tapped.current = new Set(); }, [state?.step]);
  // a tap inside a row of choices fills that field in
  useEffect(() => {
    const onTap = (e: Event) => {
      const st = state && STEPS[state.step];
      for (const t of st?.targets || []) {
        if (!t.field) continue;
        const f = findField(t.field);
        if (f?.kind === 'choice' && e.target instanceof Node && f.control.contains(e.target)) tapped.current.add(t.field);
      }
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  }, [state?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow the thing to flash as the screen changes (menus opening, sheets sliding up)
  useLayoutEffect(() => {
    if (!step || !state) { setRing(null); return; }
    // the way back to the map is always in the list, ahead of the map itself
    const targets = withExits(step.targets).map(t => ({ ...t, hint: fill(t.hint, state.sandbox), when: t.when && fill(t.when, state.sandbox) }));
    let raf = 0; let lastEl: Element | null = null;
    const tick = () => {
      const f = findTarget(targets, tapped.current);
      if (!f) setRing(null);
      else {
        const r = f.el.getBoundingClientRect();
        const big = r.width * r.height > window.innerWidth * window.innerHeight * 0.4;   // the whole map
        setRing(prev => (prev && prev.x === r.left && prev.y === r.top && prev.w === r.width && prev.h === r.height && prev.hint === f.t.hint) ? prev
          : { x: r.left, y: r.top, w: r.width, h: r.height, hint: f.t.hint, big });
        if (f.el !== lastEl && !big) { lastEl = f.el; (f.el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'nearest' }); }
      }
      raf = window.setTimeout(tick, 350) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
  }, [step, loc.pathname, state?.sandbox.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // watch the data for the current step; when it's done, move on and explain the next one
  useEffect(() => {
    setOk(false);
    if (!state || !step) return;
    if (state.done.includes(state.step) || !step.check) { setOk(true); return; }
    let live = true;
    const tick = async () => {
      if (checking.current || !live) return;
      checking.current = true;
      try {
        if (await step.check!(state.sandbox)) {
          setOk(true);
          const s = { ...state, done: [...state.done, state.step] };
          if (!step.handoff && state.step < STEPS.length - 1) { setJustDone(true); save({ ...s, step: state.step + 1 }); }
          else { save(s); setExplain(true); setJustDone(true); }
        }
      } catch { /* a flaky read: next tick */ }
      finally { checking.current = false; }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => { live = false; clearInterval(t); };
  }, [state?.step, state?.sandbox.code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!justDone) return; const t = setTimeout(() => setJustDone(false), 4000); return () => clearTimeout(t); }, [justDone, state?.step]);

  if (!state || !step) return null;

  if (demoExpired(state)) {
    return <Card><b className="text-white">This demo has ended.</b><p className="text-sm text-gray-300 mt-1">Demos last three hours. Start a fresh one any time.</p>
      <Row><Primary onClick={() => { save(null); nav('/demo'); }}>Start again</Primary></Row></Card>;
  }
  if (!onTourPage(state.role, loc.pathname) && !loc.pathname.startsWith('/demo')) {
    return <Card><b className="text-white">Tour paused</b><p className="text-sm text-gray-300 mt-1">Step {state.step + 1} of {STEPS.length}: {step.title}</p>
      <Row>
        <Primary disabled={!!busy} onClick={async () => { setBusy('Opening…'); try { if (state.role === 'worker') await becomeWorker(state.sandbox); else await becomeManager(state.sandbox); nav(PAGES[state.role]); } catch (e) { setError(msg(e)); } finally { setBusy(null); } }}>{busy || 'Back to the tour'}</Primary>
        <Secondary onClick={() => save(null)}>End the tour</Secondary>
      </Row>{error && <Err>{error}</Err>}</Card>;
  }

  const go = async (to: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, to));
    setError(null); setJustDone(false);
    if (to > state.step && step.handoff) {
      setBusy(step.handoff === 'worker' ? 'Opening the worker’s phone…' : 'Back to the manager…');
      try {
        if (step.handoff === 'worker') await becomeWorker(state.sandbox); else await becomeManager(state.sandbox);
        save({ ...state, step: next, role: step.handoff });
        nav(PAGES[step.handoff]);
      } catch (e) { setError(msg(e)); } finally { setBusy(null); }
      return;
    }
    save({ ...state, step: next });
  };
  const doAction = async () => {
    if (!step.action) return;
    setBusy('Working…'); setError(null);
    try { await step.action.run(state.sandbox); setExplain(false); } catch (e) { setError(msg(e)); } finally { setBusy(null); }
  };

  // the explanation goes on the half of the screen the flashing control isn't on
  const ringMid = ring && !ring.big ? ring.y + ring.h / 2 : null;
  const cardAtTop = ringMid != null && ringMid > window.innerHeight / 2;
  const act = actIndex(state.step);
  const handoffNow = ok && step.handoff;

  return (
    <div data-demo-coach>
      <style>{FLASH_CSS}</style>
      {ring && <Flash ring={ring} />}

      {explain ? (
        <Card top={cardAtTop}>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-bold">
            <span className="text-emerald-300">{ACTS[act]}</span>
            <span className="text-gray-500">· step {state.step + 1} of {STEPS.length}</span>
            <button type="button" className="ml-auto text-gray-500 hover:text-white p-1 -m-1" aria-label="End the tour"
              onClick={() => { if (window.confirm('End the tour? Your demo stays open for three hours if you want to keep exploring.')) save(null); }}><X size={16} /></button>
          </div>
          {justDone && <div className="mt-1 text-emerald-300 text-sm font-bold flex items-center gap-1.5"><CheckCircle2 size={16} /> Nice — done.</div>}
          <div className="text-white font-bold text-lg leading-snug mt-1">{fill(step.title, state.sandbox)}</div>
          <p className="text-[15px] text-gray-100 mt-1.5 leading-snug">{fill(step.what, state.sandbox)}</p>
          <p className="text-[13px] text-gray-400 mt-1.5 leading-snug"><span className="text-gray-300 font-semibold">Why: </span>{fill(step.why, state.sandbox)}</p>
          {step.legend && <Legend rows={step.legend} />}
          {ring && !ring.big && ring.hint !== OFF_TRACK && <p className="text-[13px] text-amber-200 mt-1.5">The flashing button is where to start.</p>}
          {ring && ring.hint === OFF_TRACK && <p className="text-[13px] text-amber-200 mt-1.5">You’ve opened something off the tour: the flashing button takes you back.</p>}
          <Row>
            {handoffNow ? (
              <Primary disabled={!!busy} onClick={() => go(state.step + 1)}>{busy ? <><Loader size={14} className="animate-spin" /> {busy}</> : step.handoff === 'worker' ? 'Switch to the worker’s phone' : 'Back to the manager'}</Primary>
            ) : last ? (
              <><Primary onClick={() => { save(null); nav('/demo'); }}>Start a fresh demo</Primary><Secondary onClick={() => save(null)}>Keep exploring</Secondary></>
            ) : step.action && !ok ? (
              <Primary disabled={!!busy} onClick={doAction}>{busy ? <><Loader size={14} className="animate-spin" /> {busy}</> : step.action.label}</Primary>
            ) : !step.check ? (
              step.targets?.length
                ? <Primary onClick={() => setExplain(false)}>Got it, let me look</Primary>
                : <Primary disabled={!!busy} onClick={() => go(state.step + 1)}>Next</Primary>
            ) : (
              <Primary onClick={() => setExplain(false)}>Got it, let me try</Primary>
            )}
            {state.step > 0 && !busy && <Secondary onClick={() => go(state.step - 1)}>Back</Secondary>}
            {step.check && !ok && !busy && <Link onClick={() => go(state.step + 1)}>Skip</Link>}
          </Row>
          {error && <Err>{error}</Err>}
        </Card>
      ) : (
        <Pill
          label={ok && step.check ? 'Done' : (ring?.hint || fill(step.title, state.sandbox))}
          stepNo={state.step + 1}
          done={ok}
          onHelp={() => setExplain(true)}
          onNext={ok || !step.check ? () => (step.handoff ? setExplain(true) : go(state.step + 1)) : undefined}
        />
      )}
    </div>
  );
};

// ── pieces ───────────────────────────────────────────────────────────────────
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const Flash: React.FC<{ ring: { x: number; y: number; w: number; h: number; big: boolean; hint: string } }> = ({ ring }) => {
  if (ring.big) {
    // the whole map: a thick glowing edge and a label in the middle, no dimming
    return (
      <>
        <div aria-hidden className="demo-flash-edge" style={{ position: 'fixed', left: ring.x, top: ring.y, width: ring.w, height: ring.h, pointerEvents: 'none', zIndex: 999 }} />
        <div aria-hidden className="demo-bubble" style={{ position: 'fixed', left: ring.x + ring.w / 2, top: ring.y + ring.h * 0.42, transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 1000 }}>{ring.hint}</div>
      </>
    );
  }
  const pad = 8;
  const below = ring.y + ring.h / 2 < window.innerHeight / 2;
  // keep the whole label on screen: estimate its half-width from its length
  const half = Math.min(ring.hint.length * 4.2 + 22, window.innerWidth / 2 - 8);
  const cx = Math.min(Math.max(ring.x + ring.w / 2, half + 8), window.innerWidth - half - 8);
  return (
    <>
      {/* everything else dimmed, the control lit with a thick pulsing ring */}
      <div aria-hidden className="demo-spot" style={{ position: 'fixed', left: ring.x - pad, top: ring.y - pad, width: ring.w + pad * 2, height: ring.h + pad * 2, pointerEvents: 'none', zIndex: 999, borderRadius: 14 }} />
      <div aria-hidden className="demo-flash" style={{ position: 'fixed', left: ring.x - pad, top: ring.y - pad, width: ring.w + pad * 2, height: ring.h + pad * 2, pointerEvents: 'none', zIndex: 999, borderRadius: 14 }} />
      <div aria-hidden className={`demo-bubble ${below ? 'demo-bubble-down' : 'demo-bubble-up'}`}
        style={{ position: 'fixed', left: cx, top: below ? ring.y + ring.h + pad + 12 : ring.y - pad - 12, transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)', pointerEvents: 'none', zIndex: 1000 }}>
        {below ? '☝ ' : '👇 '}{ring.hint}
      </div>
    </>
  );
};
const FLASH_CSS = `
@keyframes demoFlash { 0%,100% { box-shadow: 0 0 0 5px #facc15, 0 0 18px 6px rgba(250,204,21,.9); } 50% { box-shadow: 0 0 0 5px #facc15, 0 0 0 22px rgba(250,204,21,0); } }
@keyframes demoEdge { 0%,100% { box-shadow: inset 0 0 0 7px rgba(250,204,21,1), inset 0 0 40px rgba(250,204,21,.45); } 50% { box-shadow: inset 0 0 0 7px rgba(250,204,21,.35), inset 0 0 10px rgba(250,204,21,.1); } }
@keyframes demoBob { 0%,100% { margin-top: 0; } 50% { margin-top: 6px; } }
.demo-spot { box-shadow: 0 0 0 9999px rgba(0,0,0,.6); }
.demo-flash { animation: demoFlash 0.9s ease-in-out infinite; }
.demo-flash-edge { animation: demoEdge 1.1s ease-in-out infinite; }
.demo-bubble { background: #facc15; color: #111; font: 700 14px/1.2 system-ui, sans-serif; padding: 8px 12px; border-radius: 999px; white-space: nowrap; max-width: 80vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 6px 18px rgba(0,0,0,.45); }
.demo-bubble-down, .demo-bubble-up { animation: demoBob 0.9s ease-in-out infinite; }
`;

const Card: React.FC<{ children: React.ReactNode; top?: boolean }> = ({ children, top }) => (
  <>
    <div data-testid="demo-coach" role="dialog" aria-label="Tour step"
      className="fixed left-2 right-2 sm:left-auto sm:right-4 sm:w-[420px] z-[1000] bg-gray-900 border border-emerald-600 rounded-2xl shadow-2xl p-4 text-left"
      style={{ fontFamily: 'system-ui, sans-serif', ...(top ? { top: 8 } : { bottom: 8 }) }}>
      {children}
    </div>
  </>
);
const Pill: React.FC<{ label: string; stepNo: number; done: boolean; onHelp: () => void; onNext?: () => void }> = ({ label, stepNo, done, onHelp, onNext }) => (
  <div data-testid="demo-pill" className="fixed z-[1000] left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-gray-900 border border-emerald-600 shadow-xl pl-1 pr-1 py-1 max-w-[calc(100vw-16px)]"
    style={{ top: 52, fontFamily: 'system-ui, sans-serif' }}>
    <button type="button" onClick={onHelp} aria-label="Show this step again" className="flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-full text-gray-100 min-w-0">
      <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-500 text-black' : 'bg-amber-400 text-black'}`}>{done ? '✓' : stepNo}</span>
      <span className="text-xs truncate max-w-[52vw]">{label}</span>
      <HelpCircle size={14} className="text-gray-400 flex-shrink-0" />
    </button>
    {onNext && <button type="button" onClick={onNext} aria-label="Next step" className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold">Next</button>}
  </div>
);
const Legend: React.FC<{ rows: LegendRow[] }> = ({ rows }) => (
  <ul className="mt-2 space-y-1.5" aria-label="What the marks mean">
    {rows.map((r, i) => (
      <li key={i} className="flex items-center gap-2.5 text-[13px] text-gray-100 leading-tight">
        <span className="w-7 flex-shrink-0 flex items-center justify-center" aria-hidden>
          {r.mark === 'line' && <span style={{ display: 'block', width: 26, height: 4, borderRadius: 2, background: r.fill }} />}
          {r.mark === 'worker' && <span style={{ width: 22, height: 22, borderRadius: 11, background: '#1f2937', border: '2px solid #fff', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>JR</span>}
          {r.mark === 'dot' && <span style={{ width: 16, height: 16, borderRadius: 8, boxSizing: 'border-box', background: r.fill, border: `${r.dashed ? 2 : 3}px ${r.dashed ? 'dashed' : 'solid'} ${r.rim || 'transparent'}` }} />}
          {r.mark === 'x' && <span style={{ color: '#000', background: '#e5e7eb', borderRadius: 4, width: 16, height: 16, fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</span>}
        </span>
        <span>{r.label}</span>
      </li>
    ))}
  </ul>
);
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>;
const Primary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = p => (
  <button type="button" {...p} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2" />
);
const Secondary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = p => (
  <button type="button" {...p} className="px-3 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-100 text-sm" />
);
const Link: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="ml-auto text-xs text-gray-400 underline px-1 py-2">{children}</button>
);
const Err: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="mt-2 text-xs text-red-300">{children}</div>;
