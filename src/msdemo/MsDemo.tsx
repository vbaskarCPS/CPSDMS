// src/msdemo/MsDemo.tsx — propertystars.app/mainstreetaidemo: the MainstreetAI rep app and host app, the real
// screens, on sample data. A start screen picks the role; a small Demo pill on top switches roles, opens the
// tour or leaves. The address bar stays on /mainstreetaidemo (the app runs in its own memory router).
import React, { useEffect, useMemo, useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftRight, ChevronLeft, ChevronRight, LogOut, Map as MapIcon, RotateCcw, Sparkles, Video, X } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { DemoAuthProvider, type AuthState, type Profile } from '../v2/lib/auth';
import type { Permission } from '../v2/lib/permissions';
import { RepApp } from '../v2/features/rep/RepApp';
import { HostApp } from '../v2/features/meetings/HostApp';
import { MsLogo } from '../v2/ui/MsLogo';
import { HOST, REP } from './store';
import '../v2/ui/theme.css';
import './msdemo.css';

type Role = 'rep' | 'host';

function authFor(role: Role, exit: () => void): AuthState {
  const who = role === 'rep' ? REP : { id: HOST.id, name: HOST.name, email: HOST.email, phone: null as string | null };
  const profile: Profile = { id: who.id, username: role === 'rep' ? 'alexm' : 'sarahc', full_name: who.name, phone: who.phone, email: who.email,
    is_super_admin: false, rm_center_id: null, is_active: true, must_change_password: false };
  const perms = new Set<Permission>(role === 'rep' ? ['mainstreet_rep' as Permission] : []);
  const session = { access_token: 'demo', refresh_token: 'demo', expires_in: 3600, token_type: 'bearer', user: { id: who.id, email: who.email } } as unknown as Session;
  return {
    loading: false, session, profile, permissions: perms, centers: [], center: null, setCenterId: () => undefined,
    can: p => perms.has(p), signIn: async () => undefined, signOut: async () => exit(), changePassword: async () => undefined, reload: async () => undefined,
  };
}

// ───────────── the tour ─────────────
interface Step { to: string; title: string; text: string }
const TOUR: Record<Role, Step[]> = {
  rep: [
    { to: '/app/rep', title: 'The map', text: 'Your zones and the businesses reps have added in them, coloured by stage: white new, blue pitched, light green booked, green won (red lost), amber while a follow-up is open. Tap any pin to open it.' },
    { to: '/app/rep', title: 'Add a business at the door', text: 'Walking past one that isn’t on the map? Tap Add: drop the pin where you are, give it a name and type, and it’s yours to visit. In the demo you’re standing at one of Oakville’s plazas.' },
    { to: '/app/rep/zones', title: 'Your zones', text: 'Each zone shows how many are left to visit, follow-ups due and deals. Open one to walk it as a list, plaza by plaza, street by street.' },
    { to: '/app/rep', title: 'A business', text: 'Open a pin to see its stage (New → Pitched → Booked → Won). What happened? is just three taps: No one to talk to, Talked (set the follow-up and who to ask for), or Not interested (marks it lost, with why). Add the people you met, photos and notes.' },
    { to: '/app/rep', title: 'Present and book', text: 'On a business, tap Present: everything is in the Taxifi deck: the pitch, the owner’s questions, a proposal next to what they pay today, and the onboarding call, booked into the host’s real open times on the last screen.' },
    { to: '/app/rep/followups', title: 'Follow-ups', text: 'Everyone you promised to come back to or call, overdue first, with who to ask for. Add one to your calendar or open it on the map.' },
    { to: '/app/rep/inbox', title: 'Inbox', text: 'Emails with your businesses, filed on each one. Write a follow-up yourself or have Claude draft it from the visit.' },
    { to: '/app/rep/me', title: 'Me', text: 'Today against your goals, your streak, earnings, the week’s board and your numbers. Then switch to the host (the orange Demo button, bottom left) to see the calls you booked.' },
  ],
  host: [
    { to: '/app/host', title: 'Onboarding calls', text: 'The host takes the calls reps book from the deck. “How did it go?” lists the calls that have started: mark them Closed, No-show or Not a fit.' },
    { to: '/app/host', title: 'Everything the rep learned', text: 'Each call has the owner’s details, who booked it, the rep’s notes and “Their answers”: the deck questions and the proposal they saw. Join from the Zoom button.' },
    { to: '/app/host', title: 'My hours', text: 'Open My hours: the Zoom link, time zone, weekly hours and days off. These hours are exactly the open times reps see when they tap Book onboarding.' },
  ],
};

const Pill: React.FC<{ role: Role; onSwitch: () => void; onTour: () => void; onExit: () => void; onReset: () => void }> = ({ role, onSwitch, onTour, onExit, onReset }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="msd-pill">
      <button type="button" className="tag" onClick={() => setOpen(o => !o)} aria-expanded={open}>Demo · {role === 'rep' ? 'Rep' : 'Host'}</button>
      {open && <div className="menu" role="menu" onClick={() => setOpen(false)}>
        <button type="button" role="menuitem" onClick={onSwitch}><ArrowLeftRight size={15} />Switch to {role === 'rep' ? 'Host' : 'Rep'}</button>
        <button type="button" role="menuitem" onClick={onTour}><Sparkles size={15} />Show the tour</button>
        <button type="button" role="menuitem" onClick={onReset}><RotateCcw size={15} />Start over</button>
        <button type="button" role="menuitem" onClick={onExit}><LogOut size={15} />Leave the demo</button>
      </div>}
    </div>
  );
};

