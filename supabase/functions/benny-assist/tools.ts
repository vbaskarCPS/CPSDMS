// supabase/functions/benny-assist/tools.ts — what the Benny can do: its tools (per role), what it is told, and which
// database function each tool calls. No Deno, no network: tested from src/v2/lib/bennyTools.test.ts.
export type Role = 'admin' | 'rm';
export interface Ctx {
  center_id?: string; center_name?: string; today?: string; path?: string; screen?: string;
  /** on the route manager map: the old-app id of the manager whose map is open (rm_…); on the floater map, the floater's own (floater_…) */
  rm_manager?: string; user_name?: string;
  /** on the floater map: the managers followed there (their old-app ids), and their names for the answer */
  following?: string[]; following_names?: string[];
  /** the last message was spoken (speech-to-text): names and codes may be misheard */
  spoken?: boolean;
  /** for bug reports: browser, screen size, app build, recent errors on the page */
  diag?: { ua?: string; viewport?: string; build?: string; errors?: string[] };
  /** the change cards this open app can show (a tab opened before a new kind existed doesn't list it) */
  cards?: string[];
}
/** The names to expect in a spoken message (benny_vocab). */
export interface Vocab { workers?: string[]; managers?: string[]; places?: string[] }
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
  { name: 'booking', roles: ['admin'], description: 'One Master Booking (people also say prebook, job or service ticket) by its address, house number first in digits ("3575 Latimer"), or by the client\'s name: '
      + 'status (open, done, cancelled), list, job code, route and map, prepaid, the people, field note (what the crew reads) and office note, tries so far, and whether it is loaded on today\'s live map. No phone numbers or emails.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'house number and street ("3575 Latimer"), a client name, or the id from an earlier result' } }, required: ['q'] } },
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
  { name: 'live_team', roles: ['admin', 'rm'], description: "Today's live map (the old app's open day): the carts (cart_id, workers with CN and name, their routes, and the day's numbers so far: steps, equiv, gross, upsells), totals (steps, equiv, gross, upsells) and the routes (manager, workers, split) "
      + 'for one manager (manager = old-app id like rm_franklynmitchell; default: the map that is open / your own team; on the floater map, the managers followed, together), plus the day\'s route managers.',
    input_schema: { type: 'object', properties: { manager: { type: 'string', description: 'rm_… id; omit for the open map' } } } },
  { name: 'logsheet', roles: ['admin', 'rm'], description: "One worker's logsheet today (their cart on the live map): every job logged on it with its id, client, address, route, type (Production, Sale, Upgrade, Add-On), service, amount and how it was paid, "
      + 'plus the cart\'s totals (steps, equiv, gross, and cash, cheque, e-transfer, card, prepaid, billed) and whether it is already paid out. Use it to answer what someone has logged, and to find a job before changing it. No phone numbers, emails or card details.',
    input_schema: { type: 'object', properties: { worker: { type: 'string', description: 'the worker whose cart it is: name or CN' } }, required: ['worker'] } },
  { name: 'show_map', roles: ['admin', 'rm'], description: 'Show a map in the chat: the named master maps (or every map in a city) outlined, the given routes highlighted and the rest grey, and optionally every open prebook in those maps as a pin with its route highlighted. Use whenever the answer is about where things are.',
    input_schema: { type: 'object', properties: { maps: strs('map names or a city, e.g. ["Surrey"] or ["NORTH VANCOUVER #1","NORTH VANCOUVER #2"]'),
      routes: strs('route codes to highlight'), prebooks: { type: 'boolean', description: 'pin the open prebooks and highlight their routes' },
      title: { type: 'string', description: 'a short title for the map, e.g. "Open prebooks in Surrey"' } } } },
  { name: 'crew_stats', roles: ['admin'], description: "The workers booked on a day, ranked best first by their season so far at this center: average equiv per day worked (also average steps and gross per day, days worked, last day worked, and the roster cart they are on, if any). "
      + 'Workers with no days yet are listed apart (nothing to rank them by), and so are the no-shows. It also lists the route managers available that day (managers) and whether the person asking is one (you.can_manage, you.why_not). Use it for "the best / worst workers", "who are my top five", and before splitting the crew between managers or drafting teams.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; today when they don\'t say' } } } },
  { name: 'propose_start_day', roles: ['admin'], description: 'Prepare "start the day" (the workerbook session) for the person to confirm on a card. It checks the plan and returns what it would do, or the problems. '
      + 'assign = one entry per manager (or one entry with both managers when they are paired). Each entry: managers, plus maps (whole maps by name) and/or routes (route codes, e.g. the codes from map_side, or the routes with prebooks from bookings.by_route), '
      + 'and optionally workers = who goes with that manager (names or CNs from crew_stats). Give workers only when they say who goes with whom; then every worker who showed has to be in exactly one entry. Without workers the carts are dealt to the managers as before. '
      + 'team_mode: "roster" (default) = the carts already set on the roster, anyone without one on their own cart; "solo" = every worker on their own cart; "pairs" = two to a cart. '
      + '"Solo" in "everyone with me, solo" means team_mode "solo". Everyone booked that day is taken as showed unless roll call already marked them a no-show.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' },
      assign: { type: 'array', items: { type: 'object', properties: { managers: strs('"me" or names/usernames'), maps: strs('whole maps, e.g. ["NORTH VANCOUVER #1"]'), routes: strs('route codes'),
        workers: strs('this manager\'s crew: CNs (best) or full names, e.g. ["I1065","I1002"]') }, required: ['managers'] } },
      pair_managers: { type: 'boolean', description: 'managers in one entry share their teams and maps' },
      team_mode: { type: 'string', enum: ['roster', 'solo', 'pairs'] } }, required: ['date', 'assign'] } },
  { name: 'propose_give_route', roles: ['admin', 'rm'], description: "Prepare giving a route on today's live map to a worker's cart (everyone on their cart gets it, with its prebooks), for the person to confirm on a card.",
    input_schema: { type: 'object', properties: { route: { type: 'string', description: 'route code' }, worker: { type: 'string', description: 'name or CN' } }, required: ['route', 'worker'] } },
  { name: 'propose_partner', roles: ['admin', 'rm'], description: 'Prepare partnering two workers on today\'s live map: "partner A with B" = B joins A\'s cart (A keeps their routes). For the person to confirm on a card.',
    input_schema: { type: 'object', properties: { a: { type: 'string', description: 'the worker whose cart it is' }, b: { type: 'string', description: 'the worker who joins' } }, required: ['a', 'b'] } },
  { name: 'propose_solo', roles: ['admin', 'rm'], description: 'Prepare moving a worker off their cart onto a cart of their own, for the person to confirm on a card.',
    input_schema: { type: 'object', properties: { worker: str }, required: ['worker'] } },
  { name: 'propose_job_change', roles: ['admin', 'rm'], description: 'Prepare a change to one job on a worker\'s logsheet today, for the person to confirm on a card: its amount, how it was paid (cash, cheque, e-transfer, prepaid, billed), or both. '
      + 'Call logsheet first and pass that job\'s id. It refuses the jobs that must not be changed from here (a logsheet already paid out, a card or split payment, an office flat, an asphalt job) and says where to change them instead.',
    input_schema: { type: 'object', properties: { worker: { type: 'string', description: 'the worker whose cart it is: name or CN' }, job: { type: 'string', description: 'the job\'s id, from logsheet' },
      amount: { type: 'number', description: 'the new amount in dollars; leave out if it stays' }, paid_by: { type: 'string', enum: ['cash', 'cheque', 'e-transfer', 'prepaid', 'billed'], description: 'leave out if it stays' } }, required: ['worker', 'job'] } },
  { name: 'payouts', roles: ['admin'], description: "Today's payouts (the live day): each cart with its workers, whether it is paid out and the pay it was closed at, its jobs, steps and gross, what was collected by payment type, "
      + 'and whether it has cash or cheque to count by hand. Use it for "which payouts are open", "who still has cash to count", "what was Mugove paid".',
    input_schema: { type: 'object', properties: {} } },
  { name: 'propose_payouts', roles: ['admin'], description: 'Line up the open payouts that have nothing to count by hand (no cash and no cheque: card, e-transfer, prepaid and billed are already in the system) for the person to finalize one after another. '
      + 'It pays nobody and marks nothing paid: the card opens the payout screen at the first one, and pressing Finalize there moves to the next. A cart with no jobs has nothing to count either, so it is lined up too, after the ones with jobs. Carts with cash or cheque to count are left out and named.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'propose_booking', roles: ['admin'], description: 'Prepare a change to one Master Booking (prebook / job / service ticket) for the person to confirm on a card: mark it done, cancelled or open again; '
      + 'add to or replace its field note (what the crew reads at the door) or its office note; move it to another route. One booking per call; several changes to the same booking go in one call. '
      + 'It finds the booking by address itself, so call it directly; when it answers "Which one", ask, then call again with that booking\'s id.',
    input_schema: { type: 'object', properties: {
      booking: { type: 'string', description: 'house number and street, digits first ("3575 Latimer"), or the id from booking / a which list' },
      status: { type: 'string', enum: ['open', 'done', 'cancelled'] },
      field_note: { type: 'string', description: 'for the crew: gate code, dog, where to start' }, office_note: { type: 'string', description: 'for the office only' },
      note_mode: { type: 'string', enum: ['add', 'replace'], description: 'add (default) goes under what is there; replace overwrites it, and replace with empty text clears it' },
      route: { type: 'string', description: 'route code to move it to, e.g. RMD137' } }, required: ['booking'] } },
  { name: 'propose_booking_emails', roles: ['admin'], description: 'Set up the booking emails to customers (people also say service notification emails) for the person to read and send themselves. '
      + 'kind "day_before" = the reminder that the crew comes that day (open bookings); "next_try" = we missed you and are coming back (bookings already tried). For tomorrow or the day after only, for the routes or whole maps being worked that day. '
      + 'It checks and counts who would get one; the card then opens Bookings › Send booking emails with the day and routes picked and the emails written, and the person reads them and presses Send there. You never send an email, and you get no customer names or addresses from this.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['day_before', 'next_try'] }, date: { type: 'string', description: 'YYYY-MM-DD: tomorrow (default) or the day after' },
      maps: strs('whole maps, e.g. ["NORTH DELTA #1"]'), routes: strs('route codes') }, required: ['kind'] } },
  { name: 'propose_pin', roles: ['admin', 'rm'], description: 'Prepare a pin on the route manager map for the person to confirm on a card. Give exactly one place: route (a route code: the pin goes on its streets), '
      + 'worker (a name: where they are now, from their last knock or their phone, else their route), address (house number and street: a booking or any house on the maps), or here (where the manager is right now). '
      + 'see = who can see it: "me" (default), "everyone" (every manager in the center), "manager" (one manager: put the name in to), or "driver" (a stop on a worker driver\'s queue: put the worker in to).',
    input_schema: { type: 'object', properties: { label: { type: 'string', description: 'the pin\'s name, short, e.g. "Lunch", "Truck", "Meet here"; leave out if they gave none' },
      route: str, worker: str, address: { type: 'string', description: 'house number first, in digits, e.g. "10992 Brandy Dr"' }, here: { type: 'boolean' },
      see: { type: 'string', enum: ['me', 'everyone', 'manager', 'driver'] }, to: { type: 'string', description: 'the manager or the worker driver, when see is manager or driver' } } } },
  { name: 'propose_stops', roles: ['admin', 'rm'], description: 'Plan a drop, pickup or check order for the manager\'s carts on today\'s live map, as numbered pins for the person to confirm on a card. '
      + 'kind "drop" = taking each cart to its route; "pickup" = collecting each cart from where it is now; "check" = visiting each cart where it is now (now = their last knock or their phone; else their route). '
      + 'It finds each cart\'s stop and says who was left out and why; the app then puts the stops in order by driving time, from where the manager is when their location is known. only = just these workers\' carts.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['drop', 'pickup', 'check'] }, only: strs('worker names, when they want just some carts') }, required: ['kind'] } },
  { name: 'report_bug', roles: ['admin', 'rm'], description: 'Report a bug in the app to Vijay (the developer): it is saved in the app\'s Bug log, which he reads. '
      + 'Use when the person says something in the app is broken or wrong. Ask one short question first only if you can\'t tell what went wrong or where. Write it so a developer can act on it.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string', description: 'short, specific, e.g. "Houses don\'t load on RMD143 in the RM map"' },
      what_happened: str, expected: str, steps: strs('steps to make it happen, if known'),
      where: { type: 'string', description: 'screen / route / map / worker involved' },
      severity: { type: 'string', enum: ['blocking', 'annoying', 'minor'] } }, required: ['title', 'what_happened'] } },
  { name: 'log_request', roles: ['admin', 'rm'], description: 'Log something the person asked for that you could not do because you have no tool for it (a change you cannot prepare, numbers no tool returns), so Vijay sees what to build next. '
      + 'Call it every time that happens, then tell the person you can\'t do that yet and that it\'s logged. Not for things outside the DMS, and not for something you did answer.',
    input_schema: { type: 'object', properties: {
      title: { type: 'string', description: 'what they wanted, short, e.g. "Change the price on a booking"' },
      asked: { type: 'string', description: 'their request, in their words' },
      why_not: { type: 'string', description: 'what is missing, e.g. "no tool changes a booking\'s services or price"' },
      would_need: { type: 'string', description: 'what it would take, if you can tell (a lookup of X, a change to Y)' } }, required: ['title', 'asked'] } },
];

