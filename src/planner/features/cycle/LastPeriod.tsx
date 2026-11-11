// "When did your last period start?": one date and a Save. Shown when the tracker has nothing recent to count from
// (the Cycle screen, when the last logged period is too old) and in the first-open set-up (screens/SetUp.tsx).
// The end is filled in from her usual period length; it can be corrected on that day's page.
import { useState } from 'react';
import { Button } from '../../ui/primitives';
import { addDays, fmtDay } from './dates';
import type { Period } from './types';

/** The period to save for a start date: `days` long, never running past today. null when the date can't be one
 *  (in the future, not a date, or a period is already logged on it). */
export function periodFrom(start: string, days: number, todayKey: string, logged: Period[]): Period | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start > todayKey) return null;
  if (logged.some(p => p.start <= start && p.end >= start)) return null;
  const end = addDays(start, Math.max(1, Math.min(14, Math.round(days) || 5)) - 1);
  return { start, end: end > todayKey ? todayKey : end, source: 'app' };
}

export function LastPeriod({ todayKey, periodDays, logged, onSave, label = 'When did your last period start?' }: {
  todayKey: string; periodDays: number; logged: Period[]; onSave: (p: Period) => Promise<void>; label?: string;
}) {
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const period = date ? periodFrom(date, periodDays, todayKey, logged) : null;
  const save = async () => {
    if (!period || busy) return;
    setBusy(true); setError(null);
    try { await onSave(period); setDate(''); }
    catch { setError('That didn’t save. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="pl-stack" style={{ gap: 8 }}>
      <label className="pl-field">
        <span className="pl-label">{label}</span>
        <input className="pl-input" type="date" max={todayKey} value={date} onChange={e => setDate(e.target.value)} />
        {date && !period && <span className="pl-hint">{date > todayKey ? 'That day hasn’t come yet.' : 'There’s already a period logged on that day.'}</span>}
        {period && <span className="pl-hint">Saved as {fmtDay(period.start)} to {fmtDay(period.end)}. You can correct the end on that day’s page.</span>}
      </label>
      {error && <p className="pl-error">{error}</p>}
      <Button primary block onClick={() => void save()} disabled={!period || busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </div>
  );
}
