// src/v2/features/bookings/CrewBookingInfo.tsx — what the crew sees on a Master Bookings booking
// (an "mb:" prebook) in the old app's job screen and house sheet, styled like those screens:
//   PREPAID · AFSL (and the plan), gate / dog / sprinkler, the last try, this year's visits, past
//   visits. No price: the crew is credited the office flat in the background.
// NextTimeSheet: Next time / Cancelled with a reason and a note, kept on the booking.
import React, { useState } from 'react';
import { Ban, Clock, Dog, Droplets, History, Lock, ShieldCheck } from 'lucide-react';
import { accessFlags, attemptLine, CANCEL_REASONS, lastAttempt, NEXT_TIME_REASONS, type CrewInfo } from '../../lib/bookingCrew';

type JobLike = { 'Log Sheet Notes'?: string; Price?: string; Prepaid?: string; mb?: unknown } | null | undefined;
export const crewInfoOf = (job: JobLike): CrewInfo | null => (job && job.mb && typeof job.mb === 'object' ? job.mb as CrewInfo : null);

/** "PREPAID · AFSL" (or the job code alone when it isn't prepaid). */
export const bookingBadge = (job: JobLike): string => {
  const info = crewInfoOf(job);
  const code = info?.jobCode || job?.Price || '';
  const prepaid = info?.prepaid ?? job?.Prepaid === 'x';
  return [prepaid ? 'PREPAID' : null, code || null].filter(Boolean).join(' · ');
};

export const CrewBookingInfo: React.FC<{ job: JobLike; compact?: boolean }> = ({ job, compact }) => {
  const info = crewInfoOf(job);
  const [open, setOpen] = useState(false);
  if (!job) return null;
  const notes = job['Log Sheet Notes'] || info?.fieldNotes || '';
  const flags = accessFlags(notes);
  const last = lastAttempt(info?.attempts);
  const year = info?.thisYear || [];
  const history = (info?.history || []).filter(h => h.year || h.service || h.price);
  return (
    <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="bg-emerald-600 text-white text-xs font-black px-2 py-1 rounded flex items-center gap-1"><ShieldCheck size={13} />{bookingBadge(job)}</span>
        {info?.plan && <span className="text-emerald-300 text-xs font-bold">{info.plan}</span>}
        <span className="flex-1" />
        {flags.gate && <span className="text-amber-300 text-xs font-bold flex items-center gap-1" title="Locked gate"><Lock size={13} />Gate</span>}
        {flags.dog && <span className="text-amber-300 text-xs font-bold flex items-center gap-1" title="Dog"><Dog size={13} />Dog</span>}
        {flags.sprinkler && <span className="text-sky-300 text-xs font-bold flex items-center gap-1" title="Sprinklers"><Droplets size={13} />Sprinklers</span>}
      </div>
      {notes && !compact && <div className="text-sm text-white whitespace-pre-wrap">{notes}</div>}
      {last && (
        <div className="text-xs text-orange-300 flex items-start gap-1.5"><Clock size={13} className="mt-0.5 flex-shrink-0" /><span><b>Last try:</b> {attemptLine(last)}</span></div>
      )}
      {(year.length > 0 || history.length > 0) && (
        <button type="button" onClick={() => setOpen(o => !o)} className="text-xs text-emerald-300 font-bold flex items-center gap-1">
          <History size={13} />{open ? 'Hide' : 'This year & past visits'}
        </button>
      )}
      {open && (
        <div className="text-xs text-gray-300 space-y-1">
          {year.map((v, i) => (
            <div key={`y${i}`} className="flex gap-2"><span className={v.done ? 'text-green-400' : 'text-gray-500'}>{v.done ? '✓' : '–'}</span><b>{v.label}</b>{v.detail && <span className="text-gray-400">{v.detail}</span>}</div>
          ))}
          {history.length > 0 && <div className="text-gray-500 uppercase text-[10px] font-bold pt-1">Past visits</div>}
          {history.map((h, i) => (
            <div key={`h${i}`} className="flex gap-2 text-gray-400"><b className="text-gray-300">{h.year || '—'}</b><span>{[h.line, h.service, h.product, h.contractor].filter(Boolean).join(' · ')}</span></div>
          ))}
          {(info?.attempts?.length || 0) > 1 && <div className="text-gray-500 uppercase text-[10px] font-bold pt-1">Earlier tries</div>}
          {(info?.attempts || []).slice(1).map((a, i) => <div key={`a${i}`} className="text-orange-300/80">{attemptLine(a)}</div>)}
        </div>
      )}
    </div>
  );
};

export const NextTimeSheet: React.FC<{ onPick: (status: 'next_time' | 'cancelled', reason: string, note: string) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const [status, setStatus] = useState<'next_time' | 'cancelled'>('next_time');
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const reasons = status === 'next_time' ? NEXT_TIME_REASONS : CANCEL_REASONS;
  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg p-5 w-full max-w-sm border border-gray-700 shadow-xl space-y-4">
        <h3 className="text-lg font-bold text-white text-center">Not done today?</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setStatus('next_time'); setReason(''); }}
            className={`py-2 rounded font-bold text-sm border ${status === 'next_time' ? 'bg-orange-600 text-white border-orange-500' : 'bg-gray-900 text-orange-300 border-gray-700'}`}><Clock size={14} className="inline mr-1" />Next time</button>
          <button type="button" onClick={() => { setStatus('cancelled'); setReason(''); }}
            className={`py-2 rounded font-bold text-sm border ${status === 'cancelled' ? 'bg-red-600 text-white border-red-500' : 'bg-gray-900 text-red-300 border-gray-700'}`}><Ban size={14} className="inline mr-1" />Cancelled</button>
        </div>
        <p className="text-xs text-gray-400 text-center">
          {status === 'next_time' ? 'It comes back the next time this route is worked, with this note on it.' : 'The office sees it as cancelled and can reopen it.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {reasons.map(r => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${reason === r ? 'bg-white text-black border-white' : 'bg-gray-900 text-gray-200 border-gray-600'}`}>{r}</button>
          ))}
        </div>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for next time (optional)"
          className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm" />
        <div className="space-y-2">
          <button type="button" disabled={!reason} onClick={() => onPick(status, reason, note.trim())}
            className="w-full py-3 bg-white text-black rounded font-bold disabled:opacity-40">{status === 'next_time' ? 'Save · next time' : 'Save · cancelled'}</button>
          <button type="button" onClick={onClose} className="w-full py-2 text-gray-400 hover:text-white">Go back</button>
        </div>
      </div>
    </div>
  );
};