export function toolsFor(role: Role) {
  return TOOLS.filter(t => t.roles.includes(role)).map(({ roles: _r, ...t }) => t);
}

/** How CPS people talk. The Benny uses these words the way the crew does, and answers in them. */
export const CPS_WORDS = `
CPS words (use them the way the crew does, and answer in them):
- Step: one job logged on a logsheet (a production job, a sale or an upgrade each count as one). "Steps" = jobs done so far; "how many steps" is live_team's steps.
- Equiv (EQ, equivs, equivalents): the pay unit. Payable production ÷ 25. Payable = production after tax, with prepaid and billed jobs counted at part weight, less the product cost %; office flats count at their set value. Workers are paid per equiv.
- Gross: production dollars before any of that. Upsell: an add-on sold at the door (paid as commission, not equiv). IOS: a small per-item bonus.
- Payout rate: dollars per equiv = the season's base (one rate solo, a higher one in a team of 2 or more) + the worker's alumni rate + silver rate. Alumni rate: extra per equiv for returning contractors. Silver rate: extra per equiv from hats. Hats: a worker's experience count per service (AER, RJ, SE, CL).
- Logsheet: a cart's list of the day's jobs. A logsheet job (an entry): one line on it. Paid out: the logsheet has been checked and the pay worked out; after that a job is changed in Payout, not here.
- Cart: the workers sharing one logsheet (a team); a solo cart is one worker. Ramp crew (RC1, RC2): the asphalt crew in sealing. Equiv split / upsell split: how a cart shares its equiv and its upsell commission.
- Booking emails (service notification emails): the emails to customers about their booking. Day before = the crew is coming tomorrow. Next try = we missed you, we're coming back.
- Prebook: an open Master Booking waiting to be done on a route. Service ticket, ticket, job (at an address): the same thing, a Master Booking; "close the ticket" = mark it done. Field note: what the crew reads at the door. Office note: for the office only. PCL: past client list, the past customers on a route. Flats (office flats): office-set jobs worth a fixed amount (SP, RJ, FSL, AFSL). Prepaid, billed, cash, cheque, e-transfer, card: how a job is paid.
- Pin: a marker dropped on the route manager map (seen by just me, everyone, one manager, or a worker driver as a stop). Drop order: the order to take the carts to their routes. Pickup order: the order to collect them. Check order: the order to visit each cart during the day.
- CN: contractor number (like I1225). WDR: withdrawn. Q: quit. NS: no-show. Roll call: who showed. Next day: who is booked for tomorrow. Shuttle: their ride in.
- Session: the day once it is started (managers, routes, carts). Live map: today's routes and carts in the field. Close day, payouts, payslips: the end-of-day pay. Rate card: the season's pay rules. Product cost %: taken off production before equiv.
- RM: route manager. Floater: a manager covering other managers' teams. Center (command center): the office, like BC Fall RJ. Season: Aeration, Lawn Rejuv, Sealing or Cleaning. Master map: an area like NORTH VANCOUVER #2; a route is one numbered piece of it (NVN19).`;

