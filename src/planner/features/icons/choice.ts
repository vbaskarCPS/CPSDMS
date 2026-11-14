// src/planner/features/icons/choice.ts — which drawing goes where. The planner shows an icon in eleven places: the
// four buttons of the bottom bar (ui/Shell.tsx) and the big tiles on the Health and Lifestyle pages (screens/Hub.tsx).
// A pack (packs.tsx) has a drawing for every one of them. The person picks "Match my look" (the pack that suits the
// look that is on) or one pack for always, and can put a picture of their own on any place: that picture wins there.
// No React and no browser here (tested in choice.test.ts); store.ts keeps the choice and PlaceIcon.tsx draws it.

export type Place = 'today' | 'health' | 'wealth' | 'lifestyle' | 'train' | 'food' | 'cycle' | 'plan' | 'habits' | 'calendar' | 'shop';

/** The places, in the order the screen lists them. `only` = shown on that kind of planner only (the cycle tracker is Rosh's). */
export const PLACES: { id: Place; name: string; where: string; only?: 'morning' }[] = [
  { id: 'today', name: 'Today', where: 'On the bar' },
  { id: 'health', name: 'Health', where: 'On the bar' },
  { id: 'wealth', name: 'Wealth', where: 'On the bar' },
  { id: 'lifestyle', name: 'Lifestyle', where: 'On the bar' },
  { id: 'train', name: 'Train', where: 'Health page' },
  { id: 'food', name: 'Food', where: 'Health page' },
  { id: 'cycle', name: 'Cycle', where: 'Health page', only: 'morning' },
  { id: 'plan', name: 'Plan', where: 'Lifestyle page' },
  { id: 'habits', name: 'Habits', where: 'Lifestyle page' },
  { id: 'calendar', name: 'Calendar', where: 'Lifestyle page' },
  { id: 'shop', name: 'Shopping', where: 'Lifestyle page' },
];
const PLACE_IDS = new Set<string>(PLACES.map(p => p.id));
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);   // a look called "constructor" finds nothing
export const isPlace = (v: unknown): v is Place => typeof v === 'string' && PLACE_IDS.has(v);

/** The places this kind of planner shows (no Cycle on the night one). */
export const placesFor = (profile: 'morning' | 'night') => PLACES.filter(p => !p.only || p.only === profile);

/** The place a menu tile stands for, from where the tile goes ('/workout' is Train). null = a tile we have no drawings for. */
const TILE: Record<string, Place> = { workout: 'train', food: 'food', cycle: 'cycle', plan: 'plan', habits: 'habits', calendar: 'calendar', shop: 'shop' };
export function placeAt(to: string): Place | null {
  const first = to.split('/').filter(Boolean)[0] ?? '';
  return has(TILE, first) ? TILE[first] : null;
}

/** The packs. 'line' is the planner's own icons: what it has always shown. */
export const PACK_IDS = ['line', 'woodland', 'cottage', 'celestial', 'festive', 'academia', 'coastal', 'spooky', 'retro', 'blossom'] as const;
export type PackId = typeof PACK_IDS[number];
export const isPack = (v: unknown): v is PackId => typeof v === 'string' && (PACK_IDS as readonly string[]).includes(v);

/** The look on screen (the id on <html data-look>, set by the looks) → the pack that suits it. */
export const LOOK_PACK: Record<string, PackId> = {
  woodland: 'woodland', autumn: 'woodland', botanical: 'woodland',
  cottagecore: 'cottage', countryside: 'cottage', french: 'cottage',
  celestial: 'celestial', fairy: 'celestial',
  christmas: 'festive', winter: 'festive',
  academia: 'academia', regency: 'academia', stationery: 'academia',
  coastal: 'coastal', mediterranean: 'coastal',
  halloween: 'spooky',
  retro70s: 'retro',
  pastels: 'blossom', spring: 'blossom', coquette: 'blossom',
  minimal: 'line', graphite: 'line',
  lodge: 'woodland', expedition: 'woodland', harbour: 'coastal', whisky: 'academia',
  neon: 'celestial', circuit: 'line', fieldops: 'line', grit: 'line', metal: 'spooky',
};

/** What the person chose. `pack`: 'match' follows the look, or one pack for always. `own`: the places that carry a
 *  picture of their own, each with when it was put there (so another phone can tell its copy is stale). */
export interface IconPrefs { pack: 'match' | PackId; own: Partial<Record<Place, string>> }
export const NO_CHOICE: IconPrefs = { pack: 'match', own: {} };

/** A saved choice read back, whatever shape it comes in: anything we don't know is dropped, never trusted. */
export function cleanPrefs(raw: unknown): IconPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { pack?: unknown; own?: unknown };
  const own: IconPrefs['own'] = {};
  if (r.own && typeof r.own === 'object') {
    for (const [place, at] of Object.entries(r.own as Record<string, unknown>)) if (isPlace(place) && typeof at === 'string' && at) own[place] = at;
  }
  return { pack: isPack(r.pack) ? r.pack : 'match', own };
}

/** The pack to draw from: the chosen one, or with "Match my look" the one for the look that is on (none on, or a
 *  look we don't know: the planner's own icons). */
export function packFor(pack: IconPrefs['pack'], look: string | null | undefined): PackId {
  if (pack !== 'match') return pack;
  return look && has(LOOK_PACK, look) ? LOOK_PACK[look] : 'line';
}

/** A picture of their own is only ever one we made ourselves: a small PNG or WebP kept as a data: URL. */
export const isPicture = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 200_000;

export type Drawn = { own: string } | { pack: PackId };
/** What to draw at a place: their own picture when they put one there (and this phone has it), else the pack's drawing. */
export function drawn(prefs: IconPrefs, look: string | null | undefined, place: Place, pictures: Partial<Record<Place, string>>): Drawn {
  const mine = prefs.own[place] ? pictures[place] : undefined;
  return mine ? { own: mine } : { pack: packFor(prefs.pack, look) };
}

/** The places whose picture this phone still has to fetch: chosen on the account, but not here yet or changed since. */
export function toFetch(prefs: IconPrefs, have: IconPrefs, pictures: Partial<Record<Place, string>>): Place[] {
  return (Object.keys(prefs.own) as Place[]).filter(p => !pictures[p] || have.own[p] !== prefs.own[p]);
}
