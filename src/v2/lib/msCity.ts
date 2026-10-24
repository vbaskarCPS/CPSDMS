// src/v2/lib/msCity.ts — MainstreetAI: building a city (RUN_51). Runs in the browser like the house build:
//   1. boundary from Nominatim                       4. plazas / industrial parks from OSM
//   2. streets from OSM (highways, rail, water, arterials) → blocks (PostGIS)
//   3. businesses from OSM POIs                      5. businesses from a Google Places sweep (paid, approved first)
//   6. finish: block + plaza per business, chain flags, counts
import { db, must } from './client';

export const BUSINESS_KINDS = [
  { key: 'trades', label: 'Trades' }, { key: 'clinic', label: 'Clinics' }, { key: 'agency', label: 'Agencies & professional' },
  { key: 'brokerage', label: 'Real estate' }, { key: 'restaurant', label: 'Restaurants & food' }, { key: 'salon', label: 'Salons & spas' },
  { key: 'auto', label: 'Auto' }, { key: 'retail', label: 'Retail' }, { key: 'fitness', label: 'Fitness' }, { key: 'industrial', label: 'Industrial & warehouse' },
  { key: 'other', label: 'Other' },
] as const;
export type BusinessKind = typeof BUSINESS_KINDS[number]['key'];
export const kindLabel = (k: string) => BUSINESS_KINDS.find(x => x.key === k)?.label || k;
/** Taxifi's default: incorporated service businesses. */
export const TAXIFI_KINDS: BusinessKind[] = ['trades', 'clinic', 'agency', 'brokerage', 'restaurant', 'salon', 'auto'];

export interface City {
  id: string; name: string; province: string; status: 'new' | 'building' | 'built' | 'failed'; build_note: string | null;
  blocks: number; plazas: number; businesses: number; eligible_open: number; zones: number;
  center_lat: number | null; center_lng: number | null; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null; built_at: string | null; created_at: string;
}
export interface Business {
  id: string; name: string; address: string | null; lat: number; lng: number; kind: BusinessKind; status: 'open' | 'closed' | 'unknown';
  is_chain: boolean; chain_note: string | null; sources: string[]; plaza_id: number | null; block_id: number | null; zone_id: string | null;
  phone: string | null; website: string | null;
}
export interface BusinessRow {
  name: string; address?: string | null; lat: number; lng: number; kind: BusinessKind; raw_types: string[]; source: 'osm' | 'google';
  osm_id?: number; google_place_id?: string; phone?: string | null; website?: string | null; hours?: unknown; status?: 'open' | 'closed' | 'unknown';
}
export type LineKind = 'highway' | 'rail' | 'water' | 'arterial';
export interface LineRow { osm_id: number; kind: LineKind; name: string | null; coordinates: [number, number][] }
export interface PlazaRow { osm_id: number; name: string | null; kind: 'retail' | 'commercial' | 'industrial' | 'building'; coordinates: [number, number][] }
export interface BBox { s: number; w: number; n: number; e: number }

