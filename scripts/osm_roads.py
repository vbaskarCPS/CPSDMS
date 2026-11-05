"""Roads from an osmium geojsonseq export → one JSON file per 0.02° square: [{id, name, unnamed, g}].
Same roads the Map Builder asks Overpass for: any highway with a name, plus unnamed
residential / service / unclassified / living_street. A road goes in every square it has a point in."""
import json, math, sys

src, box, out = sys.argv[1], sys.argv[2], sys.argv[3]
w, s, e, n = map(float, box.split(','))
CELL = 0.02
UNNAMED_OK = {'residential', 'service', 'unclassified', 'living_street'}
idx = lambda v: math.floor(v / CELL + 1e-9)
cells = {}
for i in range(idx(s), idx(n - 1e-9) + 1):
    for j in range(idx(w), idx(e - 1e-9) + 1):
        cells[(i, j)] = []
with open(src) as f:
    for line in f:
        line = line.strip().lstrip('\x1e')
        if not line:
            continue
        ft = json.loads(line)
        geom, p = ft.get('geometry') or {}, ft.get('properties') or {}
        if geom.get('type') != 'LineString' or not p.get('highway'):
            continue
        name = (p.get('name') or '').strip()
        if not name and p['highway'] not in UNNAMED_OK:
            continue
        wid = str(p.get('@id', ''))
        if not wid.isdigit():
            continue
        g = [[round(x, 7), round(y, 7)] for x, y in geom['coordinates']]
        if len(g) < 2:
            continue
        row = {'id': int(wid), 'name': name, 'unnamed': not name, 'g': g}
        for key in {(idx(y), idx(x)) for x, y in g}:
            if key in cells:
                cells[key].append(row)
for (i, j), rows in cells.items():
    with open(f'{out}/{i}_{j}.json', 'w') as f:
        json.dump(rows, f, separators=(',', ':'))
print(f'{box}: {len(cells)} squares, {sum(len(r) for r in cells.values())} road pieces')
