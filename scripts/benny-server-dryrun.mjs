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
      if (fn === 'benny_model_mode') return { data: s.mode || 'main', error: null };
      if (fn === 'benny_ai_log_save') { (s.logs = s.logs || []).push(args.p); return { data: null, error: null }; }
      if (fn === 'benny_pace') return { data: { ok: true, day: '2026-11-11', live: true, as_of: '15:01', scope: args.p_worker ? 'worker' : args.p_manager ? 'team' : 'center',
        this_day: { knocks: 176, sales: 2, steps: 3, gross: 467.5 }, earlier_days: { count: 11, usual: { at_this_time: { knocks: 204, steps: 15, gross: 3099 } } },
        projection: { if_the_rest_goes_like_a_usual_day: { steps: 7, gross: 1781 }, if_the_day_keeps_this_pace: { steps: 3.8, gross: 623 } }, notes: ['Times are when a knock or a job was entered in the app.'] }, error: null };
      if (fn === 'benny_check_remove') {
        const known = { 'kevontae ragguette': ['I1479', 'Kevontae Ragguette'], i1479: ['I1479', 'Kevontae Ragguette'], 'kenan francis-bull': ['I1012', 'Kenan Francis-Bull'], i1012: ['I1012', 'Kenan Francis-Bull'], kenan: ['I1012', 'Kenan Francis-Bull'] };
        const hit = args.p_workers.map(w => known[w.toLowerCase()]);
        if (!hit.length || hit.some(h => !h)) return { data: { ok: false, date: '2026-11-10', problems: args.p_workers.filter((w, i) => !hit[i]).map(w => 'No worker called “' + w + '” is on today’s map.') }, error: null };
        return { data: { ok: true, date: '2026-11-10', center_type: 'road_trip', stamp: 'st1', workers: hit.map(([cn, name]) => ({ cn, name, manager: 'rm_me', manager_name: 'Franklyn Mitchell', cart_id: 's_' + cn,
          ...(cn === 'I1479' ? { routes: ['NSR42'], frees: ['NSR42'] } : {}), roster: { id: 'r_' + cn, now: 'showed', then: 'not marked' } })) }, error: null };
      }
      if (fn === 'benny_my_rm_ids') return { data: s.role === 'rm' ? ['rm_me', 'rm_buddy'] : null, error: null };
      if (fn === 'benny_side') return { data: { codes: ['NVN19', 'NVN24'], of: 19 }, error: null };
      if (fn === 'benny_bonus_rank') return { data: { ok: true, date: args.p_date || '2026-11-10', kept_as: 'the live day',
        winners: [{ place: 1, workers: ['Michael Asiegbunam'], cns: ['I1013'], bonus_eq: 19.95 }, { place: 2, workers: ['Kyle Pitt'], cns: ['I1065'], bonus_eq: 8 }],
        ranked: [{ rank: 1, workers: ['Michael Asiegbunam'], qualifies: true, bonus_eq: 19.95 }, { rank: 2, workers: ['Mugove Chipfurutse'], qualifies: false, why_not: 'a phone and an email on 0 of 2 (needs 80%)', bonus_eq: 12.57 }] }, error: null };
      if (fn === 'benny_check_bonus') return (args.p_bonuses || []).some(b => !b.place)
        ? { data: { ok: false, date: '2026-11-10', problems: ['Which place is Kyle Pitt’s Performance EQ bonus: 1st, 2nd …?'] }, error: null }
        : { data: { ok: true, date: args.p_date || '2026-11-10', source: 'live', total: 100, stamp: 'st', ask: args.p_bonuses,
            bonuses: args.p_bonuses.map((b, i) => ({ key: 'sess_' + i, cns: [b.worker], workers: [b.worker], team_size: 1, type: 'Performance EQ', placing: b.place, label: 'Performance EQ', amount: b.amount, shares: [] })) }, error: null };
      if (fn === 'benny_maps_pcl') return { data: { ranked_by: args.p_service ? args.p_service + ' past clients per route' : null,
        maps: [{ map: 'SOUTHEAST SURREY #3', city: 'Surrey', routes: 18, past_clients: 160, past_clients_by_service: { aeration: 31, lawn_rejuv: 112, sealing: 17 }, counted: 112, per_route: 6.2 }] }, error: null };
      if (fn === 'benny_text_people') return { data: { ok: true, date: args.p_date, day_state: 'live', who: args.p_who.workers ? 'named' : args.p_who.group, on_list: 14,
        people: [{ cn: 'I1169', name: 'Steven Doherty', first: 'Steven', days_worked: 3, days_on_list: 10, last_worked: '2026-11-04', has_cell: true }, { cn: 'B1003', name: 'Tim Chan', first: 'Tim', days_worked: 7, days_on_list: 10, has_cell: false }] }, error: null };
      if (fn === 'benny_check_texts') return !args.p_template && !(args.p_texts || []).length
        ? { data: { ok: false, date: args.p_date, problems: ['What should the text say?'] }, error: null }
        : { data: { ok: true, date: args.p_date, who: 'no_shows', own_words: !!args.p_template, ...(args.p_tone ? { tone: args.p_tone } : {}), no_cell: ['Tim Chan'],
            people: [{ hire_id: 'h1', cn: 'I1169', name: 'Steven Doherty', first: 'Steven', phone: '6045550101', text: args.p_template ? args.p_template.replace('{name}', 'Steven') : args.p_texts[0].text, days_worked: 3, days_on_list: 10 },
              { hire_id: 'h2', cn: 'B1003', name: 'Tim Chan', first: 'Tim', text: args.p_template ? args.p_template.replace('{name}', 'Tim') : 'Tim, call me.', days_worked: 7, days_on_list: 10 }] }, error: null };
      if (fn === 'benny_crew_stats') return { data: { ok: true, date: args.p_date, ranked_by: 'average equiv per day worked', ranked: [{ rank: 1, name: 'Tim Hale', cn: 'I1001', days: 9, avg_equiv: 23.17 }, { rank: 2, name: 'Kyle Pitt', cn: 'I1065', days: 7, avg_equiv: 15.99 }],
        no_days_yet: [], no_shows: [], counts: { booked: 2, showed: 2, ranked: 2, no_days_yet: 0 } }, error: null };
      if (fn === 'benny_plan_day' && (args.p_assign || []).some(e => e.workers)) return { data: { ok: true, crews: true, notes: [], date: args.p_date, maps: ['MISSION #1'], booked: 2, showed: 2,
        assign: args.p_assign.map((e, i) => ({ managers: [{ id: 'u' + i, name: e.managers[0] }], routes: [{ code: 'MIS0' + i }], crew: e.workers.map(cn => ({ hire_id: 'h' + cn, cn, name: cn, days: 5, avg_equiv: 12 })), crew_avg: 12 })) }, error: null };
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
      if (fn === 'benny_map' && !args.p_prebooks && !args.p_routes) return { data: { maps: args.p_maps, highlight: [], pins: [] }, error: null };   // maps only: nothing picked out
      if (fn === 'benny_map') return { data: { maps: ['SURREY #1'], highlight: ['SRY01'], pins: [{ lat: 1, lng: 2, label: 'x', route: 'SRY01' }] }, error: null };
      return { data: null, error: { message: 'no such function ' + fn } }; } }; }`;
const r = await build({ entryPoints: ['supabase/functions/benny-assist/index.ts'], bundle: true, format: 'esm', write: false, logLevel: 'silent',
  plugins: [{ name: 'fake', setup(b) { b.onResolve({ filter: /^https:\/\/esm\.sh\// }, () => ({ path: 'fake-sb', namespace: 'fake' })); b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: fakeSb, loader: 'js' })); } }] });
let handler;
globalThis.Deno = { env: { get: k => ({ ANTHROPIC_API_KEY: 'test', SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'k', ...state.env }[k]) }, serve: h => { handler = h; } };
globalThis.fetch = async (url, init) => {
  const u = String(url); const body = init?.body ? JSON.parse(init.body) : null; state.http.push([u, body]);
  if (u.includes('api.anthropic.com') && state.fastDown && body.model === 'claude-haiku-5-5') { (state.models = state.models || []).push(body.model); return new Response(JSON.stringify({ error: { message: 'model: claude-haiku-5-5 not found' } }), { status: 404 }); }
  if (u.includes('api.anthropic.com')) { const next = state.script.shift(); assert(next, 'the model was asked more times than scripted'); state.lastAsk = body; (state.models = state.models || []).push(body.model); return new Response(JSON.stringify(next), { status: 200 }); }
  throw new Error('unexpected fetch ' + u);
};
await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
const use = (name, input, id = 't' + Math.random()) => ({ type: 'tool_use', id, name, input });
const turn = (...content) => ({ content, stop_reason: content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const say = text => turn({ type: 'text', text });
const ask = async (text, context = {}, opts = {}) => {
  state.rpc = []; state.http = []; state.models = [];
  const res = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ messages: opts.messages || [{ role: 'user', content: text }], context: { center_id: 'c1', today: '2026-11-10', ...context } }) }));
  return { status: res.status, body: await res.json() };
};
const calls = () => state.rpc.filter(x => x[0] !== 'benny_model_mode' && x[0] !== 'benny_ai_log_save');   // the mode is read with every question, and every question is saved to the AI log
const fns = () => calls().map(x => x[0]);
// the server logs one line of token counts per question: kept here (and off the screen) to be checked in 5n
const print = console.log; state.usage = [];
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('benny-assist usage ')) state.usage.push(a[0]); else print(...a); };
/** what the model was told, as one text (it is sent in two parts: the rules, kept by the prompt cache, then what is true right now) */
const sysText = () => state.lastAsk.system.map(b => b.text).join('');

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
assert.equal(state.lastAsk.tools.length, 33); assert(!('roles' in state.lastAsk.tools[0]));
// the Benny drew the maps itself and picked no routes out: the plan's routes are highlighted all the same
state.script = [turn(use('show_map', { maps: ['NORTH VANCOUVER #1'], title: 'Tomorrow' })),
  turn(use('propose_start_day', { date: '2026-11-11', assign: [{ managers: ['me'], maps: ['NORTH VANCOUVER #1'] }] })), say('Tap Start the day to do it.')];
a = await ask('start tomorrow with me on north van 1');
assert.deepEqual(a.body.map.highlight, ['NVN01', 'NVN19'], 'the plan’s routes'); assert.equal(a.body.map.title, 'Tomorrow');
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
assert.equal(calls()[2][1].p_manager, 'rm_me');
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
const saved = calls()[1][1];
assert.equal(saved.p_kind, 'bug');
assert.equal(saved.p_title, 'Houses don’t load on RMD143'); assert.equal(saved.p_path, '/app/rm'); assert.equal(saved.p_center, 'c1');
assert.equal(saved.p_report.user, 'Franklyn Mitchell'); assert.deepEqual(saved.p_report.steps, ['Open RM map', 'Tap RMD143']); assert.deepEqual(saved.p_report.diag.errors, ['12:00:01 TypeError: x']);
assert.deepEqual(state.http.map(h => new URL(h[0]).host), ['api.anthropic.com', 'api.anthropic.com']);   // the model, twice; nothing else
assert(String(state.lastAsk.messages.at(-1).content[0].content).includes('"saved":true'));
assert.equal(a.body.logged, true);   // the app then offers a notification for when it's fixed
console.log('5 bug report → the app’s log only ✓');

// 5b. a spoken message brings the day's real names; a typed one doesn't
state.role = 'rm';
state.script = [turn(use('propose_partner', { a: 'Jahswill', b: 'Kevontae' })), say('I heard Jaz will and Kevin Tay: Kevontae joins Jahswill’s cart. Tap Partner up to do it.')];
a = await ask('partner up jaz will with kevin tay', { screen: 'rm', rm_manager: 'rm_me', spoken: true });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_my_rm_ids', 'benny_vocab', 'benny_check_move']);
assert.deepEqual(calls()[2][1], { p_center: 'c1', p_date: '2026-11-10', p_manager: 'rm_me' });
assert(sysText().includes('SPOKEN') && sysText().includes('Workers today: Jahswill Nuetey, Kevontae Ragguette'));
assert.equal(a.body.proposal.kind, 'partner'); assert.equal(a.body.proposal.check.a.name, 'Jahswill Nuetey');
state.script = [say('ok')];
a = await ask('who is on my team', { screen: 'rm', rm_manager: 'rm_me' });
assert(!fns().includes('benny_vocab')); assert(!sysText().includes('SPOKEN'));
state.role = 'admin';
console.log('5b spoken → real names sent along ✓');

// 5c. something it has no tool for goes in the log as a request: by the tool, or caught when the model forgets
state.role = 'admin';
state.script = [turn(use('log_request', { title: 'Move a prebook to another route', asked: 'move the oak st prebook to ndel33', why_not: 'no tool changes a booking’s route' })), say('I can’t do that yet. It’s logged for Vijay.')];
a = await ask('move the oak st prebook to ndel33');
assert.deepEqual(fns(), ['benny_ok_any', 'benny_log_save']);
assert.equal(calls()[1][1].p_kind, 'request'); assert.equal(calls()[1][1].p_report.asked, 'move the oak st prebook to ndel33'); assert.equal(calls()[1][1].p_report.diag, null);
assert.equal(a.body.logged, true);
state.script = [say('I can’t change a worker’s rate from here.')];           // forgot to log it
a = await ask('bump kyles alumni rate to 2 dollars');
assert.deepEqual(fns(), ['benny_ok_any', 'benny_log_save']);
assert.equal(calls()[1][1].p_kind, 'request'); assert.equal(calls()[1][1].p_report.auto, true); assert.equal(calls()[1][1].p_title, 'bump kyles alumni rate to 2 dollars');
assert.equal(a.body.logged, true);   // logged for it: the same offer
state.script = [say('I can only help with the DMS.')];                        // off topic: not logged
a = await ask('whats the weather'); assert.deepEqual(fns(), ['benny_ok_any']); assert(!('logged' in a.body));
state.script = [turn(use('propose_give_route', { route: 'NDEL33', worker: 'Zorro' })), say('I can’t find a worker called Zorro.')];   // a not-found is not a missing tool
a = await ask('give zorro ndel33'); assert(!fns().includes('benny_log_save'));
state.script = [say('8 workers on 8 carts today.')];                          // an answer: not logged
a = await ask('who is on today'); assert.deepEqual(fns(), ['benny_ok_any']); assert(!('logged' in a.body));
console.log('5c couldn’t-do requests are logged, and the app is told ✓');

// 5d. changing a booking ("service ticket"): a card, never a save; a move comes with its map and the house; admins only
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', status: 'done' })), say('Tap Save to do it.')];
a = await ask('update the service ticket for 3575 Latimer to done');
assert.equal(a.body.proposal, null); assert.match(a.body.reply, /Refresh the page/);   // a tab from before booking cards existed
state.script = [turn(use('propose_booking', { booking: '3575 Latimer', status: 'done' })), say('Tap Save to do it.')];
a = await ask('update the service ticket for 3575 Latimer to done', { cards: ['booking'] });
assert.equal(a.body.proposal.kind, 'booking'); assert.deepEqual(a.body.proposal.check.patch, { status: 'done' }); assert.equal(a.body.map, null);
assert.deepEqual(calls().at(-1), ['benny_check_booking', { p_center: 'c1', p_booking: '3575 Latimer', p_change: { status: 'done' } }]);
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
assert.deepEqual(calls().at(-1), ['benny_check_emails', { p_center: 'c1', p_kind: 'day_before', p_date: null, p_today: '2026-11-10', p_routes: null, p_maps: ['North Delta 2'] }]);
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
assert.equal(a.body.proposal, null); assert.equal(calls().at(-1)[1].p_manager, null);
console.log('5f pins and orders: cards with their maps for the open map, nothing written by the server ✓');

// 5g. the floater map: the floater's own id and the managers followed reach the database together, for it to check
state.role = 'rm';
const floater = { screen: 'rm', rm_manager: 'floater_stebe', following: ['rm_franklynmitchell', 'rm_jovanchung'], following_names: ['Franklyn Mitchell', 'Jovan Chung'], cards: ['pin', 'stops'] };
state.script = [turn(use('propose_stops', { kind: 'check' })), say('Two stops. Tap Drop the pins to do it.')];
a = await ask('plan my check order', floater);
assert(!fns().includes('benny_my_rm_ids'), 'the floater map is not swapped for the person’s own manager map');
assert.equal(calls().at(-1)[1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');
assert.equal(a.body.proposal.check.manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');   // the stand-in echoes it; the real check answers with the floater's id
assert(sysText().includes('on the floater map, following Franklyn Mitchell, Jovan Chung'));
state.script = [turn(use('live_team', {})), say('8 carts out.')];
a = await ask('who is out', { ...floater, spoken: true });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_vocab', 'benny_live']);
assert.equal(calls()[1][1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung'); assert.equal(calls()[2][1].p_manager, 'floater_stebe,rm_franklynmitchell,rm_jovanchung');
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

// 5j. crews: the averages are looked up, the plan carries who goes with whom, and a tab that can't deal crews is told to refresh
state.role = 'admin';
const crewPlan = { date: '2026-11-11', assign: [{ managers: ['Franklyn'], maps: ['MISSION #1'], workers: ['I1065'] }, { managers: ['Jovan'], maps: ['MISSION #2'], workers: ['I1001'] }] };
state.script = [turn(use('crew_stats', { date: '2026-11-11' })), turn(use('propose_start_day', crewPlan)), say('Franklyn gets Kyle (16.0), Jovan gets Tim (23.2). Tap Start the day to do it.')];
a = await ask('start tomorrow, give franklyn the worst half in mission and jovan the good guys', { cards: ['crews'] });
assert.deepEqual(fns().filter(f => /crew|plan/.test(f)), ['benny_crew_stats', 'benny_plan_day']);
assert.deepEqual(calls().find(x => x[0] === 'benny_plan_day')[1].p_assign.map(e => e.workers), [['I1065'], ['I1001']], 'who goes with whom reaches the database');
assert.equal(a.body.proposal.kind, 'start_day'); assert.equal(a.body.proposal.check.crews, true); assert.deepEqual(a.body.proposal.check.assign.map(e => e.crew.map(w => w.cn)), [['I1065'], ['I1001']]);
state.script = [turn(use('crew_stats', { date: '2026-11-11' })), turn(use('propose_start_day', crewPlan)), say('Tap Start the day to do it.')];
a = await ask('start tomorrow, give franklyn the worst half', {});   // a tab opened before crews: it would start the day without them
assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
state.script = [turn(use('crew_stats', {})), say('Tim is your best at 23.2 equiv a day, then Kyle at 16.0.')];
a = await ask('who are my best workers', {});
assert.equal(a.body.proposal, null); assert.deepEqual(calls().find(x => x[0] === 'benny_crew_stats')[1], { p_center: 'c1', p_date: '2026-11-10' });
state.role = 'rm';
state.script = [say('That is for the office.')];
a = await ask('who are my best workers', { screen: 'rm', rm_manager: 'rm_me' });
assert(!state.lastAsk.tools.some(t => t.name === 'crew_stats'));
state.role = 'admin';
console.log('5j crews: averages looked up, the plan carries each manager’s crew, older tabs are told to refresh ✓');

// 5k. bonuses: ranked for the day on the screen, every bonus on one card, the server adds nothing; older tabs and route managers
state.role = 'admin';
const two = { bonuses: [{ worker: 'I1013', place: 1, amount: 50 }, { worker: 'I1065', place: 2, amount: 50 }] };
state.script = [turn(use('bonus_ranking', {})), turn(use('propose_bonuses', two)), say('1st Michael, 2nd Kyle (Mugove is higher but doesn’t qualify). Tap Add the bonuses to do it.')];
a = await ask('give the top two bonus equiv carts 50 each', { cards: ['bonus'], path: '/app/workerbook/days/2026-11-10' });
assert.deepEqual(fns().filter(f => /bonus/.test(f)), ['benny_bonus_rank', 'benny_check_bonus'], 'the server only ranks and checks: it has nothing that adds a bonus');
assert.deepEqual(calls().find(x => x[0] === 'benny_bonus_rank')[1], { p_center: 'c1', p_date: '2026-11-10' }, 'the day on the screen');
assert.deepEqual(calls().find(x => x[0] === 'benny_check_bonus')[1], { p_center: 'c1', p_date: '2026-11-10', p_bonuses: two.bonuses });
assert.equal(a.body.proposal.kind, 'bonus'); assert.equal(a.body.proposal.check.bonuses.length, 2); assert.equal(a.body.map, null);
assert(/They have the workerbook day 2026-11-10 open/.test(sysText()));
state.script = [turn(use('bonus_ranking', {})), turn(use('propose_bonuses', two)), say('Tap Add the bonuses to do it.')];
a = await ask('give the top two bonus equiv carts 50 each', {});   // a tab opened before bonuses were a card
assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
state.script = [turn(use('propose_bonuses', { bonuses: [{ worker: 'Kyle', amount: 50 }] })), say('Which place is Kyle’s bonus: 1st or 2nd?')];
a = await ask('give kyle a 50 bonus', { cards: ['bonus'] });
assert.equal(a.body.proposal, null, 'a problem makes no card');
state.role = 'rm';
state.script = [say('That is for the office.')];
a = await ask('who gets the bonus today', { screen: 'rm', rm_manager: 'rm_me' });
assert(!state.lastAsk.tools.some(t => ['bonus_ranking', 'propose_bonuses'].includes(t.name)));
state.role = 'admin';
console.log('5k bonuses: ranked for the open day, one card for all of them, nothing added by the server ✓');

// 5l. texts to workers: looked up without numbers, set up on a card that has them, never sent by the server
state.role = 'admin';
const wording = '{name} if you dont get out of bed right now you can start packing';
const toolResults = () => state.lastAsk.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(c => c.type === 'tool_result').map(c => typeof c.content === 'string' ? c.content : JSON.stringify(c.content)) : []);
state.script = [turn(use('text_people', {})), turn(use('propose_texts', { template: wording })), say('2 texts are set up; Tim Chan has no cell number. Tap Text on each one; you press send.')];
a = await ask('text the guys that didnt show: <name> if you dont get out of bed right now you can start packing', { cards: ['texts'] });
assert.deepEqual(fns().filter(f => /text/.test(f)), ['benny_text_people', 'benny_check_texts'], 'the server looks up and checks: it has nothing that sends or records a text');
assert.deepEqual(calls().find(x => x[0] === 'benny_check_texts')[1], { p_center: 'c1', p_date: '2026-11-10', p_who: { group: 'no_shows' }, p_template: wording, p_texts: null, p_tone: null });
assert.equal(a.body.proposal.kind, 'texts'); assert.equal(a.body.proposal.check.people[0].phone, '6045550101', 'the card has the number for its link');
assert.equal(a.body.proposal.check.people[0].text, 'Steven if you dont get out of bed right now you can start packing'); assert.equal(a.body.map, null);
assert(toolResults().length === 2 && toolResults().every(t => !t.includes('604')), 'no phone number ever reaches the model');
assert(/"has_cell":true/.test(toolResults()[1]) && /"has_cell":false/.test(toolResults()[1]));
assert(!state.http.some(([u]) => !u.includes('api.anthropic.com')), 'nothing is sent anywhere but the model');
state.script = [turn(use('text_people', {})), turn(use('propose_texts', { texts: [{ worker: 'I1169', text: 'Steven, a week since your last day. Call me now.' }, { worker: 'B1003', text: 'Tim, call me.' }], tone: 'firm, last warning' })), say('Tap Text on each one; you press send.')];
a = await ask('write a firm last warning text to each no show', { cards: ['texts'] });
assert.equal(a.body.proposal.check.tone, 'firm, last warning'); assert.equal(a.body.proposal.check.own_words, false);
state.script = [turn(use('propose_texts', { template: wording })), say('Tap Text on each one; you press send.')];
a = await ask('text the no shows', {});   // a tab opened before texts were a card
assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
state.script = [turn(use('propose_texts', {})), say('What should the text say?')];
a = await ask('text the no shows', { cards: ['texts'] });
assert.equal(a.body.proposal, null, 'a problem makes no card');
state.role = 'rm';
state.script = [say('That is for the office.')];
a = await ask('text my no shows', { screen: 'rm', rm_manager: 'rm_me' });
assert(!state.lastAsk.tools.some(t => ['text_people', 'propose_texts'].includes(t.name)));
state.role = 'admin';
console.log('5l texts: no number reaches the model, the card carries them, nothing is sent or recorded by the server ✓');

// 5m. maps: past clients by service, ranked when a service is named
state.script = [turn(use('maps', { q: 'Surrey', service: 'lawn_rejuv' })), say('Southeast Surrey #3 is highest: 6.2 rejuv past clients per route.')];
a = await ask('which surrey map has the highest rejuv pcl density');
assert.deepEqual(calls().find(x => x[0] === 'benny_maps_pcl')[1], { p_center: 'c1', p_q: 'Surrey', p_service: 'lawn_rejuv' });
assert.equal(a.body.proposal, null); assert(/per_route/.test(toolResults()[0]));
console.log('5m maps: past clients by service, ranked for the one asked ✓');

// 5n. the prompt cache: the tools and the rules are the same bytes for every question from the same kind of person, and
// are the only part marked to be kept; who is asking, the day and the screen come after and are never kept
const told = async (role, context, text = 'hi') => { state.role = role; state.script = [say('ok')]; await ask(text, context); return { sys: state.lastAsk.system, tools: JSON.stringify(state.lastAsk.tools) }; };
const a1 = await told('admin', { user_name: 'Vijay Baskaran', center_name: 'BC Fall RJ', today: '2026-11-10', path: '/app/workerbook/days/2026-11-10' });
const a2 = await told('admin', { user_name: 'Someone Else', center_name: 'ON Fall RJ', today: '2026-11-12', path: '/app/bookings/list', spoken: true, screen: 'rm', rm_manager: 'rm_x' }, 'another question');
const r1 = await told('rm', { user_name: 'Franklyn Mitchell', screen: 'rm', rm_manager: 'rm_me' });
assert.equal(a1.sys.length, 2); assert.deepEqual(a1.sys[0].cache_control, { type: 'ephemeral' }); assert(!('cache_control' in a1.sys[1]));
assert.equal(a1.sys[0].text, a2.sys[0].text, 'the kept part is the same for every super admin, whatever the day, center or screen');
assert.equal(a1.tools, a2.tools); assert.notEqual(a1.sys[0].text, r1.sys[0].text, 'route managers have their own rules'); assert.notEqual(a1.tools, r1.tools);
for (const personal of ['Vijay Baskaran', 'Someone Else', 'ON Fall RJ', '2026-11-10', '2026-11-12', 'They have the workerbook day', 'SPOKEN', 'rm_x']) assert(!a1.sys[0].text.includes(personal) && !a2.sys[0].text.includes(personal), personal + ' must not be in the kept part');
assert(a1.sys[1].text.includes('Vijay Baskaran') && a1.sys[1].text.includes('Today is 2026-11-10') && a1.sys[1].text.includes('They have the workerbook day 2026-11-10 open'));
assert(a2.sys[1].text.includes('SPOKEN') && a2.sys[1].text.includes('open for rm_x'));
assert(a1.sys[0].text.length > 8 * a1.sys[1].text.length, 'nearly all of it is the kept part');
assert(!state.lastAsk.tools.some(t => 'cache_control' in t) && !JSON.stringify(state.lastAsk.messages).includes('cache_control'));
// one line of token counts per question goes to the function log: the steps added up, and nothing of what was said
state.role = 'admin'; state.usage = [];
state.script = [{ ...turn(use('maps', { q: 'Surrey' })), usage: { input_tokens: 400, cache_creation_input_tokens: 11000, cache_read_input_tokens: 0, output_tokens: 60 } },
  { ...say('Southeast Surrey #3.'), usage: { input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 11000, output_tokens: 40 } }];
await ask('which surrey map has the most rejuv past clients', { user_name: 'Vijay Baskaran' });
assert.equal(state.usage.length, 1);
assert.equal(state.usage[0], 'benny-assist usage {"role":"admin","mode":"main","by":"main","why":null,"fast_model":"claude-haiku-5-5","main_model":"claude-sonnet-5-5","fast":{"steps":0,"input":0,"cache_write":0,"cache_read":0,"output":0},"main":{"steps":2,"input":1300,"cache_write":11000,"cache_read":11000,"output":100}}');
state.role = 'admin';
console.log('5n prompt cache: tools + rules identical per role and marked to be kept; who, day and screen come after, never kept ✓');

// 5o. two models. fast_first: the small model takes plain lookups first, and the server shows its answer only when it is
// safe to; anything else is done again on the main model. Off (mode main) nothing changes: every scenario above ran that way.
const FASTM = 'claude-haiku-5-5', MAINM = 'claude-sonnet-5-5';
const used = () => JSON.parse(state.usage.pop().slice('benny-assist usage '.length));
state.role = 'admin'; state.mode = 'fast_first'; state.usage = [];
// a plain lookup, every number in the answer from the lookup: the small model's answer is the one shown
state.script = [turn(use('text_people', {})), say('2 workers on the list for 2026-11-10 aren’t marked as showed: Steven Doherty (I1169), 3 of 10 days, and Tim Chan (B1003), 7 of 10.')];
a = await ask('who didnt show today');
assert.deepEqual(state.models, [FASTM, FASTM]); assert(a.body.reply.startsWith('2 workers')); assert(!('route' in a.body), 'which model answered is only told to a super admin trying it out');
let u = used(); assert.equal(u.by, 'fast'); assert.equal(u.why, null); assert.equal(u.mode, 'fast_first'); assert.equal(u.main.steps, 0); assert.equal(u.fast.steps, 2);
// a number the lookup didn't return (worked out, or made up): done again on the main model, and only that answer is shown
state.script = [turn(use('text_people', {})), say('2 didn’t show, so 12 of the 14 did.'), turn(use('text_people', {})), say('Steven Doherty and Tim Chan aren’t marked as showed.')];
a = await ask('who didnt show today', { model: 'fast' });
assert.deepEqual(state.models, [FASTM, FASTM, MAINM, MAINM]); assert.equal(a.body.reply, 'Steven Doherty and Tim Chan aren’t marked as showed.');
assert.deepEqual(a.body.route, { by: 'main', why: 'ungrounded', tokens: ['12'] }); assert.equal(used().why, 'ungrounded');
// a code the lookup didn't return
state.script = [turn(use('text_people', {})), say('Steven Doherty (I1170) didn’t show.'), turn(use('text_people', {})), say('Steven Doherty (I1169) didn’t show.')];
a = await ask('did steven show', { model: 'fast' }); assert.deepEqual(a.body.route, { by: 'main', why: 'ungrounded', tokens: ['I1170'] });
// anything that makes a card: the small model's call is not run (the check runs once, for the main model), and the card is the main model's
state.script = [turn(use('propose_payouts', {})), turn(use('propose_payouts', {})), say('Tap Open to go through them.')];
a = await ask('line up the payouts with nothing to count', { cards: ['payouts'] });
assert.deepEqual(state.models, [FASTM, MAINM, MAINM]); assert.equal(fns().filter(f => f === 'benny_check_payouts').length, 1); assert.equal(a.body.proposal.kind, 'payouts'); assert.equal(used().why, 'tool:propose_payouts');
// a ranking tool, and the log: also not run by the small model
state.script = [turn(use('crew_stats', {})), turn(use('crew_stats', {})), say('Tim Hale and Kyle Pitt.')];
a = await ask('who is on the crew list'); assert.equal(fns().filter(f => f === 'benny_crew_stats').length, 1); assert.equal(used().why, 'tool:crew_stats');
state.script = [turn(use('log_request', { title: 'x', asked: 'x' })), turn(use('log_request', { title: 'Weather', asked: 'is it raining' })), say('I can’t do that yet; it’s logged for Vijay.')];
a = await ask('is it raining in surrey'); assert.equal(fns().filter(f => f === 'benny_log_save').length, 1, 'the small model never writes to the log'); assert.equal(used().why, 'tool:log_request');
// no lookup at all, "I can't", "Tap …", a lookup that failed, a name it had to guess: none of these is shown
for (const [first, why] of [[[say('15 workers are booked today.')], 'no_lookup'], [[turn(use('text_people', {})), say('I can’t see that.')], 'cant'],
  [[turn(use('text_people', {})), say('Tap Text on each one.')], 'says_tap'], [[turn(use('nope_lookup', {}))], 'tool:nope_lookup']]) {
  state.script = [...first, say('From the main model.')];
  a = await ask('who is booked', { model: 'fast' }); assert.equal(a.body.reply, 'From the main model.', why); assert.equal(a.body.route.why, why); assert.equal(state.models.at(-1), MAINM);
}
state.script = [turn(use('find_people', { q: 'x' })), say('From the main model.')];   // benny_find_people isn't in the stand-in database: an error
a = await ask('whats kyles number', { model: 'fast' }); assert.equal(a.body.route.why, 'tool_error');
// three rounds of lookups is one too many for the small model
state.script = [turn(use('text_people', {})), turn(use('text_people', {})), turn(use('text_people', {})), say('From the main model.')];
a = await ask('who is booked', { model: 'fast' }); assert.equal(a.body.route.why, 'steps'); assert.deepEqual(state.models, [FASTM, FASTM, FASTM, MAINM]);
// questions the small model isn't tried on: comparing or picking out, changing something, and anything spoken
for (const [q, ctx2, why] of [['which surrey map has the most rejuv past clients', {}, 'compare'], ['start tomorrow with me solo', {}, 'change'], ['who didnt show today', { spoken: true }, 'spoken']]) {
  state.script = [say('From the main model.')];
  a = await ask(q, { ...ctx2, model: 'fast' }); assert.deepEqual(state.models, [MAINM], q); assert.deepEqual(a.body.route, { by: 'main', why });
}
// the small model is down or unknown: the person still gets their answer, from the main model
state.fastDown = true; state.script = [turn(use('text_people', {})), say('From the main model.')];
a = await ask('who didnt show today', { model: 'fast' }); assert.equal(a.status, 200); assert.equal(a.body.reply, 'From the main model.'); assert.deepEqual(a.body.route, { by: 'main', why: 'fast_failed' }); assert.deepEqual(state.models, [FASTM, MAINM, MAINM]);
state.fastDown = false;
// the switch: off in the database, a super admin's own app can still try it; a route manager's can't; 'main' turns it off for a tester
state.mode = 'main';
state.script = [turn(use('text_people', {})), say('Steven Doherty (I1169) and Tim Chan (B1003).')];
a = await ask('who didnt show today', { model: 'fast' }); assert.deepEqual(state.models, [FASTM, FASTM]); assert.deepEqual(a.body.route, { by: 'fast', why: null });
state.script = [say('ok')]; a = await ask('who didnt show today'); assert.deepEqual(state.models, [MAINM]); assert.equal(used().mode, 'main');
state.role = 'rm'; state.script = [say('ok')]; a = await ask('who is on my team', { model: 'fast', screen: 'rm', rm_manager: 'rm_me' }); assert.deepEqual(state.models, [MAINM]); assert(!('route' in a.body));
state.role = 'admin'; state.mode = 'fast_first'; state.script = [say('ok')]; a = await ask('who didnt show today', { model: 'main' }); assert.deepEqual(state.models, [MAINM]);
// a route manager gets it from the setting like anyone else
state.role = 'rm'; state.script = [turn(use('live_team', {})), say('Your team is live.')]; a = await ask('who is on my team', { screen: 'rm', rm_manager: 'rm_me' }); assert.deepEqual(state.models, [FASTM, FASTM]);
state.role = 'admin'; state.mode = 'main'; state.usage = [];
console.log('5o two models: plain lookups on the small one, checked by the server; cards, rankings, the log and anything unchecked on the main one ✓');

// 5p. taking a worker off today: a card for super admins and route managers, and never on a name the Benny matched by sound
state.role = 'rm'; state.mode = 'fast_first';
const heard = 'Remove Devante and Keenan from today\'s payout they are not active today';
const rmCtx = { screen: 'rm', rm_manager: 'rm_me', spoken: true, cards: ['remove'] };
// spoken, and the model swaps in the names that sound closest: the check passes, but nobody they named is on it, so no card
state.script = [turn(use('propose_remove', { workers: ['Kevontae Ragguette', 'Kenan Francis-Bull'] })), say('Do you mean Kevontae Ragguette (I1479) and Kenan Francis-Bull (I1012)?')];
a = await ask(heard, rmCtx);
assert.equal(a.body.proposal, null, 'a match made by sound is asked about, never put on the card');
assert.deepEqual(state.models, ['claude-sonnet-5-5', 'claude-sonnet-5-5'], 'a change, and spoken: never the small model');
assert(toolResults().length === 1 && /Kevontae Ragguette \(I1479\) wasn’t named in what they said/.test(toolResults()[0]) && /Kenan Francis-Bull \(I1012\) wasn’t named/.test(toolResults()[0]) && /"ok":false/.test(toolResults()[0]));
assert(state.lastAsk.tools.some(t => t.name === 'propose_remove'), 'route managers have it for their own team');
// they say yes to that question: now the same call makes the card
const yes = [{ role: 'user', content: heard }, { role: 'assistant', content: 'Do you mean Kevontae Ragguette (I1479) and Kenan Francis-Bull (I1012)?' }, { role: 'user', content: 'yes' }];
state.script = [turn(use('propose_remove', { workers: ['I1479', 'I1012'] })), say('Kevontae and Kenan come off; NSR42 goes back to free. Tap Remove from today to do it.')];
a = await ask('yes', rmCtx, { messages: yes });
assert.equal(a.body.proposal.kind, 'remove'); assert.deepEqual(a.body.proposal.check.workers.map(w => w.cn), ['I1479', 'I1012']); assert.equal(a.body.proposal.check.stamp, 'st1');
assert.deepEqual(calls().find(x => x[0] === 'benny_check_remove')[1], { p_center: 'c1', p_workers: ['I1479', 'I1012'] });
assert(!fns().some(f => /remove_begin|remove_done/.test(f)), 'the server only checks: the app removes, after the tap');
// typed with the real name: straight to the card
state.script = [turn(use('propose_remove', { workers: ['I1012'] })), say('Tap Remove from today to do it.')];
a = await ask('take Kenan off today, he went home', { ...rmCtx, spoken: false }); assert.equal(a.body.proposal.kind, 'remove'); assert.equal(a.body.proposal.check.workers.length, 1);
// a yes to a long answer of ours (not a question about them) doesn't name anyone
state.script = [turn(use('propose_remove', { workers: ['I1479'] })), say('Do you mean Kevontae Ragguette (I1479)?')];
a = await ask('remove Devante', { ...rmCtx, spoken: false }, { messages: [{ role: 'user', content: 'who is on my team' }, { role: 'assistant', content: 'Your team today: ' + 'Kevontae Ragguette (I1479) on NSR42; '.repeat(14) }, { role: 'user', content: 'remove Devante' }] });
assert.equal(a.body.proposal, null);
// the database's own no (nobody by that name) makes no card either; an older tab is told to refresh
state.script = [turn(use('propose_remove', { workers: ['Devante'] })), say('Nobody called Devante is on today’s map.')];
a = await ask('remove Devante', { ...rmCtx, spoken: false }); assert.equal(a.body.proposal, null);
state.script = [turn(use('propose_remove', { workers: ['I1012'] })), say('Tap Remove from today to do it.')];
a = await ask('take Kenan off today', { screen: 'rm', rm_manager: 'rm_me' }); assert.equal(a.body.proposal, null); assert(/Refresh the page/.test(a.body.reply));
state.role = 'admin'; state.mode = 'main';
console.log('5p remove: named workers only (a by-sound match is asked about), a card for the app to carry out, nothing removed by the server ✓');

// 5q. pace and strategy: read from the pace lookup, always on the main model, for admins (the crew) and route managers (their team)
state.role = 'admin'; state.mode = 'fast_first';
state.script = [turn(use('pace', {})), say('Today has 3 steps and 176 knocks by 15:01; the earlier 11 days usually had 15 steps and 204 knocks by then. What do you count as a good start: doors, sales or dollars?')];
a = await ask('compared to other days is this a good start or bad start', { path: '/app/workerbook/days/2026-11-11' });
assert.deepEqual(state.models, [MAINM, MAINM], 'a view on pace is never tried on the small model'); assert.equal(used().why, 'compare');
assert.deepEqual(calls()[1], ['benny_pace', { p_center: 'c1', p_manager: null, p_worker: null, p_date: null, p_at: null }]);
assert(a.body.reply.includes('What do you count as a good start')); assert.equal(a.body.proposal, null);
for (const q of ['are we behind today', 'should I move Kyle to another route', 'how do I get the slow carts going', 'how many knocks does Mugove have', 'where will we finish', 'what would you do with the rookies']) {
  state.script = [say('ok')]; await ask(q); assert.deepEqual(state.models, [MAINM], q); assert(['judge', 'compare', 'change'].includes(used().why), q);
}
state.script = [turn(use('pace', { worker: ' Kyle ', at: '12:00', date: '2026-11-05' })), say('ok')]; await ask('how was Kyle doing at noon on the 5th against his usual pace');
assert.deepEqual(calls()[1][1], { p_center: 'c1', p_manager: null, p_worker: 'Kyle', p_date: '2026-11-05', p_at: '12:00' });
state.script = [turn(use('pace', { at: 'noonish', date: 'yesterday', worker: '' })), say('ok')]; await ask('pace at noon');
assert.deepEqual(calls()[1][1], { p_center: 'c1', p_manager: null, p_worker: null, p_date: null, p_at: null }, 'a time or a date it can’t read is left out, not passed on');
state.role = 'rm'; state.script = [turn(use('pace', {})), say('ok')]; await ask('is my team behind', { screen: 'rm', rm_manager: 'rm_me' });
assert.equal(calls().find(c => c[0] === 'benny_pace')[1].p_manager, 'rm_me'); assert(state.lastAsk.tools.some(t => t.name === 'pace'), 'route managers have it for their own team');
state.role = 'admin'; state.mode = 'main';
console.log('5q pace: from the pace lookup, on the main model, for the crew, a team or a worker ✓');

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