// ───────────── database ─────────────
export async function listCities(): Promise<City[]> { return must(await db.rpc('ms_cities_list')) as City[]; }
export async function cityBusinesses(cityId: string): Promise<Business[]> { return must(await db.rpc('ms_city_businesses', { p_city: cityId })) as Business[]; }
export async function saveCity(name: string, province: string, osmRelationId: number | null, boundary: GeoJSON.Geometry | null): Promise<string> {
  return must(await db.rpc('ms_save_city', { p_name: name, p_province: province, p_osm_relation_id: osmRelationId, p_boundary: boundary })) as string;
}
export async function setCityStatus(cityId: string, status: City['status'], note: string | null = null): Promise<void> {
  must(await db.rpc('ms_city_set_status', { p_city: cityId, p_status: status, p_note: note }));
}
export async function replaceLines(cityId: string, lines: LineRow[]): Promise<number> { return must(await db.rpc('ms_city_replace_lines', { p_city: cityId, p_lines: lines })) as number; }
export async function makeBlocks(cityId: string): Promise<number> { return must(await db.rpc('ms_city_make_blocks', { p_city: cityId })) as number; }
export async function replacePlazas(cityId: string, plazas: PlazaRow[]): Promise<number> { return must(await db.rpc('ms_city_replace_plazas', { p_city: cityId, p_plazas: plazas })) as number; }
export async function upsertBusinesses(cityId: string, rows: BusinessRow[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 400) added += must(await db.rpc('ms_city_upsert_businesses', { p_city: cityId, p_rows: rows.slice(i, i + 400) })) as number;
  return added;
}
export async function finishCity(cityId: string): Promise<{ businesses: number; blocks: number; plazas: number; chains: number; by_kind: Record<string, number> }> {
  return must(await db.rpc('ms_city_finish', { p_city: cityId })) as { businesses: number; blocks: number; plazas: number; chains: number; by_kind: Record<string, number> };
}
export async function setCampaignCategories(campaignId: string, kinds: string[]): Promise<void> {
  must(await db.rpc('ms_set_campaign_categories', { p_campaign: campaignId, p_categories: kinds }));
}
export async function listCampaignCategories(): Promise<{ campaign_id: string; category: string }[]> {
  return must(await db.from('ms_campaign_categories').select('campaign_id, category')) as { campaign_id: string; category: string }[];
}

