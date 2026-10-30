// /cycle/history — every cycle tracked, newest first, and the averages.
import { Fragment } from 'react';
import { Page, Header, Card, Stat, Bars, Empty } from '../../ui/primitives';
import { useCycle } from './useCycle';
import { cycles } from './predict';
import { fmtDay } from './dates';

export function History() {
  const c = useCycle();
  const cs = cycles(c.periods);
  const newest = [...cs].reverse();
  const valid = cs.filter(x => x.cycleDays !== null);
  const last12 = valid.slice(-12);
  const s = c.stats;
  const flo = c.periods.filter(p => p.source === 'flo').length;
  const avgPeriod = cs.length ? Math.round((cs.reduce((a, x) => a + x.periodDays, 0) / cs.length) * 10) / 10 : null;
  return (
    <Page>
      <Header back="/cycle" eyebrow="Cycle" title="History" />
      {!cs.length ? <Card><Empty title="Nothing tracked yet" blurb="Log a period and it shows up here." /></Card> : (
        <>
          <div className="pl-stats">
            <Stat label="Average cycle" value={s.cycleLength} sub={s.usedOverride.cycle ? 'set by you' : `median of last ${c.prefs.useLast}`} />
            <Stat label="Average period" value={avgPeriod ?? '–'} sub="days" />
            <Stat label="Shortest · longest" value={s.shortest !== null ? `${s.shortest} · ${s.longest}` : '–'} sub="days" />
            <Stat label="Variation" value={`±${s.stdDev}`} sub={s.irregular ? 'irregular' : 'fairly regular'} tone={s.irregular ? 'amber' : 'good'} />
            <Stat label="Cycles tracked" value={valid.length} sub={`${cs.length} periods`} />
            {flo > 0 && <Stat label="From Flo" value={flo} sub="imported" />}
          </div>
          {last12.length > 1 && (
            <Card>
              <h3 style={{ marginBottom: 6 }}>Cycle length, last {last12.length}</h3>
              <Bars values={last12.map(x => x.cycleDays as number)} max={Math.max(45, ...last12.map(x => x.cycleDays as number))} labels={last12.map(x => fmtDay(x.start, { month: 'short' }))} />
            </Card>
          )}
          <Card>
            <div className="cy-hist">
              <span className="cy-hist__h">Started</span><span className="cy-hist__h">Period</span><span className="cy-hist__h">Cycle</span>
              {newest.map(x => (
                <Fragment key={x.start}>
                  <span>{fmtDay(x.start, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span>{x.periodDays} d</span>
                  <span className={x.cycleDays === null ? 'pl-muted' : ''}>{x.cycleDays === null ? (x.next ? 'gap' : '—') : `${x.cycleDays} d`}</span>
                </Fragment>
              ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
