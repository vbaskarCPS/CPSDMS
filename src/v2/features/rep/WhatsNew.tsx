// src/v2/features/rep/WhatsNew.tsx — "What's new" in the rep app. The first time a rep opens the app after an update, a
// short card says what changed and how to use it, with a picture when one helps. Seen once per rep on each phone.
//
// EVERY change to the rep app adds an entry at the TOP of UPDATES (a new, unique id), in the same PR as the change.
import React, { useMemo, useState } from 'react';
import { DoorOpen, Search, Sparkles } from 'lucide-react';
import { useAuth } from '../../lib/auth';

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
