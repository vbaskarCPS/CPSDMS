// scripts/benny-server-dryrun.mjs — run: node scripts/benny-server-dryrun.mjs
// Dry run of the Benny's server (supabase/functions/benny-assist) with a scripted model and a stand-in database, so its
// glue can be checked without deploying: sign-in, roles, tools → database calls, cards, the map with a change, bug reports.
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
      if (fn === 'benny_bug_save') return { data: 'bug-1', error: null };
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
  if (u.includes('api.github.com')) return new Response(JSON.stringify({ html_url: 'https://github.com/x/y/issues/7' }), { status: 201 });
  if (u.includes('api.resend.com')) return new Response('{}', { status: 200 });
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
assert.equal(state.lastAsk.tools.length, 14); assert(!('roles' in state.lastAsk.tools[0]));
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

// 5. bug report without the secrets: saved, and says what didn't go
state.script = [turn(use('report_bug', { title: 'Houses don’t load on RMD143', what_happened: 'No houses drawn', steps: ['Open RM map', 'Tap RMD143'] })), say('Saved; the issue and email didn’t go.')];
a = await ask('houses arent loading on rmd143', { path: '/app/rm', diag: { errors: ['12:00:01 TypeError: x'] } });
assert.deepEqual(fns(), ['benny_ok_any', 'benny_bug_save', 'benny_bug_sent']);
assert.equal(state.rpc[2][1].p_emailed, false); assert(state.rpc[2][1].p_error.includes('GITHUB_TOKEN is not set'));
assert(!state.http.some(h => h[0].includes('github') || h[0].includes('resend')));
console.log('5 bug report, no secrets ✓');

// 6. bug report with the secrets: GitHub issue + email, linked
state.env = { GITHUB_TOKEN: 'gh', RESEND_API_KEY: 're', BENNY_BUG_EMAIL: 'owner@example.test' };
state.script = [turn(use('report_bug', { title: 'Houses don’t load on RMD143', what_happened: 'No houses drawn', expected: 'Houses', where: 'RM map', severity: 'blocking' })), say('I’ll let Vijay know. It’s sent.')];
a = await ask('houses arent loading on rmd143', { path: '/app/rm', user_name: 'Franklyn Mitchell', center_name: 'BC Fall RJ', diag: { ua: 'UA', viewport: '390×844', build: 'abc', errors: ['12:00:01 TypeError: x'] } });
const gh = state.http.find(h => h[0].includes('api.github.com')); const mail = state.http.find(h => h[0].includes('api.resend.com'));
assert.equal(gh[0], 'https://api.github.com/repos/vbaskarCPS/CPSDMS/issues'); assert(gh[1].title.startsWith('[Benny] Houses')); assert(gh[1].body.includes('TypeError: x') && gh[1].body.includes('/app/rm') && gh[1].body.includes('Franklyn Mitchell'));
assert.deepEqual(mail[1].to, ['owner@example.test']); assert(mail[1].text.includes('https://github.com/x/y/issues/7'));
assert.equal(state.rpc[2][1].p_issue_url, 'https://github.com/x/y/issues/7'); assert.equal(state.rpc[2][1].p_emailed, true); assert.equal(state.rpc[2][1].p_error, null);
console.log('6 bug report → issue + email ✓');
console.log('--- the GitHub issue body ---\n' + gh[1].body + '\n---');

// 7. who gets in
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
console.log('7 sign-in, roles, history, step limit ✓');
