// The looks (features/look/looks.ts) and the drawings they are made of (art.ts): every look can be read, every look
// is its own, and a choice lands on the right screens.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAR_EDGES, MOTIFS, PAPER_KINDS, TOP_EDGES, barEdge, corner, grain, motifName, topEdge, wallpaper } from './art';
import { BUTTON_SHAPES, CARD_SHAPES, EDGES, FACES, LOOKS, LOOK_IDS, LOOK_ONLY_VARS, OWN, OWN_PALETTES, SECTIONS, SHADOWS, bgBytes, bgPlan, cleanPrefs, contrast, dataUrlBytes, facesFor, firstPaint, fontUrl, isPlain, lookList, lookVars, mix, noPrefs, overlayOf, sectionOf, shrinkTo, strengthOf, tileVars, wearing, type FaceId, type LookPrefs, type Palette } from './looks';

const all = lookList();
const prefs = (over: Partial<LookPrefs> = {}): LookPrefs => ({ ...noPrefs(), ...over });

describe('the 31 looks', () => {
  it('are the ones Rosh listed, under the names the other parts of the planner know them by', () => {
    expect([...LOOK_IDS]).toEqual(['woodland', 'cottagecore', 'pastels', 'christmas', 'autumn', 'academia', 'celestial', 'minimal',
      'french', 'botanical', 'countryside', 'regency', 'coastal', 'spring', 'fairy', 'halloween', 'winter', 'mediterranean', 'retro70s', 'stationery', 'coquette',
      'lodge', 'harbour', 'whisky', 'graphite', 'expedition', 'neon', 'circuit', 'fieldops', 'grit', 'metal']);
    expect(lookList('main').map(l => l.id)).toEqual(['woodland', 'cottagecore', 'pastels', 'christmas', 'autumn', 'academia', 'celestial', 'minimal']);
    expect(lookList('more')).toHaveLength(23);
    for (const id of LOOK_IDS) expect(LOOKS[id].id).toBe(id);
  });
  it('each has a heading face no other look has', () => {
    const faces = all.map(l => l.type.display);
    expect(new Set(faces).size).toBe(all.length);
  });
  it('text is always set in a face made for reading small', () => {
    for (const l of all) expect(FACES[l.type.body].kind, l.id).toBe('text');
  });
  it('a face with one weight is used as it is, never asked for in a weight it does not have', () => {
    for (const l of all) expect(FACES[l.type.display].weights as readonly number[], l.id).toContain(l.type.headWeight);
  });
  it('no two looks share both their colours and their wallpaper', () => {
    const sig = all.map(l => `${l.palette.bg}|${l.palette.accent}|${l.bg.paper.map(w => w.kind + ('motifs' in w ? w.motifs.join() : '')).join('+')}`);
    expect(new Set(sig).size).toBe(all.length);
  });
  it('only draw with drawings that exist', () => {
    for (const l of all) {
      const named = [...l.bg.paper.flatMap(w => ('motifs' in w ? w.motifs : [])), ...(l.bg.corner ?? []), ...(l.bg.top?.motif ? [l.bg.top.motif] : [])];
      for (const m of named) expect(MOTIFS[motifName(m)], `${l.id}: ${m}`).toBeTypeOf('function');
    }
  });
  it('two are dark, as she asked (Dark Academia, Celestial), whatever the phone is set to', () => {
    expect(LOOKS.academia.palette.scheme).toBe('dark');
    expect(LOOKS.celestial.palette.scheme).toBe('dark');
    expect(lookVars(LOOKS.minimal, prefs())['color-scheme']).toBe('light');
    expect(lookVars(LOOKS.celestial, prefs())['color-scheme']).toBe('dark');
  });
});

