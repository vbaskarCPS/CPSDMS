// src/v2/features/rep/WhatsNew.tsx — "What's new" in the rep app. The first time a rep opens the app after an update, a
// short card says what changed and how to use it, with a picture when one helps. Seen once per rep on each phone.
//
// EVERY change to the rep app adds an entry at the TOP of UPDATES (a new, unique id), in the same PR as the change.
import React, { useMemo, useState } from 'react';
import { DoorOpen, Search, Sparkles } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { STAGE_PIN } from '../../lib/rep';

interface Update {
  id: string;                 // unique and never reused, e.g. '2026-11-07-add-remotely'
  title: string;
  intro: string;
  steps: string[];            // how to use it, short
  picture?: React.ReactNode;  // a small drawing of the new thing
}

// newest first
const UPDATES: Update[] = [
  {
    id: '2026-11-12-phone-notifications',
    title: 'Notifications on your phone',
    intro: 'The app can now tell you on your phone when something needs you, even when it’s closed.',
    steps: [
      'Tap the gear, then Phone notifications, and tap Turn on.',
      'You’ll hear when a deal is approved or turned down, when you get a new zone, when a follow-up is due, and 30 minutes before a meeting.',
      'Switch any of them off, or set quiet hours, on the same screen.',
    ],
  },
  {
    id: '2026-11-10-back-on-main-server',
    title: 'The app is back',
    intro: 'The app was closed for a short time on Nov 10 while we moved it back to its main server.',
    steps: [
      'Everything saved before then is still here.',
      'If the app asks you to sign in, sign in the same way as before.',
      'If something you entered around 8:30–9:30 am that morning is missing, tell your manager.',
    ],
  },
  {
    id: '2026-11-07-other-reps-leads',
    title: 'Grey pins: another rep’s lead',
    intro: 'Businesses another rep is already working now show as grey pins on your map.',
    steps: [
      'Grey means it’s someone else’s lead: don’t visit it. Tap it to see whose it is.',
      'They’re left out of your list to walk and your “to visit” count.',
      'If the other rep marks it Lost, it opens back up for everyone.',
    ],
    picture: (
      <div className="v2-whatsnew-stages" aria-hidden="true">
        <span className="on" style={{ borderColor: '#9ca3af' }}><i style={{ background: STAGE_PIN.taken.color }} />{STAGE_PIN.taken.label} · don’t visit</span>
        <span><i style={{ background: STAGE_PIN.new.color }} />Yours to visit</span>
      </div>
    ),
  },
  {
    id: '2026-11-07-questionnaire-stage',
    title: 'New stage: Questionnaire',
    intro: 'Businesses now go New → Pitched → Questionnaire → Onboarding booked → Won.',
    steps: [
      'When you save the questionnaire from the deck, the business moves to Questionnaire and its pin turns purple.',
      'Pitched (blue) now means you presented, but the questionnaire isn’t filled in yet.',
      'Book the onboarding call from a Questionnaire business to move it on to Onboarding booked.',
    ],
    picture: (
      <div className="v2-whatsnew-stages" aria-hidden="true">
        {(['new', 'pitched', 'questionnaire', 'booked', 'won'] as const).map(k => (
          <span key={k} className={k === 'questionnaire' ? 'on' : ''}><i style={{ background: STAGE_PIN[k].color }} />{STAGE_PIN[k].label}</span>))}
      </div>
    ),
  },
  {
    id: '2026-11-07-add-remotely',
    title: 'Add a business remotely',
    intro: 'The Add screen now has two clear choices at the top.',
    steps: [
      '“I’m at the door”: the pin starts where you’re standing, the same as before.',
      '“Add remotely”: for a lead from a call or a referral. Type the business name and its address (street and city), tap Find, and pick the right one.',
      'If your location is off, the Add screen switches to Add remotely by itself.',
    ],
    picture: (
      <div className="v2-add-mode" aria-hidden="true" style={{ pointerEvents: 'none' }}>
        <button type="button" tabIndex={-1}><DoorOpen size={18} /><span><b>I’m at the door</b><small>Pinned where you’re standing</small></span></button>
        <button type="button" tabIndex={-1} className="on"><Search size={18} /><span><b>Add remotely</b><small>From a call or referral: type the address</small></span></button>
      </div>
    ),
  },
];

const key = (user: string) => `ms-rep-seen-update:${user}`;
function readSeen(user: string): string | null { try { return localStorage.getItem(key(user)); } catch { return null; } }
function writeSeen(user: string, id: string) { try { localStorage.setItem(key(user), id); } catch { /* private window: it shows again next time */ } }

/** The updates this rep hasn't seen on this phone: everything above the last one they saw (at most 3). */
function unseen(user: string): Update[] {
  const last = readSeen(user);
  const i = last ? UPDATES.findIndex(u => u.id === last) : -1;
  return (i === -1 ? UPDATES : UPDATES.slice(0, i)).slice(0, 3);
}

export const WhatsNew: React.FC = () => {
  const { profile } = useAuth();
  const user = profile?.id || '';
  const list = useMemo(() => (user ? unseen(user) : []), [user]);
  const [step, setStep] = useState(0);
  const [closed, setClosed] = useState(false);
  if (!user || closed || !list.length) return null;
  const u = list[step];
  const last = step === list.length - 1;
  const done = () => { writeSeen(user, UPDATES[0].id); setClosed(true); };
  return (
    <div className="v2"><div className="v2-rep-sheet-bg v2-whatsnew-bg" onClick={done}>
      <div className="v2-rep-sheet v2-whatsnew" role="dialog" aria-modal="true" aria-labelledby="v2-whatsnew-title" onClick={e => e.stopPropagation()}>
        <div className="v2-whatsnew-tag"><Sparkles size={14} />What’s new{list.length > 1 ? ` · ${step + 1} of ${list.length}` : ''}</div>
        <h2 id="v2-whatsnew-title">{u.title}</h2>
        <p className="v2-whatsnew-intro">{u.intro}</p>
        {u.picture && <div className="v2-whatsnew-pic">{u.picture}</div>}
        <ol className="v2-whatsnew-steps">{u.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
        <button type="button" className="v2-btn v2-whatsnew-go" onClick={() => (last ? done() : setStep(step + 1))}>{last ? 'Got it' : 'Next'}</button>
      </div>
    </div></div>
  );
};
