// scripts/benny-server-dryrun.mjs — run: node scripts/benny-server-dryrun.mjs
// Dry run of the Benny's server (supabase/functions/benny-assist) with a scripted model and a stand-in database, so its
// glue can be checked without deploying: sign-in, roles, tools → database calls, cards, the map with a change, the bug log.
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const state = { role: 'admin', user: true, rpc: [], script: [], env: {}, http: [] };
globalThis.__fake = state;
const fakeSb = `
  export function createClient() { const s = globalThis.__fake; return {
    auth: { getUser: async () => ({ data: { user: s.user ? { id: 'u1' } : null } }) },
    rpc: async (fn, args) => { s.rpc.push([fn, args]);
      if (fn === 'benny_ok_any') return s.role ? { data: s.role, error: null } : { data: null, error: { message: 'Not allowed' } };
      if (fn === 'benny_my_rm_ids') return { data: s.role === 'rm' ? ['rm_me', 'rm_buddy'] : null, error: null };
      if (fn === 'benny_side') return { data: { codes: ['NVN19', 'NVN24'], of: 19 }, error: null };
      if (fn === 'benny_plan_day') return { data: { ok: true, date: args.p_date, maps: ['NORTH VANCOUVER #1', 'NORTH VANCOUVER #2'], assign: [{ managers: [{ id: 'u1', name: 'Vijay' }], routes: [{ code: 'NVN01' }, { code: 'NVN19' }] }], booked: 15, showed: 15 }, error: null };
      if (fn === 'benny_check_give') return { data: { ok: false, problems: ['Which one: Michael A, Michael B?'] }, error: null };
      if (fn === 'benny_live') return { data: { live: true, carts: [] }, error: null };
      if (fn === 'benny_log_save') return { data: 'log-1', error: null };
      if (fn === 'benny_vocab') return { data: { workers: ['Jahswill Nuetey', 'Kevontae Ragguette'], managers: ['Jovan Chung'], places: ['North Delta (NDEL) #1-#3'] }, error: null };
      if (fn === 'benny_check_move') return { data: { ok: true, date: '2026-11-10', a: { cn: 'I1004', name: 'Jahswill Nuetey', heard_as: 'Jaz will' }, b: { cn: 'I1479', name: 'Kevontae Ragguette' } }, error: null };
      if (fn === 'benny_bug_sent') return { data: null, error: null };
      if (fn === 'benny_check_booking') return args.p_booking === '1 Nowhere'
        ? { data: { ok: false, problems: ['No booking found for “1 Nowhere” in this center.'] }, error: null }
        : { data: { ok: true, booking: { id: 'b1', address: '3575 Latimer St', status: 'open', route: 'RMD57' }, change: args.p_change.route ? { route: { from: 'RMD57', to: 'RMD137', map: 'RICHMOND #7' } } : { status: { from: 'open', to: 'done' } },
            patch: args.p_change.route ? { route_code: 'RMD137' } : { status: 'done' }, ask: args.p_change, stamp: 's1', notes: [],
            ...(args.p_change.route ? { map: 'RICHMOND #7', route: 'RMD137', pin: { lat: 49.1, lng: -123.1, label: '3575 Latimer St', route: 'RMD137' } } : {}) }, error: null };
      if (fn === 'benny_check_emails') return { data: { ok: true, kind: args.p_kind, date: args.p_date || '2026-11-11', list: { id: 'l1', name: 'Fall Rejuv 2026' }, maps: ['NORTH DELTA #2'],
        routes: [{ code: 'NDEL27', area: 'NORTH DELTA #2', number: 27 }, { code: 'NDEL28', area: 'NORTH DELTA #2', number: 28 }], counts: { bookings: 5, to_email: 4, no_email: 1, already_sent: 0 }, from: 'bcclientcare@propertystars.app' }, error: null };
      if (fn === 'benny_check_pin') return { data: args.p_manager ? { ok: true, date: '2026-11-10', manager: args.p_manager, label: args.p_label || 'NDEL32', lat: 49.15, lng: -122.92, at: 'on NDEL32', visibility: 'private', seen_by: 'Just you',
        map: 'NORTH DELTA #2', route: 'NDEL32', pin: { lat: 49.15, lng: -122.92, label: args.p_label || 'NDEL32', route: 'NDEL32' } } : { ok: false, problems: ['Open a route manager’s map first: pins live on a manager’s map.'] }, error: null };
      if (fn === 'benny_plan_stops') return { data: { ok: true, kind: args.p_kind, date: '2026-11-10', manager: args.p_manager, start: { lat: 49.24, lng: -122.88 }, km: 4.2, maps: ['NORTH DELTA #2'], routes: ['NDEL28', 'NDEL32'],
        stops: [{ n: 1, label: 'Drop 1 · David', who: 'David', lat: 49.153, lng: -122.923, by: 'route', route: 'NDEL28' }, { n: 2, label: 'Drop 2 · Michael', who: 'Michael', lat: 49.15, lng: -122.925, by: 'route', route: 'NDEL32' }], left_out: ['Kyle (no route yet)'] }, error: null };
      if (fn === 'benny_live_jobs') return { data: { ok: true, date: '2026-11-10', worker: { cn: 'I1479', name: 'Kevontae Ragguette' }, cart: { id: 's7', workers: ['Kevontae Ragguette'], paid_out: false, totals: { steps: 2, cash: 180 } },
        jobs: [{ id: 't1', client: 'Ron Gee', address: '406 Cumberland St', type: 'Sale', service: 'Lawn Rejuvenation', does: ['dethatch'], amount: 180, paid_by: 'Cash' }, { id: 't2', type: 'Production', flat: 'AFSL', amount: 210, paid_by: 'Prepaid' }] }, error: null };
      if (fn === 'benny_check_job') return args.p_job === 't2'
        ? { data: { ok: false, problems: ['It’s an office flat (AFSL): its value is set by the office. Change it on the edit screen if it is really wrong.'] }, error: null }
        : { data: { ok: true, date: '2026-11-10', worker: { cn: 'I1479', name: 'Kevontae Ragguette' }, cart: { id: 's7', workers: ['Kevontae Ragguette'] }, job: { id: 't1', client: 'Ron Gee', type: 'Sale', amount: 180, paid_by: 'Cash' },
            change: { amount: { from: 180, to: 250 }, paid_by: { from: 'Cash', to: 'Prepaid' } }, ask: args.p_change, patch: { price: 250, display_price: 'RJ250.00', payment_method: 'Prepaid', payment_breakdown: { Prepaid: 250 } }, stamp: 's', notes: [] }, error: null };
      if (fn === 'benny_payouts') return { data: { live: true, date: '2026-11-10', carts: [{ cart_id: 's1', cn: 'I1167', workers: ['David Nsapu'], paid_out: false, jobs: 1, gross: 210, collected: { cash: 0, cheque: 0, prepaid: 210 } }], summary: { open: 1, paid_out: 4 } }, error: null };
      if (fn === 'benny_check_payouts') return s.noPayouts
        ? { data: { ok: false, problems: ['No open payout is free of cash and cheque: 6 are already paid out, Kevontae has $180.00 cash to count.'] }, error: null }
        : { data: { ok: true, date: '2026-11-10', carts: [{ cart_id: 's1', cn: 'I1167', workers: ['David Nsapu'], jobs: 1, gross: 210, collected: { prepaid: 210 } }, { cart_id: 's2', cn: 'I1013', workers: ['Michael Asiegbunam'], jobs: 2, gross: 602, collected: { card: 392, prepaid: 210 } }],
            to_count: [{ workers: ['Kevontae Ragguette'], cash: 180, cheque: 0 }], paid_out: 4 }, error: null };
      if (fn === 'benny_map') return { data: { maps: ['SURREY #1'], highlight: ['SRY01'], pins: [{ lat: 1, lng: 2, label: 'x', route: 'SRY01' }] }, error: null };
      return { data: null, error: { message: 'no such function ' + fn } }; } }; }`;
