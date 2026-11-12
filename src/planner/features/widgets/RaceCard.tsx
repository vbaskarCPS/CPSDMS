// src/planner/features/widgets/RaceCard.tsx — a race timer on Today: how long it took today to get from one thing to
// the next ("Up to first set": from ticking Up to the first set done in the gym), against the person's best.
// While it's on, a big clock counts up from the stored start (so a phone that sleeps, or the planner closed and opened
// again, loses nothing), with the best beside it and how far ahead or behind it is right now. After the finish: today's
// time, "New best!" when it is, and the days in a row faster than the average. Tap it for the last 30 days, where a
// wrong day can be taken off. The sums are in race.ts; the times are kept by raceStore.ts.
import { useEffect, useMemo, useState } from 'react';
import { Play, Square, Timer, Trash2 } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { Sheet } from '../../ui/primitives';
import { addDays } from '../plan/dates';
import type { Day } from '../plan/types';
import { byHand, clockOf, isNewBest, LIVE_MAX, liveView, RACES, wordsOf, type Lap } from './race';
import { useRace, WINDOW } from './raceStore';
import type { Race } from './widgets';

/** Now, once a second while `on` and the page is in sight; not at all otherwise. Coming back into sight it's read
 *  again at once, so the clock is right straight away. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    let id = 0;
    const run = () => {
      window.clearInterval(id);
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      id = window.setInterval(() => setNow(Date.now()), 1000);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, [on]);
  return now;
}

const shortDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

/** `live` = today's day from the Today screen, so a tick there shows at once. */
export function RaceCard({ w, small, live }: { w: Race; small: boolean; live?: { key: string; day: Day } | null }) {
  const r = useRace(w, live);
  const [open, setOpen] = useState(false);
  const hand = byHand(w.race), today = dayKey();
  const running = !!r.start && !r.finish;
  const now = useNow(running);
  const late = running && !hand && now - r.start!.at > LIVE_MAX;     // Up ticked hours ago and no gym: not a race today
  const best = r.board.best;
  // the best before today, to race against (today's own time can't be the target while it's on)
  const before = useMemo(() => {
    const prior = r.laps.filter(l => l.day < r.runDay);
    return prior.length ? prior.reduce((b, l) => (l.ms < b.ms ? l : b)) : null;
  }, [r.laps, r.runDay]);
  const mine = r.laps.find(l => l.day === today);
  const fresh = !!mine && isNewBest(r.laps, today);
  const lv = running && !late ? liveView(r.start!.at, now, before?.ms ?? null) : null;

  let big = '', line = '', tone = '';
  if (!r.loaded && r.trouble !== 'load') { big = '…'; }
  else if (r.removed) { big = '–'; line = 'Taken off today’s board'; }
  else if (r.rest) { big = '–'; line = 'Rest day. No race today'; }
  else if (lv) { big = lv.text; line = lv.ahead === null ? 'First race: set the time to beat' : lv.word; tone = lv.ahead === null ? '' : lv.ahead >= 0 ? 'is-ahead' : 'is-behind'; }
  else if (late) { big = '–'; line = 'No finish yet today. Not raced'; }
  else if (mine) { big = clockOf(mine.ms); line = fresh ? 'New best!' : best && best.day !== today ? `${clockOf(mine.ms - best.ms)} off your best` : 'Your first time on the board'; tone = fresh ? 'is-best' : ''; }
  else { big = '0:00'; line = hand ? 'Tap Start when you begin' : RACES[w.race].waiting || ''; tone = 'is-idle'; }
  const said = `${w.title}: ${lv ? `${wordsOf(lv.ms)} so far${lv.word ? `, ${lv.word}` : ''}` : mine && !lv ? `today ${wordsOf(mine.ms)}${fresh ? ', a new best' : ''}` : line}${best ? `. Best ${wordsOf(best.ms)}` : ''}. Open the last ${WINDOW} days`;

  return (
    <section className={`pl-card wg-race ${small ? 'is-small' : ''} ${running && !late ? 'is-on' : ''} ${tone}`}>
      <button type="button" className="wg-race__open" aria-label={said} onClick={() => setOpen(true)}>
        <span className="wg-race__head">
          <Timer aria-hidden />
          <b className="wg-race__title">{w.title}</b>
          {best && !small && <span className="wg-race__best">Best {clockOf((before && running ? before : best).ms)}</span>}
        </span>
        <span className="wg-race__clock" aria-hidden>
          <b className={`wg-race__big ${big.length > 5 ? 'is-long' : ''}`}>{big}</b>
          {mine?.approx && !lv && <small className="wg-race__approx" title="About: this day’s time isn’t exact">about</small>}
        </span>
        {lv && lv.ahead !== null && <span className="wg-race__bar" aria-hidden><i style={{ width: `${Math.round(lv.fill * 100)}%` }} /></span>}
        <span className="wg-race__line" aria-hidden>
          {tone === 'is-best' && <span className="wg-race__burst" aria-hidden>{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>}
          {line}
        </span>
        {!small && !lv && mine && (best || r.board.streak > 0) && (
          <span className="wg-race__more" aria-hidden>
            {best && best.day !== today && `Best ${clockOf(best.ms)}`}{best && best.day !== today && r.board.streak > 0 ? ' · ' : ''}
            {r.board.streak > 0 && `${r.board.streak} ${r.board.streak === 1 ? 'day' : 'days'} in a row faster than your average`}
          </span>
        )}
        {small && best && <span className="wg-race__more" aria-hidden>Best {clockOf(best.ms)}</span>}
      </button>
      {hand && r.loaded && !r.removed && (!r.start ? (
        <button type="button" className="pl-btn pl-btn--primary wg-race__go" onClick={r.begin}><Play aria-hidden /> Start</button>
      ) : running ? (
        <div className="wg-race__acts">
          <button type="button" className="pl-btn pl-btn--primary wg-race__go" onClick={r.stop}><Square aria-hidden /> Stop</button>
          <button type="button" className="pl-btn pl-btn--ghost wg-race__go" onClick={r.cancel}>Cancel</button>
        </div>
      ) : null)}
      {r.trouble === 'load' && <small className="pl-error">Couldn’t load the times. Check the connection.</small>}
      {r.trouble === 'save' && <small className="pl-error">Not saved yet. Check the connection.</small>}
      <Sheet open={open} onClose={() => setOpen(false)} title={w.title}>
        {open && <RaceHistory laps={r.laps} board={r.board} today={today} hand={hand} ready={r.loaded} onRemove={r.remove} onClose={() => setOpen(false)} />}
      </Sheet>
    </section>
  );
}

/** The last 30 days: a bar a day (the best one marked, an approximate one striped), the average and the best, and a
 *  way to take a wrong day off. */
function RaceHistory({ laps, board, today, hand, ready, onRemove, onClose }: { laps: Lap[]; board: ReturnType<typeof useRace>['board']; today: string; hand: boolean; ready: boolean; onRemove: (day: string) => void; onClose: () => void }) {
  const [asking, setAsking] = useState<string | null>(null);
  const days = Array.from({ length: WINDOW }, (_, i) => addDays(today, i - WINDOW + 1));
  const by = new Map(laps.map(l => [l.day, l]));
  const top = Math.max(1, ...laps.map(l => l.ms));
  const list = [...laps].sort((a, b) => b.day.localeCompare(a.day));
  return (
    <div className="pl-stack wg-rh">
      {!laps.length ? <p className="pl-muted">No times yet. {hand ? 'Tap Start, then Stop, and your first one shows here.' : 'Tick I’m up, then your first set in the gym, and your first one shows here.'}</p> : (
        <>
          <div className="wg-rh__chart" role="img" aria-label={`The last ${WINDOW} days: ${laps.length} raced. Best ${wordsOf(board.best!.ms)}, average ${wordsOf(board.average!)}`}>
            {days.map(d => {
              const l = by.get(d);
              return <span key={d} className={`wg-rh__col ${l ? '' : 'is-none'} ${l && board.best?.day === d ? 'is-best' : ''} ${l?.approx ? 'is-approx' : ''} ${d === today ? 'is-today' : ''}`}>
                <i style={l ? { height: `${Math.max(6, Math.round((l.ms / top) * 100))}%` } : undefined} />
              </span>;
            })}
            {board.average !== null && <span className="wg-rh__avg" style={{ bottom: `${Math.round((board.average / top) * 100)}%` }} aria-hidden />}
          </div>
          <div className="wg-rh__axis pl-muted" aria-hidden><span>{shortDay(days[0])}</span><span>Today</span></div>
          <div className="wg-rh__stats">
            <div><small className="pl-muted">Best</small><b>{clockOf(board.best!.ms)}</b><small className="pl-muted">{shortDay(board.best!.day)}</small></div>
            <div><small className="pl-muted">Average</small><b>{clockOf(board.average!)}</b><small className="pl-muted">{laps.length} {laps.length === 1 ? 'day' : 'days'}</small></div>
            <div><small className="pl-muted">In a row</small><b>{board.streak}</b><small className="pl-muted">faster than average</small></div>
          </div>
          <p className="pl-muted wg-rh__key"><i className="wg-rh__sw is-best" aria-hidden /> best · <i className="wg-rh__sw is-approx" aria-hidden /> about (from an older version, not exact) · the line is your average</p>
          <ul className="wg-rh__list" aria-label="Each day">
            {list.map(l => (
              <li key={l.day}>
                <div className="wg-rh__row">
                  <span className="pl-grow">{l.day === today ? 'Today' : shortDay(l.day)}</span>
                  <b>{l.approx ? 'about ' : ''}{clockOf(l.ms)}</b>
                  {board.best?.day === l.day && <span className="pl-chip wg-rh__tag">Best</span>}
                  <button type="button" className="wg-rh__bin" aria-label={`Take ${l.day === today ? 'today' : shortDay(l.day)} off`} disabled={!ready} onClick={() => setAsking(a => (a === l.day ? null : l.day))}><Trash2 aria-hidden /></button>
                </div>
                {asking === l.day && (
                  <div className="wg-rh__ask" role="group" aria-label="Take this day off?">
                    <small>Take this day off? {hand ? 'It goes from your times.' : 'Use it when a tick was wrong (Up forgotten, a set ticked late). It won’t be counted again.'}</small>
                    <button type="button" className="pl-btn pl-btn--small pl-btn--danger wg-tap" onClick={() => { onRemove(l.day); setAsking(null); }}>Take it off</button>
                    <button type="button" className="pl-btn pl-btn--small pl-btn--ghost wg-tap" onClick={() => setAsking(null)}>Keep it</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="pl-btn pl-btn--block wg-tap" onClick={onClose}>Done</button>
    </div>
  );
}
