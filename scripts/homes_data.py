#!/usr/bin/env python3
"""Every civic address in the areas the BC master maps cover, from the BC Address Geocoder (DataBC, open data), so Map
Builder › Auto-build knows where the houses are: a stretch of road with no houses isn't walked, a main road goes to the
route whose houses face it, and Holes finds houses no route covers.

  python3 scripts/homes_data.py fetch out/homes       fetches the sites, writes homes/{i}_{j}.json (0.05° tiles) + index.json

A tile: {"streets": ["Avon|Pl|", …], "h": [[lng, lat, street, civic, units], …]}: one row per civic address (a parcel
point), street an index into streets (name|type|direction, as the geocoder spells them), units the number of unit
addresses at that civic number (0 for a house).
"""
import json, math, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

API = 'https://geocoder.api.gov.bc.ca/sites/within.json'
CAP = 500             # the geocoder returns at most 500 sites a call: a box that comes back full is split in four
START = 0.02          # first grid, degrees
TILE = 0.05
# the master maps: the Lower Mainland and the Fraser Valley to Harrison, and Squamish
REGIONS = [
    (49.00, -123.30, 49.42, -121.70),
    (49.65, -123.20, 49.80, -123.08),
]

lock = threading.Lock()
stats = {'calls': 0, 'retries': 0, 'split': 0, 'failed': 0}
failed = []


def get(s, w, n, e):
    """The sites in a box; None when the geocoder keeps refusing (the box is listed in index.json as missing)."""
    url = f'{API}?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}&maxResults={CAP}&outputSRS=4326'
    for k in range(12):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'cpsdms-homes-data'}), timeout=60) as r:
                with lock:
                    stats['calls'] += 1
                    if stats['calls'] % 200 == 0: print(f"    {stats}", flush=True)
                return json.load(r).get('features') or []
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, OSError) as ex:
            with lock:
                stats['retries'] += 1
                if stats['retries'] % 50 == 1: print(f'    retrying ({ex})', flush=True)
            time.sleep(min(30, 1.5 ** k))
    with lock:
        stats['failed'] += 1
        failed.append([s, w, n, e])
    return None


def fetch_all():
    sites = {}
    boxes = []
    for (s, w, n, e) in REGIONS:
        i = s
        while i < n - 1e-9:
            j = w
            while j < e - 1e-9:
                boxes.append((i, j, min(n, i + START), min(e, j + START), 0))
                j += START
            i += START
    print(f'{len(boxes)} boxes to start', flush=True)
    with ThreadPoolExecutor(3) as pool:
        while boxes:
            results = list(pool.map(lambda b: (b, get(*b[:4])), boxes))
            boxes = []
            for (s, w, n, e, d), f in results:
                if f is None: continue
                if len(f) >= CAP and d < 14:
                    my, mx = (s + n) / 2, (w + e) / 2
                    boxes += [(s, w, my, mx, d + 1), (s, mx, my, e, d + 1), (my, w, n, mx, d + 1), (my, mx, n, e, d + 1)]
                    stats['split'] += 1
                for x in f:
                    p = x.get('properties') or {}
                    sid = p.get('siteID')
                    if sid and p.get('civicNumber') and p.get('streetName'):
                        sites[sid] = (x['geometry']['coordinates'], p)
            print(f"  calls {stats['calls']} · sites {len(sites)} · next round {len(boxes)} boxes", flush=True)
    return sites


def cmd_fetch(out):
    t0 = time.time()
    sites = fetch_all()
    # one row per civic address: the unit addresses at it are counted
    civ = {}
    for (lng, lat), p in sites.values():
        street = f"{p.get('streetName') or ''}|{p.get('streetType') or ''}|{p.get('streetDirection') or ''}"
        key = (street, p['civicNumber'], p.get('civicNumberSuffix') or '', p.get('localityName') or '')
        row = civ.get(key)
        unit = 1 if (p.get('unitNumber') or p.get('unitDesignator')) else 0
        if not row:
            civ[key] = row = [round(lng, 6), round(lat, 6), street, p['civicNumber'], 0]
        row[4] += unit
        if not unit: row[0], row[1] = round(lng, 6), round(lat, 6)   # the building's own point when there is one
    tiles = {}
    for row in civ.values():
        k = f'{math.floor(row[1] / TILE + 1e-9)}_{math.floor(row[0] / TILE + 1e-9)}'
        tiles.setdefault(k, []).append(row)
    os.makedirs(out, exist_ok=True)
    for k, rows in tiles.items():
        names = sorted({r[2] for r in rows})
        ix = {s: i for i, s in enumerate(names)}
        with open(f'{out}/{k}.json', 'w') as f:
            json.dump({'streets': names, 'h': [[r[0], r[1], ix[r[2]], r[3], r[4]] for r in rows]}, f, separators=(',', ':'))
    with open(f'{out}/index.json', 'w') as f:
        json.dump({'made': time.strftime('%Y-%m-%d'), 'tile': TILE, 'regions': REGIONS, 'tiles': sorted(tiles),
                   'addresses': len(civ), 'sites': len(sites), 'missing': failed}, f)
    print(f"{len(sites)} sites → {len(civ)} civic addresses in {len(tiles)} tiles · {stats} · {time.time() - t0:.0f}s")


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'fetch':
        cmd_fetch(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
