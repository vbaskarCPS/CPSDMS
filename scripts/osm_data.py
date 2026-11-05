"""OpenStreetMap → tiles for the Map Builder and MainstreetAI (see .github/workflows/osm-data.yml).

  osm_data.py boxes PROVINCE              the populated boxes (west,south,east,north) for a province, one per line
  osm_data.py ms FILE OUTDIR              main roads / rail / rivers / commercial land → OUTDIR/{i}_{j}.json (0.25°)
  osm_data.py streets FILE OUTDIR BOX     builder streets → OUTDIR/{i}_{j}.json (0.1°), merged with what's there
  osm_data.py index OUTDIR                OUTDIR/index.json
"""
import json, math, os, sys, datetime

MS_TILE, ST_TILE = 0.25, 0.1
# where people live: the Map Builder's streets are published for these (west,south,east,north)
BOXES = {
    'british-columbia': [
        '-123.35,48.95,-121.30,49.45',   # Lower Mainland and Fraser Valley (North Shore to Hope)
        '-123.65,48.30,-123.25,48.75',   # Greater Victoria
        '-124.20,49.05,-123.80,49.35',   # Nanaimo
        '-119.90,49.75,-119.20,50.35',   # Kelowna, West Kelowna, Vernon
        '-119.75,49.40,-119.45,49.60',   # Penticton
        '-120.60,50.60,-120.15,50.80',   # Kamloops
        '-122.90,53.80,-122.65,54.00',   # Prince George
        '-123.25,49.65,-123.05,49.80',   # Squamish
    ],
    'ontario': [
        '-80.70,42.80,-78.50,44.45',     # GTA, Hamilton, Niagara, Durham, York, Halton, Peel, south Simcoe
        '-81.00,43.10,-80.20,43.75',     # Kitchener-Waterloo, Cambridge, Guelph, Brantford
        '-81.45,42.85,-81.05,43.10',     # London
        '-83.15,42.15,-82.75,42.40',     # Windsor
        '-79.80,44.20,-79.30,44.70',     # Barrie, Orillia
        '-78.45,44.20,-78.20,44.40',     # Peterborough
        '-76.70,44.15,-76.35,44.35',     # Kingston
        '-76.10,45.10,-75.30,45.55',     # Ottawa
        '-81.20,46.40,-80.80,46.60',     # Sudbury
        '-80.40,42.95,-80.15,43.05',     # Woodstock / Ingersoll fringe
    ],
    'alberta': [
        '-114.40,50.80,-113.80,51.25',   # Calgary, Airdrie, Chestermere
        '-113.85,53.35,-113.25,53.75',   # Edmonton, St. Albert, Sherwood Park, Spruce Grove
        '-113.95,52.20,-113.70,52.35',   # Red Deer
        '-112.95,49.60,-112.70,49.75',   # Lethbridge
        '-110.75,49.95,-110.60,50.10',   # Medicine Hat
        '-115.40,51.00,-115.30,51.10',   # Canmore
    ],
}
UNNAMED_OK = {'residential', 'service', 'unclassified', 'living_street'}
HIGHWAY = {'motorway', 'trunk', 'motorway_link', 'trunk_link'}
ARTERIAL = {'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link'}


def rows(path):
    with open(path) as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if line:
                yield json.loads(line)


def rnd(c):
    return [round(c[0], 6), round(c[1], 6)]


def tile_keys(coords, size):
    return {(math.floor(y / size + 1e-9), math.floor(x / size + 1e-9)) for x, y in coords}


def line_kind(p):
    h = p.get('highway')
    if h in HIGHWAY: return 'highway'
    if h in ARTERIAL: return 'arterial'
    if p.get('railway') == 'rail': return 'rail'
    if p.get('waterway') in ('river', 'canal'): return 'water'
    return None


def plaza_kind(p):
    lu, b, shop = p.get('landuse'), p.get('building'), p.get('shop')
    if lu == 'retail' or shop == 'mall' or b in ('mall', 'retail', 'supermarket'): return 'retail'
    if lu == 'industrial' or b in ('industrial', 'warehouse'): return 'industrial'
    if lu == 'commercial': return 'commercial'
    return 'building'


