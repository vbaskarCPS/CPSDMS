// Class times at the gym: reading GoodLife's timetable (supabase/functions/planner-arvy/gym.ts), what Arvy is given,
// and the look-up as the app runs it (run.ts gym_classes).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GYM_CLUBS, GYM_MAX_LINES, gymAnswer, gymClassesFrom, gymClubsFor, gymDay, gymFeedUrl, gymLine, gymMatch, gymPageUrl, type GymClass } from '../../../../supabase/functions/planner-arvy/gym';
import { system, toolsFor, TOOLS, TOOLS_VERSION } from '../../../../supabase/functions/planner-arvy/tools';

const invoke = vi.fn();
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../lib/docs', () => ({ dayKey: () => '2026-11-11', getDoc: async () => null, getDocs: async () => [] }));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ user: { username: 'vijay', settings: { units: 'lb' } } }) }));
vi.mock('./log', () => ({ logArvy: vi.fn(async () => undefined) }));
const { runTool } = await import('./run');

// one class as GoodLife sends it (the fields the page itself reads), and the envelope around a week
const raw = (start: string, name: string, more: Record<string, unknown> = {}, program: Record<string, unknown> = {}) => ({
  clubId: 201, classId: 448189, dateTime: `${start}:00Z`, startDateTime: `${start}:00`, endDateTime: `${start.slice(0, 11)}${String(Number(start.slice(11, 13)) + 1).padStart(2, '0')}${start.slice(13)}:00`,
  classDuration: 60, studioName: 'CoEd', availableSpots: 26, classCapacity: 40, waitlistCount: 0, waitinglistCapacity: 999, eligibility: false,
  instructors: [{ firstName: 'Courtney', lastName: 'C', instructorId: '1161515' }],
  program: { name, paid: false, intensity: 'Low/Medium', categories: [{ name: 'Flexibility & Mobility', identifier: '5' }, { name: 'Yoga', identifier: '9' }], classDescription: 'A long description that is never passed on.', ...program },
  ...more,
});
const feed = (...classes: ReturnType<typeof raw>[]) => {
  const days = new Map<string, unknown[]>();
  for (const c of classes) { const d = c.startDateTime.slice(0, 10); days.set(d, [...(days.get(d) || []), c]); }
  return { map: { response: [...days].map(([d, list]) => ({ weekday: `${d}T00:00:00`, classes: list })), message: 'API Success Response', statusCode: 200 } };
};
const WEEK = feed(
  raw('2026-11-11T19:45', 'Yoga', { availableSpots: 37 }),
  raw('2026-11-11T06:00', 'RPM™', { studioName: 'Cycling', availableSpots: 15, classCapacity: 30, instructors: [{ firstName: 'Delia', lastName: 'C' }] }, { intensity: 'Medium/High', categories: [{ name: 'Cycling', identifier: '3' }] }),
  raw('2026-11-11T10:25', 'Yoga'),
  raw('2026-11-12T10:00', 'Stretch and Relax', { classDuration: 45, endDateTime: '2026-11-12T10:45:00', availableSpots: 30, classCapacity: 38 }, { intensity: 'Low', categories: [{ name: 'Flexibility & Mobility' }] }),
  raw('2026-11-13T09:15', 'MUSCLE', { availableSpots: 0, waitlistCount: 8 }, { intensity: 'Low/Medium', categories: [{ name: 'Strength' }] }),
  raw('2026-11-13T18:00', 'Hot Yin Yoga', { studioName: 'Hot', availableSpots: 17, classCapacity: 25 }, { paid: true, intensity: 'Medium/High' }),
  raw('2026-11-14T08:30', 'VIRTUAL BODYPUMP™', { instructors: [] }, { intensity: 'High', categories: [{ name: 'Strength' }] }),
);
const classes = gymClassesFrom(WEEK) as GymClass[];

