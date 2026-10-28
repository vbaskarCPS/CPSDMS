// src/v2/features/rep/repContext.tsx — what every rep screen shares: today's day (started? ended?),
// the visits waiting for signal, a toast, and the background jobs: sending what's waiting when the
// signal's back, a location every two minutes while the day is on, and follow-up reminders on this
// phone while the app is open.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { dayPing, hereNow, repFollowups, repToday, type RepToday } from '../../lib/rep';
import { flush, onQueue, type QItem } from '../../lib/repQueue';

export interface ToastAction { label: string; onClick: () => void }
export interface Toast { msg: string; actions?: ToastAction[]; ms?: number }

interface Ctx {
  today: RepToday | null; setToday: (t: RepToday) => void; refreshToday: () => void;
  queue: QItem[]; flushNow: () => void;
  toast: (t: Toast | string) => void;
  mapTick: number; bumpMap: () => void;
}
const RepCtx = createContext<Ctx | null>(null);
export const useRep = () => { const c = useContext(RepCtx); if (!c) throw new Error('useRep outside RepProvider'); return c; };

const PING_MS = 2 * 60 * 1000;
const NOTIFIED = 'ms-rep-notified';

export const RepProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [today, setToday] = useState<RepToday | null>(null);
  const [queue, setQueue] = useState<QItem[]>([]);
  const [toastNow, setToastNow] = useState<Toast | null>(null);
  const [mapTick, setMapTick] = useState(0);
  const bumpMap = useCallback(() => setMapTick(t => t + 1), []);
  const refreshToday = useCallback(() => { repToday().then(setToday).catch(() => { /* offline: keep what we had */ }); }, []);

  // what's waiting, and sending it
  useEffect(() => onQueue(setQueue), []);
  const flushNow = useCallback(() => {
    flush().then(r => { if (r.sent) { setToastNow({ msg: `${r.sent} saved visit${r.sent === 1 ? '' : 's'} sent.` }); bumpMap(); refreshToday(); } }).catch(() => {});
  }, [bumpMap, refreshToday]);
  useEffect(() => {
    flushNow(); refreshToday();
    const on = () => flushNow();
    window.addEventListener('online', on);
    const t = setInterval(flushNow, 30000);
    return () => { window.removeEventListener('online', on); clearInterval(t); };
  }, [flushNow, refreshToday]);

  // a location now and then while the day is on (distance walked)
  const dayOn = !!today?.started_at && !today?.ended_at;
  useEffect(() => {
    if (!dayOn) return;
    const go = () => { hereNow(10000).then(p => { if (p) dayPing(p).catch(() => {}); }); };
    go();
    const t = setInterval(go, PING_MS);
    return () => clearInterval(t);
  }, [dayOn]);

  // follow-up reminders on this phone (while the app is open and notifications are allowed)
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const arm = () => {
      timers.current.forEach(clearTimeout); timers.current = [];
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      repFollowups().then(list => {
        let done: string[] = [];
        try { done = JSON.parse(localStorage.getItem(NOTIFIED) || '[]'); } catch { /* none */ }
        for (const f of list) {
          const key = `${f.business_id}:${f.follow_up_at}`;
          const wait = new Date(f.follow_up_at).getTime() - 10 * 60000 - Date.now();   // 10 minutes before
          if (done.includes(key) || wait > 70 * 60000 || wait < -60 * 60000) continue;
          timers.current.push(window.setTimeout(() => {
            try {
              new Notification(`Follow up: ${f.name}`, { body: [f.contact_name && `Ask for ${f.contact_name}`, f.address].filter(Boolean).join(' · '), tag: key });
              localStorage.setItem(NOTIFIED, JSON.stringify([...done, key].slice(-200)));
            } catch { /* not allowed here */ }
          }, Math.max(0, wait)));
        }
      }).catch(() => {});
    };
    arm();
    const t = setInterval(arm, 15 * 60000);
    return () => { clearInterval(t); timers.current.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    if (!toastNow) return;
    const t = setTimeout(() => setToastNow(null), toastNow.ms || (toastNow.actions?.length ? 9000 : 4000));
    return () => clearTimeout(t);
  }, [toastNow]);
  const toast = useCallback((t: Toast | string) => setToastNow(typeof t === 'string' ? { msg: t } : t), []);

  return (
    <RepCtx.Provider value={{ today, setToday, refreshToday, queue, flushNow, toast, mapTick, bumpMap }}>
      {children}
      {toastNow && (
        <div className="v2-rep-toast" role="status">
          <span>{toastNow.msg}</span>
          {toastNow.actions?.map(a => <button key={a.label} type="button" onClick={() => { a.onClick(); setToastNow(null); }}>{a.label}</button>)}
        </div>)}
    </RepCtx.Provider>
  );
};

/** Saves a text file on the phone (the calendar file). */
export function download(name: string, text: string, type = 'text/calendar') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
