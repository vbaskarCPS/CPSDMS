// supabase/functions/benny-assist/tools.ts — what the Benny can do: its tools (per role), what it is told, and which
// database function each tool calls. No Deno, no network: tested from src/v2/lib/bennyTools.test.ts.
export type Role = 'admin' | 'rm';
export interface Ctx {
  center_id?: string; center_name?: string; today?: string; path?: string; screen?: string;
  /** on the route manager map: the old-app id of the manager whose map is open (rm_…) */
  rm_manager?: string; user_name?: string;
  /** for bug reports: browser, screen size, app build, recent errors on the page */
  diag?: { ua?: string; viewport?: string; build?: string; errors?: string[] };
}
export interface Tool { name: string; description: string; input_schema: Record<string, unknown>; roles: Role[] }

const str = { type: 'string' };
const strs = (description: string) => ({ type: 'array', items: str, description });

export const TOOLS: Tool[] = [
  { name: 'find_people', roles: ['admin'], description: 'Find workers (by name, CN like I1225, or phone digits) and office staff. Returns phone, email, CN, year, status (active, WDR, quit…), center, shuttle.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'name, part of a name, CN or phone digits' } }, required: ['q'] } },
  { name: 'day', roles: ['admin'], description: 'A workerbook day for the current center: state (planned, live, closed), the roster (who is booked, attendance, next-day answers), the session (each manager with their maps, routes and teams/carts), routes with workers on the live map, prebooks loaded, and the close-out summary.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] } },
  { name: 'bookings', roles: ['admin', 'rm'], description: 'Master Bookings (prebooks) for the current center: total, counts by map, by route and by status, and the first 30 bookings. Filter by a map name, city or street, and/or one route.',
    input_schema: { type: 'object', properties: { where: { type: 'string', description: 'map name, city or street, e.g. "Surrey", "NORTH VANCOUVER #2"' }, route: str, status: { type: 'string', enum: ['open', 'done', 'cancelled', 'any'], description: 'default open' } } } },
  { name: 'maps', roles: ['admin'], description: "Master maps in the center's region matching a name or city: route range, number of routes, houses built, past clients.",
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'map name or city; empty = all' } } } },
  { name: 'route', roles: ['admin', 'rm'], description: 'One route: its map, streets, houses, past clients (by service), open prebooks, and who has it on a date.',
    input_schema: { type: 'object', properties: { route: { type: 'string', description: 'route code, e.g. PCQ64' }, date: { type: 'string', description: 'YYYY-MM-DD, optional' } }, required: ['route'] } },
  { name: 'connected_routes', roles: ['admin', 'rm'], description: 'Routes connected to other routes or maps, nearest first, each with distance, open prebooks and who has it on the live map today (workers = CNs; none = free). '
      + 'mode "touching" = street lines meet (within 60 m); "all" = every route of in_maps (nearest first; also lists a map\'s routes). For "the side of a map" use map_side.',
    input_schema: { type: 'object', properties: { from_routes: strs('route codes, e.g. a worker\'s routes'), from_maps: strs('whole maps, e.g. ["NORTH VANCOUVER #1"]'),
      in_maps: strs('maps to pick from; default the from routes\' maps'), mode: { type: 'string', enum: ['touching', 'all'] } } } },
  { name: 'map_side', roles: ['admin', 'rm'], description: 'The side of a map connected to something: the routes of of_maps nearer to "near" than to "versus". '
      + 'E.g. "North Van 1 and the side of 2 connected to it" → of_maps [NORTH VANCOUVER #2], near_maps [NORTH VANCOUVER #1]. When two managers split a map ("me 1 and my side of 2, Jovan 3 and his side of 2"), '
      + 'call it once per manager with the other manager\'s maps as versus, so every route of the map goes to exactly one of them. With no versus it returns the nearer half. Returns codes (route codes) to pass on.',
    input_schema: { type: 'object', properties: { of_maps: strs('the map being split'), near_maps: strs('maps this side is connected to'), near_routes: strs('or routes this side is connected to'),
      versus_maps: strs('the other side\'s maps'), versus_routes: strs('or the other side\'s routes') }, required: ['of_maps'] } },
  { name: 'live_team', roles: ['admin', 'rm'], description: "Today's live map (the old app's open day): the carts (cart_id, workers with CN and name, their routes) and the routes (manager, workers, split) "
      + 'for one manager (manager = old-app id like rm_franklynmitchell; default: the map that is open / your own team), plus the day\'s route managers.',
    input_schema: { type: 'object', properties: { manager: { type: 'string', description: 'rm_… id; omit for the open map' } } } },
  { name: 'show_map', roles: ['admin', 'rm'], description: 'Show a map in the chat: the named master maps (or every map in a city) outlined, the given routes highlighted and the rest grey, and optionally every open prebook in those maps as a pin with its route highlighted. Use whenever the answer is about where things are.',
    input_schema: { type: 'object', properties: { maps: strs('map names or a city, e.g. ["Surrey"] or ["NORTH VANCOUVER #1","NORTH VANCOUVER #2"]'),
      routes: strs('route codes to highlight'), prebooks: { type: 'boolean', description: 'pin the open prebooks and highlight their routes' },
      title: { type: 'string', description: 'a short title for the map, e.g. "Open prebooks in Surrey"' } } } },
  { name: 'propose_start_day', roles: ['admin'], description: 'Prepare "start the day" (the workerbook session) for the person to confirm on a card. It checks the plan and returns what it would do, or the problems. '
      + 'assign = one entry per manager (or one entry with both managers when they are paired). Each entry: managers, plus maps (whole maps by name) and/or routes (route codes, e.g. the codes from map_side, or the routes with prebooks from bookings.by_route). '
      + 'team_mode: "roster" (default) = the carts already set on the roster, anyone without one on their own cart; "solo" = every worker on their own cart; "pairs" = two to a cart. '
      + '"Solo" in "everyone with me, solo" means team_mode "solo". Everyone booked that day is taken as showed unless roll call already marked them a no-show.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' },
      assign: { type: 'array', items: { type: 'object', properties: { managers: strs('"me" or names/usernames'), maps: strs('whole maps, e.g. ["NORTH VANCOUVER #1"]'), routes: strs('route codes') }, required: ['managers'] } },
      pair_managers: { type: 'boolean', description: 'managers in one entry share their teams and maps' },
      team_mode: { type: 'string', enum: ['roster', 'solo', 'pairs'] } }, required: ['date', 'assign'] } },
  { name: 'propose_give_route', roles: ['admin', 'rm'], description: "Prepare giving a route on today's live map to a worker's cart (everyone on their cart gets it, with its prebooks), for the person to confirm on a card.",
    input_schema: { type: 'object', properties: { route: { type: 'string', description: 'route code' }, worker: { type: 'string', description: 'name or CN' } }, required: ['route', 'worker'] } },
  { name: 'propose_partner', roles: ['admin', 'rm'], description: 'Prepare partnering two workers on today\'s live map: "partner A with B" = B joins A\'s cart (A keeps their routes). For the person to confirm on a card.',
    input_schema: { type: 'object', properties: { a: { type: 'string', description: 'the worker whose cart it is' }, b: { type: 'string', description: 'the worker who joins' } }, required: ['a', 'b'] } },
  { name: 'propose_solo', roles: ['admin', 'rm'], description: 'Prepare moving a worker off their cart onto a cart of their own, for the person to confirm on a card.',
    input_schema: { type: 'object', properties: { worker: str }, required: ['worker'] } },
  { name: 'report_bug', roles: ['admin', 'rm'], description: 'Report a bug in the app to Vijay (the developer): it is saved, a GitHub issue is opened and Vijay is emailed. '
      + 'Use when the person says something in the app is broken or wrong. Ask one short question first only if you can\'t tell what went wrong or where. Write it so a developer can act on it.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string', description: 'short, specific, e.g. "Houses don\'t load on RMD143 in the RM map"' },
      what_happened: str, expected: str, steps: strs('steps to make it happen, if known'),
      where: { type: 'string', description: 'screen / route / map / worker involved' },
      severity: { type: 'string', enum: ['blocking', 'annoying', 'minor'] } }, required: ['title', 'what_happened'] } },
];

