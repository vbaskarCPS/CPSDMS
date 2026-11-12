// The icon packs (packs.tsx): every pack has a drawing for every place, in colours that follow the page.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookOpen, CalendarDays, Compass, Dumbbell, Heart, HeartPulse, Repeat, ShoppingCart, Sunrise, Utensils, Wallet } from 'lucide-react';
import { PACK_IDS, PLACES } from './choice';
import { LINE, PACKS, PackIcon, packOf } from './packs';

const svg = (pack: typeof PACK_IDS[number], place: typeof PLACES[number]['id']) => renderToStaticMarkup(createElement(PackIcon, { pack, place }));
const drawnPacks = PACKS.filter(p => p.art);

describe('the packs', () => {
  it('one for every pack id, in the same order, each named once', () => {
    expect(PACKS.map(p => p.id)).toEqual([...PACK_IDS]);
    expect(new Set(PACKS.map(p => p.name)).size).toBe(PACKS.length);
    expect(PACKS.every(p => p.note.length > 8 && p.note.length < 48)).toBe(true);
    expect(PACKS.length).toBeGreaterThanOrEqual(8);
  });
  it('every pack has a drawing for every place', () => {
    expect(Object.keys(LINE).sort()).toEqual(PLACES.map(p => p.id).sort());
    for (const pack of drawnPacks) {
      expect(Object.keys(pack.art!).sort(), pack.id).toEqual(PLACES.map(p => p.id).sort());
      for (const place of PLACES) expect(svg(pack.id, place.id).length, `${pack.id} ${place.id}`).toBeGreaterThan(120);
    }
  });
  it('the planner’s own pack is the icons the bar and the tiles have always had', () => {
    expect(LINE).toEqual({ today: Sunrise, health: HeartPulse, wealth: Wallet, lifestyle: Compass, train: Dumbbell, food: Utensils, cycle: Heart, plan: BookOpen, habits: Repeat, calendar: CalendarDays, shop: ShoppingCart });
    expect(packOf('line').art).toBeUndefined();
    expect(svg('line', 'today')).toContain('lucide');
  });
  it('each drawing is on the 24 grid, hidden from screen readers, and well formed', () => {
    for (const pack of drawnPacks) for (const place of PLACES) {
      const s = svg(pack.id, place.id), what = `${pack.id} ${place.id}`;
      expect(s, what).toMatch(/^<svg viewBox="0 0 24 24"/);
      expect(s, what).toContain('aria-hidden="true"');
      expect(s, what).not.toMatch(/NaN|undefined|Infinity|null/);
    }
  });
  it('takes the colour of the page: no colour of its own anywhere', () => {
    for (const pack of drawnPacks) for (const place of PLACES) {
      const s = svg(pack.id, place.id), what = `${pack.id} ${place.id}`;
      expect(s, what).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl|url\(/i);
      const colours = [...s.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(m => m[1]);
      expect(colours.every(c => c === 'currentColor' || c === 'none'), `${what}: ${colours.join(' ')}`).toBe(true);
      expect(s, what).toContain('currentColor');
    }
  });
  it('no two places in a pack share a drawing, and no two packs draw a place the same way', () => {
    for (const pack of drawnPacks) expect(new Set(PLACES.map(p => svg(pack.id, p.id))).size, pack.id).toBe(PLACES.length);
    const inner = (s: string) => s.replace(/^<svg[^>]*>/, '');
    for (const place of PLACES) expect(new Set(drawnPacks.map(p => inner(svg(p.id, place.id)))).size, place.id).toBe(drawnPacks.length);
  });
  it('a pack draws in one hand: the same pen for all its drawings', () => {
    for (const pack of drawnPacks) {
      const opens = new Set(PLACES.map(p => svg(pack.id, p.id).match(/^<svg[^>]*>/)![0]));
      expect(opens.size, pack.id).toBe(1);
    }
    expect(new Set(drawnPacks.map(p => JSON.stringify(p.hand))).size).toBeGreaterThanOrEqual(6);   // and the packs don't all share one
  });
});