describe('every look can be read', () => {
  it.each(all.map(l => [l.id, l] as const))('%s: text on the page and on a card', (_id, l) => {
    const c = l.palette;
    expect(contrast(c.ink, c.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.ink, c.bg2)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.ink2, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.ink2, c.bg2)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentInk, c.accent)).toBeGreaterThanOrEqual(4.5);   // a filled button's words
    expect(contrast(c.amber2, c.bg2)).toBeGreaterThanOrEqual(4.5);         // gold words on a card
    expect(contrast(c.accent, c.bg2)).toBeGreaterThanOrEqual(3);           // a filled button against its card
  });
  it.each(all.map(l => [l.id, l] as const))('%s: the bits the planner draws in fixed colours', (_id, l) => {
    const c = l.palette, v = lookVars(l, prefs());
    // the chat's letter badge and the demo's button put dark lettering on the gold
    expect(contrast('#2a1a00', c.amber)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#101c3a', c.amber)).toBeGreaterThanOrEqual(4.5);
    // done (green) and wrong (red)
    expect(contrast(v['--good'], c.bg2)).toBeGreaterThanOrEqual(3);
    expect(contrast(v['--bad'], c.bg2)).toBeGreaterThanOrEqual(3);
  });
  it.each(all.filter(l => l.bg.sky).map(l => [l.id, l] as const))('%s: the wash of colour down the page keeps its text readable', (_id, l) => {
    for (const stop of l.bg.sky!) {
      expect(contrast(l.palette.ink, stop)).toBeGreaterThanOrEqual(7);
      expect(contrast(l.palette.ink2, stop)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(all.map(l => [l.id, l] as const))('%s: text straight on the wallpaper, at the strength the look comes with', (_id, l) => {
    // the most a drawing can colour the page: its colour at the wallpaper's strength, less the veil
    const most = (strengthOf(l, prefs()) / 100) * (1 - overlayOf(l, prefs()) / 100);
    const drawnIn = [...l.art, ...l.bg.paper.flatMap(w => w.colors ?? [])];
    for (const under of [l.palette.bg, ...(l.bg.sky ?? [])]) for (const col of drawnIn) {
      const page = mix(under, col, most);
      expect(contrast(l.palette.ink, page), `${l.id} ink on ${col}`).toBeGreaterThanOrEqual(5);
      expect(contrast(l.palette.ink2, page), `${l.id} second ink on ${col}`).toBeGreaterThanOrEqual(3.2);
    }
  });
});

describe('the drawings', () => {
  const cols = ['#6f8a5c', '#d9a0a0', '#5a3b28', '#b3a3c7'];
  it('every motif draws in the colours it is given and nothing else', () => {
    for (const [name, m] of Object.entries(MOTIFS)) {
      const out = m('#111111', '#222222', '#333333');
      expect(out, name).toMatch(/^<(path|g|circle|ellipse|rect)/);
      const used = out.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      expect(used.every(c => ['#111111', '#222222', '#333333'].includes(c)), `${name}: ${used.join(' ')}`).toBe(true);
      expect(out, name).not.toMatch(/NaN|undefined/);
    }
  });
  it('every motif the sticker sheets draw from is still there under its name (they call MOTIFS[name](a, b, c))', () => {
    const promised = ['leaf', 'sprig', 'fern', 'flower', 'daisy', 'blossom', 'tulip', 'rose', 'lavender', 'mushroom', 'acorn', 'maple', 'pumpkin', 'star', 'sparkle', 'moon', 'sun', 'cloud', 'heart', 'bow', 'snow', 'holly', 'pine', 'bauble', 'cane', 'candle', 'book', 'quill', 'key', 'crystal',
      'moth', 'butterfly', 'bunny', 'fox', 'mouse', 'cat', 'ghost', 'bat', 'bird', 'cottage', 'teacup', 'shell', 'starfish', 'lemon', 'olive', 'cherries', 'rainbow', 'crane', 'fan', 'laurel', 'cameo', 'berry', 'wheat', 'dot'];
    for (const n of promised) { expect(MOTIFS[n], n).toBeTypeOf('function'); expect(MOTIFS[n].length, n).toBeLessThanOrEqual(3); }
  });
  it('the moon is a crescent with some width to it (its two arcs once fell on the same curve and drew nothing)', () => {
    // from tip to tip is 24.8: the inner arc's radius must be more than half that, and its bulge well short of the outer one's
    const [, outer, inner] = MOTIFS.moon('#000', '', '').match(/A([\d.]+) [\d.]+ 0 1 0 8 12\.4 A([\d.]+)/) ?? [];
    expect(Number(inner)).toBeGreaterThan(12.4);
    const bulge = (r: number) => r - Math.sqrt(r * r - 12.4 * 12.4);
    expect(2 * Number(outer) - bulge(Number(outer)) - bulge(Number(inner))).toBeGreaterThan(6);
  });
  it('every kind of wallpaper, strip and bar edge comes out as a drawing', () => {
    for (const kind of PAPER_KINDS) { const t = wallpaper({ kind }, cols); expect(t.svg, kind).toContain('<svg'); expect(t.size, kind).toBeGreaterThan(0); expect(t.svg, kind).not.toMatch(/NaN|undefined/); }
    for (const kind of TOP_EDGES) { const t = topEdge(kind, cols, 'leaf'); expect(t.svg, kind).toContain('<svg'); expect(t.h, kind).toBeGreaterThan(0); expect(t.svg, kind).not.toMatch(/NaN|undefined/); }
    for (const kind of BAR_EDGES) expect(barEdge(kind, '#fff', '#ccc').svg, kind).toContain('<svg');
    expect(wallpaper({ kind: 'none' }, cols).svg).toBe('');
    expect(topEdge('none', cols).svg).toBe('');
    expect(corner([], cols).svg).toBe('');
    expect(grain('#000', 0.5).svg).toContain('feTurbulence');
  });
  it('a look can say which colour a drawing starts from, so a lemon is yellow whatever comes first', () => {
    const lemon = (spec: string) => corner([spec], ['#000001', '#000002', '#000003']).svg;
    expect(lemon('lemon@1')).toContain('fill="#000002"');
    expect(lemon('lemon@1')).not.toBe(lemon('lemon'));
    expect(motifName('lemon@1')).toBe('lemon');
    expect(topEdge('garland', ['#000001', '#000002', '#000003'], 'lemon@1').svg.match(/M-12\.6 \.8[^>]+fill="#000002"/g)).toHaveLength(5);   // every lemon on the string
  });
  it('a scatter is the same every time, so the wallpaper does not jump about between visits', () => {
    const w = { kind: 'scatter' as const, motifs: ['leaf', 'fox', 'acorn'] };
    expect(wallpaper(w, cols).svg).toBe(wallpaper(w, cols).svg);
  });
  it('a motif that hangs over the edge of the tile is drawn again on the other side, so there is no seam', () => {
    const t = wallpaper({ kind: 'scatter', motifs: ['dot'], across: 4, size: 200 }, cols);
    const drawn = t.svg.match(/<g transform="translate/g)?.length ?? 0;
    expect(drawn).toBeGreaterThan(16);   // 16 places, and the ones on an edge twice
  });
  it('a look costs a few kilobytes, not a download', () => {
    for (const l of all) expect(bgBytes(l), l.id).toBeLessThan(60_000);
    expect(bgBytes(LOOKS.minimal)).toBeLessThan(3_000);
    expect(bgPlan(LOOKS.woodland, prefs()).paper).toBe(bgPlan(LOOKS.woodland, prefs({ bg: { strength: 10, brightness: null, overlay: null, corner: true, strip: true } })).paper);   // drawn once, not at every nudge of a slider
  });
});

describe('a look for each section', () => {
  it('sections go by the first part of the path', () => {
    expect(sectionOf('/')).toBe('today');
    expect(sectionOf('')).toBe('today');
    expect(sectionOf('/plan/brief')).toBe('plan');
    expect(sectionOf('/workout/live/3')).toBe('workout');
    expect(sectionOf('/food/add')).toBe('food');
    expect(sectionOf('/cycle')).toBe('cycle');
    expect(sectionOf('/money/import')).toBe('money');
    expect(sectionOf('/shop')).toBe('shop');
    expect(sectionOf('/calendar')).toBe('calendar');
    expect(sectionOf('/habits/new')).toBe('habits');
  });
  it('the menu pages and Settings are not sections: they wear the whole planner’s look', () => {
    for (const p of ['/health', '/lifestyle', '/settings', '/settings/look', '/us']) expect(sectionOf(p)).toBeNull();
    const p = prefs({ all: 'woodland', sections: { food: 'mediterranean', today: 'minimal' } });
    expect(wearing(p, '/lifestyle').id).toBe('woodland');
    expect(wearing(p, '/settings/look').id).toBe('woodland');
  });
  it('a section with its own look wears it on every screen inside it, and the rest keep the planner’s', () => {
    const p = prefs({ all: 'woodland', sections: { food: 'mediterranean' } });
    expect(wearing(p, '/food').id).toBe('mediterranean');
    expect(wearing(p, '/food/recipes/7').id).toBe('mediterranean');
    expect(wearing(p, '/').id).toBe('woodland');
    expect(wearing(p, '/money').id).toBe('woodland');
  });
  it('a section can go back to the planner’s own look while the rest wear another', () => {
    const p = prefs({ all: 'celestial', sections: { money: OWN } });
    expect(wearing(p, '/money').id).toBe(OWN);
    expect(wearing(p, '/').id).toBe('celestial');
  });
  it('Cycle is only offered in Rosh’s planner', () => {
    expect(SECTIONS.filter(s => 'morningOnly' in s && s.morningOnly).map(s => s.id)).toEqual(['cycle']);
  });
});

describe('a picture of their own behind the planner', () => {
  it('one picture for the whole planner shows everywhere that wears the planner’s look', () => {
    const p = prefs({ all: 'minimal', pic: { ...noPrefs().pic, on: { all: 'a1' } } });
    expect(wearing(p, '/').pic).toBe('all');
    expect(wearing(p, '/lifestyle').pic).toBe('all');
    expect(wearing(p, '/settings').pic).toBe('all');
  });
  it('a section with its own look shows that look’s wallpaper, not the planner’s picture', () => {
    const p = prefs({ all: 'minimal', sections: { food: 'mediterranean' }, pic: { ...noPrefs().pic, on: { all: 'a1' } } });
    expect(wearing(p, '/food').pic).toBeNull();
    expect(wearing(p, '/plan').pic).toBe('all');
  });
  it('a section’s own picture wins there', () => {
    const p = prefs({ all: 'minimal', sections: { food: 'mediterranean' }, pic: { ...noPrefs().pic, on: { all: 'a1', food: 'f2', habits: 'h3' } } });
    expect(wearing(p, '/food/add').pic).toBe('food');
    expect(wearing(p, '/habits').pic).toBe('habits');
    expect(wearing(p, '/').pic).toBe('all');
  });
  it('works on the planner’s own look too', () => {
    const p = prefs({ pic: { ...noPrefs().pic, on: { all: 'a1' } } });
    expect(wearing(p, '/')).toEqual({ id: OWN, section: 'today', pic: 'all' });
    expect(isPlain(p)).toBe(false);
  });
  it('a picture is shrunk so its long side is about 1400, and never made bigger', () => {
    expect(shrinkTo(4000, 3000)).toEqual({ w: 1400, h: 1050 });
    expect(shrinkTo(3000, 4000)).toEqual({ w: 1050, h: 1400 });
    expect(shrinkTo(800, 600)).toEqual({ w: 800, h: 600 });
    expect(shrinkTo(0, 0)).toEqual({ w: 0, h: 0 });
    expect(shrinkTo(9000, 20).h).toBe(3);
  });
  it('knows how big a picture is from its address', () => {
    expect(dataUrlBytes(`data:image/jpeg;base64,${'A'.repeat(4000)}`)).toBe(3000);
  });
  it('a picture takes the wallpaper’s place and uses its own sliders', () => {
    const p = prefs({ pic: { strength: 80, brightness: 110, overlay: 50, fit: 'fill', on: { all: 'a1' } } });
    const b = bgPlan(LOOKS.woodland, p, true);
    expect(b.paper).toEqual([]);
    expect(b.grain).toBeNull();
    expect([b.paperOpacity, b.brightness, b.veil]).toEqual([0.8, 1.1, 0.5]);
  });
});

describe('what goes on the page', () => {
  it('nothing chosen: nothing is set, the planner is exactly as it was', () => {
    expect(lookVars(null, prefs())).toEqual({});
    expect(facesFor(null, prefs())).toEqual([]);
    expect(isPlain(prefs())).toBe(true);
  });
  it('a look sets every colour the planner draws with', () => {
    const v = lookVars(LOOKS.autumn, prefs());
    for (const k of ['--bg', '--bg-2', '--ink', '--ink-2', '--line', '--accent', '--accent-ink', '--amber', '--amber-2', 'color-scheme', '--serif', '--sans', '--radius']) expect(v[k], k).toBeTruthy();
    expect(v['--serif']).toContain('DM Serif Display');
    expect(v['--serif']).toContain('Georgia');   // something to read in if the face can't be fetched
    expect(v['--sans']).toContain('Nunito');
  });
  it('shapes and type chosen by hand work on the planner’s own look, and touch no colour', () => {
    const p = prefs({ shapes: { cards: 'square', buttons: 'pill', edges: 'stitch', shadows: 'pop' }, type: { heading: 'playfair', text: 'look' } });
    const v = lookVars(null, p);
    expect(v['--radius']).toBe(`${CARD_SHAPES.square}px`);
    expect(v['--look-btn-radius']).toBe(`${BUTTON_SHAPES.pill}px`);
    expect(v['--look-card-outline']).toContain('dashed');
    expect(v['--look-card-shadow']).toContain('4px 4px 0');
    expect(v['--serif']).toContain('Playfair Display');
    expect(v['--sans']).toBeUndefined();
    expect(Object.keys(v).some(k => ['--bg', '--ink', '--accent', 'color-scheme'].includes(k))).toBe(false);
    expect(facesFor(null, p)).toEqual(['playfair']);
    expect(isPlain(p)).toBe(false);
  });
  it('a hand choice takes the place of the look’s own, one setting at a time', () => {
    const own = lookVars(LOOKS.pastels, prefs());
    const mine = lookVars(LOOKS.pastels, prefs({ shapes: { cards: 'square', buttons: 'look', edges: 'look', shadows: 'look' } }));
    expect(own['--radius']).toBe('28px');
    expect(mine['--radius']).toBe('2px');
    expect(mine['--look-btn-radius']).toBe(own['--look-btn-radius']);
    expect(mine['--look-card-border']).toBe(own['--look-card-border']);
  });
  it('a pill is kept for buttons; a box you type several lines in never gets pill ends', () => {
    const v = lookVars(LOOKS.pastels, prefs());
    expect(v['--look-btn-radius']).toBe('999px');
    expect(parseInt(v['--look-field-radius'], 10)).toBeLessThanOrEqual(18);
  });
  it('every edge and every shadow has its own way of being drawn', () => {
    const edge = (e: (typeof EDGES)[number]) => { const v = lookVars(null, prefs({ shapes: { cards: 'look', buttons: 'look', edges: e, shadows: 'none' } })); return `${v['--look-card-border']}|${v['--look-card-outline']}|${v['--look-card-shadow']}`; };
    const shadow = (s: (typeof SHADOWS)[number]) => lookVars(null, prefs({ shapes: { cards: 'look', buttons: 'look', edges: 'hairline', shadows: s } }))['--look-card-shadow'];
    expect(new Set(EDGES.map(edge)).size).toBe(EDGES.length);
    expect(new Set(SHADOWS.map(shadow)).size).toBe(SHADOWS.length);
    // a filled card keeps a frame it can be seen on
    expect(lookVars(LOOKS.academia, prefs())['--look-card-shadow-accent']).toContain('var(--accent)');
  });
  it('looks with hand-written labels say so; the others leave the labels alone', () => {
    expect(lookVars(LOOKS.woodland, prefs())['--look-label-font']).toContain('Caveat');
    expect(lookVars(LOOKS.minimal, prefs())['--look-label-font']).toBeUndefined();
  });
  it('asks Google Fonts only for what the look on screen needs, weights in rising order', () => {
    expect(facesFor(LOOKS.woodland, prefs())).toEqual(['fondamento', 'nunito', 'caveat']);
    expect(facesFor(LOOKS.minimal, prefs())).toEqual(['josefin']);   // Inter is already there
    const url = fontUrl(facesFor(LOOKS.woodland, prefs()));
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Fondamento:wght@400&family=Nunito:wght@400;500;600;700&family=Caveat:wght@600;700&display=swap');
    expect(fontUrl([])).toBe('');
    for (const id of Object.keys(FACES) as FaceId[]) { const w = [...FACES[id].weights]; expect(w, id).toEqual([...w].sort((a, b) => a - b)); }
  });
  it('the tiles in the Studio ask for just the letters of the names', () => {
    expect(fontUrl(['shrikhand'], 'Retro 70s')).toBe('https://fonts.googleapis.com/css2?family=Shrikhand:wght@400&display=swap&text=Retro%2070s');
  });
  it('the sliders: as the look has it until moved, then the person’s own', () => {
    expect(strengthOf(LOOKS.woodland, prefs())).toBe(LOOKS.woodland.bg.strength);
    const p = prefs({ bg: { strength: 80, brightness: 120, overlay: 30, corner: false, strip: false } });
    const b = bgPlan(LOOKS.woodland, p);
    expect([b.paperOpacity, b.brightness, b.veil]).toEqual([0.8, 1.2, 0.3]);
    expect(b.corner).toBeNull();
    expect(b.top).toBeNull();
    expect(b.bar).not.toBeNull();   // the bar's edge is part of the bar, not of the background
    const d = bgPlan(LOOKS.woodland, prefs());
    expect(d.corner).not.toBeNull();
    expect(d.top).not.toBeNull();
  });
});

describe('the Studio’s tiles', () => {
  it('the planner’s own tile shows the colours planner.css has (so the two can’t drift apart)', () => {
    const css = readFileSync(new URL('../../planner.css', import.meta.url), 'utf8');
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    const block = (text: string, opens: string): Record<string, string> => {
      const from = text.indexOf(opens);
      return Object.fromEntries([...text.slice(from, text.indexOf('}', from)).matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    };
    const same = (p: Palette, v: Record<string, string>, base: Record<string, string> = {}) => {
      const all = { ...base, ...v };
      expect([p.bg, p.bg2, p.ink, p.ink2, p.line, p.accent, p.accentInk, p.amber, p.amber2]).toEqual(['--bg', '--bg-2', '--ink', '--ink-2', '--line', '--accent', '--accent-ink', '--amber', '--amber-2'].map(k => all[k]));
    };
    same(OWN_PALETTES.navy.light, block(light, ':root {'));
    same(OWN_PALETTES.plum.light, block(light, 'html[data-theme="plum"] {'), block(light, ':root {'));
    same(OWN_PALETTES.navy.dark, block(dark, ':root {'));
    same(OWN_PALETTES.plum.dark, block(dark, 'html[data-theme="plum"] {'), block(dark, ':root {'));
    expect(block(light, ':root {')['color-scheme']).toBe('light');
    expect(block(dark, ':root {')['color-scheme']).toBe('dark');
  });
  it('a tile sets every look-only variable, so it borrows nothing from the look on the page around it', () => {
    const own = tileVars(OWN, { theme: 'plum', dark: true });
    for (const k of LOOK_ONLY_VARS) expect(own[k], k).toBe('initial');
    expect(own['--bg']).toBe(OWN_PALETTES.plum.dark.bg);
    expect(own['--serif']).toContain('Fraunces');
    const pastels = tileVars('pastels', { theme: 'navy', dark: false });
    for (const k of LOOK_ONLY_VARS) expect(pastels[k], k).toBeTruthy();
    expect(pastels['--look-btn-radius']).toBe('999px');
    expect(pastels['--look-label-font']).toBe('initial');   // Pastels has no hand-written labels: not Woodland's by accident
    // every variable a look sets is either one of the planner's own or on the list a tile clears
    const known = new Set<string>([...LOOK_ONLY_VARS, '--bg', '--bg-2', '--ink', '--ink-2', '--line', '--accent', '--accent-ink', '--amber', '--amber-2', 'color-scheme', '--good', '--bad', '--cy-pink-2', '--cy-teal-2', '--serif', '--sans', '--radius']);
    for (const l of all) for (const k of Object.keys(lookVars(l, prefs({ shapes: { cards: 'soft', buttons: 'pill', edges: 'frame', shadows: 'pop' } })))) expect(known.has(k), `${l.id}: ${k}`).toBe(true);
  });
  it('heading faces whose numbers dip or dance hand big figures to the text face', () => {
    expect(lookVars(LOOKS.woodland, prefs())['--look-num-font']).toContain('Nunito');
    expect(lookVars(LOOKS.autumn, prefs())['--look-num-font']).toBeUndefined();   // DM Serif Display's stand on the line
    expect(lookVars(null, prefs({ type: { heading: 'playfair', text: 'look' } }))['--look-num-font']).toContain('Inter');
  });
});

describe('the colour for the very first frame (planner.html, before the app has loaded)', () => {
  it('nothing chosen: the planner’s own', () => {
    expect(firstPaint(prefs())).toEqual({ all: null, sections: {} });
  });
  it('the whole planner’s look, and each section with its own by the first part of its path', () => {
    const f = firstPaint(prefs({ all: 'celestial', sections: { today: 'minimal', food: 'mediterranean', money: OWN } }));
    expect(f.all).toEqual({ bg: LOOKS.celestial.palette.bg, scheme: 'dark' });
    expect(f.sections).toEqual({ '': { bg: LOOKS.minimal.palette.bg, scheme: 'light' }, food: { bg: LOOKS.mediterranean.palette.bg, scheme: 'light' }, money: null });
  });
});

describe('what was saved comes back safe to use', () => {
  it('nothing, or rubbish, is "nothing chosen"', () => {
    for (const junk of [null, undefined, 7, 'woodland', [], { all: 'plasma' }, { sections: 'x', bg: 4, pic: null, shapes: [], type: 0 }]) expect(isPlain(cleanPrefs(junk)), JSON.stringify(junk)).toBe(true);
  });
  it('keeps what it knows and drops what it does not', () => {
    const p = cleanPrefs({ all: 'fairy', sections: { food: 'mediterranean', money: 'own', plan: 'vaporwave', nope: 'woodland' }, bg: { strength: 140, brightness: 10, overlay: 55.4, corner: false }, pic: { fit: 'repeat', overlay: 200, on: { all: 'abc', today: '', moon: 'x' } }, shapes: { cards: 'soft', buttons: 'triangle', edges: 'frame', shadows: 'pop' }, type: { heading: 'cinzel', text: 'comic sans' }, at: '2026-11-11T10:00:00.000Z' });
    expect(p.all).toBe('fairy');
    expect(p.sections).toEqual({ food: 'mediterranean', money: 'own' });
    expect(p.bg).toEqual({ strength: 100, brightness: 50, overlay: 55, corner: false, strip: true });
    expect(p.pic.fit).toBe('repeat');
    expect(p.pic.overlay).toBe(90);
    expect(p.pic.on).toEqual({ all: 'abc' });
    expect(p.shapes).toEqual({ cards: 'soft', buttons: 'look', edges: 'frame', shadows: 'pop' });
    expect(p.type).toEqual({ heading: 'cinzel', text: 'look' });
    expect(p.at).toBe('2026-11-11T10:00:00.000Z');
  });
  it('going round through JSON changes nothing', () => {
    const p = prefs({ all: 'winter', sections: { shop: 'retro70s' }, at: '2026-11-11T10:00:00.000Z' });
    expect(cleanPrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