const Tour: React.FC<{ role: Role; onClose: () => void }> = ({ role, onClose }) => {
  const steps = TOUR[role];
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { if (!loc.pathname.startsWith(steps[i].to) || (steps[i].to === '/app/rep' && loc.pathname !== '/app/rep')) nav(steps[i].to); }, [i]);   // eslint-disable-line react-hooks/exhaustive-deps
  const s = steps[i];
  return (
    <div className="msd-tour" role="dialog" aria-label="Demo tour">
      <div className="h"><b>{s.title}</b><span>{i + 1} of {steps.length}</span><button type="button" aria-label="Close the tour" onClick={onClose}><X size={16} /></button></div>
      <p>{s.text}</p>
      <div className="f">
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={16} />Back</button>
        {i < steps.length - 1 ? <button type="button" className="on" onClick={() => setI(i + 1)}>Next<ChevronRight size={16} /></button>
          : <button type="button" className="on" onClick={onClose}>Try it</button>}
      </div>
    </div>
  );
};

const HostFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="v2"><div className="msd-hostbar"><MsLogo size={18} tone="dark" /><span className="who">{HOST.name}</span></div>{children}</div>
);

const Demo: React.FC<{ role: Role; onRole: (r: Role) => void; onExit: () => void; onReset: () => void }> = ({ role, onRole, onExit, onReset }) => {
  const seen = (r: Role) => { try { return sessionStorage.getItem(`msd-tour-${r}`) === '1'; } catch { return false; } };
  const [tour, setTour] = useState(() => !seen(role));
  const close = () => { setTour(false); try { sessionStorage.setItem(`msd-tour-${role}`, '1'); } catch { /* private mode */ } };
  const auth = useMemo(() => authFor(role, onExit), [role, onExit]);
  return (
    <DemoAuthProvider value={auth}>
      <MemoryRouter initialEntries={[role === 'rep' ? '/app/rep' : '/app/host']}>
        <Routes>
          <Route path="/app/rep/*" element={<RepApp />} />
          <Route path="/app/host" element={<HostFrame><HostApp /></HostFrame>} />
          <Route path="/app/login" element={<Exit onExit={onExit} />} />
          <Route path="*" element={<Navigate to={role === 'rep' ? '/app/rep' : '/app/host'} replace />} />
        </Routes>
        <Pill role={role} onSwitch={() => onRole(role === 'rep' ? 'host' : 'rep')} onTour={() => setTour(true)} onExit={onExit} onReset={onReset} />
        {tour && <Tour role={role} onClose={close} />}
      </MemoryRouter>
    </DemoAuthProvider>
  );
};
const Exit: React.FC<{ onExit: () => void }> = ({ onExit }) => { useEffect(() => { onExit(); }, [onExit]); return null; };

const Start: React.FC<{ onPick: (r: Role) => void }> = ({ onPick }) => (
  <div className="msd-start">
    <div className="card">
      <MsLogo size={26} />
      <h1>See MainstreetAI at work</h1>
      <p>The real apps on sample data: the businesses are real Oakville listings, the visits, deals and calls are made up. Tap anything. Nothing is saved and no emails or texts are sent.</p>
      <button type="button" className="role" onClick={() => onPick('rep')}>
        <MapIcon size={26} /><span><b>Try it as a Rep</b><em>Walk the zones, log visits, present the Taxifi deck and book an onboarding call</em></span><ChevronRight size={20} />
      </button>
      <button type="button" className="role" onClick={() => onPick('host')}>
        <Video size={26} /><span><b>Try it as a Host</b><em>Take the onboarding calls reps book, see what the owner answered, set your hours</em></span><ChevronRight size={20} />
      </button>
      <p className="small">Book a call as the Rep, then switch to the Host from the orange Demo button (bottom left): it’s waiting there.</p>
    </div>
  </div>
);

export default function MsDemoRoot() {
  const [role, setRole] = useState<Role | null>(() => { try { return (sessionStorage.getItem('msd-role') as Role | null) || null; } catch { return null; } });
  const [run, setRun] = useState(0);
  useEffect(() => { document.title = 'MainstreetAI demo'; }, []);
  const pick = (r: Role | null) => { setRole(r); try { if (r) sessionStorage.setItem('msd-role', r); else sessionStorage.removeItem('msd-role'); } catch { /* private mode */ } };
  const exit = React.useCallback(() => pick(null), []);
  // "Start over": the pretend server lives in memory, so a reload is a fresh start
  const reset = () => { try { sessionStorage.removeItem('msd-tour-rep'); sessionStorage.removeItem('msd-tour-host'); } catch { /* ignore */ } window.location.reload(); };
  if (!role) return <div className="v2"><Start onPick={pick} /></div>;
  return <Demo key={`${role}-${run}`} role={role} onRole={r => { pick(r); setRun(n => n + 1); }} onExit={exit} onReset={reset} />;
}
