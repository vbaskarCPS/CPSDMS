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
  routes: string[]; carts: string[]; booking: string;
}
export interface DemoState { sandbox: DemoSandbox; step: number; role: 'manager' | 'worker'; startedAt: number; done: number[] }

export const readDemo = (): DemoState | null => getStorageItem<DemoState | null>(DEMO_KEY, null);
export const writeDemo = (s: DemoState | null) => (s ? setStorageItem(DEMO_KEY, s) : removeStorageItem(DEMO_KEY));
/** A demo older than its sandbox (3 hours) is over: the sweep has taken its centre. */
export const demoExpired = (s: DemoState) => Date.now() - s.startedAt > 3 * 3600 * 1000;

export type Act = 'Route Manager' | 'Worker' | 'Route Manager again';
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
}

const count = async (table: string, build: (q: any) => any): Promise<number> => {
  const { count: n } = await build(supabase.from(table).select('*', { count: 'exact', head: true }));
  return n || 0;
};

export const STEPS: DemoStep[] = [
  {
    act: 'Route Manager', role: 'manager', title: 'Your day at a glance',
    what: 'Look around the map. Each colour is a route; the circles with initials are your workers, two to a cart.',
    where: 'This is the Route Manager map. On a phone, the menu button opens Team, Pins, Layers and more.',
    why: 'Everything a manager does during the day starts here: who is where, what is sold, what is left.',
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Assign a route',
    what: 'Cart 3 (Amara and Liam) has no route yet. Tap the uncoloured route 03 on the map, choose Assign Route, and pick cart 3.',
    where: 'Tap the route’s outline on the map; the route card has the Assign button.',
    why: 'A worker only sees houses on routes assigned to them, so an unassigned cart can’t knock.',
    check: async sb => (await count('routes', q => q.eq('route_code', sb.routes[2]).eq('command_center_id', sb.center_id).not('assigned_worker_ids', 'eq', '{}'))) > 0,
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Open a cart',
    what: 'Tap cart 1 (Jordan and Priya). You’ll see who’s on it, its route, and the numbers so far: steps, equiv, gross.',
    where: 'Carts are the circles on the map and the cards in Team.',
    why: 'This is the live scoreboard for each pair; the same numbers feed their payslip at the end of the day.',
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Manage Team: move a worker',
    what: 'Vidal is on cart 2 but should be with Jordan. Open Team, choose Vidal, and move him to cart 1.',
    where: 'Menu › Team › tap Vidal › Move to an existing cart.',
    why: 'Pairs change through the day (no-shows, late arrivals). Moving someone here moves their route, their map and their pay split with them.',
    check: async sb => (await count('logsheet_sessions', q => q.eq('id', sb.carts[0]).contains('team_worker_ids', [sb.mover]))) > 0,
  },
  {
    act: 'Route Manager', role: 'manager', title: 'Layers and sharing',
    what: 'Open Layers. Turn on Previously done and Callbook clients (PCL). Then, under Share with, give Sam Lee Full access.',
    where: 'Menu › Layers. Sharing is at the bottom of the Layers panel.',
    why: 'Layers show past customers and callbook clients on your map. Sharing lets another manager cover for you and see exactly what you see.',
    check: async sb => {
      const { data } = await supabase.from('users').select('metadata').eq('user_id', sb.manager).eq('command_center_id', sb.center_id).maybeSingle();
      return !!(data?.metadata?.mapSharing?.access || []).includes(sb.other_manager);
    },
  },
  {
    act: 'Route Manager', role: 'manager', title: 'A late arrival',
    what: 'Chris Martine just turned up. In the real app the office adds him in Workerbook › Day › Late arrival; press the button to do that here, then find him on the map on a cart of his own.',
    why: 'Late arrivals go straight onto the live map so they can start knocking, and the manager pairs them up from Team.',
    action: { label: 'Add Chris as a late arrival', run: async sb => { const { error } = await supabase.rpc('app_demo_late_arrival', { p_code: sb.code }); if (error) throw new Error(error.message); } },
    check: async sb => (await count('users', q => q.eq('user_id', sb.late).eq('command_center_id', sb.center_id))) > 0,
    handoff: 'worker',
  },
  {
    act: 'Worker', role: 'worker', title: 'Your route, and what the colours mean',
    what: 'You’re Jordan now, on route 01. Before you knock, read the colours: purple = a past customer of ours; blue = a callbook (PCL) client; lime = a client of our other service (aeration). Grey, red and orange are your partner Priya’s knocks: not home, no, go back. Pink is invalid.',
    where: 'Tap any coloured house to see its history.',
    why: 'Past customers and callbook clients already know us: knock them first and lead with the history.',
  },
  {
    act: 'Worker', role: 'worker', title: 'Knock three doors',
    what: 'Tap a grey-free house and mark it Not home. Mark another No. Mark a third Go back with a note (“back after 5”).',
    where: 'Tap a house › the buttons at the bottom of its card.',
    why: 'Every knock is shared live: your partner, your manager and tomorrow’s crew all see it, so nobody re-knocks a no.',
    check: async sb => {
      const { data } = await supabase.from('house_dispositions').select('status').eq('route_code', sb.routes[0]).eq('worker_id', sb.worker);
      const s = new Set((data || []).map((r: any) => r.status));
      return s.has('not_home') && s.has('no') && s.has('go_back');
    },
  },
  {
    act: 'Worker', role: 'worker', title: 'Mark an invalid',
    what: 'Find a house you couldn’t do: a fresh seal from another company, a concrete driveway, or one that can’t be done today (cars on it, gravel). Mark it Invalid and say why.',
    where: 'Tap the house › Invalid.',
    why: 'Invalid takes the house off everyone’s list for the season, so no one on the team wastes a knock on it.',
    check: async sb => (await count('house_dispositions', q => q.eq('route_code', sb.routes[0]).eq('worker_id', sb.worker).eq('status', 'invalid'))) > 0,
  },
  {
    act: 'Worker', role: 'worker', title: 'A yes: save it as pending',
    what: 'Pick a house and make the sale: tap the house › Sale, price the driveway, and save it as pending. Watch the house turn yellow.',
    where: 'Tap the house › Sale (the yellow button).',
    why: 'Pending means sold but not done yet. Your manager sees it on the map straight away, and it holds the house for you.',
    check: async sb => (await count('pending_sales', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0
      || (await count('transactions', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0,
  },
  {
    act: 'Worker', role: 'worker', title: 'Do the job and complete it',
    what: 'Open the yellow house and complete the job: take the payment (cash, e-transfer or card — nothing is charged in the demo) and log it. The house turns green.',
    where: 'Tap the yellow house › Complete.',
    why: 'Green is money in: the job goes on your logsheet, into your stats and onto the office’s books, all from one tap.',
    check: async sb => (await count('transactions', q => q.eq('command_center_id', sb.center_id).eq('worker_id', sb.worker))) > 0,
  },
  {
    act: 'Worker', role: 'worker', title: 'Your stats',
    what: 'Open your stats: steps, equiv and gross for the day, and the pending booking the office sent you (Grace Whitfield, yellow on the map) that you’d do next.',
    where: 'The stats bar at the top, or Menu › Stats.',
    why: 'Workers are paid on equiv, so they can see their day add up as they go.',
    handoff: 'manager',
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'The sale on your map',
    what: 'You’re Alex again. Find the green house on route 01 and open cart 1: the job you just logged is in its numbers.',
    where: 'Menu › Team › cart 1, or tap the cart on the map.',
    why: 'Managers never have to ask “how are you doing?”: every sale lands on the map and in the cart’s totals the moment it’s logged.',
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'Check a worker’s knocking',
    what: 'Open cart 1 and look at today’s knocks: how many doors, nos, go-backs, invalids, and how much of the route is covered.',
    where: 'The cart card › Today.',
    why: 'This is how a manager spots a crew that is coasting, or one that needs a fresh route, without driving over.',
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'Day’s end',
    what: 'At the end of the day the office closes the day in Workerbook: every cart’s sales become payout lines and payslips, exactly as the carts show them now. In this demo the day stays open.',
    why: 'Nothing is re-keyed: what the workers logged is what gets paid.',
  },
  {
    act: 'Route Manager again', role: 'manager', title: 'That’s the tour',
    what: 'You’ve assigned a route, moved a worker, shared a map, added a late arrival, knocked doors, logged a sale and checked the numbers. Keep exploring this demo (it lasts three hours), or start a fresh one.',
    why: 'One app, from the knock to the payslip.',
  },
];

export const stepsOfAct = (act: Act) => STEPS.filter(s => s.act === act);
export const actIndex = (i: number) => (['Route Manager', 'Worker', 'Route Manager again'] as Act[]).indexOf(STEPS[i].act);
