// src/lib/demoTour.ts — the guided tour at /demo: its sandbox, its steps, and what counts as done.
// The tour runs on the real RM map and the real map logsheet inside a throwaway demo centre
// (app_demo_start). The coach (DemoCoach) shows one step at a time and watches the data the app
// writes to know when the visitor has done it. State lives in local storage so it survives the
// page changes the app makes along the way.
import { supabase } from './supabase';
import { getStorageItem, removeStorageItem, setStorageItem } from './localStorage';

export const DEMO_KEY = 'cps.demo';

export interface DemoSandbox {
  code: string; center_id: string; date: string;
  manager: string; other_manager: string; worker: string; partner: string; mover: string; late: string;
  /** The tour's three routes: cart 1's (the visitor's), cart 2's, and the one to assign. */
  routes: string[]; carts: string[]; booking: string;
  /** Their route numbers, for the words on screen ("route 21"). */
  route_nums?: number[];
}

/** Fill a step's words in for this sandbox: {r1} {r2} {r3} are the tour's route numbers, {c1} {c2} {c3} their codes. */
export function fill(text: string, sb: DemoSandbox): string {
  const num = (i: number) => String(sb.route_nums?.[i] ?? Number((sb.routes[i] || '').slice(-2)));
  return text.replace(/\{r([123])\}/g, (_, i) => num(Number(i) - 1)).replace(/\{c([123])\}/g, (_, i) => sb.routes[Number(i) - 1] || '');
}
export interface DemoState { sandbox: DemoSandbox; step: number; role: 'manager' | 'worker'; startedAt: number; done: number[] }

export const readDemo = (): DemoState | null => getStorageItem<DemoState | null>(DEMO_KEY, null);
export const writeDemo = (s: DemoState | null) => (s ? setStorageItem(DEMO_KEY, s) : removeStorageItem(DEMO_KEY));
/** A demo older than its sandbox (3 hours) is over: the sweep has taken its centre. */
export const demoExpired = (s: DemoState) => Date.now() - s.startedAt > 3 * 3600 * 1000;

export type Act = 'Route Manager' | 'Worker' | 'Route Manager again';

/**
 * What to flash for a step. The coach tries these in order and flashes the first one on screen,
 * so list the last control of a step first: as the visitor opens menus, the flash moves on to the
 * next thing to tap. `when` limits a target to screens where that text is showing.
 */
export interface Target {
  /** A CSS selector. */
  sel?: string;
  /** Text on the control (case-insensitive, contained). */
  text?: string;
  /** Text must equal the control's text exactly (for short words like "No"). */
  exact?: boolean;
  /** Only while this text is somewhere on screen. */
  when?: string;
  /** What to say in the pill while this is the thing flashing. */
  hint: string;
}
const MAP: Target = { sel: '.mapboxgl-canvas', hint: 'On the map' };
const MENU: Target = { sel: '[aria-label="Menu"]', hint: 'Open the menu' };
/** Leaving a route for the map: always shown before the map itself, so it lights up whenever a route is open. */
export const BACK: Target[] = [
  { sel: '[aria-label="Back to map"]', hint: 'Back to the map (top left)' },
  { sel: '[aria-label="Back to all routes"]', hint: 'Back to the map (top left)' },
];
/** A step's targets with the way back to the map put in before the map. */
export function withBack(targets: Target[] | undefined): Target[] {
  const t = targets || [];
  const i = t.findIndex(x => x.sel === MAP.sel);
  return i < 0 ? [...t, ...BACK] : [...t.slice(0, i), ...BACK, ...t.slice(i)];
}
export interface DemoStep {
  act: Act;
  role: 'manager' | 'worker';
  title: string;
  /** What to do, in the imperative. */
  what: string;
  /** Where the control is. */
  where?: string;
  /** Why it matters — one line. */
  why: string;
  /** How the coach knows it's done; absent = the visitor presses Next. */
  check?: (sb: DemoSandbox) => Promise<boolean>;
  /** A step the coach does for them (with a button), when the real control lives in the office app. */
  action?: { label: string; run: (sb: DemoSandbox) => Promise<void> };
  /** The step ends with a change of role. */
  handoff?: 'worker' | 'manager';
  /** What to flash, most specific first. */
  targets?: Target[];
}

