// src/planner/features/cycle/Calendar.tsx — month grid and year overview with period / fertile / ovulation marks.
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { daysInMonth, fmtMonth, fmtShortMonth, pad, parse } from './dates';
import type { DayMarks } from './predict';
import { hasLog, type DayLog } from './types';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const cls = (m: DayMarks) => `${m.period ? 'is-period' : m.predicted ? 'is-predicted' : ''} ${m.fertile ? 'is-fertile' : ''} ${m.ovulation ? 'is-ovulation' : ''}`;

export function MonthGrid({ ym, marks, logs, todayKey, onPrev, onNext }: { ym: string; marks: (k: string) => DayMarks; logs: Record<string, DayLog>; todayKey: string; onPrev: () => void; onNext: () => void }) {
  const nav = useNavigate();
  const n = daysInMonth(ym);
  const first = parse(`${ym}-01`).getDay();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`)];
  return (
    <div className="pl-stack" style={{ gap: 8 }}>
      <div className="pl-row">
        <button className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Previous month" onClick={onPrev}><ChevronLeft /></button>
        <b className="pl-grow" style={{ textAlign: 'center', fontFamily: 'var(--serif)', fontSize: 17 }}>{fmtMonth(ym)}</b>
        <button className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Next month" onClick={onNext}><ChevronRight /></button>
      </div>
      <div className="cy-cal">
        {DOW.map((d, i) => <div key={i} className="cy-cal__dow">{d}</div>)}
        {cells.map((k, i) => k ? (
          <button key={k} className={`cy-day ${cls(marks(k))} ${k === todayKey ? 'is-today' : ''} ${k > todayKey ? 'is-future' : ''}`} onClick={() => nav(`/cycle/log/${k}`)} aria-label={k}>
            {Number(k.slice(8))}{hasLog(logs[k]) && <span className="cy-dot" />}
          </button>
        ) : <button key={`e${i}`} className="cy-day" disabled />)}
      </div>
    </div>
  );
}

export function YearGrid({ year, marks, todayKey, onPick }: { year: number; marks: (k: string) => DayMarks; todayKey: string; onPick: (ym: string) => void }) {
  return (
    <div className="cy-year">
      {Array.from({ length: 12 }, (_, m) => {
        const ym = `${year}-${pad(m + 1)}`;
        const n = daysInMonth(ym), first = parse(`${ym}-01`).getDay();
        return (
          <button key={ym} className="cy-mini" style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: 'inherit' }} onClick={() => onPick(ym)}>
            <span className="cy-mini__name">{fmtShortMonth(ym)}</span>
            <span className="cy-mini__grid">
              {Array.from({ length: first }, (_, i) => <span key={`e${i}`} className="cy-mini__d is-empty" />)}
              {Array.from({ length: n }, (_, i) => { const k = `${ym}-${pad(i + 1)}`; return <span key={k} className={`cy-mini__d ${cls(marks(k))} ${k === todayKey ? 'is-today' : ''}`}>{i + 1}</span>; })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Legend() {
  return (
    <div className="cy-legend">
      <span><i style={{ background: 'var(--cy-pink)' }} /> period</span>
      <span><i style={{ boxShadow: 'inset 0 0 0 2px var(--cy-pink)' }} /> predicted</span>
      <span><i style={{ background: 'var(--cy-teal-2)' }} /> fertile</span>
      <span><i style={{ border: '2px dotted var(--cy-teal)' }} /> ovulation</span>
    </div>
  );
}

/** 14 days around today, for the Today card. */
export function Strip({ marks, todayKey, from }: { marks: (k: string) => DayMarks; todayKey: string; from: string }) {
  const days = Array.from({ length: 14 }, (_, i) => { const d = parse(from); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; });
  return <div className="cy-strip">{days.map(k => <span key={k} className={`cy-strip__d ${cls(marks(k))} ${k === todayKey ? 'is-today' : ''}`}>{Number(k.slice(8))}</span>)}</div>;
}
