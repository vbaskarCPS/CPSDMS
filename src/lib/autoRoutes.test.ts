// Map Builder › Auto-build: the route cutter on a made-up grid of streets.
import { describe, expect, it } from 'vitest';
import { autoRoutes, streetKey, type AutoHome, type AutoWay, type LngLat, type MainKind } from './autoRoutes';

// a flat patch near Port Coquitlam: metres → [lng, lat]
const LAT0 = 49.27, LNG0 = -122.75;
const kx = 111320 * Math.cos(LAT0 * Math.PI / 180), ky = 110540;
const at = (x: number, y: number): LngLat => [Math.round((LNG0 + x / kx) * 1e7) / 1e7, Math.round((LAT0 + y / ky) * 1e7) / 1e7];

/** A grid of streets every 100 m over size × size metres; each street one way from end to end (nodes shared at corners). */
function grid(size: number, mainX?: number) {
  const ways: AutoWay[] = []; const main = new Map<number, MainKind>(); let id = 1;
  for (let x = 0; x <= size; x += 100) {
    ways.push({ id, name: x === mainX ? 'Main Street' : `${x / 100} Street`, geometry: Array.from({ length: size / 100 + 1 }, (_, k) => at(x, k * 100)) });
    if (x === mainX) main.set(id, 'arterial');
    id++;
  }
  for (let y = 0; y <= size; y += 100) ways.push({ id: id++, name: `${y / 100} Avenue`, geometry: Array.from({ length: size / 100 + 1 }, (_, k) => at(k * 100, y)) });
  return { ways, main };
}
const square = (x0: number, y0: number, x1: number, y1: number): LngLat[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
const keyOf = (g: LngLat[]) => g.map(p => p.join(',')).join(';');

describe('autoRoutes', () => {
  it('uses every street once, in routes of about the target length that are each in one piece', () => {
    const { ways, main } = grid(1600, 800);
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 1610, 1610), targetM: 2500 });
    // 17 streets each way × 1600 m = 54.4 km, roughly 22 routes
    expect(r.routes.length).toBeGreaterThan(16);
    expect(r.routes.length).toBeLessThan(28);
    const all = r.routes.flatMap(rt => rt.pieces.map(p => keyOf(p.geometry)));
    expect(new Set(all).size).toBe(all.length);                       // no piece twice
    expect(r.totalM).toBeGreaterThan(54000);                           // nothing dropped
    const lens = r.routes.map(rt => rt.lengthM);
    const mean = lens.reduce((t, v) => t + v, 0) / lens.length;
    expect(Math.min(...lens)).toBeGreaterThan(0.5 * mean);
    expect(Math.max(...lens)).toBeLessThan(1.8 * mean);
    // the main road is in the routes, each piece once
    const mainPieces = r.routes.flatMap(rt => rt.pieces.filter(p => p.main));
    expect(mainPieces.reduce((t, p) => t + p.lengthM, 0)).toBeGreaterThan(1500);
  });

  it('numbers routes in rows from the top, left to right', () => {
    const { ways, main } = grid(1600);
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 1610, 1610), targetM: 2500 });
    const cy = (i: number) => { const ps = r.routes[i].pieces.flatMap(p => p.geometry); return ps.reduce((t, p) => t + p[1], 0) / ps.length; };
    expect(cy(0)).toBeGreaterThan(cy(r.routes.length - 1));
  });

  it('leaves out streets another master map already has', () => {
    const { ways, main } = grid(1000);
    const takenWay = ways.find(w => w.name === '3 Street')!;
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 1010, 1010), taken: [takenWay.geometry] });
    expect(r.alreadyMapped).toBeGreaterThan(0);
    expect(r.routes.flatMap(rt => rt.pieces).some(p => p.name === '3 Street')).toBe(false);
  });

  it('only takes streets inside the outline, and skips trails, unnamed ways and highways', () => {
    const { ways, main } = grid(1000);
    ways.push({ id: 900, name: 'Hyde Creek Trail', geometry: [at(50, 50), at(950, 950)] });
    ways.push({ id: 901, name: '', unnamed: true, geometry: [at(50, 950), at(950, 50)] });
    ways.push({ id: 902, name: 'Lougheed Highway', geometry: [at(0, 450), at(1000, 450)] });
    main.set(902, 'highway');
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 510, 1010) });
    const names = new Set(r.routes.flatMap(rt => rt.pieces.map(p => p.name)));
    expect(names.has('Hyde Creek Trail')).toBe(false);
    expect(names.has('Lougheed Highway')).toBe(false);
    expect(names.has('8 Street')).toBe(false);                          // outside the outline
    expect(names.has('2 Street')).toBe(true);
    // the avenues are cut at the outline's edge (about 500 m of each, plus the slack)
    const ave = r.routes.flatMap(rt => rt.pieces).filter(p => p.name === '4 Avenue').reduce((t, p) => t + p.lengthM, 0);
    expect(ave).toBeGreaterThan(480);
    expect(ave).toBeLessThan(560);
  });

  it('leaves a main road on the east edge to the map beside it, and keeps the west edge', () => {
    const { ways, main } = grid(1000);
    const east = ways.find(w => w.name === '10 Street')!, west = ways.find(w => w.name === '0 Street')!;
    main.set(east.id, 'arterial'); main.set(west.id, 'arterial');
    const outline = square(0, 0, 1000, 1000);
    const nextDoor = [square(1000, 0, 2000, 1000)];
    const r = autoRoutes({ ways, main, outline, neighbours: nextDoor });
    const inRoutes = new Set(r.routes.flatMap(rt => rt.pieces.map(p => p.name)));
    expect(inRoutes.has('10 Street')).toBe(false);
    expect(r.leftToNext.every(p => p.name === '10 Street')).toBe(true);
    expect(inRoutes.has('0 Street')).toBe(true);
    // with no map beside it, the east edge is this map's
    const alone = autoRoutes({ ways, main, outline });
    expect(new Set(alone.routes.flatMap(rt => rt.pieces.map(p => p.name))).has('10 Street')).toBe(true);
  });
});

