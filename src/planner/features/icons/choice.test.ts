// Which drawing goes where (choice.ts): the pack that suits a look, the person's choice, and their own pictures.
import { describe, expect, it } from 'vitest';
import { cleanPrefs, drawn, isPicture, LOOK_PACK, NO_CHOICE, PACK_IDS, packFor, placeAt, PLACES, placesFor, toFetch, type IconPrefs } from './choice';

// the looks the planner has (the ids the looks put on <html data-look>)
const LOOKS = ['woodland', 'cottagecore', 'pastels', 'christmas', 'autumn', 'academia', 'celestial', 'minimal', 'french', 'botanical', 'countryside', 'regency', 'coastal', 'spring', 'fairy', 'halloween', 'winter', 'mediterranean', 'retro70s', 'stationery', 'coquette', 'lodge', 'harbour', 'whisky', 'graphite', 'expedition'];
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const WEBP = 'data:image/webp;base64,UklGRg==';

describe('the places an icon shows', () => {
  it('four on the bar and seven on the menu pages, each named once', () => {
    expect(PLACES.map(p => p.id)).toEqual(['today', 'health', 'wealth', 'lifestyle', 'train', 'food', 'cycle', 'plan', 'habits', 'calendar', 'shop']);
    expect(new Set(PLACES.map(p => p.id)).size).toBe(PLACES.length);
    expect(new Set(PLACES.map(p => p.name)).size).toBe(PLACES.length);
    expect(PLACES.filter(p => p.where === 'On the bar').map(p => p.id)).toEqual(['today', 'health', 'wealth', 'lifestyle']);
  });
  it('the cycle tracker is only on the morning planner', () => {
    expect(placesFor('morning').map(p => p.id)).toContain('cycle');
    expect(placesFor('night').map(p => p.id)).not.toContain('cycle');
    expect(placesFor('night')).toHaveLength(10);
  });
  it('a menu tile is known by where it goes', () => {
    expect(['/workout', '/food', '/cycle', '/plan', '/habits', '/calendar', '/shop'].map(placeAt)).toEqual(['train', 'food', 'cycle', 'plan', 'habits', 'calendar', 'shop']);
    expect(placeAt('/workout/live/3')).toBe('train');
    expect(placeAt('/somewhere-new')).toBeNull();   // a tile added later keeps its own icon
    expect(placeAt('/')).toBeNull();
    expect(placeAt('/constructor')).toBeNull();
  });
});

describe('the pack that suits a look', () => {
  it('every look has one, and it is a pack that exists', () => {
    for (const look of LOOKS) expect(PACK_IDS, look).toContain(LOOK_PACK[look]);
    expect(Object.keys(LOOK_PACK).sort()).toEqual([...LOOKS].sort());
  });
  it('the pack ids are all different', () => {
    expect(new Set(PACK_IDS).size).toBe(PACK_IDS.length);
    expect(PACK_IDS[0]).toBe('line');
  });
  it('every pack but the planner’s own is some look’s pack', () => {
    const used = new Set(Object.values(LOOK_PACK));
    for (const id of PACK_IDS) expect(used.has(id), id).toBe(true);
  });
  it('the ones that share a name go together', () => {
    expect(LOOK_PACK).toMatchObject({ woodland: 'woodland', celestial: 'celestial', academia: 'academia', coastal: 'coastal', christmas: 'festive', halloween: 'spooky', retro70s: 'retro', cottagecore: 'cottage', coquette: 'blossom', minimal: 'line' });
  });
});

describe('which icons are drawn', () => {
  const none = {};
  it('nothing chosen and no look on: the planner’s own, everywhere', () => {
    for (const p of PLACES) expect(drawn(NO_CHOICE, null, p.id, none)).toEqual({ pack: 'line' });
    expect(packFor('match', undefined)).toBe('line');
    expect(packFor('match', '')).toBe('line');
  });
  it('“Match my look” follows the look that is on', () => {
    expect(drawn(NO_CHOICE, 'celestial', 'today', none)).toEqual({ pack: 'celestial' });
    expect(drawn(NO_CHOICE, 'christmas', 'shop', none)).toEqual({ pack: 'festive' });
    expect(packFor('match', 'minimal')).toBe('line');
  });
  it('a look we have never heard of gets the planner’s own', () => {
    expect(packFor('match', 'vaporwave')).toBe('line');
    expect(packFor('match', 'constructor')).toBe('line');
  });
  it('one pack for always stays, whatever the look', () => {
    const fixed: IconPrefs = { pack: 'woodland', own: {} };
    expect(drawn(fixed, 'celestial', 'health', none)).toEqual({ pack: 'woodland' });
    expect(drawn(fixed, null, 'health', none)).toEqual({ pack: 'woodland' });
    expect(packFor('line', 'halloween')).toBe('line');
  });
  it('her own picture wins on its place, and only there', () => {
    const prefs: IconPrefs = { pack: 'spooky', own: { health: '2026-11-11T10:00:00.000Z' } };
    expect(drawn(prefs, 'coastal', 'health', { health: PNG })).toEqual({ own: PNG });
    expect(drawn(prefs, 'coastal', 'wealth', { health: PNG })).toEqual({ pack: 'spooky' });
    expect(drawn({ ...prefs, pack: 'match' }, 'coastal', 'health', { health: PNG })).toEqual({ own: PNG });
  });
  it('a picture this phone doesn’t have yet: the pack’s drawing meanwhile', () => {
    expect(drawn({ pack: 'match', own: { today: '2026-11-11T10:00:00.000Z' } }, 'retro70s', 'today', {})).toEqual({ pack: 'retro' });
  });
  it('a picture left behind on the phone after it was taken off is not shown', () => {
    expect(drawn(NO_CHOICE, null, 'today', { today: PNG })).toEqual({ pack: 'line' });
  });
});

describe('a saved choice read back', () => {
  it('nothing saved, or rubbish: Match my look and no pictures', () => {
    for (const raw of [null, undefined, 'woodland', 7, [], { pack: 'glitter' }, { pack: null, own: 'yes' }]) expect(cleanPrefs(raw)).toEqual({ pack: 'match', own: {} });
  });
  it('keeps what it knows and drops the rest', () => {
    expect(cleanPrefs({ pack: 'coastal', own: { today: '2026-11-11T10:00:00.000Z', moon: 'x', food: 5, plan: '' }, extra: 1 })).toEqual({ pack: 'coastal', own: { today: '2026-11-11T10:00:00.000Z' } });
    expect(cleanPrefs({ pack: 'match', own: {} })).toEqual({ pack: 'match', own: {} });
  });
  it('only a small PNG or WebP we made counts as a picture', () => {
    expect(isPicture(PNG)).toBe(true);
    expect(isPicture(WEBP)).toBe(true);
    for (const bad of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,<script>', 'data:text/html;base64,AAAA', '', null, 5, `data:image/png;base64,${'A'.repeat(200_000)}`]) expect(isPicture(bad), String(bad).slice(0, 40)).toBe(false);
  });
  it('which pictures another phone still has to fetch', () => {
    const account: IconPrefs = { pack: 'match', own: { today: 't2', food: 'f1', shop: 's1' } };
    const here: IconPrefs = { pack: 'match', own: { today: 't1', food: 'f1' } };
    expect(toFetch(account, here, { today: PNG, food: PNG })).toEqual(['today', 'shop']);   // changed since, and new
    expect(toFetch(account, account, { today: PNG, food: PNG, shop: PNG })).toEqual([]);
    expect(toFetch(account, account, { today: PNG })).toEqual(['food', 'shop']);            // marked, but the picture itself is missing here
  });
});
