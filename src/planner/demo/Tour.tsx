// src/planner/demo/Tour.tsx — the guided demo at /demo: a card above the nav that walks through the
// planner in about four minutes, moving the app from page to page. Sample data, nothing saved (store.ts).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pause, Play, X, RotateCcw } from 'lucide-react';
import { resetDemo } from './store';

interface Step { to: string; title: string; text: string; secs: number; scroll?: string }

const STEPS: Step[] = [
  { to: '/', title: 'Welcome to the planner', secs: 14, text: "A four-minute tour on sample data — tap anything, nothing is saved. This is Today: one timeline from waking up to lights out, with the streaks that matter at the top." },
  { to: '/', scroll: '.today-block.is-now', title: 'It knows what time it is', secs: 18, text: "The routine is built around a real day — Bed Brief at 8:30, fast until dinner at 6, gym at 9, sauna, shake, hard stop at 12:45. The current block is highlighted; one tap marks it done and the habits stacked before or after it tick themselves." },
  { to: '/', scroll: '.today-prios', title: 'The day between Brief and dinner', secs: 16, text: "The work block holds the to-do list the morning Brief built, in the order you'll tackle it. Starred items are the must-dos; items with a time move up when the clock says so." },
  { to: '/plan/brief', title: 'Bed Brief', secs: 22, text: "Ten minutes before getting up: a word for the day, where you'll bring your A-game, the stress you expect and your answer to it. Once Coach Claude has seen a few Briefs it starts suggesting — and the last step turns the answers into today's list." },
  { to: '/plan', title: "Today's list", secs: 18, text: "Drag items into your order, star the must-dos, give anything time-sensitive a time. Things you add often — daycare, the invoice — come back as one-tap suggestions. Scores and the Brief sit alongside." },
  { to: '/habits', title: 'Habits with implementation intentions', secs: 18, text: "Each habit has an identity, a cue, a two-minute version and a place in the routine: 'after the shake, read 10 pages'. Coach Claude designs them from a sentence, and the ones tied to a block record themselves." },
  { to: '/workout', title: 'Train: today is done', secs: 24, text: "Tonight's full-body session is complete, so Coach Claude has written its review — what moved, what to watch — and asks two quick questions. Tomorrow is already set up as a 45-minute mobility night because of the tight hip, and Thursday's lifts are prefilled from tonight's numbers." },
  { to: '/workout', scroll: '.wo-hero__list', title: 'Tap any move', secs: 14, text: "Don't know a stretch? Tap it: a plain description, a mind-muscle tip, and short videos under a minute for each move in a flow — nothing to sit through mid-workout." },
  { to: '/workout/coach', title: 'Coach Claude', secs: 20, text: "Every chat box in the planner is Coach Claude, and it sees everything — Briefs, habits, meals, every set, your notes on goals and old injuries. Ask about a plan and it answers from your data; one button makes that plan today's or tomorrow's session." },
  { to: '/food', title: 'Food', secs: 18, text: "The fast runs to dinner; after that, a photo of the plate becomes calories and protein with a confidence level. Targets, favourites and the late shake all count toward the day." },
  { to: '/calendar', title: 'A shared calendar', secs: 14, text: "One calendar for Vijay and Rosh — Kiaan's swim lesson, dinner at Mum's, repeating gym nights — visible from both planners and on the Today page when something's coming up." },
  { to: '/shop', title: 'Shopping, organised by the flyers', secs: 22, text: "Either of you adds to the list; the planner checks this week's flyers for the stores nearby and sorts the list by where each thing is cheapest — or the everyday price when nothing's on sale. Switch to By section to walk the store, or let it pick the best single trip. The grocers with no flyer get Coach Claude's suggestions instead." },
  { to: '/plan/sauna', title: 'The sauna', secs: 20, text: "Straight from the gym: a sauna timer, the day's meal plan (the road to 180 g protein: two meals and a couple of shakes, eaten by 2 pm), then today's Brief, which becomes the to-do list." },
  { to: '/settings', title: 'It gets to know you', secs: 18, text: "Settings hold the routine times and the reminders — and 'Tell Coach Claude', notes it keeps for good: the day you started, how you train, what hurts. That's the planner. Open yours, or start the tour again." },
];

export function Tour() {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [left, setLeft] = useState(STEPS[0].secs);
  const started = useRef(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // the page follows the step, then scrolls to its anchor
  useEffect(() => {
    nav(step.to);
    const t = setTimeout(() => {
      const el = step.scroll ? document.querySelector(step.scroll) : null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 350);
    setLeft(step.secs);
    started.current = Date.now();
    return () => clearTimeout(t);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // autoplay: count down, move on; the last step waits
  useEffect(() => {
    if (!playing || last) return;
    const id = setInterval(() => {
      setLeft(l => {
        if (l <= 1) { setI(n => Math.min(n + 1, STEPS.length - 1)); return 0; }
        return l - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, last, i]);

  // poking the app pauses the tour so the page can be explored
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.pl-tour')) setPlaying(false); };
    document.addEventListener('pointerdown', onDown);
    document.body.classList.add('pl-demo');
    return () => { document.removeEventListener('pointerdown', onDown); document.body.classList.remove('pl-demo'); };
  }, []);

  const pct = last ? 100 : Math.round((1 - left / step.secs) * 100);
  const exit = () => { location.href = '/vijayplanner/'; };
  const restart = () => { resetDemo(); setPlaying(true); setI(0); nav('/'); };

  return (
    <aside className="pl-tour" aria-label="Guided demo">
      <div className="pl-tour__bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="pl-tour__head">
        <span className="pl-tour__step">Demo · {i + 1} / {STEPS.length}</span>
        <button type="button" className="pl-tour__icon" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause /> : <Play />}</button>
        <button type="button" className="pl-tour__icon" onClick={exit} aria-label="Exit demo"><X /></button>
      </div>
      <b className="pl-tour__title">{step.title}</b>
      <p className="pl-tour__text">{step.text}</p>
      <div className="pl-tour__nav">
        <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" onClick={() => { setPlaying(false); setI(n => Math.max(0, n - 1)); }} disabled={i === 0}><ChevronLeft /> Back</button>
        {last
          ? <><button type="button" className="pl-btn pl-btn--small pl-btn--ghost" onClick={restart}><RotateCcw /> Start over</button><a className="pl-btn pl-btn--small pl-btn--primary" href="/vijayplanner/">Open your planner</a></>
          : <button type="button" className="pl-btn pl-btn--small pl-btn--primary" onClick={() => setI(n => n + 1)}>Next <ChevronRight /></button>}
      </div>
    </aside>
  );
}