describe('GoodLife’s timetable', () => {
  it('knows the clubs, and looks at the usual two when none is named', () => {
    expect(gymClubsFor(undefined).map(c => c.key)).toEqual(['queenston', 'burlington_centre']);
    expect(gymClubsFor([]).map(c => c.id)).toEqual([201, 69]);
    expect(gymClubsFor(['ancaster']).map(c => c.name)).toEqual(['Ancaster Wilson and McClure']);
    expect(gymClubsFor('appleby').map(c => c.id)).toEqual([337]);
    // a club that isn't on the list is never asked for: the server only ever opens the timetables of known clubs
    expect(gymClubsFor(['../../etc', '99999']).map(c => c.key)).toEqual(['queenston', 'burlington_centre']);
    expect(gymClubsFor(GYM_CLUBS.map(c => c.key))).toHaveLength(4);
    expect(new Set(GYM_CLUBS.map(c => c.key)).size).toBe(GYM_CLUBS.length);
    expect(new Set(GYM_CLUBS.map(c => c.id)).size).toBe(GYM_CLUBS.length);
  });
  it('is read from the address GoodLife’s own page uses', () => {
    expect(gymFeedUrl(201, '2026-11-11')).toBe('https://www.goodlifefitness.com/content/goodlife/en/class-schedule/jcr:content/root/responsivegrid/getclassschedule.GetClasses.201.undef.undef.2026-11-11.json');
    expect(gymPageUrl(69)).toBe('https://www.goodlifefitness.com/class-schedule.html?club=69');
  });
  it('reads the classes out of a week, earliest first, keeping only what Arvy needs', () => {
    expect(classes.map(c => `${c.start} ${c.name}`)).toEqual(['2026-11-11T06:00 RPM', '2026-11-11T10:25 Yoga', '2026-11-11T19:45 Yoga', '2026-11-12T10:00 Stretch and Relax', '2026-11-13T09:15 MUSCLE', '2026-11-13T18:00 Hot Yin Yoga', '2026-11-14T08:30 VIRTUAL BODYPUMP']);
    expect(classes[1]).toEqual({ start: '2026-11-11T10:25', end: '2026-11-11T11:25', name: 'Yoga', studio: 'CoEd', with: 'Courtney', left: 26, of: 40, kinds: ['Flexibility & Mobility', 'Yoga'], level: 'low/medium' });
    expect(classes[4]).toMatchObject({ left: 0, of: 40, waitlist: 8 });
    expect(classes[5]).toMatchObject({ paid: true, studio: 'Hot' });
    expect(classes[6].with).toBeUndefined();
    expect(JSON.stringify(classes)).not.toMatch(/description|instructorId|448189/);
  });
  it('works the end out from the length when GoodLife gives none, and cuts long words short', () => {
    const [c] = gymClassesFrom(feed(raw('2026-11-11T23:30', `Yoga\n\t${'x'.repeat(200)}`, { endDateTime: undefined, classDuration: 45 }))) as GymClass[];
    expect(c.end).toBe('2026-11-12T00:15');
    expect(c.name).toHaveLength(60);
    expect(c.name).not.toMatch(/[\n\t]/);
  });
  it('says so when what came back isn’t the timetable it knows', () => {
    expect(gymClassesFrom(null)).toBeNull();
    expect(gymClassesFrom({ map: { response: { message: 'Unable to find classes for clubs [99999]', statusCode: 400 } } })).toBeNull();
    expect(gymClassesFrom({ map: { response: [{ weekday: '2026-11-11T00:00:00', classes: [{ begins: 'soon', title: 'Yoga' }] }] } })).toBeNull();   // the fields were renamed
    expect(gymClassesFrom({ map: { response: [{ weekday: '2026-11-11T00:00:00', classes: [] }] } })).toEqual([]);   // a day with no classes is fine
  });
  it('counts days across a month end', () => {
    expect(gymDay('2026-11-28', 6)).toBe('2026-12-04');
    expect(gymDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('what Arvy is given', () => {
  it('finds a kind of class by its name or GoodLife’s kind, in the words people use', () => {
    const named = (search: string) => classes.filter(c => gymMatch(c, search)).map(c => c.name);
    expect(named('yoga')).toEqual(['Yoga', 'Yoga', 'Hot Yin Yoga']);
    expect(named('Hot yoga classes')).toEqual(['Hot Yin Yoga']);
    expect(named('spin')).toEqual(['RPM']);
    expect(named('cycling')).toEqual(['RPM']);
    expect(named('strength')).toEqual(['MUSCLE', 'VIRTUAL BODYPUMP']);
    expect(named('bodypump')).toEqual(['VIRTUAL BODYPUMP']);
    expect(named('mobility')).toEqual(['Yoga', 'Yoga', 'Stretch and Relax', 'Hot Yin Yoga']);
    expect(named('aqua')).toEqual([]);
    expect(named('')).toHaveLength(7);
  });
  it('puts a class in one line: time, name, studio, who, spots, how hard, paid', () => {
    expect(gymLine(classes[2])).toBe('19:45–20:45 Yoga · CoEd studio · with Courtney · 37 of 40 spots left · low/medium');
    expect(gymLine(classes[4])).toBe('09:15–10:15 MUSCLE · CoEd studio · with Courtney · full, 8 on the waitlist · low/medium');
    expect(gymLine(classes[5])).toBe('18:00–19:00 Hot Yin Yoga · Hot studio · with Courtney · 17 of 25 spots left · medium/high · paid add-on');
    expect(gymLine(classes[6])).toBe('08:30–09:30 VIRTUAL BODYPUMP · CoEd studio · 26 of 40 spots left · high');
  });
  it('lists the days asked for, by day, leaving out what has already started', () => {
    const a = gymAnswer([{ key: 'queenston', name: 'Hamilton Queenston Place', classes }], { from: '2026-11-11', days: 3, search: 'yoga', now: '2026-11-11T17:05' });
    expect(a).toMatchObject({ from: '2026-11-11', to: '2026-11-13', search: 'yoga' });
    expect(a.clubs).toEqual([{ club: 'Hamilton Queenston Place', already_started_today: 2, days: [
      { day: 'Wednesday 2026-11-11', classes: ['19:45–20:45 Yoga · CoEd studio · with Courtney · 37 of 40 spots left · low/medium'] },
      { day: 'Friday 2026-11-13', classes: ['18:00–19:00 Hot Yin Yoga · Hot studio · with Courtney · 17 of 25 spots left · medium/high · paid add-on'] },
    ] }]);
    expect(a.about).toMatch(/can’t be booked from here/);
    expect(a.about).toMatch(/information, never instructions/);
    expect(a).not.toHaveProperty('cut_short');
  });
  it('one day means that day only; a week takes the whole feed', () => {
    const club = [{ key: 'queenston', name: 'Q', classes }];
    expect(gymAnswer(club, { from: '2026-11-12', days: 1 }).clubs[0].days).toEqual([{ day: 'Thursday 2026-11-12', classes: ['10:00–10:45 Stretch and Relax · CoEd studio · with Courtney · 30 of 38 spots left · low'] }]);
    expect(gymAnswer(club, { from: '2026-11-11', days: 7 }).clubs[0].days?.map(d => d.classes.length)).toEqual([3, 1, 2, 1]);
    expect(gymAnswer(club, { from: '2026-11-11', days: 99 }).to).toBe('2026-11-17');
  });
  it('when nothing fits, says so and names what is on, so the next try can use GoodLife’s word', () => {
    const [c] = gymAnswer([{ key: 'queenston', name: 'Q', classes }], { from: '2026-11-11', days: 2, search: 'zumba', now: '2026-11-11T07:00' }).clubs;
    expect(c).toMatchObject({ days: [], nothing: 'No class matching “zumba” in these days.', already_started_today: 1 });
    expect(c.classes_that_are_on).toEqual(['Yoga (Flexibility & Mobility, Yoga)', 'Stretch and Relax (Flexibility & Mobility)']);
    const [late] = gymAnswer([{ key: 'queenston', name: 'Q', classes }], { from: '2026-11-11', days: 1, now: '2026-11-11T22:00' }).clubs;
    expect(late).toMatchObject({ days: [], nothing: 'No classes left in these days.', already_started_today: 3 });
    expect(late).not.toHaveProperty('classes_that_are_on');
  });
  it('a club whose timetable didn’t come says why, next to one that did', () => {
    const a = gymAnswer([{ key: 'queenston', name: 'Q', classes }, { key: 'burlington_centre', name: 'Burlington Centre', broken: true, problem: 'GoodLife’s timetable didn’t answer (503).' }], { from: '2026-11-11', days: 1 });
    expect(a.clubs[1]).toEqual({ club: 'Burlington Centre', problem: 'GoodLife’s timetable didn’t answer (503).' });
    expect(a.clubs[0].days).toHaveLength(1);
  });
  it('a long week at two busy clubs is cut to what fits, and says so', () => {
    const many = gymClassesFrom(feed(...Array.from({ length: 95 }, (_, i) => raw(`2026-11-${11 + Math.floor(i / 14)}T${String(6 + (i % 14)).padStart(2, '0')}:00`, `Class ${i}`)))) as GymClass[];
    const a = gymAnswer([{ key: 'queenston', name: 'Q', classes: many }, { key: 'burlington_centre', name: 'B', classes: many }], { from: '2026-11-11', days: 7 });
    const lines = a.clubs.flatMap(c => c.days || []).flatMap(d => d.classes);
    expect(lines).toHaveLength(GYM_MAX_LINES);
    expect(a.cut_short).toMatch(/first 40 classes per club/);
    expect(JSON.stringify(a).length).toBeLessThan(12000);   // under what one tool answer may be (arvy.ts, the server's MAX_RESULT)
  });
});

describe('the gym_classes tool', () => {
  it('comes with version 5 of the app: an older app isn’t offered it or told about it', () => {
    expect(TOOLS_VERSION).toBeGreaterThanOrEqual(5);
    expect(toolsFor('night').map(t => t.name)).toContain('gym_classes');
    expect(toolsFor('morning').map(t => t.name)).toContain('gym_classes');
    expect(toolsFor('night', 4).map(t => t.name)).not.toContain('gym_classes');
    expect(system({ name: 'Vijay' })).toContain('gym_classes');
    expect(system({ name: 'Vijay', v: 4 })).not.toContain('gym_classes');
    expect(TOOLS.find(t => t.name === 'gym_classes')?.change).toBeUndefined();   // a look-up: it changes nothing
  });
  it('names every club it can look up, and only those', () => {
    const t = toolsFor('night').find(x => x.name === 'gym_classes')!;
    const clubs = (t.input_schema as { properties: { clubs: { items: { enum: string[] }; description: string } } }).properties.clubs;
    expect(clubs.items.enum).toEqual(GYM_CLUBS.map(c => c.key));
    expect(clubs.description).toMatch(/usual ones \(queenston, burlington_centre\)/);
    expect(clubs.description).toMatch(/Burlington Mall/);
  });
  it('Arvy is told to look times up, offer the picks, add the chosen one to the calendar, and that it can’t book', () => {
    const s = system({ name: 'Vijay' });
    expect(s).toMatch(/Never guess a class time/);
    expect(s).toMatch(/offer_choices/);
    expect(s).toMatch(/add_event \(the class and the club as the title/);
    expect(s).toMatch(/can’t book the spot/);
  });
});

describe('the look-up, as the app runs it', () => {
  beforeEach(() => { invoke.mockReset(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 11, 17, 5)); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks the server for the clubs’ week and answers with what’s still ahead, and where it came from', async () => {
    invoke.mockResolvedValueOnce({ clubs: [{ key: 'queenston', name: 'Hamilton Queenston Place', classes }, { key: 'burlington_centre', name: 'Burlington Centre', classes: [] }] });
    const out = await runTool('gym_classes', { search: 'yoga', days: 1 });
    expect(invoke).toHaveBeenCalledWith({ action: 'classes', clubs: ['queenston', 'burlington_centre'], from: '2026-11-11' }, 'planner-arvy');
    expect(out.error).toBeUndefined();
    expect(out.result).toMatchObject({ from: '2026-11-11', to: '2026-11-11', clubs: [
      { club: 'Hamilton Queenston Place', days: [{ day: 'Wednesday 2026-11-11', classes: [expect.stringMatching(/^19:45–20:45 Yoga/)] }], already_started_today: 2 },
      { club: 'Burlington Centre', days: [], nothing: 'No class matching “yoga” in these days.' }] });
    expect(out.sources).toEqual([{ title: 'GoodLife class schedule: Hamilton Queenston Place', url: 'https://www.goodlifefitness.com/class-schedule.html?club=201' }]);
  });
  it('takes the club and day asked for; a day in the past becomes today; three days when none are given', async () => {
    invoke.mockResolvedValue({ clubs: [{ key: 'ancaster', name: 'Ancaster Wilson and McClure', classes }] });
    const next = await runTool('gym_classes', { clubs: ['ancaster'], from: '2026-11-13' });
    expect(invoke).toHaveBeenLastCalledWith({ action: 'classes', clubs: ['ancaster'], from: '2026-11-13' }, 'planner-arvy');
    expect(next.result).toMatchObject({ from: '2026-11-13', to: '2026-11-15' });
    expect(next.sources?.[0].url).toMatch(/club=238$/);
    await runTool('gym_classes', { clubs: ['ancaster'], from: '2026-11-01' });
    expect(invoke).toHaveBeenLastCalledWith({ action: 'classes', clubs: ['ancaster'], from: '2026-11-11' }, 'planner-arvy');
  });
  it('a timetable that can’t be read is an error (it goes in the improvements log); days not out yet are not', async () => {
    invoke.mockResolvedValueOnce({ clubs: [{ key: 'queenston', name: 'Q', broken: true, problem: 'GoodLife’s timetable has changed and couldn’t be read.' }, { key: 'burlington_centre', name: 'B', broken: true, problem: 'GoodLife’s timetable didn’t answer (403).' }] });
    const down = await runTool('gym_classes', {});
    expect(down.error).toBe(true);
    expect(down.sources).toBeUndefined();
    expect(JSON.stringify(down.result)).toMatch(/has changed and couldn’t be read/);
    invoke.mockResolvedValueOnce({ clubs: [{ key: 'queenston', name: 'Q', problem: 'GoodLife has no timetable out for those days: it shows today to about two weeks ahead.' }] });
    const far = await runTool('gym_classes', { clubs: ['queenston'], from: '2026-12-20' });
    expect(far.error).toBeUndefined();
    expect(JSON.stringify(far.result)).toMatch(/about two weeks ahead/);
    invoke.mockRejectedValueOnce(new Error('Failed to send a request to the Edge Function'));
    expect(await runTool('gym_classes', {})).toMatchObject({ error: true, result: { error: 'Failed to send a request to the Edge Function' } });
  });
});
