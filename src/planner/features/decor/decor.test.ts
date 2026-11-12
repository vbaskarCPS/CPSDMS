// Stickers on a planner page: the library (library.ts), and where a sticker goes and what is saved (decor.ts).
import { describe, expect, it, vi } from 'vitest';
import {
  EDGE, MAX_ON_PAGE, MAX_SIZE, MIN_SIZE, OWN_MAX_BYTES, OWN_SIDES, SECTIONS, bearing, boxOf, canRestack, change, copy, dataUrlBytes, decoratePath, edgeScroll, fitWithin,
  layers, middle, mineArt, mineKey, overlap, pinch, place, placeAt, readDecor, readOwn, remove, restack, sectionOf, sectionsFor, sizeFromDrag, tidy, tuck, turn,
  turnFromDrag, writeDecor, type Placed, type Shape,
} from './decor';
import { GROUPS, LIBRARY, artOf, inGroup, srcOf } from './library';

const st = (id: string, x: number, y: number, more: Partial<Placed> = {}): Placed => ({ id, art: 'fox', x, y, s: 60, r: 0, ...more });
const square: Shape = { w: 1, h: 1 };
const squares = () => square;
const ids = (items: Placed[]) => items.map(p => p.id).join(' ');
/** A phone's page (390 wide, 16 either side) and a wide window's (the page stops growing at 640). */
const PHONE = 358, NARROW = 288, WIDE = 608;