/** For a spoken message: how to hear this app's own words, and the real names to match against. */
export function heardRight(vocab?: Vocab | null): string {
  const list = (label: string, items?: string[]) => (items?.length ? `\n${label}: ${items.slice(0, 220).join(', ')}` : '');
  return `

The last message was SPOKEN and turned into text by the phone, which doesn't know this app's words.
- Names and codes may be misheard as ordinary words: "Jaz will" = Jahswill, "Kevin Tay" = Kevontae, "Joe Van" = Jovan, "N Dell 33" or "endel thirty three" = NDEL33, "poco 64" = PCQ64, "north van one" = NORTH VANCOUVER #1.
- Before using a tool, match what you heard to the real names below BY SOUND and use the real one. When the name you use differs from what was heard, say so in a few words ("I heard Kevin Tay: using Kevontae Ragguette").
- If two real names could fit, ask which. If nothing sounds close, say what you heard and ask who they mean. Never guess a person for a change.
- A route code is a place's prefix + the number (two digits under 10: "NVN 7" = NVN07). A map is the place + #number.${list('Workers today', vocab?.workers)}${list('Route managers', vocab?.managers)}${list('Places (route prefix) and how many maps', vocab?.places)}`;
}

const isFloaterId = (id?: string | null) => /^floater_/.test((id || '').trim());
const ID = /^[A-Za-z0-9_.-]{1,80}$/;
/** The map that is open, as the database takes it (p_manager): a manager's id, or on the floater map the floater's id
 *  then the managers followed, "floater_basvi,rm_a,rm_b". The database checks every part against who is asking. */