// ───────────── classification (pure, tested) ─────────────
const GOOGLE_KIND: [RegExp, BusinessKind][] = [
  [/electrician|plumber|roofing|general_contractor|painter|hvac|landscap|locksmith|moving_company|home_improvement|flooring|carpenter|contractor|pest_control|cleaning_service|window|glazier|fence|paving|concrete|masonry|handyman|insulation|solar|pool|tree_service|excavat/, 'trades'],
  [/dentist|dental|doctor|physician|physiotherap|chiropract|clinic|optometr|pharmacy|veterinar|medical|massage_therap|psycholog|podiatr|audiolog|dermatolog|orthodont|skin_care_clinic|wellness_center/, 'clinic'],
  [/real_estate|mortgage/, 'brokerage'],
  [/insurance|accounting|lawyer|law_firm|attorney|consultant|marketing|advertising|travel_agency|notary|financial|tax_prepar|employment_agency|architect|engineer|design_agency|photographer|graphic|software|it_services|printing|courier|telecommunications|security_service|funeral|event_planner|wedding|child_care|tutoring|driving_school|dance_school|music_school|art_school/, 'agency'],
  [/restaurant|cafe|coffee|bakery|bar$|pub|meal_takeaway|meal_delivery|food|pizza|sushi|diner|bistro|tea_house|ice_cream|dessert|juice|deli|caterer|brewery|winery|sandwich|burger|steak|seafood|breakfast|brunch|buffet|hamburger|donut|bagel|cafeteria|bar_and_grill|wine_bar|night_club/, 'restaurant'],
  [/hair|salon|barber|beauty|nail|spa$|spa_|tanning|waxing|eyebrow|lash|makeup|tattoo|piercing/, 'salon'],
  [/car_repair|auto_|car_dealer|car_wash|car_rental|tire|auto_parts|body_shop|mechanic|oil_change|gas_station|truck_|motorcycle|transmission|windshield|detailing/, 'auto'],
  [/gym|fitness|yoga|pilates|martial_arts|boxing|crossfit|swimming|sports_club|climbing|personal_trainer/, 'fitness'],
  [/warehouse|manufactur|wholesal|distribut|industrial|factory|machine_shop|metal|plastics|packaging|logistics|freight|storage|self_storage|supplier|fabricat/, 'industrial'],
  [/store|shop|market|supermarket|grocery|boutique|retail|florist|jewel|furniture|electronics|hardware|clothing|shoe|book|pet_store|liquor|convenience|department|gift|toy|sporting_goods|bicycle|cell_phone|home_goods|garden|optician|vape|cannabis|dispensary/, 'retail'],
];
const OSM_KIND: [RegExp, BusinessKind][] = [
  [/^shop=(hairdresser|beauty|massage|tattoo|nails?|cosmetics)$/, 'salon'],
  [/^shop=(car_repair|car_parts|car|tyres|motorcycle|car_wash)$|^amenity=(car_wash|car_repair|fuel|car_rental)$|^craft=(car_painter|auto_body)/, 'auto'],
  [/^amenity=(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$|^shop=(bakery|butcher|deli|pastry|confectionery|coffee|tea|beverages|seafood|cheese|chocolate|greengrocer)$/, 'restaurant'],
  [/^amenity=(dentist|doctors|clinic|pharmacy|veterinary|hospital)$|^healthcare=|^shop=(optician|medical_supply|hearing_aids)$/, 'clinic'],
  [/^office=(estate_agent|real_estate)$|^shop=estate_agent$/, 'brokerage'],
  [/^office=|^shop=(travel_agency|copyshop|printing|funeral_directors|tailor|dry_cleaning|laundry|photo)$|^amenity=(driving_school|language_school|music_school|childcare|kindergarten)$|^craft=(photographer|printer)/, 'agency'],
  [/^craft=|^shop=(hardware|trade|doityourself|glaziery|paint|flooring|tiles|kitchen|bathroom_furnishing|locksmith|electrical|plumbing|garden_centre|lighting)$/, 'trades'],
  [/^leisure=(fitness_centre|sports_centre|dance|fitness_station)$|^shop=fitness$|^amenity=gym$|^sport=/, 'fitness'],
  [/^industrial=|^man_made=works$|^building=(warehouse|industrial)$|^shop=(wholesale|trade)$|^landuse=industrial$/, 'industrial'],
  [/^shop=/, 'retail'],
];
export function classifyGoogle(primaryType: string | undefined, types: string[]): BusinessKind {
  const all = [primaryType || '', ...types].filter(Boolean);
  for (const t of all) for (const [re, kind] of GOOGLE_KIND) if (re.test(t)) return kind;
  return 'other';
}
export function classifyOsm(tags: Record<string, string>): BusinessKind {
  const pairs = Object.entries(tags).map(([k, v]) => `${k}=${v}`);
  for (const [re, kind] of OSM_KIND) if (pairs.some(p => re.test(p))) return kind;
  return 'other';
}
/** OSM things with a business-ish tag and a name. Benches, parking and bus stops never count. */
export function isOsmBusiness(tags: Record<string, string> | undefined): boolean {
  if (!tags?.name) return false;
  if (tags.shop || tags.craft || tags.office || tags.healthcare) return true;
  if (tags.amenity) return /^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|dentist|doctors|clinic|pharmacy|veterinary|car_wash|car_repair|fuel|car_rental|driving_school|language_school|music_school|childcare|kindergarten|gym|bank|coworking_space|studio|marketplace)$/.test(tags.amenity);
  if (tags.leisure) return /^(fitness_centre|sports_centre|dance|bowling_alley|escape_game|amusement_arcade|trampoline_park)$/.test(tags.leisure);
  return !!tags.industrial || tags.man_made === 'works';
}

