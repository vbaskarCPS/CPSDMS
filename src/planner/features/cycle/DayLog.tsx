// /cycle/log/:date — what this day was like, and the period that covers it.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Page, Header, Card, Button, Field, Input, TextArea, Chip, Sheet, useToast } from '../../ui/primitives';
import { useDoc } from '../../lib/useDoc';
import { useCycle } from './useCycle';
import { today as todayView, PHASE_LABEL } from './predict';
import { addDays, diffDays, fmtDay } from './dates';
import { DISCHARGE, FLOWS, MOODS, SYMPTOMS, type DayLog as Log, type Period } from './types';

const toggle = (xs: string[] | undefined, v: string) => (xs || []).includes(v) ? (xs || []).filter(x => x !== v) : [...(xs || []), v];

export function DayLog() {
  const { date = '' } = useParams();
  const c = useCycle();
  const { data, update, save } = useDoc<Log>('cyclelog', date, {}, 600);
  const [toast, say] = useToast();
  const [edit, setEdit] = useState<Period | null>(null);
  const [editing, setEditing] = useState(false);
  const [prevStart, setPrevStart] = useState<string | undefined>();
  const covering = c.periods.find(p => p.start <= date && p.end >= date) || null;
  const v = todayView(c.periods, c.prefs, date);
  useEffect(() => { if (!editing) { setEdit(covering); setPrevStart(covering?.start); } }, [covering, editing]);

  const savePeriod = async () => {
    if (!edit || !edit.start || !edit.end || edit.end < edit.start) { say('Check the dates', 'bad'); return; }
    try { await c.savePeriod({ ...edit, source: edit.source || 'app' }, prevStart); setEditing(false); say('Period saved', 'good'); }
    catch { say('Could not save', 'bad'); }
  };
  const removePeriod = async () => {
    if (!covering) return;
    try { await c.removePeriod(covering.start); setEditing(false); say('Period removed'); } catch { say('Could not save', 'bad'); }
  };

  return (
    <Page>
      <Header back="/cycle" eyebrow={v.day ? `Cycle day ${v.day}${v.phase ? ` · ${PHASE_LABEL[v.phase]}` : ''}` : 'Log'} title={fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })} save={save} />

      <Card className="pl-stack">
        <div className="pl-row">
          <b className="pl-grow">{covering ? `Period · day ${diffDays(covering.start, date) + 1} of ${diffDays(covering.start, covering.end) + 1}` : 'No period on this day'}</b>
          <Button small ghost onClick={() => { setEdit(covering || { start: date, end: addDays(date, c.stats.periodLength - 1), source: 'app' }); setPrevStart(covering?.start); setEditing(true); }}>{covering ? 'Edit' : 'Add period here'}</Button>
        </div>
        <p className="pl-eyebrow">Flow</p>
        <div className="pl-chips">{FLOWS.map(f => <Chip key={f} on={data.flow === f} onClick={() => update({ flow: data.flow === f ? undefined : f })}>{f}</Chip>)}</div>
      </Card>

      <Card className="pl-stack">
        <p className="pl-eyebrow">Symptoms</p>
        <div className="pl-chips">{SYMPTOMS.map(s => <Chip key={s} on={data.symptoms?.includes(s)} onClick={() => update({ symptoms: toggle(data.symptoms, s) })}>{s}</Chip>)}</div>
        <p className="pl-eyebrow">Mood</p>
        <div className="pl-chips">{MOODS.map(m => <Chip key={m} on={data.mood?.includes(m)} onClick={() => update({ mood: toggle(data.mood, m) })}>{m}</Chip>)}</div>
        <p className="pl-eyebrow">Discharge</p>
        <div className="pl-chips">{DISCHARGE.map(d => <Chip key={d} on={data.discharge === d} onClick={() => update({ discharge: data.discharge === d ? undefined : d })}>{d}</Chip>)}</div>
      </Card>

      <Card className="pl-stack">
        <p className="pl-eyebrow">Sex</p>
        <div className="pl-chips">{(['none', 'protected', 'unprotected'] as const).map(x => <Chip key={x} on={data.sex === x} onClick={() => update({ sex: data.sex === x ? undefined : x })}>{x}</Chip>)}</div>
        <p className="pl-eyebrow">Ovulation test</p>
        <div className="pl-chips">{(['negative', 'positive'] as const).map(x => <Chip key={x} on={data.ovulationTest === x} tone={x === 'positive' ? 'good' : undefined} onClick={() => update({ ovulationTest: data.ovulationTest === x ? undefined : x })}>{x}</Chip>)}</div>
        <div className="pl-grid-2">
          <Field label="BBT (°C)"><Input type="number" step="0.01" inputMode="decimal" value={data.bbt ?? ''} onChange={e => update({ bbt: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        </div>
        <Field label="Notes"><TextArea rows={2} value={data.notes || ''} onChange={e => update({ notes: e.target.value })} placeholder="Anything worth remembering…" /></Field>
      </Card>

      <Sheet open={editing} onClose={() => setEditing(false)} title={covering ? 'Edit period' : 'Add period'}>
        {edit && (
          <div className="pl-stack">
            <div className="pl-grid-2">
              <Field label="Started"><Input type="date" value={edit.start} onChange={e => setEdit({ ...edit, start: e.target.value })} /></Field>
              <Field label="Ended"><Input type="date" value={edit.end} onChange={e => setEdit({ ...edit, end: e.target.value })} /></Field>
            </div>
            <div className="pl-chips">{(['light', 'medium', 'heavy'] as const).map(f => <Chip key={f} on={edit.flow === f} onClick={() => setEdit({ ...edit, flow: edit.flow === f ? undefined : f })}>{f} overall</Chip>)}</div>
            <Button primary block onClick={() => void savePeriod()}>Save</Button>
            {covering && <Button danger block onClick={() => void removePeriod()}>Remove this period</Button>}
          </div>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