describe('autoRoutes with road classes', () => {
  it('keeps to streets with homes, and takes main roads from the class when it is known', () => {
    const { ways } = grid(1000);
    for (const w of ways) w.kind = 'residential';
    ways.find(w => w.name === '2 Street')!.kind = 'service';
    ways.find(w => w.name === '5 Avenue')!.kind = 'secondary';
    ways.find(w => w.name === '8 Avenue')!.kind = 'motorway';
    const r = autoRoutes({ ways, main: new Map(), outline: square(-10, -10, 1010, 1010) });
    const ps = r.routes.flatMap(rt => rt.pieces);
    expect(ps.some(p => p.name === '2 Street')).toBe(false);
    expect(ps.some(p => p.name === '8 Avenue')).toBe(false);
    expect(ps.filter(p => p.name === '5 Avenue').every(p => p.main)).toBe(true);
    expect(ps.some(p => p.name === '5 Avenue')).toBe(true);
  });

  it('cuts a route that came out far too long into two that are each in one piece', () => {
    // one long dead-end street with a comb of short ones: a single pocket of about 9 km
    const ways: AutoWay[] = [{ id: 1, name: 'Long Road', geometry: Array.from({ length: 31 }, (_, k) => at(k * 100, 0)) }];
    for (let k = 0; k <= 30; k++) ways.push({ id: 10 + k, name: `${k} Close`, geometry: [at(k * 100, 0), at(k * 100, 180)] });
    const r = autoRoutes({ ways, main: new Map(), outline: square(-50, -50, 3050, 250), targetM: 2700 });
    expect(r.routes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...r.routes.map(x => x.lengthM))).toBeLessThan(1.6 * 2700);
  });
});

