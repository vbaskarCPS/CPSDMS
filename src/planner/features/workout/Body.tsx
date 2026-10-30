// src/planner/features/workout/Body.tsx — /workout/body: body weight log and trend.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PlannerPass } from '../../lib/auth';
import { dayKey } from '../../lib/docs';
import { Page, Header, Card, Button, Input, Line, Stat, useToast } from '../../ui/primitives';
import { daysAgo, fmtDate, loadBodyWeights, saveBodyWeight } from './store';
import { useUnits } from './WorkoutHome';

export function Body({ pass }: { pass: PlannerPass }) {
  const units = useUnits(pass);
  const [rows, setRows] = useState<{ date: string; weight: number }[]>([]);
  const [date, setDate] = useState(dayKey());
  const [weight, setWeight] = useState('');
  const [toast, say] = useToast();
  useEffect(() => { void loadBodyWeights(daysAgo(365)).then(setRows); }, []);

  const last90 = useMemo(() => rows.filter(r => r.date >= daysAgo(90)), [rows]);
  const latest = rows[rows.length - 1];
  const avg7 = useMemo(() => { const r = rows.filter(x => x.date >= daysAgo(7)); return r.length ? r.reduce((s, x) => s + x.weight, 0) / r.length : null; }, [rows]);
  const prev30 = useMemo(() => { const r = rows.filter(x => x.date <= daysAgo(30)); return r[r.length - 1] || null; }, [rows]);
  const change = latest && prev30 ? latest.weight - prev30.weight : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const w = parseFloat(weight);
    if (!isFinite(w) || w <= 0) return;
    await saveBodyWeight(date, w);
    setRows(r => [...r.filter(x => x.date !== date), { date, weight: w }].sort((a, b) => (a.date < b.date ? -1 : 1)));
    setWeight(''); say('Logged', 'good');
  };

  return (
    <Page>
      <Header back="/workout" eyebrow="Train" title="Body weight" />
      <Card>
        <form className="pl-row" onSubmit={submit}>
          <Input type="date" value={date} max={dayKey()} onChange={e => setDate(e.target.value)} style={{ flex: 1 }} />
          <Input inputMode="decimal" placeholder={units} value={weight} onChange={e => setWeight(e.target.value)} style={{ width: 96, textAlign: 'center' }} />
          <Button primary type="submit" disabled={!weight}>Log</Button>
        </form>
      </Card>
      <div className="pl-stats">
        <Stat label="Latest" value={latest ? latest.weight : '–'} sub={latest ? fmtDate(latest.date) : ''} />
        <Stat label="7-day avg" value={avg7 ? avg7.toFixed(1) : '–'} sub={units} />
        <Stat label="vs 30 days" value={change === null ? '–' : `${change > 0 ? '+' : ''}${change.toFixed(1)}`} sub={units} tone={change === null ? undefined : change <= 0 ? 'good' : 'amber'} />
      </div>
      <Card>
        <h3 style={{ marginBottom: 6 }}>Last 90 days</h3>
        <Line values={last90.map(r => r.weight)} height={90} />
        {last90.length >= 2 && <div className="pl-bars__labels"><span style={{ textAlign: 'left' }}>{fmtDate(last90[0].date)}</span><span style={{ textAlign: 'right' }}>{fmtDate(last90[last90.length - 1].date)}</span></div>}
      </Card>
      {rows.length > 0 && (
        <Card>
          <h3 style={{ marginBottom: 6 }}>Entries</h3>
          <table className="wo-table"><tbody>
            {[...rows].reverse().slice(0, 14).map(r => <tr key={r.date}><td>{fmtDate(r.date)}</td><td>{r.weight} {units}</td></tr>)}
          </tbody></table>
        </Card>
      )}
      {toast}
    </Page>
  );
}
