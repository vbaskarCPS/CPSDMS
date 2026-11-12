// The routine reminders (supabase/functions/planner-push/reminders.ts), and how a day's own changes to the routine
// (Day.adjust) change them: nothing for a skipped block, moved times, one for each block added to the day.
import { describe, expect, it } from 'vitest';
import { dueReminders, NIGHT_ROUTINE, MORNING_ROUTINE, plannerDayKey, reminderList, reminders } from '../../../supabase/functions/planner-push/reminders';

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
  it('Rosh with no morning routine at all (her choice in the set-up): up, then the Brief, opening Today', () => {
    const none = { ...MORNING_ROUTINE, wake: '08:00', stretchMin: 0, meditateMin: 0, workoutMin: 0 };
    expect(due(8, 0, {}, {}, none)).toEqual(['wake: Morning. Up, then the Brief.']);
    expect(reminders(none, 'roshplanner')[0].url).toBe('/roshplanner/');
    expect(reminders(MORNING_ROUTINE, 'roshplanner')[0]).toMatchObject({ body: 'Morning. Stretch, breathe, move — then the Brief.', url: '/roshplanner/plan/morning' });
    expect(due(5, 30, {}, {}, { ...MORNING_ROUTINE, meditateMin: 0, workoutMin: 0 })).toEqual(['wake: Morning. Stretch, breathe, move — then the Brief.']);   // a stretch alone is still a routine
  });
});

describe('a reminder switched off (Settings: no notification, the block stays)', () => {
  const ids = (r: typeof NIGHT_ROUTINE, app: 'vijayplanner' | 'roshplanner' = 'vijayplanner', a?: Parameters<typeof reminders>[2]) => reminders(r, app, a).map(x => x.id);
  it('each of his reminders can be switched off on its own', () => {
    const all = ids(NIGHT_ROUTINE);
    expect(all).toEqual(['wake', 'sauna', 'kitchen', 'window', 'lightsOut']);
    for (const id of all) expect(ids({ ...NIGHT_ROUTINE, quiet: [id] })).toEqual(all.filter(x => x !== id));
    expect(due(6, 20, {}, {}, { ...NIGHT_ROUTINE, quiet: ['sauna'] })).toEqual([]);
    expect(ids({ ...NIGHT_ROUTINE, quiet: ['gym'] }, 'vijayplanner', { times: { gym: '17:00' } })).not.toContain('gym');   // the late-gym nudge too
  });
  it('and each of hers', () => {
    for (const id of ['wake', 'evening', 'bed']) expect(ids({ ...MORNING_ROUTINE, quiet: [id] }, 'roshplanner')).toEqual(['wake', 'evening', 'bed'].filter(x => x !== id));
  });
  it('names that are not reminders are ignored, and an old routine without the list sends everything', () => {
    expect(ids({ ...NIGHT_ROUTINE, quiet: ['nap', '', 'x:s1'] })).toEqual(ids(NIGHT_ROUTINE));
    expect(ids({ ...NIGHT_ROUTINE, quiet: 'sauna' as unknown as string[] })).toEqual(ids(NIGHT_ROUTINE));
    expect(ids({ ...NIGHT_ROUTINE, quiet: [3, null] as unknown as string[] })).toEqual(ids(NIGHT_ROUTINE));
    const old: Record<string, unknown> = { ...NIGHT_ROUTINE }; delete old.quiet;
    expect(ids(old as unknown as typeof NIGHT_ROUTINE)).toEqual(['wake', 'sauna', 'kitchen', 'window', 'lightsOut']);
  });
  it('a block added for the day keeps its reminder', () => {
    const r = { ...NIGHT_ROUTINE, quiet: ['wake', 'sauna', 'kitchen', 'window', 'lightsOut', 's1', 'x:s1'] };
    expect(ids(r, 'vijayplanner', sick.adjust)).toEqual(['x:s1', 'x:b1']);
  });
  it('the Settings list is the same reminders, by name and time, switched off ones included', () => {
    const r = { ...NIGHT_ROUTINE, quiet: ['sauna'] };
    expect(reminderList(r, 'vijayplanner')).toEqual([
      { id: 'wake', name: 'Up', at: '05:00', on: true },
      { id: 'sauna', name: 'Sauna and the Brief', at: '06:20', on: false },
      { id: 'kitchen', name: 'Kitchen closes', at: '13:30', on: true },
      { id: 'window', name: 'Eating window', at: '17:45', on: true },
      { id: 'lightsOut', name: 'Lights out', at: '21:15', on: true },
    ]);
    expect(reminderList(r, 'vijayplanner').map(x => x.id)).toEqual(reminders({ ...r, quiet: [] }, 'vijayplanner').map(x => x.id));
    expect(reminderList(MORNING_ROUTINE, 'roshplanner').map(x => `${x.name} ${x.at}`)).toEqual(['Up 05:30', 'Evening review 20:30', 'Lights out 20:50']);
    expect(reminderList({ ...NIGHT_ROUTINE, lightsOut: '00:30' }, 'vijayplanner').slice(-1)[0].at).toBe('00:15');   // after midnight
  });
});
