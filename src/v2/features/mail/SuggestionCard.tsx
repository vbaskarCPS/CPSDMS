// src/v2/features/mail/SuggestionCard.tsx — Claude's suggestion on a customer's email to a centre's mailbox
// (RUN_71): what they want, the booking it's about, what to do with it, and a reply to edit. One tap sends
// the reply and makes the booking change together; nothing happens until someone presses a button.
//   Delay → second round (skipped in first-pass sessions) · Cancel → the whole plan (prepaid: marked for refund)
//   Instructions → field notes · Thanks → nothing to do · anything else → a reply only
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import {
  actionLabel, actionShort, decideSuggestion, htmlToText, mailSuggestion, reSubject, sendMail, suggestAgain, textToHtml, undoSuggestion,
  type Suggestion, type SuggestBooking,
} from '../../lib/mail';
import { useLoad } from '../../lib/data';

const INTENT: Record<Suggestion['intent'], string> = {
  delay: 'Wants to delay', cancel: 'Wants to cancel', instructions: 'Sent instructions', thanks: 'Just saying thanks', question: 'Asked a question', other: 'Wrote back',
};

export const SuggestionCard: React.FC<{ threadId: string; subject: string; replyTo?: string | null; tick: number; onChanged: () => void }> = ({ threadId, subject, replyTo, tick, onChanged }) => {
  const [n, setN] = useState(0);
  const sug = useLoad(() => mailSuggestion(threadId), [threadId, tick, n]);
  const s = sug.data;
  const [booking, setBooking] = useState<string | null>(null);
  const [apply, setApply] = useState(true);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [writeReply, setWriteReply] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!s) return;
    setBooking(s.booking_id || (s.bookings?.length === 1 ? s.bookings[0].id : null));
    setNote(s.note || ''); setReply(htmlToText(s.reply_html || '')); setWriteReply(s.needs_reply); setApply(true); setErr(null);
  }, [s?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const b: SuggestBooking | null = useMemo(() => s?.bookings?.find(x => x.id === booking) || null, [s, booking]);
  if (!s) return null;

  // decided in the last 15 minutes: say what happened, offer undo
  if (s.status !== 'pending') {
    if (!s.applied) return null;
    return (
      <div className="sugg done" role="status">
        <Check size={18} /><span><b>{actionLabel(s.applied, b)}</b>{s.replied ? ' · reply sent' : ''}{done ? ` · ${done}` : ''}</span>
        <button type="button" className="link" disabled={!!busy} onClick={async () => {
          setBusy('undo'); setErr(null);
          try { await undoSuggestion(s.id); setDone(null); setN(x => x + 1); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
        }}><Undo2 size={14} /> Undo</button>
        {err && <span className="sugg-err">{err}</span>}
      </div>
    );
  }

  const act = s.action !== 'none' && !!s.bookings?.length;
  const blocked = !act ? null
    : !b ? 'Pick which booking this is about.'
    : b.can_change === false ? 'You don’t have Master Bookings access to change this booking; send the reply and ask someone who does.'
    : (s.action === 'second_round' || s.action === 'cancel') && b.status !== 'open' ? `This booking is already ${b.status === 'done' ? `done${b.done_on ? ` (${b.done_on})` : ''}` : 'cancelled'}.`
    : null;
  const doAction = act && apply && !blocked;
  const refund = s.action === 'cancel' && !!b && (b.prepaid || b.plan?.prepaid);
  const canReply = !!replyTo && writeReply && reply.trim().length > 0;

  const go = async (opts: { send: boolean; apply: boolean }) => {
    setErr(null);
    try {
      if (opts.send) {
        setBusy('send');
        const html = textToHtml(reply);
        await sendMail({ staff: true, thread_id: threadId, to: [replyTo!], cc: [], subject: s.reply_subject || reSubject(subject), html, text: reply.trim(), attachments: [] });
      }
      setBusy('save');
      const r = await decideSuggestion(s.id, { apply: opts.apply, booking, note, replied: opts.send });
      setDone(r.refund ? 'marked for refund' : r.bookings && r.bookings > 1 ? `${r.bookings} bookings` : null);
      setN(x => x + 1); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const short = actionShort(s.action);
  const primary = doAction && canReply ? `Send reply + ${short.toLowerCase().replace('cancel plan', 'cancel the plan')}`
    : doAction ? short
    : canReply ? 'Send reply' : 'Mark handled';

  return (
    <section className="sugg" aria-label="Suggested by Claude">
      <div className="sugg-h">
        <Sparkles size={18} />
        <b>{s.summary || INTENT[s.intent]}</b>
        {s.confidence === 'low' && <span className="gc warn">Not sure</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="icon sm" title="Ask Claude again" aria-label="Ask Claude again" disabled={!!busy} onClick={async () => {
          setBusy('again'); setErr(null);
          try { await suggestAgain(s.message_id); setN(x => x + 1); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
        }}>{busy === 'again' ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}</button>
        <button type="button" className="icon sm" title="Dismiss" aria-label="Dismiss" disabled={!!busy} onClick={() => go({ send: false, apply: false })}><X size={16} /></button>
      </div>

      {!!s.bookings?.length && (
        <div className="sugg-bk">
          {s.bookings.length > 1 ? (
            <select value={booking || ''} onChange={e => setBooking(e.target.value || null)} aria-label="Which booking">
              <option value="">Which booking is this about?</option>
              {s.bookings.map(x => <option key={x.id} value={x.id}>{x.address}{x.list ? ` · ${x.list}` : ''} · {x.status}{x.round && x.round > 1 ? ' · 2nd round' : ''}</option>)}
            </select>
          ) : b && <span>{b.address}{b.job ? ` · ${b.job}` : ''}{b.list ? ` · ${b.list}` : ''}{b.plan ? ` · ${b.plan.kind}` : ''}{b.prepaid ? ' · prepaid' : ''}{b.round && b.round > 1 ? ' · 2nd round' : ''}</span>}
        </div>
      )}

      {act && (
        <div className="sugg-act">
          <label className={blocked ? 'off' : ''}>
            <input type="checkbox" checked={doAction} disabled={!!blocked} onChange={e => setApply(e.target.checked)} />
            <span>{actionLabel(s.action, b)}</span>
          </label>
          {blocked && <div className="sugg-warn"><AlertTriangle size={14} />{blocked}</div>}
          {refund && doAction && <div className="sugg-warn"><AlertTriangle size={14} />Prepaid: it will be marked for refund for the office.</div>}
          {doAction && (
            <input className="sugg-note" value={note} onChange={e => setNote(e.target.value)} placeholder={s.action === 'field_notes' ? 'Field note' : 'Note (their reason)'} aria-label="Note" />
          )}
        </div>
      )}

      {replyTo && (writeReply ? (
        <div className="sugg-reply">
          <div className="mut">Reply to {replyTo} (edit if you like)</div>
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={Math.min(10, Math.max(4, reply.split('\n').length + 1))} aria-label="Reply" />
        </div>
      ) : <button type="button" className="link" onClick={() => setWriteReply(true)}>No reply needed · write one anyway</button>)}

      {err && <div className="err">{err}</div>}
      <div className="sugg-btns">
        <button type="button" className="btn-primary" disabled={!!busy}
          onClick={() => go({ send: canReply, apply: doAction })}>
          {busy === 'send' ? 'Sending…' : busy === 'save' ? 'Saving…' : primary}</button>
        {doAction && canReply && <button type="button" className="btn-plain" disabled={!!busy} onClick={() => go({ send: true, apply: false })}>Reply only</button>}
        {doAction && canReply && <button type="button" className="btn-plain" disabled={!!busy} onClick={() => go({ send: false, apply: true })}>{short}, no reply</button>}
      </div>
    </section>
  );
};