// ───────────── OpenStreetMap ─────────────
const OVERPASS_ENDPOINTS = [
  { url: 'https://overpass-api.de/api/interpreter', ms: 75000 },
  { url: 'https://overpass.private.coffee/api/interpreter', ms: 60000 },
  { url: 'https://overpass.kumi.systems/api/interpreter', ms: 60000 },
];
export interface OsmElement { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

export async function overpass(query: string, signal?: AbortSignal): Promise<OsmElement[]> {
  let lastErr: unknown = null;
  for (const { url, ms } of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort(); signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: ctrl.signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return ((await res.json()).elements || []) as OsmElement[];
    } catch (e) {
      if (signal?.aborted) throw new Error('Stopped');
      lastErr = ctrl.signal.aborted ? new Error(`${new URL(url).host} didn’t answer within ${Math.round(ms / 1000)} s`) : e;
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  throw new Error(`OpenStreetMap didn’t answer (${lastErr instanceof Error ? lastErr.message : 'all mirrors failed'}). Wait a minute and press Start again: it carries on from this step.`);
}
/** The bbox cut into n × n tiles, so each OpenStreetMap request stays small and quick. */
export function tiles(b: BBox, n: number): BBox[] {
  const out: BBox[] = []; const dLat = (b.n - b.s) / n, dLng = (b.e - b.w) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ s: b.s + i * dLat, n: b.s + (i + 1) * dLat, w: b.w + j * dLng, e: b.w + (j + 1) * dLng });
  return out;
}
/** Runs an Overpass query per tile and merges the elements by id. */
async function overpassTiled(bbox: BBox, query: (b: string) => string, signal?: AbortSignal, onTile?: (done: number, of: number) => void): Promise<OsmElement[]> {
  const parts = tiles(bbox, 3); const seen = new Map<string, OsmElement>();
  for (let i = 0; i < parts.length; i++) {
    const els = await overpass(query(bb(parts[i])), signal);
    for (const e of els) seen.set(`${e.type}${e.id}`, e);
    onTile?.(i + 1, parts.length);
  }
  return [...seen.values()];
}
const bb = (b: BBox) => `${b.s},${b.w},${b.n},${b.e}`;