const count = async (table: string, build: (q: any) => any): Promise<number> => {
  const { count: n } = await build(supabase.from(table).select('*', { count: 'exact', head: true }));
  return n || 0;
};

export const STEPS: DemoStep[] = [
  // ── Act 1: the Route Manager ────────────────────────────────────────────────
  {
    act: 'Route Manager', role: 'manager', title: 'Your day at a glance',
    what: 'This is the whole Bridlewood map. Each coloured line is a route; the circles with initials are your workers, two to a cart.',
    why: 'Everything a manager does during the day starts here: who is where, what is sold, what is left.',
    targets: [MAP],
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Layers and sharing',
    what: 'Open Layers. Turn on Previously done and Callbook clients (PCL) to see past customers and callbook clients on the map. Then, under Share with, give Sam Lee Full access.',
    why: 'Layers show who already knows us. Sharing lets another manager cover for you and see exactly what you see.',
    check: async sb => {
      const { data } = await supabase.from('users').select('metadata').eq('user_id', sb.manager).eq('command_center_id', sb.center_id).maybeSingle();
      return !!(data?.metadata?.mapSharing?.access || []).includes(sb.other_manager);
    },
    targets: [{ sel: '[aria-label="Full access for Sam Lee"]', hint: 'Give Sam Lee full access' }, { text: 'Layers', exact: true, hint: 'Tap Layers' }, MENU],
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Open a cart',
    what: 'Tap cart 1 (Jordan and Priya) on route {r1}. You’ll see who’s on it, its houses, and the numbers so far: steps, equiv, gross. Then come back to the map.',
    why: 'This is the live scoreboard for each pair; the same numbers feed their payslip at the end of the day.',
    targets: [{ text: 'Jordan', hint: 'Tap cart 1: Jordan & Priya' }, { ...MAP, hint: 'Tap cart 1 on the map' }],
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Assign a route',
    what: 'Cart 3 (Amara and Liam) has no route yet. Tap route {r3} on the map, tap Assign, and pick cart 3.',
    why: 'A worker only sees houses on routes assigned to them, so an unassigned cart can’t knock.',
    check: async sb => (await count('routes', q => q.eq('route_code', sb.routes[2]).eq('command_center_id', sb.center_id).not('assigned_worker_ids', 'eq', '{}'))) > 0,
    targets: [
      { when: 'Assign Route', text: 'Amara', hint: 'Pick cart 3: Amara & Liam' },
      { when: '{c3}', sel: '[aria-label="Assign route"]', hint: 'Tap Assign' },
      { when: '{c3}', text: 'Assign', exact: true, hint: 'Tap Assign' },
      { ...MAP, hint: 'Tap route {r3} on the map' },
    ],
    handoff: 'worker',
  },
  // ── Act 2: the worker ───────────────────────────────────────────────────────
  {
    act: 'Worker', role: 'worker', title: 'Your route, and what the colours mean',
    what: 'You’re Jordan now, on route {r1}. Before you knock, read the colours: purple = a past customer of ours; blue = a callbook (PCL) client; lime = a client of our other service (aeration). Grey, red and orange are your partner Priya’s knocks: not home, no, go back. Pink is invalid.',
    why: 'Past customers and callbook clients already know us: knock them first and lead with the history.',
    targets: [MAP],
  },
  {
    act: 'Worker', role: 'worker', title: 'Knock three doors',
    what: 'Tap a black house and mark it Not home. Mark another No. Mark a third Go back.',
    why: 'Every knock is shared live: your partner, your manager and tomorrow’s crew all see it, so nobody re-knocks a no.',
    check: async sb => {
      const { data } = await supabase.from('house_dispositions').select('status').eq('route_code', sb.routes[0]).eq('worker_id', sb.worker);
      const s = new Set((data || []).map((r: any) => r.status));
      return s.has('not_home') && s.has('no') && s.has('go_back');
    },
    targets: [{ text: 'Not home', exact: true, hint: 'Not home here, then No and Go back on two others' }, { ...MAP, hint: 'Tap a house' }],
  },
  {
    act: 'Worker', role: 'worker', title: 'Mark an invalid',
    what: 'A house you can’t do: freshly sealed by another company, a concrete driveway, or one that can’t be done today (cars on it). Mark it Invalid and say why.',
    why: 'Invalid takes the house off everyone’s list, so no one on the team wastes a knock on it.',
    check: async sb => (await count('house_dispositions', q => q.eq('route_code', sb.routes[0]).eq('worker_id', sb.worker).eq('status', 'invalid'))) > 0,
    targets: [{ text: 'Invalid', exact: true, hint: 'Tap Invalid and say why' }, { ...MAP, hint: 'Tap a house you can’t do' }],
  },
  {
    act: 'Worker', role: 'worker', title: 'A yes: save it as pending',
    what: 'Make a sale: tap a house › Sale, price the driveway, and Save Pending. The house turns yellow.',
    why: 'Pending means sold but not done yet. Your manager sees it straight away, and it holds the house for you.',
    check: async sb => (await count('pending_sales', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0
      || (await count('transactions', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0,
    targets: [{ text: 'Save Pending', hint: 'Save Pending' }, { text: 'Sale', exact: true, hint: 'Tap Sale' }, { ...MAP, hint: 'Tap a house' }],
  },
  {
    act: 'Worker', role: 'worker', title: 'Do the job and complete it',
    what: 'Open the yellow house and complete it: choose how they paid (nothing is charged in the demo) and Save & Complete. The house turns green.',
    why: 'Green is money in: the job goes on your logsheet, into your stats and onto the office’s books in one tap.',
    check: async sb => (await count('transactions', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0,
    targets: [{ text: 'Save & Complete', hint: 'Save & Complete' }, { text: 'Payment Method', hint: 'Choose how they paid' }, { text: 'Proceed to Complete', hint: 'Proceed to Complete' }, { text: 'Complete pending sale', hint: 'Complete the sale' }, { ...MAP, hint: 'Tap the yellow house' }],
  },
  {
    act: 'Worker', role: 'worker', title: 'Your stats',
    what: 'Open Today’s Stats: steps, equiv and gross for the day.',
    why: 'Workers are paid on equiv, so they watch their day add up as they go.',
    targets: [{ text: 'Today’s Stats', hint: 'Open Today’s Stats' }, { text: "Today's Stats", hint: 'Open Today’s Stats' }, MENU],
    handoff: 'manager',
  },
  // ── Act 3: back to the Route Manager ───────────────────────────────────────
  {
    act: 'Route Manager again', role: 'manager', title: 'The sale on your map',
    what: 'You’re Alex again. The green house on route {r1} is the job you just logged; open cart 1 and it’s in their numbers.',
    why: 'Managers never have to ask “how are you doing?”: every sale lands on the map and in the cart’s totals the moment it’s logged.',
    targets: [{ text: 'Jordan', hint: 'Open cart 1' }, MAP],
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'Check a worker’s knocking',
    what: 'In cart 1, look at today’s knocks: doors, nos, go-backs, invalids, and how much of the route is covered.',
    why: 'This is how a manager spots a crew that is coasting, or one that needs a fresh route, without driving over.',
    targets: [{ text: 'Today', exact: true, hint: 'Today’s knocks' }, { text: 'Jordan', hint: 'Open cart 1' }, MAP],
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'That’s the tour',
    what: 'You’ve read the map, shared it, assigned a route, knocked doors, logged a sale and watched it land. At day’s end the office closes the day and these carts become payslips, exactly as they show now. Keep exploring this demo (it lasts three hours), or start a fresh one.',
    why: 'One app, from the knock to the payslip.',
  },
];

export const stepsOfAct = (act: Act) => STEPS.filter(s => s.act === act);
export const actIndex = (i: number) => (['Route Manager', 'Worker', 'Route Manager again'] as Act[]).indexOf(STEPS[i].act);