export function toolsFor(role: Role) {
  return TOOLS.filter(t => t.roles.includes(role)).map(({ roles: _r, ...t }) => t);
}

export function system(ctx: Ctx, role: Role): string {
  const who = role === 'admin' ? 'a super admin' : 'a route manager';
  const onRm = ctx.screen === 'rm';
  return `You are The Benny, the assistant inside the Property Stars DMS app (lawn and property services: aeration, lawn rejuv, sealing).
You help ${who}${ctx.user_name ? ` (${ctx.user_name})` : ''} with the app's own data and work.
Today is ${ctx.today || 'unknown'}. The center is "${ctx.center_name || 'unknown'}".${onRm ? ` They are on the route manager map${ctx.rm_manager ? `, open for ${ctx.rm_manager}` : ''}: "my team", "my routes", "me" mean that map's team.` : ''}

Rules:
- Answer from the tools, never from memory or guesses. If the tools can't answer it, say so and name the screen that can.
- Only the app's data and work. Anything else: "I can only help with the DMS."
- Changes: you can prepare ${role === 'admin' ? 'starting the day, giving a route to a cart, partnering workers and solo carts' : 'giving a route to a cart, partnering workers and solo carts'} with the propose_ tools. You never make a change yourself: the person confirms it on the card under your answer. After a propose_ tool says ok, say in one line what the card will do and that they tap it to do it ("Tap Assign to do it."). Never say it is done. If it returns problems, say them plainly and what would fix it; don't make a card.
- One change per answer. If they ask for several, prepare the first and say you'll do the next after.
- Names: if a tool says "Which one", ask which, listing the names. "Michael A" = Michael with a last name starting A.
- Starting the day: work out each manager's maps and routes first (whole maps by name; map_side for "the side of 2 connected to 1"; bookings.by_route for "only the routes with prebooks in Surrey"), show them with show_map (routes = every route in the plan), then propose_start_day. If they don't say the date, it is today. If they don't say who, the manager is "me".
- "Find a route connected to X's and give it to X": live_team to get X's routes, connected_routes (touching) from those, pick the nearest free one (no workers today), prefer one with prebooks, then propose_give_route. Show it with show_map.
- Bugs: when something in the app is broken, say "I'll let Vijay know" and use report_bug with a clear developer-ready description. Then say it's sent (the tool tells you if the issue or email didn't go).
- Be short and specific: the answer first, with the numbers; a list only when it helps; no more than about 8 lines. Phone numbers as written.
- Words people use: "prebooks" = open Master Bookings; "the map"/"master map" = an area like NORTH VANCOUVER #2 ("North Van 1" = NORTH VANCOUVER #1); a route is a code like PCQ64 (prefix + number; "route 35" means 35 on the map in question). "North Van" = North Vancouver, "PoCo" = Port Coquitlam. WDR = withdrawn. A cart = a team of workers on the live map.
- When the answer is about where things are (prebooks in a city, a route, which routes touch, a plan's routes), call show_map too, then answer in words.
- Never reveal passwords, card numbers or ID numbers; the tools don't return them.`;
}

