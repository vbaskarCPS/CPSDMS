// src/planner/features/mail/MailTodos.tsx — "From your email" on Today: the to-dos the half-hourly check found in a
// connected mailbox and is offering (todos.ts). Each has Add (onto today's list, or the day the email named) and Not
// needed. Nothing is on the list until Add is tapped. The card is only there while some are waiting: with none it
// draws nothing, and it isn't one of the blocks a person arranges (it sits with the other prompts above them).
// It loads its own docs, and looks again when the planner comes back to the front or a check's notification is opened.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { dayKey, onDocsChanged } from '../../lib/docs';
import { MAILTODO_KIND } from '../../../../supabase/functions/planner-mail/mail';
import { addOffered, dayFor, dayWords, dismissOffered, loadOffered, type Offered } from './todos';

const SHOWN = 3;   // more than this fold away behind "Show n more"

export function MailTodos() {
  const [list, setList] = useState<Offered[]>([]);
  const [busy, setBusy] = useState<{ key: string; what: 'add' | 'dismiss' } | null>(null);   // the one being added or put aside
  const [note, setNote] = useState<string | null>(null);     // what just happened: "Added to today’s list."
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const on = useRef(true);
  const today = dayKey();

  const load = useCallback(() => { void loadOffered().then(l => { if (on.current) setList(l); }).catch(() => undefined); }, []);
  useEffect(() => {
    on.current = true;
    load();
    const onShow = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onShow);
    const off = onDocsChanged(kinds => { if (kinds.includes(MAILTODO_KIND)) load(); });
    return () => { on.current = false; document.removeEventListener('visibilitychange', onShow); off(); };
  }, [load]);
  // the line saying what happened goes after a few seconds (and the card with it, when nothing else is waiting)
  useEffect(() => { if (!note) return; const id = window.setTimeout(() => setNote(null), 4000); return () => window.clearTimeout(id); }, [note]);

  const act = async (o: Offered, what: 'add' | 'dismiss') => {
    if (busy) return;
    setBusy({ key: o.key, what }); setErr(null); setNote(null);
    try {
      if (what === 'add') { const day = await addOffered(o, today); setNote(day === today ? 'Added to today’s list.' : `Added to the list for ${dayWords(day, today)}.`); }
      else await dismissOffered(o);
      setList(cur => cur.filter(x => x.key !== o.key));
    } catch (e) { setErr(e instanceof Error && e.message ? e.message : 'That didn’t work. Try again.'); }
    finally { setBusy(null); }
  };

  if (!list.length && !note && !err) return null;
  const shown = all ? list : list.slice(0, SHOWN), rest = list.length - shown.length;
  return (
    <section className="pl-card mail-todos" aria-label="From your email">
      <div className="mail-todos__head">
        <Mail aria-hidden />
        <div className="pl-grow">
          <b>From your email</b>
          {list.length > 0 && <small>{list.length === 1 ? '1 thing you may need to do' : `${list.length} things you may need to do`}</small>}
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="mail-todos__list">
          {shown.map(o => {
            const day = dayFor(o.todo, today);
            return (
              <li key={o.key}>
                <b>{o.todo.what}</b>
                <small>{o.todo.from}{o.todo.subject ? ` · ${o.todo.subject}` : ''}</small>
                {day !== today && <small className="mail-todos__day">For {dayWords(day, today)}{o.todo.time && o.todo.date === day ? `, ${clock(o.todo.time)}` : ''}</small>}
                <div className="mail-todos__btns">
                  <button type="button" className="pl-btn pl-btn--small pl-btn--primary" disabled={busy !== null} onClick={() => void act(o, 'add')}>{busy?.key === o.key && busy.what === 'add' ? 'Adding…' : day === today ? 'Add' : `Add to ${dayWords(day, today)}`}</button>
                  <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" disabled={busy !== null} onClick={() => void act(o, 'dismiss')}>Not needed</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rest > 0 && <button type="button" className="mail-todos__more" onClick={() => setAll(true)}>Show {rest} more</button>}
      {note && <p className="mail-todos__note" role="status">{note}</p>}
      {err && <p className="pl-error" role="alert">{err}</p>}
    </section>
  );
}

/** 15:00 → 3:00 PM */
const clock = (t: string): string => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
