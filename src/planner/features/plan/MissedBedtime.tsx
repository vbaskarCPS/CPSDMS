// src/planner/features/plan/MissedBedtime.tsx — "Did you forget to record bedtime?" In the morning, if last night has
// no lights-out, the Today screen asks for the time you actually went to bed and saves it on last night's day.
// Also opens when lights out is tapped in the morning, so a late tap lands on the right night with the right time.
import { useEffect, useMemo, useState } from 'react';
import { Moon } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { clock, routineMinutes, type Routine } from '../../lib/routine';
import { Button, Card, Input } from '../../ui/primitives';
import { autoMark } from '../habits/auto';
import { addDays } from './dates';
import { emptyDay, normalizeDay, type Day } from './types';

/** 4 am to 2 pm: lights out tapped now is about last night. */
export const isMorningHours = (d = new Date()) => routineMinutes(d) < 10 * 60;

const askedKey = (k: string) => `pl-bed-asked-${k}`;
const wasAsked = (k: string) => { try { return localStorage.getItem(askedKey(k)) === '1'; } catch { return false; } };
const markAsked = (k: string) => { try { localStorage.setItem(askedKey(k), '1'); } catch { /* private mode */ } };

export function MissedBedtime({ routine, open, onClose }: { routine: Routine; open?: boolean; onClose?: () => void }) {
  const night = useMemo(() => addDays(dayKey(), -1), []);
  const { data, update, loading, loadError, flush } = useDoc<Day>('day', night, emptyDay(), 200);
  const day = normalizeDay(data);
  const [time, setTime] = useState(routine.lightsOut);
  const [skipped, setSkipped] = useState(() => wasAsked(night));
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { setTime(routine.lightsOut); }, [routine.lightsOut]);
  const bedWord = routine.profile === 'morning' ? 'went to bed' : 'turned the lights out';

  if (saved) return (
    <Card className="bed-missed"><Moon aria-hidden /><div className="pl-grow"><b>Saved.</b><small className="pl-muted">Last night: in bed {clock(saved)}.</small></div>
      <Button small ghost onClick={() => { setSaved(null); onClose?.(); }}>OK</Button></Card>
  );
  if (loading || loadError) return null;
  if (day.ticks.lightsOut) {
    if (!open) return null;
    return (
      <Card className="bed-missed"><Moon aria-hidden /><div className="pl-grow"><b>Last night is already recorded.</b><small className="pl-muted">In bed {clock(day.ticks.lightsOut)}. Change it below if that’s not right.</small>
        <div className="bed-missed__row"><Input type="time" aria-label="Bedtime last night" value={time} onChange={e => setTime(e.target.value)} />
          <Button small primary disabled={!time} onClick={() => save()}>Change it</Button><Button small ghost onClick={onClose}>Close</Button></div></div></Card>
    );
  }
  if (!open && (skipped || !isMorningHours())) return null;

  async function save() {
    if (!time) return;
    update(d => { const n = normalizeDay(d); return { ...n, ticks: { ...n.ticks, lightsOut: time } }; });
    await flush();
    void autoMark('lightsOut', true, night);
    markAsked(night);
    setSaved(time);
  }
  const skip = () => { markAsked(night); setSkipped(true); onClose?.(); };

  return (
    <Card accent className="bed-missed">
      <Moon aria-hidden />
      <div className="pl-grow">
        <b>{open ? 'Recording last night?' : 'Did you forget to record bedtime?'}</b>
        <small className="pl-muted">What time you actually {bedWord} last night. It’s saved on last night, not today.</small>
        <div className="bed-missed__row">
          <Input type="time" aria-label="Bedtime last night" value={time} onChange={e => setTime(e.target.value)} />
          <Button small primary disabled={!time} onClick={() => void save()}>Save</Button>
          <Button small ghost onClick={skip}>{open ? 'Cancel' : 'Skip'}</Button>
        </div>
      </div>
    </Card>
  );
}
