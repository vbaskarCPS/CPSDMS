// src/planner/features/habits/SlotHabits.tsx — the habits stacked before/after one slot of the routine,
// shown inside that slot on Today, tickable there. One shared load for the whole timeline.
import { createContext, useContext, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useHabits } from './useHabits';

type Ctx = ReturnType<typeof useHabits> | null;
const HabitsCtx = createContext<Ctx>(null);
export function SlotHabitsProvider({ children }: { children: ReactNode }) { return <HabitsCtx.Provider value={useHabits()}>{children}</HabitsCtx.Provider>; }

export function SlotHabits({ block, when }: { block: string; when: 'before' | 'after' }) {
  const ctx = useContext(HabitsCtx);
  if (!ctx) return null;
  const { active, logs, today, mark } = ctx;
  const dow = new Date().getDay();
  const list = active.filter(h => h.anchor?.block === block && h.anchor.when === when && (!h.days?.length || h.days.includes(dow)));
  if (!list.length) return null;
  const log = logs[today] || {};
  return (
    <div className="today-slot-habits">
      {list.map(h => {
        const m = log[h.id];
        return (
          <div key={h.id} className={`today-slot-habit ${m === 'done' ? 'is-done' : m ? 'is-part' : ''}`}>
            <button type="button" className={`pl-check ${m === 'done' ? 'is-on' : ''}`} aria-label={m === 'done' ? 'Undo' : 'Done'} onClick={() => void mark(h.id, m === 'done' ? undefined : 'done')}><Check /></button>
            <Link to={`/habits/${h.id}`} className="pl-grow"><small>{when} · </small><b>{h.name}</b>{h.auto && <small> · ticks itself</small>}</Link>
          </div>
        );
      })}
    </div>
  );
}
