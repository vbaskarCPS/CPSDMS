// The routine reminders (supabase/functions/planner-push/reminders.ts), and how a day's own changes to the routine
// (Day.adjust) change them: nothing for a skipped block, moved times, one for each block added to the day.
import { describe, expect, it } from 'vitest';
import { dueReminders, NIGHT_ROUTINE, MORNING_ROUTINE, plannerDayKey, reminders } from '../../../supabase/functions/planner-push/reminders';

// Toronto, 11 November 2026 (EST, UTC-5)
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 11, h + 5, m));
const due = (h: number, m: number, day: Record<string, unknown> = {}, log: Record<string, string> = {}, r = NIGHT_ROUTINE) => dueReminders(r, at(h, m), log, day).map(x => `${x.id}: ${x.body}`);
const sick = { adjust: { why: 'Sick day', skip: ['gym', 'sauna'], times: { wake: '07:00' },
  added: [{ id: 's1', at: '07:00', label: 'Home stretch', note: 'easy, 20 min' }, { id: 'b1', at: '07:30', label: 'Breakfast' }] } };

describe('routine reminders', () => {
  it('a normal day of the 5 am club', () => {
    expect(due(5, 0)).toEqual(['wake: 5 am. Up — straight to the gym, no snooze.']);
    expect(due(5, 12)).toEqual([]);                                             // only within ten minutes of its time
    expect(due(6, 20)[0]).toMatch(/^sauna: Sauna: look back at yesterday/);
    expect(due(13, 30)).toEqual(['kitchen: Kitchen closes at 2:00 pm — 30 minutes.']);
    expect(due(21, 15)).toEqual(['lightsOut: Lights out at 9:30 pm — up at 5:00 am.']);
    expect(due(5, 0, { ticks: { up: '04:55' } })).toEqual([]);                  // already up
    expect(due(5, 0, {}, { wake: 'sent' })).toEqual([]);                         // already sent today
    expect(plannerDayKey(at(2, 0))).toBe('2026-11-10');                          // 2 am still belongs to the day before
  });
  it('a sick day: nothing at 5, up at 7 with no gym, the stretch and breakfast at their times, no sauna', () => {
    expect(due(5, 0, sick)).toEqual([]);
    expect(due(6, 20, sick)).toEqual([]);
    expect(due(7, 0, sick)).toEqual(['wake: 7 am. Up. Sick day: no gym this morning.', 'x:s1: 7:00 am · Home stretch — easy, 20 min']);
    expect(due(7, 15, sick)).toEqual(["sauna: Look back at yesterday, plan the protein road, then today's Brief → the list."]);
    expect(due(7, 30, sick)).toEqual(['x:b1: 7:30 am · Breakfast']);
    expect(due(21, 15, sick)).toEqual(['lightsOut: Lights out at 9:30 pm — up at 5:00 am.']);   // tomorrow is a normal day
    const done = { adjust: { ...sick.adjust, added: [{ ...sick.adjust.added[0], done: '07:02' }, sick.adjust.added[1]] } };
    expect(due(7, 5, done, { wake: 'sent' })).toEqual([]);                       // the stretch is ticked: no nudge
  });
  it('moved times and a dropped cut-off', () => {
    expect(due(22, 15, { adjust: { times: { lightsOut: '22:30' } } })).toEqual(['lightsOut: Lights out at 10:30 pm — up at 5:00 am.']);
    expect(due(21, 15, { adjust: { times: { lightsOut: '22:30' } } })).toEqual([]);
    expect(due(13, 30, { adjust: { skip: ['kitchen'] } })).toEqual([]);
    expect(due(14, 30, { adjust: { times: { kitchenClose: '15:00' } } })).toEqual(['kitchen: Kitchen closes at 3:00 pm — 30 minutes.']);
  });
  it('the gym moved to the evening: no gym in the wake-up, a nudge before it', () => {
    const day = { adjust: { times: { gym: '17:00' } } };
    expect(due(5, 0, day)).toEqual(["wake: 5 am. Up. No gym this morning — it's at 5:00 pm."]);
    expect(due(16, 45, day)).toEqual(['gym: Gym at 5:00 pm today.']);
    expect(due(16, 45, { ...day, ticks: { gym: '16:40' } })).toEqual([]);
  });
  it("Rosh's day, and a morning without the Miracle Morning", () => {
    expect(reminders(MORNING_ROUTINE, 'roshplanner').map(x => x.id)).toEqual(['wake', 'evening', 'bed']);
    expect(due(6, 30, { adjust: { skip: ['morning'], times: { wake: '06:30' } } }, {}, MORNING_ROUTINE)).toEqual(['wake: Morning. An easy start today, then the Brief.']);
    expect(reminders(MORNING_ROUTINE, 'roshplanner', { skip: ['evening'] }).map(x => x.id)).toEqual(['wake', 'bed']);
  });
});