describe('the sticker library', () => {
  it('has the eight groups Rosh asked for, each worth browsing, and plenty in all', () => {
    expect(GROUPS.map(g => g.name)).toEqual(['Woodland', 'Flowers', 'Ribbons & frames', 'Seasons', 'Washi tape', 'Arrows & labels', 'Tasks & moods', 'Paper']);
    for (const g of GROUPS) expect(inGroup(g.id).length, g.name).toBeGreaterThanOrEqual(8);
    expect(LIBRARY.length).toBeGreaterThanOrEqual(70);
    expect(LIBRARY.every(s => GROUPS.some(g => g.id === s.group))).toBe(true);
  });
  it('no two stickers share an id, and every one has a name', () => {
    expect(new Set(LIBRARY.map(s => s.id)).size).toBe(LIBRARY.length);
    expect(LIBRARY.every(s => /^[a-z][a-z0-9-]*$/.test(s.id) && s.name.trim().length > 1)).toBe(true);
  });
  it('every sticker is a drawing with a shape and a sensible first size', () => {
    for (const s of LIBRARY) {
      expect(s.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="'), s.id).toBe(true);
      expect(s.svg.endsWith('</svg>'), s.id).toBe(true);
      expect(s.svg, s.id).not.toMatch(/NaN|undefined|null|<script|href=/);
      expect(s.w > 0 && s.h > 0, s.id).toBe(true);
      expect(s.size, s.id).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(s.size, s.id).toBeLessThanOrEqual(MAX_SIZE);
    }
  });
  it('a sticker is shown as a picture, the same one every time', () => {
    const fox = artOf('fox')!;
    expect(srcOf(fox).startsWith('data:image/svg+xml,%3Csvg')).toBe(true);
    expect(srcOf(fox)).toBe(srcOf(fox));
    expect(artOf('no-such-sticker')).toBeUndefined();
  });
  it('tape is see-through and has no white edge; the animals are cut out with one', () => {
    expect(artOf('tape-stripes')!.svg).toMatch(/opacity="0\.9"/);
    expect(artOf('tape-stripes')!.svg).not.toMatch(/<filter/);
    expect(artOf('hedgehog')!.svg).toMatch(/<filter id="fin"/);
    expect(artOf('tape-stripes')!.w).toBeGreaterThan(artOf('tape-stripes')!.h * 4);   // a strip
  });
  it('a torn edge is torn the same way every time (two phones show the same sticker)', async () => {
    vi.resetModules();
    const again = await import('./library');
    expect(again.LIBRARY).not.toBe(LIBRARY);   // drawn afresh
    expect(again.artOf('note')!.svg).toBe(artOf('note')!.svg);
    expect(again.artOf('tape-kraft')!.svg).toBe(artOf('tape-kraft')!.svg);
  });
});

describe('which pages carry stickers', () => {
  it('each section’s own front page, and the two menu pages', () => {
    expect(sectionOf('/')).toBe('today');
    expect(sectionOf('')).toBe('today');
    for (const s of SECTIONS) expect(sectionOf(s.path)).toBe(s.id);
    expect(sectionOf('/health')).toBe('health');
    expect(sectionOf('/lifestyle')).toBe('lifestyle');
    expect(sectionOf('/shop/')).toBe('shop');
  });
  it('the Plan page for another day is still the Plan page', () => {
    expect(sectionOf('/plan/2026-11-10')).toBe('plan');
  });
  it('the screens inside a section, and Settings, carry none', () => {
    for (const p of ['/food/add', '/plan/brief', '/plan/week', '/workout/live/3', '/money/budget', '/habits/new', '/cycle/log/2026-11-11', '/settings', '/settings/stickers', '/us', '/nowhere']) expect(sectionOf(p), p).toBeNull();
  });
  it('Cycle is offered on Rosh’s planner only', () => {
    expect(sectionsFor('morning').map(s => s.name)).toEqual(['Today', 'Plan', 'Calendar', 'Habits', 'Train', 'Food', 'Cycle', 'Money', 'Shopping', 'Health', 'Lifestyle']);
    expect(sectionsFor('night').map(s => s.name)).toEqual(['Today', 'Plan', 'Calendar', 'Habits', 'Train', 'Food', 'Money', 'Shopping', 'Health', 'Lifestyle']);
  });
  it('a page is opened for decorating at its own address', () => {
    expect(decoratePath(SECTIONS[0])).toBe('/?decorate=1');
    expect(decoratePath(SECTIONS.find(s => s.id === 'shop')!)).toBe('/shop?decorate=1');
    expect(sectionOf(decoratePath(SECTIONS[1]).split('?')[0])).toBe('plan');
  });
});

describe('what is saved for a page', () => {
  it('a page with nothing on it saves nothing at all', () => {
    expect(writeDecor([])).toBeNull();
    expect(readDecor(null)).toEqual([]);
    expect(readDecor(undefined)).toEqual([]);
    expect(readDecor({ v: 1 })).toEqual([]);
  });
  it('what was saved comes back the same', () => {
    const items = [st('a', 0.25, 120, { s: 80, r: -15 }), st('b', 0.8, 900, { art: mineArt('k1'), under: true })];
    const saved = JSON.parse(JSON.stringify(writeDecor(items)));
    expect(saved).toEqual({ v: 1, items: [{ id: 'a', art: 'fox', x: 0.25, y: 120, s: 80, r: -15 }, { id: 'b', art: 'mine:k1', x: 0.8, y: 900, s: 60, r: 0, under: true }] });
    expect(readDecor(saved)).toEqual(items);
  });
  it('anything that isn’t a sticker is dropped, and odd numbers are brought within the rules', () => {
    const got = readDecor({ items: [
      null, 'fox', { id: 'a' }, { id: 'b', art: 'fox', x: 'left', y: 1 }, { id: '', art: 'fox', x: 0, y: 0 }, { id: 'c', art: 'java script:alert(1)', x: 0, y: 0 },
      { id: 'ok', art: 'fox', x: 1.7, y: -40, s: 9000, r: 725 }, { id: 'ok', art: 'owl', x: 0.5, y: 5 }, { id: 'plain', art: 'owl', x: 0.5, y: 5, under: 'yes' },
    ] });
    expect(got).toEqual([{ id: 'ok', art: 'fox', x: 1, y: 0, s: MAX_SIZE, r: 5 }, { id: 'plain', art: 'owl', x: 0.5, y: 5, s: 72, r: 0 }]);
  });
  it('a page never holds more than forty, even if more were saved', () => {
    const many = Array.from({ length: 55 }, (_, i) => st(`s${i}`, 0.5, i * 10));
    expect(readDecor({ items: many }).length).toBe(MAX_ON_PAGE);
    expect(MAX_ON_PAGE).toBe(40);
  });
  it('one of the person’s own pictures is told apart from a library sticker', () => {
    expect(mineKey(mineArt('abc123'))).toBe('abc123');
    expect(mineKey('fox')).toBeNull();
  });
});

describe('placing a sticker', () => {
  it('a sticker from the tray lands where it is put, on top of the others', () => {
    const next = place([st('a', 0.2, 50)], 'owl', { x: 0.5, y: 300 }, 72, 'new')!;
    expect(ids(next)).toBe('a new');
    expect(next[1]).toEqual({ id: 'new', art: 'owl', x: 0.5, y: 300, s: 72, r: 0 });
  });
  it('the forty-first is refused, and the page is left as it was', () => {
    const full = Array.from({ length: MAX_ON_PAGE }, (_, i) => st(`s${i}`, 0.5, i * 10));
    expect(place(full, 'owl', { x: 0.5, y: 10 }, 72)).toBeNull();
    expect(copy(full, 's3', PHONE)).toBeNull();
    expect(place(full.slice(1), 'owl', { x: 0.5, y: 10 }, 72)!.length).toBe(MAX_ON_PAGE);
  });
  it('its middle never leaves the page: not off the sides, not above the top, not past the end', () => {
    const items = [st('a', 0.5, 100)];
    expect(change(items, 'a', { x: -0.3 })[0].x).toBe(0);
    expect(change(items, 'a', { x: 1.4 })[0].x).toBe(1);
    expect(change(items, 'a', { y: -80 })[0].y).toBe(0);
    expect(change(items, 'a', { y: 5000 }, 1200)[0].y).toBe(1200);
    expect(change(items, 'a', { y: 5000 })[0].y).toBe(5000);   // the page's length isn't known here: kept as asked
  });
  it('moving one leaves the others, and the list that was passed in, untouched', () => {
    const items = [st('a', 0.1, 10), st('b', 0.2, 20)];
    const next = change(items, 'b', { x: 0.6, y: 200 });
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toMatchObject({ x: 0.6, y: 200 });
    expect(items[1]).toMatchObject({ x: 0.2, y: 20 });
  });
  it('a copy sits a little down and to the right, on top, with its own id', () => {
    const next = copy([st('a', 0.5, 100, { s: 90, r: 30, under: true }), st('b', 0.1, 10)], 'a', PHONE, 'twin')!;
    expect(ids(next)).toBe('a b twin');
    expect(next[2]).toMatchObject({ id: 'twin', art: 'fox', s: 90, r: 30, under: true, y: 118 });
    expect(next[2].x * PHONE).toBeCloseTo(0.5 * PHONE + 18, 0);
  });
  it('taking one off leaves the rest in order', () => {
    expect(ids(remove([st('a', 0, 0), st('b', 0, 0), st('c', 0, 0)], 'b'))).toBe('a c');
  });
});

describe('sizes and turns', () => {
  it('a sticker is never smaller than 24 px or bigger than 320 px on its longer side', () => {
    expect(tidy(st('a', 0.5, 0, { s: 3 })).s).toBe(MIN_SIZE);
    expect(tidy(st('a', 0.5, 0, { s: 4000 })).s).toBe(MAX_SIZE);
    expect([MIN_SIZE, MAX_SIZE]).toEqual([24, 320]);
  });
  it('the longer side is the size; the other follows the drawing’s shape', () => {
    expect(boxOf(160, { w: 160, h: 34 })).toEqual({ w: 160, h: 34 });      // a strip of tape
    expect(boxOf(100, { w: 56, h: 88 })).toEqual({ w: (100 * 56) / 88, h: 100 });   // a tall tag
    expect(boxOf(64, square)).toEqual({ w: 64, h: 64 });
  });
  it('dragging a corner away from the middle makes it bigger, towards it smaller, within the limits', () => {
    const mid = { x: 100, y: 100 };
    expect(sizeFromDrag(60, mid, { x: 130, y: 130 }, { x: 160, y: 160 })).toBe(120);
    expect(sizeFromDrag(60, mid, { x: 130, y: 130 }, { x: 115, y: 115 })).toBe(30);
    expect(sizeFromDrag(60, mid, { x: 130, y: 130 }, { x: 101, y: 101 })).toBe(MIN_SIZE);
    expect(sizeFromDrag(60, mid, { x: 130, y: 130 }, { x: 900, y: 900 })).toBe(MAX_SIZE);
  });
  it('the turning handle carries the sticker round with it', () => {
    const mid = { x: 100, y: 100 }, below = { x: 100, y: 160 };
    expect(turnFromDrag(0, mid, below, { x: 40, y: 100 })).toBe(90);          // handle dragged from below to the left: a quarter turn clockwise
    expect(turnFromDrag(0, mid, below, { x: 160, y: 100 })).toBe(-90);
    expect(turnFromDrag(30, mid, below, { x: 58, y: 142 })).toBeCloseTo(75, 0);
  });
  it('close to straight, it clicks to straight', () => {
    const mid = { x: 0, y: 0 }, from = { x: 0, y: 100 };
    const at = (deg: number) => ({ x: -100 * Math.sin((deg * Math.PI) / 180), y: 100 * Math.cos((deg * Math.PI) / 180) });
    expect(turnFromDrag(0, mid, from, at(3))).toBe(0);
    expect(turnFromDrag(0, mid, from, at(-2.5))).toBe(0);
    expect(turnFromDrag(0, mid, from, at(88))).toBe(90);
    expect(turnFromDrag(0, mid, from, at(12))).toBeCloseTo(12, 0);
    expect(turnFromDrag(0, mid, from, at(178))).toBe(180);
  });
  it('a turn is kept between a half turn one way and the other', () => {
    expect(turn(370)).toBe(10);
    expect(turn(-190)).toBe(170);
    expect(turn(180)).toBe(180);
    expect(turn(-180)).toBe(180);
    expect(turn(540.04)).toBe(180);
  });
  it('two fingers: spreading them resizes, twisting turns, and the sticker follows the point between them', () => {
    const was = { s: 80, r: 10, at: { x: 150, y: 400 } };
    const a0 = { x: 100, y: 400 }, b0 = { x: 200, y: 400 };
    expect(pinch(was, a0, b0, { x: 50, y: 400 }, { x: 250, y: 400 })).toEqual({ s: 160, r: 10, at: { x: 150, y: 400 } });
    expect(pinch(was, a0, b0, { x: 150, y: 350 }, { x: 150, y: 450 })).toEqual({ s: 80, r: 100, at: { x: 150, y: 400 } });
    expect(pinch(was, a0, b0, { x: 130, y: 440 }, { x: 230, y: 440 })).toEqual({ s: 80, r: 10, at: { x: 180, y: 440 } });
    expect(pinch(was, a0, b0, { x: 149, y: 400 }, { x: 151, y: 400 }).s).toBe(MIN_SIZE);
    expect(bearing({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe(90);
  });
});

describe('order: what is in front of what', () => {
  // three in a pile at the left, one off on its own at the right
  const pile = [st('a', 0.2, 100), st('b', 0.25, 110), st('far', 0.9, 800), st('c', 0.22, 120)];
  const ov = (a: Placed, b: Placed) => overlap(a, b, squares, PHONE);
  it('stickers overlap when the boxes they fit in do', () => {
    expect(ov(pile[0], pile[1])).toBe(true);
    expect(ov(pile[0], pile[2])).toBe(false);
    expect(overlap(st('a', 0.2, 100), st('b', 0.4, 100), squares, PHONE)).toBe(false);   // 72 px apart, 60 wide
    expect(overlap(st('a', 0.2, 100), st('b', 0.4, 100), squares, NARROW)).toBe(true);   // on a narrower page they touch
    // a strip of tape turned on its end reaches up and down, not across
    const tape = () => ({ w: 160, h: 34 });
    expect(overlap(st('t', 0.5, 100, { s: 160 }), st('u', 0.5, 160, { s: 160 }), tape, PHONE)).toBe(false);
    expect(overlap(st('t', 0.5, 100, { s: 160, r: 90 }), st('u', 0.5, 160, { s: 160 }), tape, PHONE)).toBe(true);
  });
  it('forward steps past the next sticker that covers it, not past ones elsewhere on the page', () => {
    expect(ids(restack(pile, 'a', 'forward', ov))).toBe('b a far c');
    expect(ids(restack(pile, 'b', 'forward', ov))).toBe('a far c b');     // over "far" in one step: it was never in the way
    expect(ids(restack(pile, 'c', 'back', ov))).toBe('a c b far');
  });
  it('with nothing in the way the same list comes back, so the button can say so', () => {
    expect(restack(pile, 'c', 'forward', ov)).toBe(pile);
    expect(restack(pile, 'a', 'back', ov)).toBe(pile);
    expect(restack(pile, 'far', 'forward', ov)).toBe(pile);
    expect(canRestack(pile, 'far', 'back', ov)).toBe(false);
    expect(canRestack(pile, 'a', 'forward', ov)).toBe(true);
    expect(restack(pile, 'nobody', 'forward', ov)).toBe(pile);
  });
  it('tucked behind the cards: drawn under them, and it only trades places with others tucked there', () => {
    const tucked = tuck(pile, 'a');
    expect(ids(tucked)).toBe('b far c a');
    expect(tucked[3].under).toBe(true);
    expect(layers(tucked).under.map(p => p.id)).toEqual(['a']);
    expect(layers(tucked).over.map(p => p.id)).toEqual(['b', 'far', 'c']);
    expect(restack(tucked, 'a', 'back', ov)).toBe(tucked);                // b and c are in front of the cards: not its neighbours
    const two = tuck(tucked, 'b');
    expect(ids(restack(two, 'b', 'back', ov))).toBe('far c b a');
    const out = tuck(two, 'a');
    expect(out.find(p => p.id === 'a')).not.toHaveProperty('under');
    expect(ids(out)).toBe('far c b a');
  });
});

describe('moving between screen widths', () => {
  const p = st('a', 0.75, 640, { s: 96 });
  it('across is a share of the page: three quarters along on a phone is three quarters along on a wide screen', () => {
    expect(middle(p, PHONE).x).toBeCloseTo(268.5);
    expect(middle(p, WIDE).x).toBe(456);
    expect(middle(p, NARROW).x).toBe(216);
  });
  it('down is in pixels from the top of the page, the same on every screen; so is its size', () => {
    for (const w of [NARROW, PHONE, WIDE]) expect(middle(p, w).y).toBe(640);
    expect(boxOf(p.s, square).w).toBe(96);
  });
  it('a place on the screen and the saved place turn into each other', () => {
    const saved = placeAt({ x: 89.5, y: 420 }, PHONE);
    expect(saved).toEqual({ x: 0.25, y: 420 });
    expect(middle(st('b', saved.x, saved.y), PHONE)).toEqual({ x: 89.5, y: 420 });
    expect(placeAt({ x: 10, y: 10 }, 0)).toEqual({ x: 0.5, y: 10 });   // a page with no width yet: the middle
  });
  it('a page that is shorter today shows its last stickers at its end; what is saved stays where it was', () => {
    expect(middle(p, PHONE, 500).y).toBe(500);
    expect(middle(p, PHONE, 2000).y).toBe(640);
    expect(p.y).toBe(640);
  });
  it('a sticker at the edge stays at the edge', () => {
    expect(middle(st('l', 0, 10), WIDE).x).toBe(0);
    expect(middle(st('r', 1, 10), NARROW).x).toBe(NARROW);
  });
});

describe('dragging a sticker near the edge of the screen', () => {
  it('scrolls the page under it, faster the closer it is, and not at all in the middle', () => {
    expect(edgeScroll(400, 0, 560)).toBe(0);
    expect(edgeScroll(EDGE + 1, 0, 560)).toBe(0);
    expect(edgeScroll(10, 0, 560)).toBeLessThan(edgeScroll(50, 0, 560));
    expect(edgeScroll(10, 0, 560)).toBeLessThan(0);                     // up
    expect(edgeScroll(555, 0, 560)).toBeGreaterThan(edgeScroll(510, 0, 560));
    expect(edgeScroll(510, 0, 560)).toBeGreaterThan(0);                 // down: the tray's top is the bottom edge
    expect(Math.abs(edgeScroll(-50, 0, 560))).toBe(Math.abs(edgeScroll(900, 0, 560)));
  });
});

describe('a picture of the person’s own', () => {
  it('is shrunk to fit 512 px on its longer side, and never made bigger', () => {
    expect(fitWithin(2048, 1024)).toEqual({ w: 512, h: 256 });
    expect(fitWithin(900, 1800)).toEqual({ w: 256, h: 512 });
    expect(fitWithin(120, 80)).toEqual({ w: 120, h: 80 });
    expect(fitWithin(3000, 2, 512)).toEqual({ w: 512, h: 1 });
  });
  it('still too big to save: the next size down is tried, biggest first', () => {
    expect(OWN_SIDES[0]).toBe(512);
    expect([...OWN_SIDES].sort((a, b) => b - a)).toEqual(OWN_SIDES);
    expect(OWN_MAX_BYTES).toBe(200_000);
  });
  it('its size is read from the picture itself', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAAAAAA')).toBe(6);
    expect(dataUrlBytes('nothing')).toBe(0);
  });
  it('only a picture we made is ever shown', () => {
    const ok = { url: 'data:image/png;base64,iVBORw0KGgo=', w: 512, h: 300, at: '2026-11-11T10:00:00.000Z' };
    expect(readOwn(ok)).toEqual(ok);
    expect(readOwn({ ...ok, url: 'data:image/webp;base64,UklGRg==' })?.w).toBe(512);
    expect(readOwn({ ...ok, url: 'https://example.com/a.png' })).toBeNull();
    expect(readOwn({ ...ok, url: 'data:image/svg+xml;base64,PHN2Zz4=' })).toBeNull();
    expect(readOwn({ ...ok, url: 'data:text/html;base64,PGI+' })).toBeNull();
    expect(readOwn({ ...ok, url: 'javascript:alert(1)' })).toBeNull();
    expect(readOwn({ ...ok, w: 0 })).toBeNull();
    expect(readOwn({ ...ok, url: `data:image/png;base64,${'A'.repeat(900_000)}` })).toBeNull();   // far too big to be one of ours
    expect(readOwn(null)).toBeNull();
  });
});
