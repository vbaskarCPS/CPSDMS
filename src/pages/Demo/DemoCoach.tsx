// src/pages/Demo/DemoCoach.tsx — the card at the bottom of the screen during the /demo tour: one step
// at a time, with why it matters, Next once the step is really done (watched in the data), Skip,
// and the hand-offs between the manager and the worker. Mounted app-wide; shows only while a demo
// is on and the page is one of the two the tour uses.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Loader, X } from 'lucide-react';
import { STEPS, actIndex, demoExpired, readDemo, writeDemo, type DemoState } from '../../lib/demoTour';
import { becomeManager, becomeWorker } from './demoRoles';

const ACTS = ['Route Manager', 'Worker', 'Route Manager again'];
const PAGES: Record<'manager' | 'worker', string> = { manager: '/rm-logbook', worker: '/map-logsheet' };
const onTourPage = (role: 'manager' | 'worker', path: string) =>
  role === 'manager' ? path.startsWith('/rm-logbook') : (path.startsWith('/map-logsheet') || path.startsWith('/logsheet') || path.startsWith('/job-detail'));

export const DemoCoach: React.FC = () => {
  const loc = useLocation();
  const nav = useNavigate();
  const [state, setState] = useState<DemoState | null>(() => readDemo());
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const checking = useRef(false);

  // follow changes made elsewhere (the landing page starting a demo, another tab)
  useEffect(() => {
    const sync = () => setState(readDemo());
    window.addEventListener('storage', sync);
    window.addEventListener('cpsdms:demo', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('cpsdms:demo', sync); };
  }, []);

  const save = useCallback((s: DemoState | null) => { writeDemo(s); setState(s); window.dispatchEvent(new Event('cpsdms:demo')); }, []);

  const step = state ? STEPS[state.step] : null;

  // watch the data for the current step
  useEffect(() => {
    setOk(false); setError(null);
    if (!state || !step) return;
    if (state.done.includes(state.step)) { setOk(true); return; }
    if (!step.check) { setOk(true); return; }
    let live = true;
    const tick = async () => {
      if (checking.current || !live) return;
      checking.current = true;
      try { if (await step.check!(state.sandbox)) { setOk(true); save({ ...state, done: [...state.done, state.step] }); } }
      catch { /* a flaky read: try again next tick */ }
      finally { checking.current = false; }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
  }, [state?.step, state?.sandbox.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !step) return null;
  if (demoExpired(state)) {
    return (
      <Shell>
        <div className="text-sm text-white font-bold">This demo has ended</div>
        <div className="text-xs text-gray-300 mt-1">Demos last three hours. Start a fresh one any time.</div>
        <div className="mt-3 flex gap-2"><Primary onClick={() => { save(null); nav('/demo'); }}>Start again</Primary></div>
      </Shell>
    );
  }
  // The visitor wandered off the tour's pages (a logout, a link): offer the way back, nothing more.
  if (!onTourPage(state.role, loc.pathname) && !loc.pathname.startsWith('/demo')) {
    return (
      <Shell>
        <div className="text-sm text-white font-bold">Tour paused</div>
        <div className="text-xs text-gray-300 mt-1">Step {state.step + 1} of {STEPS.length}: {step.title}</div>
        <div className="mt-3 flex gap-2">
          <Primary onClick={async () => { setBusy('Opening…'); try { if (state.role === 'worker') await becomeWorker(state.sandbox); else await becomeManager(state.sandbox); nav(PAGES[state.role]); } catch (e) { setError(msg(e)); } finally { setBusy(null); } }}>Back to the tour</Primary>
          <Secondary onClick={() => save(null)}>End the tour</Secondary>
        </div>
      </Shell>
    );
  }

  const go = async (to: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, to));
    const cur = STEPS[state.step];
    setError(null);
    if (to > state.step && cur.handoff) {
      setBusy(cur.handoff === 'worker' ? 'Switching to the worker’s phone…' : 'Back to the manager’s desk…');
      try {
        if (cur.handoff === 'worker') await becomeWorker(state.sandbox); else await becomeManager(state.sandbox);
        save({ ...state, step: next, role: cur.handoff });
        nav(PAGES[cur.handoff]);
      } catch (e) { setError(msg(e)); }
      finally { setBusy(null); }
      return;
    }
    save({ ...state, step: next });
  };

  const act = actIndex(state.step);
  const inAct = STEPS.filter(s => s.act === step.act);
  const posInAct = inAct.indexOf(step) + 1;
  const last = state.step === STEPS.length - 1;

  return (
    <Shell>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-400">
            {ACTS.map((a, i) => <span key={a} className={`${i === act ? 'text-emerald-300 font-bold' : i < act ? 'text-gray-500 line-through' : ''}`}>{a}</span>)}
            <span className="ml-auto text-gray-500 normal-case tracking-normal">{posInAct}/{inAct.length}</span>
          </div>
          {!folded && <>
            <div className="text-white font-bold text-base mt-1">{step.title}</div>
            <div className="text-sm text-gray-100 mt-1">{step.what}</div>
            {step.where && <div className="text-xs text-sky-200 mt-1">Where: {step.where}</div>}
            <div className="text-xs text-gray-400 mt-1 italic">Why: {step.why}</div>
          </>}
          {folded && <div className="text-white font-bold text-sm mt-0.5 truncate">{step.title}</div>}
        </div>
        <button type="button" onClick={() => setFolded(f => !f)} className="text-gray-400 hover:text-white p-1" aria-label={folded ? 'Expand' : 'Collapse'}>{folded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
        <button type="button" onClick={() => { if (window.confirm('End the tour? The demo stays open for three hours if you want to keep exploring.')) save(null); }} className="text-gray-400 hover:text-white p-1" aria-label="End the tour"><X size={18} /></button>
      </div>
      {!folded && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {step.action && !ok && (
            <Primary disabled={!!busy} onClick={async () => { setBusy('Working…'); setError(null); try { await step.action!.run(state.sandbox); } catch (e) { setError(msg(e)); } finally { setBusy(null); } }}>{step.action.label}</Primary>
          )}
          {state.step > 0 && <Secondary disabled={!!busy} onClick={() => go(state.step - 1)}>Back</Secondary>}
          {!last && (
            <Primary disabled={!!busy || (!ok && !!step.check)} onClick={() => go(state.step + 1)}>
              {busy ? <><Loader size={14} className="animate-spin" /> {busy}</> : step.handoff === 'worker' ? 'Next: see what the worker sees' : step.handoff === 'manager' ? 'Next: back to the manager' : 'Next'}
            </Primary>
          )}
          {!last && step.check && !ok && <Secondary disabled={!!busy} onClick={() => go(state.step + 1)}>Skip</Secondary>}
          {last && <Primary onClick={() => { save(null); nav('/demo'); }}>Start a fresh demo</Primary>}
          {last && <Secondary onClick={() => save(null)}>Keep exploring</Secondary>}
          {step.check && !ok && !busy && <span className="text-[11px] text-amber-300 flex items-center gap-1"><Loader size={12} className="animate-spin" /> waiting for you to do it…</span>}
          {step.check && ok && <span className="text-[11px] text-emerald-300">Done ✓</span>}
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
    </Shell>
  );
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div data-testid="demo-coach" className="fixed left-2 right-2 bottom-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[420px] z-[1000] bg-gray-900/95 border border-emerald-700 rounded-2xl shadow-2xl p-4 text-left" style={{ fontFamily: 'system-ui, sans-serif' }}>
    {children}
  </div>
);
const Primary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = p => (
  <button type="button" {...p} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2" />
);
const Secondary: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = p => (
  <button type="button" {...p} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-100 text-sm" />
);