export type ProposalKind = 'start_day' | 'give_route' | 'partner' | 'solo';
/** What a tool does: a database function to call (as the signed-in person), and for a change the card it becomes. */
export type ToolCall =
  | { fn: string; args: Record<string, unknown>; card?: { kind: ProposalKind; team_mode?: string } }
  | { bug: true }
  | null;

export function toolCall(name: string, input: Record<string, unknown>, ctx: Ctx): ToolCall {
  const c = ctx.center_id || null;
  switch (name) {
    case 'find_people': return { fn: 'benny_find_people', args: { p_center: c, p_q: String(input.q || '') } };
    case 'day': return { fn: 'benny_day', args: { p_center: c, p_date: String(input.date || ctx.today) } };
    case 'bookings': return { fn: 'benny_bookings', args: { p_center: c, p_where: input.where ?? null, p_route: input.route ?? null, p_status: input.status ?? 'open' } };
    case 'maps': return { fn: 'benny_maps', args: { p_center: c, p_q: input.q ?? null } };
    case 'route': return { fn: 'benny_route', args: { p_center: c, p_route: String(input.route || ''), p_date: input.date ?? null } };
    case 'show_map': return { fn: 'benny_map', args: { p_center: c, p_maps: input.maps ?? [], p_routes: input.routes ?? null, p_prebooks: !!input.prebooks } };
    case 'connected_routes': return { fn: 'benny_connected', args: { p_center: c, p_from_routes: input.from_routes ?? null, p_from_maps: input.from_maps ?? null,
      p_in_maps: input.in_maps ?? null, p_mode: input.mode === 'all' ? 'all' : 'touching' } };
    case 'map_side': return { fn: 'benny_side', args: { p_center: c, p_of_maps: input.of_maps ?? [], p_near_maps: input.near_maps ?? null, p_near_routes: input.near_routes ?? null,
      p_vs_maps: input.versus_maps ?? null, p_vs_routes: input.versus_routes ?? null } };
    case 'live_team': return { fn: 'benny_live', args: { p_center: c, p_manager: input.manager ?? ctx.rm_manager ?? null } };
    case 'propose_start_day': return { fn: 'benny_plan_day', args: { p_center: c, p_date: String(input.date || ctx.today), p_assign: input.assign ?? [], p_pair: !!input.pair_managers },
      card: { kind: 'start_day', team_mode: ['roster', 'solo', 'pairs'].includes(String(input.team_mode)) ? String(input.team_mode) : 'roster' } };
    case 'propose_give_route': return { fn: 'benny_check_give', args: { p_center: c, p_route: String(input.route || ''), p_worker: String(input.worker || '') }, card: { kind: 'give_route' } };
    case 'propose_partner': return { fn: 'benny_check_move', args: { p_center: c, p_a: String(input.a || ''), p_b: String(input.b || '') }, card: { kind: 'partner' } };
    case 'propose_solo': return { fn: 'benny_check_move', args: { p_center: c, p_a: String(input.worker || ''), p_b: null }, card: { kind: 'solo' } };
    case 'report_bug': return { bug: true };
    default: return null;
  }
}