/** The city boundary (an OSM administrative relation) from Nominatim. */
export async function fetchBoundary(city: string, province = 'Ontario'): Promise<{ osm_id: number; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; bbox: BBox } | null> {
  const q = encodeURIComponent(`${city}, ${province}, Canada`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&polygon_geojson=1&limit=5`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json() as { osm_type: string; osm_id: number; display_name: string; category?: string; class?: string; type: string; geojson: GeoJSON.Geometry; boundingbox: string[] }[];
  const hit = rows.find(r => r.osm_type === 'relation' && (r.category || r.class) === 'boundary' && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon'))
    || rows.find(r => r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon');
  if (!hit) return null;
  const [s, n, w, e] = hit.boundingbox.map(Number);
  return { osm_id: hit.osm_id, name: hit.display_name, geometry: hit.geojson as GeoJSON.Polygon | GeoJSON.MultiPolygon, bbox: { s, n, w, e } };
}

export function lineKind(tags: Record<string, string>): LineKind | null {
  const h = tags.highway;
  if (h && /^(motorway|trunk|motorway_link|trunk_link)$/.test(h)) return 'highway';
  if (h && /^(primary|secondary|tertiary|primary_link|secondary_link)$/.test(h)) return 'arterial';
  if (tags.railway === 'rail') return 'rail';
  if (tags.waterway && /^(river|canal)$/.test(tags.waterway)) return 'water';
  return null;
}
export async function fetchLines(bbox: BBox, signal?: AbortSignal, onTile?: (done: number, of: number) => void): Promise<LineRow[]> {
  const els = await overpassTiled(bbox, b => `[out:json][timeout:60];(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"](${b});
  way["railway"="rail"](${b});
  way["waterway"~"^(river|canal)$"](${b});
); out body geom;`, signal, onTile);
  return els.flatMap(w => {
    const kind = w.tags ? lineKind(w.tags) : null;
    if (!kind || !w.geometry || w.geometry.length < 2) return [];
    return [{ osm_id: w.id, kind, name: w.tags?.name || null, coordinates: w.geometry.map(p => [p.lon, p.lat] as [number, number]) }];
  });
}
export async function fetchPlazas(bbox: BBox, signal?: AbortSignal, onTile?: (done: number, of: number) => void): Promise<PlazaRow[]> {
  const els = await overpassTiled(bbox, b => `[out:json][timeout:60];(
  way["landuse"~"^(retail|commercial|industrial)$"](${b});
  way["building"~"^(retail|commercial|industrial|warehouse|supermarket|mall)$"](${b});
  way["shop"="mall"](${b});
); out body geom;`, signal, onTile);
  return els.flatMap(w => {
    if (!w.geometry || w.geometry.length < 4) return [];
    const t = w.tags || {};
    const kind = t.landuse === 'retail' || t.shop === 'mall' || t.building === 'mall' || t.building === 'retail' || t.building === 'supermarket' ? 'retail'
      : t.landuse === 'industrial' || t.building === 'industrial' || t.building === 'warehouse' ? 'industrial'
      : t.landuse === 'commercial' ? 'commercial' : 'building';
    return [{ osm_id: w.id, name: t.name || null, kind, coordinates: w.geometry.map(p => [p.lon, p.lat] as [number, number]) }] as PlazaRow[];
  });
}
export async function fetchOsmBusinesses(bbox: BBox, signal?: AbortSignal, onTile?: (done: number, of: number) => void): Promise<BusinessRow[]> {
  const els = await overpassTiled(bbox, b => `[out:json][timeout:60];(
  nwr["shop"]["name"](${b}); nwr["craft"]["name"](${b}); nwr["office"]["name"](${b}); nwr["healthcare"]["name"](${b});
  nwr["amenity"]["name"](${b}); nwr["leisure"]["name"](${b}); nwr["industrial"]["name"](${b});
); out center tags;`, signal, onTile);
  return els.flatMap(e => {
    if (!isOsmBusiness(e.tags)) return [];
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (lat == null || lng == null) return [];
    const t = e.tags!;
    const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null;
    return [{ name: t.name, address: addr, lat, lng, kind: classifyOsm(t), raw_types: Object.entries(t).filter(([k]) => /^(shop|amenity|office|craft|healthcare|leisure|industrial|cuisine)$/.test(k)).map(([k, v]) => `${k}=${v}`),
      source: 'osm' as const, osm_id: e.id, phone: t.phone || t['contact:phone'] || null, website: t.website || t['contact:website'] || null, status: 'unknown' as const }];
  });
}

// ───────────── Google Places sweep ─────────────
export const GOOGLE_COST_PER_CALL = 0.04;   // Nearby Search (New) with contact + hours fields, upper bound
export const GOOGLE_MAX_CALLS = 2500;
const EXCLUDED_TYPES = ['park', 'parking', 'transit_station', 'bus_station', 'bus_stop', 'subway_station', 'train_station', 'light_rail_station', 'school', 'primary_school',
  'secondary_school', 'university', 'church', 'hindu_temple', 'mosque', 'synagogue', 'place_of_worship', 'cemetery', 'city_hall', 'courthouse', 'fire_station', 'police',
  'post_office', 'library', 'hospital', 'local_government_office', 'playground', 'hiking_area', 'apartment_complex', 'apartment_building', 'housing_complex', 'condominium_complex',
  'campground', 'rv_park', 'atm', 'electric_vehicle_charging_station', 'rest_stop', 'airport', 'dog_park', 'national_park', 'state_park', 'community_center', 'embassy', 'lodging', 'hotel', 'motel'];

export interface Cell { lat: number; lng: number; radius: number }
/** Squares of `sideM` metres covering the bbox, kept when any corner or the centre is inside the boundary. */
export function gridCells(bbox: BBox, boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon, sideM: number): Cell[] {
  const latStep = sideM / 111320;
  const midLat = (bbox.s + bbox.n) / 2;
  const lngStep = sideM / (111320 * Math.cos(midLat * Math.PI / 180));
  const out: Cell[] = [];
  for (let lat = bbox.s + latStep / 2; lat < bbox.n + latStep / 2; lat += latStep) {
    for (let lng = bbox.w + lngStep / 2; lng < bbox.e + lngStep / 2; lng += lngStep) {
      const pts: [number, number][] = [[lng, lat], [lng - lngStep / 2, lat - latStep / 2], [lng + lngStep / 2, lat - latStep / 2], [lng - lngStep / 2, lat + latStep / 2], [lng + lngStep / 2, lat + latStep / 2]];
      if (pts.some(p => inPolygon(p, boundary))) out.push({ lat, lng, radius: Math.ceil(sideM / Math.SQRT2) });
    }
  }
  return out;
}
export function inPolygon([x, y]: [number, number], g: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some(rings => rings.length > 0 && inRing([x, y], rings[0]) && !rings.slice(1).some(h => inRing([x, y], h)));
}
function inRing([x, y]: [number, number], ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
/** Four quarter-cells of a saturated cell. */
export function splitCell(c: Cell): Cell[] {
  const side = c.radius * Math.SQRT2 / 2;
  const dLat = side / 2 / 111320, dLng = side / 2 / (111320 * Math.cos(c.lat * Math.PI / 180));
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ({ lat: c.lat + a * dLat, lng: c.lng + b * dLng, radius: Math.ceil(side / Math.SQRT2) }));
}
export const estimateCalls = (cells: number) => Math.min(GOOGLE_MAX_CALLS, Math.round(cells * 2.5));

interface GPlace { id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; types?: string[]; primaryType?: string;
  businessStatus?: string; websiteUri?: string; nationalPhoneNumber?: string; regularOpeningHours?: { weekdayDescriptions?: string[] } }

export function googleKey(): string | null {
  const k = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_GOOGLE_PLACES_API_KEY;
  return k && k.length > 10 ? k : null;
}
async function nearby(cell: Cell, key: string, signal?: AbortSignal): Promise<GPlace[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours.weekdayDescriptions' },
    body: JSON.stringify({ locationRestriction: { circle: { center: { latitude: cell.lat, longitude: cell.lng }, radius: Math.min(50000, cell.radius) } },
      maxResultCount: 20, rankPreference: 'DISTANCE', excludedPrimaryTypes: EXCLUDED_TYPES, languageCode: 'en', regionCode: 'CA' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
    const msg = body.error?.message || `Google ${res.status}`;
    if (res.status === 403 || /not (been )?(enabled|authorized)|API key/i.test(msg)) throw new Error(`Google refused the key: ${msg}. Enable "Places API (New)" for it in Google Cloud and allow this site.`);
    if (res.status === 429) throw new Error('Google rate limit: wait a minute and run the sweep again (it carries on where it was).');
    throw new Error(msg);
  }
  return ((await res.json()).places || []) as GPlace[];
}
export function googleRow(p: GPlace): BusinessRow | null {
  if (!p.id || !p.displayName?.text || !p.location) return null;
  return { name: p.displayName.text, address: p.formattedAddress || null, lat: p.location.latitude, lng: p.location.longitude,
    kind: classifyGoogle(p.primaryType, p.types || []), raw_types: [p.primaryType || '', ...(p.types || [])].filter(Boolean), source: 'google', google_place_id: p.id,
    phone: p.nationalPhoneNumber || null, website: p.websiteUri || null, hours: p.regularOpeningHours?.weekdayDescriptions || null,
    status: p.businessStatus === 'OPERATIONAL' ? 'open' : p.businessStatus?.startsWith('CLOSED') ? 'closed' : 'unknown' };
}

/**
 * Adaptive sweep: 1 km cells, split while a cell comes back full (20), down to ~150 m. Calls stop at `maxCalls`.
 * Reports after every cell; the caller saves the rows in batches.
 */
export async function googleSweep(cells: Cell[], key: string, maxCalls: number, onCell: (p: { calls: number; pending: number; found: number }) => void,
  onRows: (rows: BusinessRow[]) => Promise<void>, signal?: AbortSignal): Promise<{ calls: number; found: number; stopped: boolean }> {
  const queue = cells.slice(); const seen = new Set<string>(); let calls = 0; let found = 0; let buffer: BusinessRow[] = [];
  const flush = async () => { if (buffer.length) { const b = buffer; buffer = []; await onRows(b); } };
  while (queue.length && calls < maxCalls) {
    if (signal?.aborted) { await flush(); return { calls, found, stopped: true }; }
    const cell = queue.shift()!;
    const places = await nearby(cell, key, signal); calls++;
    for (const p of places) { if (seen.has(p.id)) continue; seen.add(p.id); const r = googleRow(p); if (r) { buffer.push(r); found++; } }
    if (places.length >= 20 && cell.radius > 110) queue.push(...splitCell(cell));
    onCell({ calls, pending: queue.length, found });
    if (buffer.length >= 300) await flush();
  }
  await flush();
  return { calls, found, stopped: queue.length > 0 };
}