export function openMap(ctx: Ctx): string | null {
  const id = (ctx.rm_manager || '').split(',')[0].trim();
  if (!id || !ID.test(id)) return null;
  if (!isFloaterId(id)) return id;
  const followed = Array.isArray(ctx.following) ? [...new Set(ctx.following.filter(x => typeof x === 'string' && ID.test(x) && !isFloaterId(x)))].slice(0, 30) : [];
  return [id, ...followed].join(',');
}
/** The followed managers' names, safe to put in what the Benny is told. */
const followedNames = (ctx: Ctx): string[] => (Array.isArray(ctx.following_names) ? ctx.following_names : [])
  .filter(x => typeof x === 'string').map(x => x.replace(/[^\p{L}\p{N} .'’-]/gu, '').trim().slice(0, 60)).filter(Boolean).slice(0, 12);

export function system(ctx: Ctx, role: Role, vocab?: Vocab | null): string {
  const who = role === 'admin' ? 'a super admin' : 'a route manager';
  const onRm = ctx.screen === 'rm';
  const floating = onRm && isFloaterId(ctx.rm_manager);
  const names = followedNames(ctx);
  const where = !onRm ? '' : floating
    ? ` They are on the floater map, following ${names.length ? names.join(', ') : 'the managers they picked'}: "my team", "my carts", "my routes", "me" mean those managers' teams together. A pin or an order they make is their own, for those managers' carts.`
    : ` They are on the route manager map${ctx.rm_manager ? `, open for ${ctx.rm_manager}` : ''}: "my team", "my routes", "me" mean that map's team.`;
  return `You are The Benny, the assistant inside the Property Stars DMS app (lawn and property services: aeration, lawn rejuv, sealing).
You help ${who}${ctx.user_name ? ` (${ctx.user_name})` : ''} with the app's own data and work.
Today is ${ctx.today || 'unknown'}. The center is "${ctx.center_name || 'unknown'}".${where}

Rules:
- Answer from the tools, never from memory or guesses. If the tools can't answer it, say so and name the screen that can.
- Only the app's data and work. Anything else: "I can only help with the DMS."
- Changes: you can prepare ${role === 'admin' ? 'starting the day, giving a route to a cart, partnering workers, solo carts, changing a job on a logsheet (amount, how it was paid), changing a booking (status, notes, route), setting up the booking emails to customers, and lining up payouts to finalize' : 'giving a route to a cart, partnering workers, solo carts and changing a job on a logsheet (amount, how it was paid)'} with the propose_ tools, and on the route manager map dropping a pin and planning a drop, pickup or check order. You never make a change yourself: the person confirms it on the card under your answer. After a propose_ tool says ok, say in one line what the card will do and that they tap it to do it ("Tap Assign to do it."). Never say it is done. If it returns problems, say them plainly and what would fix it; don't make a card.
- One change per answer. If they ask for several, prepare the first and say you'll do the next after.
- Names: if a tool says "Which one", ask which, listing the names. "Michael A" = Michael with a last name starting A.
- Starting the day: work out each manager's maps and routes first (whole maps by name; map_side for "the side of 2 connected to 1"; bookings.by_route for "only the routes with prebooks in Surrey"), show them with show_map (routes = every route in the plan), then propose_start_day. If they don't say the date, it is today. If they don't say who, the manager is "me".
- "Find a route connected to X's and give it to X": live_team to get X's routes, connected_routes (touching) from those, pick the nearest free one (no workers today), prefer one with prebooks, then propose_give_route. Show it with show_map.
${role === 'admin' ? `- Crews ("give Franklyn the worst half and me the good guys", "split the crew evenly", "draft the teams", "who are my best workers"): call crew_stats for that day first. Rank by average equiv per day worked unless they say steps or gross. "The worst half" = the bottom half of the ranking, "the good guys" = the rest; with an odd number the middle worker goes with the better half. An even split, balanced teams or a draft = managers take turns down the ranking in snake order (with two: 1st to A, 2nd and 3rd to B, 4th and 5th to A, and so on). Workers with no days yet can't be ranked: name them and ask who they go with before making the card (unless they already said, e.g. "new guys with me"). No-shows are in nobody's crew. Only the managers in crew_stats.managers can take a crew: if they said "me" and you.can_manage is false, or named someone who isn't listed, say that first, with why (you.why_not) and who is available, before asking anything else. Then propose_start_day with each manager's workers as CNs, plus their maps and routes. After ok, give each crew in one short line (how many, its average, the names) and any note about a roster cart being split, then "Tap Start the day to do it." Don't work out who is paired with whom or how many carts there are: the card says. Just asking who is best or worst is an answer from crew_stats, not a card.
- "The prebook-heavy maps in North Van" (or any city): bookings with where = the city, and take the maps with the most open prebooks; say which maps you took and how many prebooks each has. If none of its maps has an open prebook, say so and ask which maps they want instead.
- Booking emails ("service notification emails", "day-before emails", "let the customers know we're coming"): use propose_booking_emails with the kind, the day and that day's routes or whole maps. If they don't say which routes or maps, ask; "the routes with prebooks in Surrey" = bookings.by_route first. After ok, say how many customers get one, how many have no email and how many already got it, then "Tap Open to read and send." Never say an email was sent: the person reads them and sends them on that screen.
- Payouts: "which payouts are open", "who has cash to count", "what did Kyle get paid" = payouts. "Close / finalize / do the payouts with no cash or cheque" = propose_payouts. You never pay anyone out and never mark a logsheet paid: the card opens the payout screen and the person presses Finalize on each one. After ok, say how many are lined up (and which of them have no jobs), and who is left for a hand count and why, then "Tap Open to go through them." Never say a payout is closed.
- Bookings: to change a booking (a "service ticket") use propose_booking with the address as they said it, house number first in digits ("thirty five seventy five Latimer" = "3575 Latimer"). "Close", "complete", "finish" = done; "reopen" = open. A note with no kind: field note when it is for the crew (gate code, dog, where to start), office note otherwise; ask if you can't tell. "Add a note" = add; "change the note to" = replace. Say the card's cautions in a few words. Then "Tap Save to do it." Address, people, phone, services and price change in Bookings › List, not here.
` : ''}- Pins and orders (the route manager map): "drop a pin at/on …" = propose_pin with one place (a route code, a worker, an address, or here = where they are) and the name they gave it, if any. Only they see it unless they say everyone, name a manager, or say it is a stop for a driver. "Plan my drop order / pickup order / check order" = propose_stops. After ok, say how many stops there are, anyone left out and why, and that it replaces their earlier pins of that kind when it says so. Do NOT list the order or give a distance: the app works the order out by driving time and adds it under your answer. Say nothing about where they are either, unless the result has start_far: then say their location is too far from the carts, so the order starts at its first stop. Then "Tap Drop the pins to do it." ("Drop the pin" for one). Never say a pin is on the map before they tap.
- Logsheet jobs: "what has Kyle logged", "how much cash should Nathan have" = logsheet for that worker. To change a job ("change Ron's job on Mugove's cart to 250 prepaid") call logsheet first and find the job by client, address or service; if more than one fits, ask which, giving each one's client and amount. Then propose_job_change with that job's id and only what they asked to change. This changes what the worker is paid, so never guess: if the amount or the payment type wasn't clear, ask. After ok, say what it reads now and what it will read ("$180 cash becomes $250 prepaid") and any caution on the card, then "Tap Save to do it." If it says no (a logsheet already paid out, a card or split payment, an office flat), say why and where to change it instead; that is an answer, not something to log.
- Bugs: when something in the app is broken, use report_bug with a clear developer-ready description, then say "I'll let Vijay know — it's in the bug log." If the tool returns an error, say it wasn't saved.
- Be short and specific: the answer first, with the numbers; a list only when it helps; no more than about 8 lines. Phone numbers as written.
- Words people use: "prebooks" = open Master Bookings; "the map"/"master map" = an area like NORTH VANCOUVER #2 ("North Van 1" = NORTH VANCOUVER #1); a route is a code like PCQ64 (prefix + number; "route 35" means 35 on the map in question). "North Van" = North Vancouver, "PoCo" = Port Coquitlam. WDR = withdrawn. A cart = a team of workers on the live map.
- When the answer is about where things are (prebooks in a city, a route, which routes touch, a plan's routes), call show_map too, then answer in words.
- A live day has two records. The live map (live_team) is what is true NOW: carts and routes change through the day (routes get added, workers get moved, paired or sent home). The day tool's session is how the day was STARTED and is not updated after. For anything about now (who is working, carts, routes, steps, equiv) use live_team; quote the session only as "at the start". A difference between the two is normal, not a bug: don't report it as one, and don't mix their numbers.
- When you find nothing, say which center you looked in (the one in the top bar): they may be on a different one.
- Can't do it: when they ask for something in the DMS that you have no tool for (a change you can't prepare, numbers no tool returns), call log_request with what they wanted, then say plainly that you can't do that yet and that it's logged for Vijay. Never pretend, and never leave it unlogged.
- A tool result with heard_as matched the name by sound: say which name you used. A result with which or closest lists near matches: ask which one, or use it when only one fits.
- Never reveal passwords, card numbers or ID numbers; the tools don't return them.
` + CPS_WORDS + (ctx.spoken ? heardRight(vocab) : '');
}

export type ProposalKind = 'start_day' | 'give_route' | 'partner' | 'solo' | 'booking' | 'booking_emails' | 'pin' | 'stops' | 'job' | 'payouts';
/** What a tool does: a database function to call (as the signed-in person), and for a change the card it becomes. */
export type ToolCall =
  | { fn: string; args: Record<string, unknown>; card?: { kind: ProposalKind; team_mode?: string } }
  | { log: 'bug' | 'request' }
  | null;

export function toolCall(name: string, input: Record<string, unknown>, ctx: Ctx): ToolCall {
  const c = ctx.center_id || null;
  switch (name) {
    case 'find_people': return { fn: 'benny_find_people', args: { p_center: c, p_q: String(input.q || '') } };
    case 'day': return { fn: 'benny_day', args: { p_center: c, p_date: String(input.date || ctx.today) } };
    case 'bookings': return { fn: 'benny_bookings', args: { p_center: c, p_where: input.where ?? null, p_route: input.route ?? null, p_status: input.status ?? 'open' } };
    case 'booking': return { fn: 'benny_booking', args: { p_center: c, p_q: String(input.q || '') } };
    case 'maps': return { fn: 'benny_maps', args: { p_center: c, p_q: input.q ?? null } };
    case 'route': return { fn: 'benny_route', args: { p_center: c, p_route: String(input.route || ''), p_date: input.date ?? null } };
    case 'show_map': return { fn: 'benny_map', args: { p_center: c, p_maps: input.maps ?? [], p_routes: input.routes ?? null, p_prebooks: !!input.prebooks } };
    case 'connected_routes': return { fn: 'benny_connected', args: { p_center: c, p_from_routes: input.from_routes ?? null, p_from_maps: input.from_maps ?? null,
      p_in_maps: input.in_maps ?? null, p_mode: input.mode === 'all' ? 'all' : 'touching' } };
    case 'map_side': return { fn: 'benny_side', args: { p_center: c, p_of_maps: input.of_maps ?? [], p_near_maps: input.near_maps ?? null, p_near_routes: input.near_routes ?? null,
      p_vs_maps: input.versus_maps ?? null, p_vs_routes: input.versus_routes ?? null } };
    case 'live_team': return { fn: 'benny_live', args: { p_center: c, p_manager: input.manager ?? openMap(ctx) } };
    case 'crew_stats': return { fn: 'benny_crew_stats', args: { p_center: c, p_date: String(input.date || ctx.today) } };
    case 'propose_start_day': return { fn: 'benny_plan_day', args: { p_center: c, p_date: String(input.date || ctx.today), p_assign: input.assign ?? [], p_pair: !!input.pair_managers },
      card: { kind: 'start_day', team_mode: ['roster', 'solo', 'pairs'].includes(String(input.team_mode)) ? String(input.team_mode) : 'roster' } };
    case 'propose_give_route': return { fn: 'benny_check_give', args: { p_center: c, p_route: String(input.route || ''), p_worker: String(input.worker || '') }, card: { kind: 'give_route' } };
    case 'propose_partner': return { fn: 'benny_check_move', args: { p_center: c, p_a: String(input.a || ''), p_b: String(input.b || '') }, card: { kind: 'partner' } };
    case 'propose_solo': return { fn: 'benny_check_move', args: { p_center: c, p_a: String(input.worker || ''), p_b: null }, card: { kind: 'solo' } };
    case 'logsheet': return { fn: 'benny_live_jobs', args: { p_center: c, p_worker: String(input.worker || '') } };
    case 'propose_job_change': {
      // only what was asked: an amount (a number, or the words as heard for the database to refuse), a payment type, or both
      const change: Record<string, unknown> = {};
      if (typeof input.amount === 'number' && Number.isFinite(input.amount)) change.amount = input.amount;
      else if (typeof input.amount === 'string' && input.amount.trim()) change.amount = input.amount.trim();
      if (typeof input.paid_by === 'string' && input.paid_by.trim()) change.paid_by = input.paid_by.trim();
      return { fn: 'benny_check_job', args: { p_center: c, p_worker: String(input.worker || ''), p_job: String(input.job || ''), p_change: change }, card: { kind: 'job' } };
    }
    case 'payouts': return { fn: 'benny_payouts', args: { p_center: c } };
    case 'propose_payouts': return { fn: 'benny_check_payouts', args: { p_center: c }, card: { kind: 'payouts' } };
    case 'propose_booking': {
      const change: Record<string, unknown> = {};
      for (const k of ['status', 'route', 'field_note', 'office_note', 'note_mode']) if (typeof input[k] === 'string') change[k] = input[k];
      return { fn: 'benny_check_booking', args: { p_center: c, p_booking: String(input.booking || ''), p_change: change }, card: { kind: 'booking' } };
    }
    case 'propose_booking_emails': return { fn: 'benny_check_emails', args: { p_center: c, p_kind: String(input.kind || 'day_before'), p_date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? input.date : null,
      p_today: /^\d{4}-\d{2}-\d{2}$/.test(ctx.today || '') ? ctx.today : null, p_routes: input.routes ?? null, p_maps: input.maps ?? null }, card: { kind: 'booking_emails' } };
    case 'propose_pin': {
      const text = (k: string) => (typeof input[k] === 'string' && String(input[k]).trim() ? String(input[k]).trim() : null);
      const place: Record<string, unknown> = text('route') ? { route: text('route') } : text('worker') ? { worker: text('worker') } : text('address') ? { address: text('address') } : input.here === true ? { here: true } : {};
      return { fn: 'benny_check_pin', args: { p_center: c, p_manager: openMap(ctx), p_place: place, p_label: text('label'), p_see: text('see') || 'me', p_to: text('to') }, card: { kind: 'pin' } };
    }
    case 'propose_stops': return { fn: 'benny_plan_stops', args: { p_center: c, p_manager: openMap(ctx), p_kind: String(input.kind || ''), p_only: Array.isArray(input.only) ? input.only : null }, card: { kind: 'stops' } };
    case 'report_bug': return { log: 'bug' };
    case 'log_request': return { log: 'request' };
    default: return null;
  }
}