describe('autoRoutes keeps streets whole', () => {
  it('doesn\'t cut a street where driveways and lanes meet it, and puts a street split across OSM ways back together', () => {
    const ways: AutoWay[] = [
      { id: 1, name: 'Hoy Street', kind: 'residential', geometry: [at(0, 0), at(0, 100), at(0, 200), at(0, 300)] },
      { id: 2, name: 'Hoy Street', kind: 'residential', geometry: [at(0, 300), at(0, 400), at(0, 500)] },
    ];
    // driveways off every vertex
    ways.push({ id: 10, name: '', unnamed: true, kind: 'service', geometry: [at(0, 100), at(30, 100)] });
    ways.push({ id: 11, name: 'Back Lane', kind: 'service', geometry: [at(0, 200), at(-30, 200)] });
    ways.push({ id: 12, name: '', unnamed: true, kind: 'service', geometry: [at(0, 400), at(30, 400)] });
    const r = autoRoutes({ ways, main: new Map(), outline: square(-50, -50, 50, 550) });
    expect(r.routes.length).toBe(1);
    // one piece per OSM way: no cuts at the driveways
    expect(r.routes[0].pieces.map(p => p.wayId).sort()).toEqual([1, 2]);
  });

  it('cuts out only the stretch another map already has', () => {
    const ways: AutoWay[] = [{ id: 1, name: 'Long Street', kind: 'residential', geometry: [at(0, 0), at(1000, 0)] }];
    const r = autoRoutes({ ways, main: new Map(), outline: square(-20, -50, 1020, 50), taken: [[at(0, 0), at(400, 0)]] });
    const len = r.routes.flatMap(x => x.pieces).reduce((t, p) => t + p.lengthM, 0);
    expect(len).toBeGreaterThan(560);
    expect(len).toBeLessThan(640);
    expect(r.alreadyMapped).toBe(1);
  });
});

describe('autoRoutes with the houses known', () => {
  it('leaves out a main road with no houses on it, and a dead end with none', () => {
    const { ways, main } = grid(1000, 500);
    for (const w of ways) w.kind = 'residential';
    ways.push({ id: 950, name: 'Empty Close', kind: 'residential', geometry: [at(1000, 300), at(1150, 300)] });
    const homes: AutoHome[] = [];
    // a house every 20 m along every street but the main road and the close
    for (const w of ways) {
      if (w.name === 'Main Street' || w.name === 'Empty Close') continue;
      const [a, b] = [w.geometry[0], w.geometry[w.geometry.length - 1]];
      for (let f = 0.02; f < 1; f += 0.02) homes.push({ at: [a[0] + (b[0] - a[0]) * f + 0.00012, a[1] + (b[1] - a[1]) * f + 0.00012], street: w.name.replace('Street', 'St').replace('Avenue', 'Ave') });
    }
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 1200, 1010), homes });
    expect(r.homesKnown).toBe(true);
    const names = new Set(r.routes.flatMap(rt => rt.pieces.map(p => p.name)));
    expect(names.has('Main Street')).toBe(false);
    expect(names.has('Empty Close')).toBe(false);
    expect(names.has('3 Street')).toBe(true);
    expect(r.routes.every(rt => (rt.homes || 0) > 0)).toBe(true);
    expect(r.noHomesM).toBeGreaterThan(900);
  });

  it('knows a street however it is spelled', () => {
    expect(streetKey('Lúrio Crescent').full).toBe(streetKey('Lurio|Cres|').full);
    expect(streetKey('East 10th Avenue').full).toBe(streetKey('10th|Ave|E').full);
    expect(streetKey('Thames Close').full).not.toBe(streetKey('Thames Crescent').full);
  });
});

describe('autoRoutes filling the gaps', () => {
  it('only takes streets near the lines it is given', () => {
    const { ways, main } = grid(1600);
    const near = { lines: [ways.find(w => w.name === '2 Street')!.geometry], m: 150 };
    const r = autoRoutes({ ways, main, outline: square(-10, -10, 1610, 1610), near });
    const names = new Set(r.routes.flatMap(rt => rt.pieces.map(p => p.name)));
    expect(names.has('2 Street')).toBe(true);
    expect(names.has('12 Street')).toBe(false);
  });
});
