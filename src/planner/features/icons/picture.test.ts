// A picture of their own made ready to be an icon (picture.ts): which square of it is kept.
import { describe, expect, it } from 'vitest';
import { CENTRED, drag, MAX_ZOOM, place, settle, square } from './picture';

describe('the square that is kept', () => {
  it('a wide photo, untouched: the middle of it, as tall as the photo', () => {
    expect(square(4000, 3000, CENTRED)).toEqual({ side: 3000, sx: 500, sy: 0 });
  });
  it('a tall photo, untouched: the middle of it, as wide as the photo', () => {
    expect(square(1080, 1920, CENTRED)).toEqual({ side: 1080, sx: 0, sy: 420 });
  });
  it('a square one is kept whole', () => {
    expect(square(512, 512, CENTRED)).toEqual({ side: 512, sx: 0, sy: 0 });
  });
  it('closer in keeps a smaller square, round the same middle', () => {
    expect(square(4000, 3000, { zoom: 2, x: 0.5, y: 0.5 })).toEqual({ side: 1500, sx: 1250, sy: 750 });
  });
  it('never runs off the picture, however it is pushed', () => {
    expect(square(4000, 3000, { zoom: 1, x: 0, y: 0 })).toEqual({ side: 3000, sx: 0, sy: 0 });
    expect(square(4000, 3000, { zoom: 2, x: 1, y: 1 })).toEqual({ side: 1500, sx: 2500, sy: 1500 });
    expect(square(4000, 3000, { zoom: 99, x: 0.5, y: 0.5 }).side).toBe(3000 / MAX_ZOOM);
    expect(square(4000, 3000, { zoom: 0.2, x: 0.5, y: 0.5 }).side).toBe(3000);
    expect(square(4000, 3000, { zoom: NaN, x: 0.5, y: 0.5 }).side).toBe(3000);
  });
});

describe('sliding and zooming it', () => {
  it('the picture follows the finger: dragged left, the square moves right across it', () => {
    const f = drag(4000, 3000, CENTRED, -28, 0, 280);   // a tenth of the frame
    expect(square(4000, 3000, f).sx).toBeCloseTo(800);   // a tenth of the 3000 kept, further right
    expect(f.y).toBe(0.5);
  });
  it('dragging past the edge stops at the edge', () => {
    const f = drag(4000, 3000, CENTRED, 5000, 5000, 280);
    expect(square(4000, 3000, f)).toMatchObject({ sx: 0, sy: 0 });
    const g = drag(4000, 3000, f, -99999, 0, 280);
    expect(square(4000, 3000, g).sx).toBe(1000);
  });
  it('zooming out near an edge pulls the square back inside', () => {
    const corner = settle(4000, 3000, { zoom: 4, x: 1, y: 1 });
    expect(square(4000, 3000, corner)).toEqual({ side: 750, sx: 3250, sy: 2250 });
    const out = settle(4000, 3000, { ...corner, zoom: 1 });
    expect(square(4000, 3000, out)).toEqual({ side: 3000, sx: 1000, sy: 0 });
    expect(out.zoom).toBe(1);
  });
  it('zoomed in, a drag moves less of the picture', () => {
    const near = drag(4000, 3000, { zoom: 2, x: 0.5, y: 0.5 }, -28, 0, 280);
    expect(square(4000, 3000, near).sx).toBeCloseTo(1250 + 150);
  });
});

describe('showing it in a frame', () => {
  it('the kept square exactly fills the frame, whatever its size', () => {
    for (const frame of [26, 40, 280]) {
      const fit = { zoom: 2, x: 0.3, y: 0.6 }, q = square(4000, 3000, fit), p = place(4000, 3000, fit, frame);
      expect(p.width / 4000).toBeCloseTo(frame / q.side);
      expect(p.height / 3000).toBeCloseTo(frame / q.side);
      expect(-p.left).toBeCloseTo((q.sx * frame) / q.side);
      expect(-p.top).toBeCloseTo((q.sy * frame) / q.side);
    }
  });
});
