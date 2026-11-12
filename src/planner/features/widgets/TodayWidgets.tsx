// src/planner/features/widgets/TodayWidgets.tsx — Today's blocks, drawn in the person's own order (widgets.ts, store.ts).
// screens/Today.tsx hands over its blocks by name, exactly as it has always built them; this decides which show, in what
// order and at what size, and slots in the ones the person added (a countdown, a note, the mini calendar, the habit
// tracker, a race timer: it's handed today's day page as the screen has it, so a tick shows on it at once). For someone who never arranged anything it draws the same blocks in the same order with nothing around
// them, so their Today is what it was.
import { Component, Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import type { Profile } from '../../lib/app';
import { COMPACT } from './Compact';
import { CountdownCard } from './Countdown';
import { HabitWeekCard } from './HabitWeek';
import { MonthCard } from './Month';
import { NoteCard } from './Note';
import { RaceCard } from './RaceCard';
import type { Day } from '../plan/types';
import { useWidgets } from './store';
import { arrange, change, EMPTY, remove, rows, untouched, type Item, type TodayBlockId } from './widgets';

/** The person's arrangement, worked out for Today. `compact(id)` = that block is set to its compact size. */
export function useTodayWidgets(pass: PlannerPass, profile: Profile) {
  const uid = pass.user.id;
  const { prefs, loaded, change: save } = useWidgets(uid);
  return useMemo(() => {
    // whatever is in the saved arrangement, Today draws: anything unexpected and it's the original page
    let items: Item[], asEver: boolean;
    try { items = arrange(prefs, profile); asEver = untouched(prefs, profile); } catch { items = arrange(EMPTY, profile); asEver = true; }
    return { uid, loaded, save, rows: rows(items), untouched: asEver, compact: (id: TodayBlockId) => items.some(i => i.id === id && i.on && i.size === 'compact') };
  }, [uid, prefs, profile, loaded, save]);
}

/** An added widget that breaks leaves a gap, not a broken Today. */
class Guard extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  render() { return this.state.broken ? null : this.props.children; }
}

/** `blocks` = every one of the planner's own blocks by name (one missing is a type error, so a block added to Today
 *  later can't be left out of the list). */
export function TodayWidgets({ widgets, blocks, day }: { widgets: ReturnType<typeof useTodayWidgets>; blocks: Record<TodayBlockId, ReactNode>; day?: { key: string; day: Day } | null }) {
  const { uid, loaded, save } = widgets;
  const draw = (it: Item): ReactNode => {
    if (it.block) {
      const Line = it.size === 'compact' ? COMPACT[it.block.id] : undefined;
      return Line ? <Line /> : blocks[it.block.id];
    }
    const w = it.added, small = it.size === 'compact';
    if (!w) return null;
    return (
      <Guard>
        {w.kind === 'countdown' ? <CountdownCard w={w} small={small} ready={loaded} onMove={date => save(p => change(p, { ...w, date }))} onRemove={() => save(p => remove(p, w.id))} />
          : w.kind === 'note' ? <NoteCard w={w} uid={uid} small={small} />
          : w.kind === 'month' ? <MonthCard small={small} />
          : w.kind === 'race' ? <RaceCard w={w} small={small} live={day} />
          : <HabitWeekCard />}
      </Guard>
    );
  };
  return (
    <>
      {widgets.rows.map(row => (row.length > 1
        ? <div key={row.map(i => i.id).join(' ')} className="wg-pair">{row.map(i => <Fragment key={i.id}>{draw(i)}</Fragment>)}</div>
        : <Fragment key={row[0].id}>{draw(row[0])}</Fragment>))}
      {!widgets.untouched && <Link to="/settings/widgets" className="wg-arrange"><LayoutGrid aria-hidden /> Arrange this page</Link>}
    </>
  );
}