def merge_into(path, new, keys):
    """A tile file may already hold items from a neighbouring province or box: add the new ones, each id once."""
    data = {k: [] for k in keys}
    if os.path.exists(path):
        with open(path) as f:
            old = json.load(f)
        data = {keys[0]: old} if isinstance(old, list) else {k: old.get(k, []) for k in keys}
    for k in keys:
        have = {(x.get('t') or '') + str(x['id']) for x in data[k]}
        for it in new.get(k, []):
            key = (it.get('t') or '') + str(it['id'])
            if key not in have:
                data[k].append(it); have.add(key)
    return data


def cmd_ms(src, out):
    tiles = {}
    for ft in rows(src):
        g, p = ft.get('geometry') or {}, ft.get('properties') or {}
        oid = p.get('@id'); typ = p.get('@type', 'way')
        if not str(oid).isdigit(): continue
        kind = line_kind(p) if g.get('type') == 'LineString' else None
        if kind:
            c = [rnd(x) for x in g['coordinates']]
            if len(c) < 2: continue
            it = {'id': int(oid), 'kind': kind, 'name': p.get('name') or None, 'c': c}
            for k in tile_keys(c, MS_TILE): tiles.setdefault(k, {'lines': [], 'plazas': []})['lines'].append(it)
        elif g.get('type') in ('Polygon', 'MultiPolygon') and (p.get('landuse') or p.get('building') or p.get('shop')):
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
            for n, poly in enumerate(polys):
                ring = [rnd(x) for x in poly[0]]
                if len(ring) < 4: continue
                pid = int(oid) * 10 + n if typ == 'relation' else int(oid)
                it = {'id': pid, 't': 'r' if typ == 'relation' else 'w', 'name': p.get('name') or None, 'kind': plaza_kind(p), 'c': ring}
                for k in tile_keys(ring, MS_TILE): tiles.setdefault(k, {'lines': [], 'plazas': []})['plazas'].append(it)
    for (i, j), t in tiles.items():
        path = f'{out}/{i}_{j}.json'
        data = merge_into(path, t, ['lines', 'plazas'])
        with open(path, 'w') as f: json.dump(data, f, separators=(',', ':'))
    print(f'ms: {len(tiles)} tiles')


def cmd_streets(src, out, box):
    w, s, e, n = map(float, box.split(','))
    tiles = {}
    for ft in rows(src):
        g, p = ft.get('geometry') or {}, ft.get('properties') or {}
        if g.get('type') != 'LineString' or not p.get('highway'): continue
        name = (p.get('name') or '').strip()
        if not name and p['highway'] not in UNNAMED_OK: continue
        oid = str(p.get('@id', ''))
        if not oid.isdigit(): continue
        c = [[round(x, 7), round(y, 7)] for x, y in g['coordinates']]
        if len(c) < 2: continue
        it = {'id': int(oid), 'name': name, 'unnamed': not name, 'g': c}
        for (i, j) in tile_keys(c, ST_TILE):
            # only whole tiles inside the box (a tile half outside it would be missing roads)
            if i * ST_TILE >= s - 1e-9 and (i + 1) * ST_TILE <= n + 1e-9 and j * ST_TILE >= w - 1e-9 and (j + 1) * ST_TILE <= e + 1e-9:
                tiles.setdefault((i, j), []).append(it)
    for (i, j), items in tiles.items():
        path = f'{out}/{i}_{j}.json'
        data = merge_into(path, {'ways': items}, ['ways'])
        with open(path, 'w') as f: json.dump(data['ways'], f, separators=(',', ':'))
    print(f'streets {box}: {len(tiles)} tiles')


def cmd_index(out):
    idx = {'made': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),
           'ms_tile': MS_TILE, 'streets_tile': ST_TILE,
           'ms': sorted(f[:-5] for f in os.listdir(f'{out}/ms')),
           'streets': sorted(f[:-5] for f in os.listdir(f'{out}/streets'))}
    with open(f'{out}/index.json', 'w') as f: json.dump(idx, f, separators=(',', ':'))
    print(f"index: {len(idx['ms'])} ms tiles, {len(idx['streets'])} street tiles")


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'boxes': print('\n'.join(BOXES[sys.argv[2]]))
    elif cmd == 'ms': cmd_ms(sys.argv[2], sys.argv[3])
    elif cmd == 'streets': cmd_streets(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == 'index': cmd_index(sys.argv[2])