const r = await build({ entryPoints: ['supabase/functions/benny-assist/index.ts'], bundle: true, format: 'esm', write: false, logLevel: 'silent',
  plugins: [{ name: 'fake', setup(b) { b.onResolve({ filter: /^https:\/\/esm\.sh\// }, () => ({ path: 'fake-sb', namespace: 'fake' })); b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: fakeSb, loader: 'js' })); } }] });
let handler;
globalThis.Deno = { env: { get: k => ({ ANTHROPIC_API_KEY: 'test', SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'k', ...state.env }[k]) }, serve: h => { handler = h; } };
globalThis.fetch = async (url, init) => {
  const u = String(url); const body = init?.body ? JSON.parse(init.body) : null; state.http.push([u, body]);
  if (u.includes('api.anthropic.com')) { const next = state.script.shift(); assert(next, 'the model was asked more times than scripted'); state.lastAsk = body; return new Response(JSON.stringify(next), { status: 200 }); }
  throw new Error('unexpected fetch ' + u);
};
await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const use = (name, input, id = 't' + Math.random()) => ({ type: 'tool_use', id, name, input });
const turn = (...content) => ({ content, stop_reason: content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const say = text => turn({ type: 'text', text });
const ask = async (text, context = {}, opts = {}) => {
  state.rpc = []; state.http = [];
  const res = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ messages: opts.messages || [{ role: 'user', content: text }], context: { center_id: 'c1', today: '2026-11-10', ...context } }) }));
  return { status: res.status, body: await res.json() };
};
const fns = () => state.rpc.map(x => x[0]);

// 1. start the day: side of a map → plan → a card, with its map even though the model drew none
state.role = 'admin';
state.script = [turn(use('map_side', { of_maps: ['NORTH VANCOUVER #2'], near_maps: ['NORTH VANCOUVER #1'] })),
  turn(use('propose_start_day', { date: '2026-11-11', team_mode: 'solo', assign: [{ managers: ['me'], maps: ['NORTH VANCOUVER #1'], routes: ['NVN19', 'NVN24'] }] })),
  say('Tap Start the day to do it.')];
let a = await ask('start tomorrow with everyone with me, solo, north van 1 and the side of 2 connected');
assert.equal(a.status, 200);
assert.deepEqual(fns(), ['benny_ok_any', 'benny_side', 'benny_plan_day']);
assert.equal(a.body.proposal.kind, 'start_day'); assert.equal(a.body.proposal.team_mode, 'solo'); assert.equal(a.body.proposal.check.date, '2026-11-11');
assert.deepEqual(a.body.map.highlight, ['NVN01', 'NVN19']); assert.equal(a.body.reply, 'Tap Start the day to do it.');
assert.equal(state.lastAsk.tools.length, 24); assert(!('roles' in state.lastAsk.tools[0]));
console.log('1 start the day: card + map ✓');

// 2. a change with a problem makes no card
state.script = [turn(use('propose_give_route', { route: 'NDEL33', worker: 'Michael' })), say('Which Michael: A or B?')];
a = await ask('give michael ndel33');
assert.equal(a.body.proposal, null); assert.equal(a.body.map, null);
console.log('2 a problem → no card ✓');

// 3. route manager: no office tools, and "my team" can't be pointed at someone else's map
state.role = 'rm';
state.script = [turn(use('find_people', { q: 'chris' }), use('live_team', {})), say('I can only help with your team.')];
a = await ask('whats chris number', { screen: 'rm', rm_manager: 'rm_someone_else' });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_my_rm_ids', 'benny_live']);
assert.equal(state.rpc[2][1].p_manager, 'rm_me');
assert(!state.lastAsk.tools.some(t => ['find_people', 'day', 'maps', 'propose_start_day'].includes(t.name)));
const results = state.lastAsk.messages.at(-1).content; assert(String(results[0].content).includes("isn't available"));
console.log('3 route manager limits ✓');

// 4. a map with pins: the model gets the count, the app gets the pins
state.role = 'admin';
state.script = [turn(use('show_map', { maps: ['Surrey'], prebooks: true, title: 'Open prebooks in Surrey' })), say('1 open prebook in Surrey.')];
a = await ask('show me the prebooks in surrey');
assert.equal(a.body.map.title, 'Open prebooks in Surrey'); assert.equal(a.body.map.pins.length, 1);
assert(String(state.lastAsk.messages.at(-1).content[0].content).includes('"pins":1'));
console.log('4 map pins ✓');

// 5. a bug report goes into the app's own log, with what the page knew — and nowhere else
state.script = [turn(use('report_bug', { title: 'Houses don’t load on RMD143', what_happened: 'No houses drawn', steps: ['Open RM map', 'Tap RMD143'], severity: 'blocking' })), say('I’ll let Vijay know — it’s in the bug log.')];
a = await ask('houses arent loading on rmd143', { path: '/app/rm', screen: 'rm', user_name: 'Franklyn Mitchell', center_name: 'BC Fall RJ', diag: { ua: 'UA', viewport: '390×844', errors: ['12:00:01 TypeError: x'] } });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_log_save']);
const saved = state.rpc[1][1];
assert.equal(saved.p_kind, 'bug');
assert.equal(saved.p_title, 'Houses don’t load on RMD143'); assert.equal(saved.p_path, '/app/rm'); assert.equal(saved.p_center, 'c1');
assert.equal(saved.p_report.user, 'Franklyn Mitchell'); assert.deepEqual(saved.p_report.steps, ['Open RM map', 'Tap RMD143']); assert.deepEqual(saved.p_report.diag.errors, ['12:00:01 TypeError: x']);
assert.deepEqual(state.http.map(h => new URL(h[0]).host), ['api.anthropic.com', 'api.anthropic.com']);   // the model, twice; nothing else
assert(String(state.lastAsk.messages.at(-1).content[0].content).includes('"saved":true'));
console.log('5 bug report → the app’s log only ✓');

// 5b. a spoken message brings the day's real names; a typed one doesn't
state.role = 'rm';
state.script = [turn(use('propose_partner', { a: 'Jahswill', b: 'Kevontae' })), say('I heard Jaz will and Kevin Tay: Kevontae joins Jahswill’s cart. Tap Partner up to do it.')];
a = await ask('partner up jaz will with kevin tay', { screen: 'rm', rm_manager: 'rm_me', spoken: true });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_my_rm_ids', 'benny_vocab', 'benny_check_move']);
assert.deepEqual(state.rpc[2][1], { p_center: 'c1', p_date: '2026-11-10', p_manager: 'rm_me' });
assert(state.lastAsk.system.includes('SPOKEN') && state.lastAsk.system.includes('Workers today: Jahswill Nuetey, Kevontae Ragguette'));
assert.equal(a.body.proposal.kind, 'partner'); assert.equal(a.body.proposal.check.a.name, 'Jahswill Nuetey');
state.script = [say('ok')];
a = await ask('who is on my team', { screen: 'rm', rm_manager: 'rm_me' });
assert(!fns().includes('benny_vocab')); assert(!state.lastAsk.system.includes('SPOKEN'));
state.role = 'admin';
console.log('5b spoken → real names sent along ✓');

// 5c. something it has no tool for goes in the log as a request: by the tool, or caught when the model forgets
state.role = 'admin';
state.script = [turn(use('log_request', { title: 'Move a prebook to another route', asked: 'move the oak st prebook to ndel33', why_not: 'no tool changes a booking’s route' })), say('I can’t do that yet. It’s logged for Vijay.')];
a = await ask('move the oak st prebook to ndel33');
assert.deepEqual(fns(), ['benny_ok_any', 'benny_log_save']);
assert.equal(state.rpc[1][1].p_kind, 'request'); assert.equal(state.rpc[1][1].p_report.asked, 'move the oak st prebook to ndel33'); assert.equal(state.rpc[1][1].p_report.diag, null);
state.script = [say('I can’t change a worker’s rate from here.')];           // forgot to log it
a = await ask('bump kyles alumni rate to 2 dollars');
assert.deepEqual(fns(), ['benny_ok_any', 'benny_log_save']);
assert.equal(state.rpc[1][1].p_kind, 'request'); assert.equal(state.rpc[1][1].p_report.auto, true); assert.equal(state.rpc[1][1].p_title, 'bump kyles alumni rate to 2 dollars');
state.script = [say('I can only help with the DMS.')];                        // off topic: not logged
a = await ask('whats the weather'); assert.deepEqual(fns(), ['benny_ok_any']);
state.script = [turn(use('propose_give_route', { route: 'NDEL33', worker: 'Zorro' })), say('I can’t find a worker called Zorro.')];   // a not-found is not a missing tool
a = await ask('give zorro ndel33'); assert(!fns().includes('benny_log_save'));
state.script = [say('8 workers on 8 carts today.')];                          // an answer: not logged
a = await ask('who is on today'); assert.deepEqual(fns(), ['benny_ok_any']);
console.log('5c couldn’t-do requests are logged ✓');

// 5d. changing a booking ("service ticket"): a card, never a save; a move comes with its map and the house; admins only
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', status: 'done' })), say('Tap Save to do it.')];
a = await ask('update the service ticket for 3575 Latimer to done');
assert.equal(a.body.proposal, null); assert.match(a.body.reply, /Refresh the page/);   // a tab from before booking cards existed
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', status: 'done' })), say('Tap Save to do it.')];
a = await ask('update the service ticket for 3575 Latimer to done', { cards: ['booking'] });
assert.equal(a.body.proposal.kind, 'booking'); assert.deepEqual(a.body.proposal.check.patch, { status: 'done' }); assert.equal(a.body.map, null);
assert.deepEqual(state.rpc.at(-1), ['benny_check_booking', { p_center: 'c1', p_booking: '3575 Latimer', p_change: { status: 'done' } }]);
assert(!fns().some(f => /save/.test(f)), 'the server never saves a booking');
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', route: 'RMD137' })), say('Tap Save to do it.')];
a = await ask('move 3575 latimer to rmd137', { cards: ['booking'] });
assert.deepEqual(a.body.map, { maps: ['RICHMOND #7'], highlight: ['RMD137'], pins: [{ lat: 49.1, lng: -123.1, label: '3575 Latimer St', route: 'RMD137' }], title: '3575 Latimer St → RMD137' });
state.script = [turn(use('propose_booking', { booking: '1 Nowhere', status: 'done' })), say('I couldn’t find a booking at 1 Nowhere in BC Fall RJ.')];
a = await ask('close the ticket at 1 nowhere', { cards: ['booking'] });
assert.equal(a.body.proposal, null);
assert(!fns().includes('benny_log_save'), 'a booking that isn’t found is an answer, not a missing tool');
state.role = 'rm';
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', status: 'done' }), use('log_request', { title: 'Mark a booking done', asked: 'mark 3575 latimer done' })), say('I can’t do that yet. It’s logged for Vijay.')];
a = await ask('mark 3575 latimer done', { screen: 'rm', rm_manager: 'rm_me' });
assert.equal(a.body.proposal, null); assert(!fns().includes('benny_check_booking')); assert(fns().includes('benny_log_save'));
assert(!state.lastAsk.tools.some(t => ['booking', 'propose_booking'].includes(t.name)));
state.role = 'admin';
console.log('5d booking change: a card for admins, its map on a move, never saved by the server, "refresh" for an old tab ✓');

// 5e. booking emails ("service notification emails"): set up for the person to read and send; the server never sends one
state.script = [turn(use('propose_booking_emails', { kind: 'day_before', maps: ['North Delta 2'] })), say('4 customers get one, 1 has no email. Tap Open to read and send.')];
a = await ask('send the service notification emails for north delta 2 tomorrow', { cards: ['booking', 'booking_emails'] });
assert.equal(a.body.proposal.kind, 'booking_emails'); assert.equal(a.body.proposal.check.counts.to_email, 4);
assert.deepEqual(state.rpc.at(-1), ['benny_check_emails', { p_center: 'c1', p_kind: 'day_before', p_date: null, p_today: '2026-11-10', p_routes: null, p_maps: ['North Delta 2'] }]);
assert.deepEqual(a.body.map, { maps: ['NORTH DELTA #2'], highlight: ['NDEL27', 'NDEL28'], pins: [], title: 'Routes to email' });
assert(!state.http.some(([u]) => !u.includes('api.anthropic.com')), 'nothing but the model is called: no mail goes out');
assert(!fns().some(f => /mail|send/.test(f) && f !== 'benny_check_emails'), 'no mail function is called');
state.script = [turn(use('propose_booking_emails', { kind: 'day_before', maps: ['North Delta 2'] })), say('Tap Open to read and send.')];
a = await ask('send the day before emails', { cards: ['booking'] });   // a tab from before this card existed
assert.equal(a.body.proposal, null); assert.match(a.body.reply, /Refresh the page/);
console.log('5e booking emails: set up on a card with its routes, nothing sent, "refresh" for an old tab ✓');

// 5f. pins and orders on the route manager map: cards with their maps; the server drops nothing
state.role = 'rm';
state.script = [turn(use('propose_pin', { label: 'Lunch', route: 'NDEL32' })), say('Tap Drop the pin to do it.')];
a = await ask('drop a pin on ndel32 called lunch', { screen: 'rm', rm_manager: 'rm_me', cards: ['pin', 'stops'] });
assert.equal(a.body.proposal.kind, 'pin'); assert.equal(a.body.proposal.check.manager, 'rm_me');
assert.deepEqual(a.body.map, { maps: ['NORTH DELTA #2'], highlight: ['NDEL32'], pins: [{ lat: 49.15, lng: -122.92, label: 'Lunch', route: 'NDEL32' }], title: 'Lunch' });
state.script = [turn(use('propose_stops', { kind: 'drop' })), say('David, then Michael: about 4.2 km. Kyle has no route yet. Tap Drop the pins to do it.')];
a = await ask('plan my drop order', { screen: 'rm', rm_manager: 'rm_me', cards: ['pin', 'stops'] });
assert.equal(a.body.proposal.kind, 'stops'); assert.equal(a.body.map.title, 'Drop order');
assert.deepEqual(a.body.map.pins.map(p => p.n), [1, 2]); assert.deepEqual(a.body.map.start, { lat: 49.24, lng: -122.88 }); assert.deepEqual(a.body.map.highlight, ['NDEL28', 'NDEL32']);
assert(!fns().some(f => /pin|stop/.test(f) && !['benny_check_pin', 'benny_plan_stops'].includes(f)), 'the server only checks and plans: it writes no pin');
state.role = 'admin';
state.script = [turn(use('propose_pin', { here: true })), say('Open a route manager’s map first: pins live on a manager’s map.')];
a = await ask('drop a pin here', { cards: ['pin', 'stops'] });   // the top bar, no map open
assert.equal(a.body.proposal, null); assert.equal(state.rpc.at(-1)[1].p_manager, null);
console.log('5f pins and orders: cards with their maps for the open map, nothing written by the server ✓');

// 5g. the floater map: the floater's own id and the managers followed reach the database together, for it to check
state.role = 'rm';
const floater = { screen: 'rm', rm_manager: 'floater_stebe', following: ['rm_franklynmitchell', 'rm_jovanchung'], following_names: ['Franklyn Mitchell', 'Jovan Chung'], cards: ['pin', 'stops'] };
state.script = [turn(use('propose_stops', { kind: 'check' })), say('Two stops. Tap Drop the pins to do it.')];
a = await ask('plan my check order', floater);
assert(!fns().includes('benny_my_rm_ids'), 'the floater map is not swapped for the person’s own manager map');
assert.equal(state.rpc.at(-1)[1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');
assert.equal(a.body.proposal.check.manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');   // the stand-in echoes it; the real check answers with the floater's id
assert(state.lastAsk.system.includes('on the floater map, following Franklyn Mitchell, Jovan Chung'));
state.script = [turn(use('live_team', {})), say('8 carts out.')];
a = await ask('who is out', { ...floater, spoken: true });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_vocab', 'benny_live']);
assert.equal(state.rpc[1][1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung'); assert.equal(state.rpc[2][1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');
state.role = 'admin';
console.log('5g the floater map: "my team" is the managers followed, checked by the database ✓');

// 5h. a logsheet job: looked up, then a card; the server saves nothing, a refusal makes no card, and an old tab is told to refresh
for (const role of ['admin', 'rm']) {
  state.role = role;
  state.script = [turn(use('logsheet', { worker: 'Kevontae' })), turn(use('propose_job_change', { worker: 'Kevontae', job: 't1', amount: 250, paid_by: 'prepaid' })), say('Ron’s sale: $180 cash becomes $250 prepaid. Tap Save to do it.')];
  a = await ask('change rons job on kevontaes cart to 250 prepaid', { screen: 'rm', rm_manager: 'rm_me', cards: ['job'] });
  assert.equal(a.body.proposal.kind, 'job'); assert.deepEqual(a.body.proposal.check.ask, { amount: 250, paid_by: 'prepaid' }); assert.equal(a.body.map, null);
  assert.deepEqual(fns().filter(f => /job/.test(f)), ['benny_live_jobs', 'benny_check_job'], 'the server looks and checks: it never begins or saves a change');
}
state.role = 'admin';
state.script = [turn(use('propose_job_change', { worker: 'Kevontae', job: 't2', amount: 250 })), say('That one is an office flat: change it on the edit screen.')];
a = await ask('make the afsl 250', { cards: ['job'] });
assert.equal(a.body.proposal, null);
state.script = [turn(use('propose_job_change', { worker: 'Kevontae', job: 't1', amount: 250 })), say('Tap Save to do it.')];
a = await ask('make rons 250', {});   // a tab opened before this card existed
assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
console.log('5h logsheet jobs: looked up and checked, a card for admins and route managers, nothing saved by the server ✓');

// 5i. payouts: looked up and lined up for a super admin; the server pays nobody; route managers don't get the tools
state.role = 'admin';
state.script = [turn(use('propose_payouts', {})), say('2 payouts are lined up. Kevontae has $180 cash to count. Tap Open to go through them.')];
a = await ask('close all the payouts that dont have cash or cheque', { cards: ['payouts'] });
assert.equal(a.body.proposal.kind, 'payouts'); assert.deepEqual(a.body.proposal.check.carts.map(c => c.cn), ['I1167', 'I1013']); assert.equal(a.body.map, null);
assert.deepEqual(fns().filter(f => /payout/.test(f)), ['benny_check_payouts'], 'the server only checks: it has nothing that pays out');
state.noPayouts = true;
state.script = [turn(use('propose_payouts', {})), say('None to line up: 6 are paid out and Kevontae has cash to count.')];
a = await ask('close the no cash payouts', { cards: ['payouts'] });
assert.equal(a.body.proposal, null); state.noPayouts = false;
state.script = [turn(use('propose_payouts', {})), say('Tap Open.')];
a = await ask('close the no cash payouts', {});   // a tab opened before this card existed
assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
state.role = 'rm';
state.script = [turn(use('propose_payouts', {})), say('I can’t do that.')];
a = await ask('close the payouts', { screen: 'rm', rm_manager: 'rm_me', cards: ['payouts'] });
assert(!state.lastAsk.tools.some(t => ['payouts', 'propose_payouts'].includes(t.name))); assert.equal(a.body.proposal, null); assert(!fns().includes('benny_check_payouts'));
state.role = 'admin';
console.log('5i payouts: lined up on a card for super admins, nobody paid out by the server ✓');

// 6. who gets in
state.user = false; a = await ask('hi'); assert.equal(a.status, 401); state.user = true;
state.role = null; a = await ask('hi'); assert.equal(a.status, 403); state.role = 'admin';
a = await ask('', {}, { messages: [{ role: 'assistant', content: 'hello' }] }); assert.equal(a.status, 400);
// a card's outcome reaches the model; a leading assistant turn is dropped
state.script = [say('ok')];
a = await ask('', {}, { messages: [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'give kyle a route' }, { role: 'assistant', content: 'Tap Assign.\n\n[The card: confirmed, done: NDEL33 is on Kyle’s cart.]' }, { role: 'user', content: 'thanks' }] });
assert.equal(state.lastAsk.messages[0].role, 'user'); assert.equal(state.lastAsk.messages.length, 3);
// too many steps stops
state.script = Array.from({ length: 8 }, () => turn(use('live_team', {})));
a = await ask('loop'); assert(a.body.reply.startsWith('That took too many steps'));
console.log('6 sign-in, roles, history, step limit ✓');
