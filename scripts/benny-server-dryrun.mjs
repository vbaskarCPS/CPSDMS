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
assert.equal(state.lastAsk.tools.length, 15); assert(!('roles' in state.lastAsk.tools[0]));
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
