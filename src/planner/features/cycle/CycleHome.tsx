// /cycle — where the cycle is today, the calendar, and the period buttons.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings as Cog, History, Droplet, Check } from 'lucide-react';
import { Page, Header, Card, Button, Segmented, Ring, useToast } from '../../ui/primitives';
import { useCycle } from './useCycle';
import { MonthGrid, YearGrid, Legend } from './Calendar';
import { addDays, diffDays, fmtDay, monthKey, shiftMonth } from './dates';
import { PHASE_BLURB, PHASE_LABEL } from './predict';

const NOTE_KEY = 'cycle-note-seen';

export function CycleHome() {
  const c = useCycle();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [ym, setYm] = useState(() => monthKey(c.todayKey));
  const [year, setYear] = useState(() => Number(c.todayKey.slice(0, 4)));
  const [note, setNote] = useState(() => { try { return !localStorage.getItem(NOTE_KEY); } catch { return true; } });
  const [toast, say] = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!note) { try { localStorage.setItem(NOTE_KEY, '1'); } catch { /* fine */ } } }, [note]);

  const v = c.view, s = c.stats;
  const next = v.next;
  const fertileNow = next ? c.todayKey >= next.fertileStart && c.todayKey <= next.fertileEnd : false;

  const startToday = async () => {
    setBusy(true);
    try { await c.savePeriod({ start: c.todayKey, end: addDays(c.todayKey, s.periodLength - 1), source: 'app' }); say('Period logged', 'good'); }
    catch { say('Could not save', 'bad'); } finally { setBusy(false); }
  };
  const endToday = async () => {
    if (!v.inPeriod) return;
    setBusy(true);
    try { await c.savePeriod({ ...v.inPeriod, end: c.todayKey }); say('Period ended', 'good'); }
    catch { say('Could not save', 'bad'); } finally { setBusy(false); }
  };

  return (
    <Page>
      <Header title="Cycle" eyebrow={v.phase ? PHASE_BLURB[v.phase] : 'Period & ovulation'} right={
        <span className="pl-row" style={{ gap: 2 }}>
          <Link to="/cycle/history" className="pl-btn pl-btn--ghost" aria-label="History" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><History /></Link>
          <Link to="/cycle/settings" className="pl-btn pl-btn--ghost" aria-label="Cycle settings" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><Cog /></Link>
        </span>} />

      <Card>
        {c.loading ? <p className="pl-muted">Loading…</p> : !v.lastStart ? (
          <div className="pl-stack">
            <p>No periods logged yet. Tap the button on the day your period starts and predictions begin after a cycle or two.</p>
            <Button primary onClick={() => void startToday()} disabled={busy}><Droplet /> Period started today</Button>
          </div>
        ) : (
          <div className="pl-stack">
            <div className="cy-hero">
              <div className={`cy-hero__ring ${fertileNow && v.phase !== 'menstrual' ? 'is-fertile' : ''}`}>
                <Ring value={Math.min(v.day || 0, s.cycleLength)} max={s.cycleLength} size={96} label={`Day ${v.day ?? '–'}`} sub={`of ~${s.cycleLength}`} />
              </div>
              <div className="pl-grow pl-stack" style={{ gap: 4 }}>
                <span className="cy-phase">{v.phase ? PHASE_LABEL[v.phase] : ''}{v.inPeriod ? ` · day ${diffDays(v.inPeriod.start, c.todayKey) + 1}` : ''}</span>
                {v.late > 0 ? <span className="cy-late">{v.late} day{v.late === 1 ? '' : 's'} late</span>
                  : next && <span>Next period ~ <b>{fmtDay(next.start)}</b> <span className="pl-muted">(in {diffDays(c.todayKey, next.start)} days)</span></span>}
                {next && <span className="pl-muted" style={{ fontSize: 13 }}>Fertile {fmtDay(next.fertileStart, { day: 'numeric', month: 'short' })}–{fmtDay(next.fertileEnd, { day: 'numeric', month: 'short' })} · ovulation ~ {fmtDay(next.ovulation, { day: 'numeric', month: 'short' })}</span>}
                {s.irregular && <span className="pl-muted" style={{ fontSize: 12 }}>Your recent cycles vary a fair bit (±{s.stdDev} days), so these dates are rougher.</span>}
              </div>
            </div>
            <div className="pl-row">
              {v.inPeriod
                ? <Button block onClick={() => void endToday()} disabled={busy || v.inPeriod.end <= c.todayKey && v.inPeriod.end !== c.todayKey}><Check /> Period ended today</Button>
                : <Button block primary onClick={() => void startToday()} disabled={busy}><Droplet /> Period started today</Button>}
              <Link to={`/cycle/log/${c.todayKey}`} className="pl-btn">Log today</Link>
            </div>
          </div>
        )}
      </Card>

      {note && (
        <Card className="pl-row" style={{ padding: '10px 14px' }}>
          <p className="pl-muted pl-grow" style={{ fontSize: 13 }}>Predictions are estimates from your history — not medical advice.</p>
          <Button small ghost onClick={() => setNote(false)}>OK</Button>
        </Card>
      )}

      <Card className="pl-stack">
        <Segmented value={mode} options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} onChange={setMode} />
        {mode === 'month'
          ? <MonthGrid ym={ym} marks={c.marks} logs={c.logs} todayKey={c.todayKey} onPrev={() => setYm(shiftMonth(ym, -1))} onNext={() => setYm(shiftMonth(ym, 1))} />
          : (
            <div className="pl-stack">
              <div className="pl-row">
                <Button small ghost onClick={() => setYear(year - 1)}>‹ {year - 1}</Button>
                <b className="pl-grow" style={{ textAlign: 'center', fontFamily: 'var(--serif)', fontSize: 17 }}>{year}</b>
                <Button small ghost onClick={() => setYear(year + 1)}>{year + 1} ›</Button>
              </div>
              <YearGrid year={year} marks={c.marks} todayKey={c.todayKey} onPick={m => { setYm(m); setMode('month'); }} />
            </div>
          )}
        {(ym !== monthKey(c.todayKey) || year !== Number(c.todayKey.slice(0, 4))) && (
          <Button small ghost onClick={() => { setYm(monthKey(c.todayKey)); setYear(Number(c.todayKey.slice(0, 4))); }}>↓ Back to today</Button>
        )}
        <Legend />
      </Card>
      {toast}
    </Page>
  );
}
