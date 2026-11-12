// src/planner/features/habits/ticked.ts — "a habit was just ticked": said once the tick is saved, whether it was made by
// hand in one of the blocks (useHabits) or by itself (auto.ts). A block that shows the same days from its own copy can
// listen and read them again: the habit tracker on Today does (features/widgets). The blocks that were here before
// don't listen, so they behave as they always did.
const heard = new Set<() => void>();
export function onHabitTicked(fn: () => void): () => void { heard.add(fn); return () => { heard.delete(fn); }; }
export function habitTicked(): void { for (const fn of [...heard]) { try { fn(); } catch { /* that block shows its own error */ } } }
