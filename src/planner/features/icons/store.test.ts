// The icon choice as it is kept (store.ts): on screen at once, on the phone for the next opening, and on the account
// for the other phone. Each "phone" here is the store loaded afresh over its own storage.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const account = new Map<string, unknown>();   // the server's docs
let offline = false, demo = false, asked = 0;
let user: { id: string } | null = { id: 'u-rosh' };
const passWatchers = new Set<() => void>();
vi.mock('../../lib/docs', () => ({
  getDoc: async (kind: string, key: string) => { asked++; if (offline) throw new Error('Failed to fetch'); return account.get(`${kind}|${key}`) ?? null; },
  getDocs: async (kind: string) => { asked++; if (offline) throw new Error('Failed to fetch'); return [...account].filter(([k]) => k.startsWith(`${kind}|`)).map(([k, data]) => ({ key: k.slice(kind.length + 1), data, updated_at: '' })); },
  putDocs: async (docs: { kind: string; key: string; data: unknown }[]) => { if (offline) throw new Error('Failed to fetch'); for (const d of docs) account.set(`${d.kind}|${d.key}`, d.data); },
}));
vi.mock('../../lib/auth', () => ({ getPass: () => (user ? { user } : null), onPassChange: (fn: () => void) => { passWatchers.add(fn); return () => passWatchers.delete(fn); } }));
vi.mock('../../lib/app', () => ({ isDemo: () => demo }));

const storage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, size: () => m.size }; };
const page = { dataset: {} as Record<string, string | undefined> };
const heard: Record<string, () => void> = {};
vi.stubGlobal('document', { documentElement: page, visibilityState: 'visible', addEventListener: () => undefined });
vi.stubGlobal('window', { addEventListener: (name: string, fn: () => void) => { heard[name] = fn; } });

/** A phone: the store loaded afresh over that phone's own storage. */
async function phone(disk = storage()) {
  vi.stubGlobal('localStorage', disk);
  vi.resetModules();
  passWatchers.clear();
  return { disk, ...(await import('./store')) };
}
const PNG = 'data:image/png;base64,iVBORw0KGgo=', WEBP = 'data:image/webp;base64,UklGRg==';

beforeEach(() => { account.clear(); offline = false; demo = false; asked = 0; user = { id: 'u-rosh' }; page.dataset = {}; });

describe('choosing a pack', () => {
  it('nothing chosen: the planner’s own icons, and nothing is saved anywhere', async () => {
    const a = await phone();
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
    await a.refreshIcons(true);
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
    expect(account.size).toBe(0);
    expect(a.disk.size()).toBe(0);
  });
  it('shows at once, and is saved to the phone and to the account', async () => {
    const a = await phone();
    let drew = 0;
    a.onIcons(() => { drew++; });
    const saving = a.choosePack('woodland');
    expect(a.iconAt('wealth')).toEqual({ pack: 'woodland' });   // before the save has come back
    expect(drew).toBe(1);
    await saving;
    expect(account.get('prefs|icons')).toEqual({ pack: 'woodland', own: {} });
    expect(JSON.parse(a.disk.getItem('planner-icons:u-rosh')!)).toMatchObject({ prefs: { pack: 'woodland' }, unsaved: false });
  });
  it('the next time the planner opens, the bar has it before the server is asked', async () => {
    const a = await phone();
    await a.choosePack('coastal');
    asked = 0;
    const again = await phone(a.disk);
    expect(again.iconAt('today')).toEqual({ pack: 'coastal' });
    expect(asked).toBe(0);
  });
  it('chosen on one phone, it shows on her other one', async () => {
    const a = await phone();
    await a.choosePack('blossom');
    const b = await phone();
    expect(b.iconAt('today')).toEqual({ pack: 'line' });
    let drew = 0;
    b.onIcons(() => { drew++; });   // the bar starts listening: that asks the account
    await b.refreshIcons(true);
    expect(b.iconAt('today')).toEqual({ pack: 'blossom' });
    expect(drew).toBe(1);
    await b.refreshIcons(true);
    expect(drew).toBe(1);   // nothing new: nothing drawn again
  });
});

describe('Match my look', () => {
  it('follows the look on the page, and says so when it changes', async () => {
    const a = await phone();
    let drew = 0;
    a.onIcons(() => { drew++; });
    const before = a.iconsStamp();
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
    page.dataset.look = 'celestial';
    heard['planner-look']();   // what the looks send
    expect(drew).toBe(1);
    expect(a.iconsStamp()).not.toBe(before);
    expect(a.iconAt('today')).toEqual({ pack: 'celestial' });
    delete page.dataset.look;
    heard['planner-look']();
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
  });
  it('a look put on without a word is still seen the next time anything draws', async () => {
    const a = await phone();
    const before = a.iconsStamp();
    page.dataset.look = 'halloween';
    expect(a.iconsStamp()).not.toBe(before);
    expect(a.iconAt('habits')).toEqual({ pack: 'spooky' });
  });
  it('one pack for always doesn’t move with the look', async () => {
    const a = await phone();
    await a.choosePack('retro');
    page.dataset.look = 'celestial';
    expect(a.iconAt('today')).toEqual({ pack: 'retro' });
    await a.choosePack('match');
    expect(a.iconAt('today')).toEqual({ pack: 'celestial' });
  });
});

describe('her own picture', () => {
  it('wins on its place, is saved as its own doc, and comes off again', async () => {
    const a = await phone();
    await a.choosePack('festive');
    await a.setPicture('health', PNG);
    expect(a.iconAt('health')).toEqual({ own: PNG });
    expect(a.iconAt('wealth')).toEqual({ pack: 'festive' });
    expect(account.get('lookicon|health')).toMatchObject({ src: PNG });
    expect((account.get('prefs|icons') as { own: Record<string, string> }).own.health).toBe((account.get('lookicon|health') as { at: string }).at);
    await a.clearPicture('health');
    expect(a.iconAt('health')).toEqual({ pack: 'festive' });
    expect(account.get('lookicon|health')).toBeNull();
    expect(account.get('prefs|icons')).toEqual({ pack: 'festive', own: {} });
  });
  it('is on the bar the moment the planner opens again, and reaches her other phone', async () => {
    const a = await phone();
    await a.setPicture('today', WEBP);
    asked = 0;
    const again = await phone(a.disk);
    expect(again.iconAt('today')).toEqual({ own: WEBP });
    expect(asked).toBe(0);
    const b = await phone();
    await b.refreshIcons(true);
    expect(b.iconAt('today')).toEqual({ own: WEBP });
  });
  it('changed on one phone, the other fetches the new one; taken off, it goes there too', async () => {
    const a = await phone(), aDisk = a.disk;
    await a.setPicture('food', PNG);
    const b = await phone(), bDisk = b.disk;
    await b.refreshIcons(true);
    expect(b.iconAt('food')).toEqual({ own: PNG });
    await new Promise(r => setTimeout(r, 3));   // a later moment
    await (await phone(aDisk)).setPicture('food', WEBP);
    const b2 = await phone(bDisk);
    expect(b2.iconAt('food')).toEqual({ own: PNG });   // what it had, until it has asked
    await b2.refreshIcons(true);
    expect(b2.iconAt('food')).toEqual({ own: WEBP });
    await (await phone(aDisk)).clearPicture('food');
    const b3 = await phone(bDisk);
    await b3.refreshIcons(true);
    expect(b3.iconAt('food')).toEqual({ pack: 'line' });
  });
  it('anything that isn’t a small picture of ours is refused', async () => {
    const a = await phone();
    await expect(a.setPicture('today', 'https://example.com/cat.png')).rejects.toThrow();
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
    account.set('prefs|icons', { pack: 'match', own: { plan: 'x' } });
    account.set('lookicon|plan', { src: 'data:image/svg+xml;base64,PHN2Zz4=', at: 'x' });
    await a.refreshIcons(true);
    expect(a.iconAt('plan')).toEqual({ pack: 'line' });   // a doc that isn't one of ours is never drawn
  });
});

describe('no signal', () => {
  it('the choice still shows and is kept on the phone; the screen is told it wasn’t saved', async () => {
    const a = await phone();
    offline = true;
    await expect(a.choosePack('academia')).rejects.toThrow();
    expect(a.iconAt('plan')).toEqual({ pack: 'academia' });
    expect(JSON.parse(a.disk.getItem('planner-icons:u-rosh')!)).toMatchObject({ prefs: { pack: 'academia' }, unsaved: true });
    expect(account.size).toBe(0);
  });
  it('it goes up the next time the planner opens, instead of being lost to the older copy', async () => {
    const first = await phone();
    await first.choosePack('woodland');   // what the account has
    offline = true;
    await first.choosePack('spooky').catch(() => undefined);
    await first.setPicture('shop', PNG).catch(() => undefined);
    offline = false;
    const again = await phone(first.disk);
    expect(again.iconAt('today')).toEqual({ pack: 'spooky' });
    await again.refreshIcons(true);
    expect(again.iconAt('today')).toEqual({ pack: 'spooky' });
    expect(account.get('prefs|icons')).toMatchObject({ pack: 'spooky' });
    expect(account.get('lookicon|shop')).toMatchObject({ src: PNG });
    expect(JSON.parse(again.disk.getItem('planner-icons:u-rosh')!).unsaved).toBe(false);
  });
  it('opening with no signal keeps what the phone has', async () => {
    const a = await phone();
    await a.choosePack('coastal');
    offline = true;
    const again = await phone(a.disk);
    await again.refreshIcons(true);
    expect(again.iconAt('today')).toEqual({ pack: 'coastal' });
  });
  it('a pack picked while the account was still being asked is not undone by the answer', async () => {
    account.set('prefs|icons', { pack: 'woodland', own: {} });
    const a = await phone();
    const asking = a.refreshIcons(true);
    await a.choosePack('retro');
    await asking;
    expect(a.iconAt('today')).toEqual({ pack: 'retro' });
    expect(account.get('prefs|icons')).toEqual({ pack: 'retro', own: {} });
  });
});

describe('who it belongs to', () => {
  it('two people on one phone each keep their own', async () => {
    const a = await phone();
    await a.choosePack('blossom');
    user = { id: 'u-vijay' };
    account.clear();   // his account has chosen nothing
    for (const fn of [...passWatchers]) fn();
    expect(a.iconAt('today')).toEqual({ pack: 'line' });
    await a.choosePack('academia');
    user = { id: 'u-rosh' };
    for (const fn of [...passWatchers]) fn();
    expect(a.iconAt('today')).toEqual({ pack: 'blossom' });
  });
  it('the demo works, and keeps nothing on the phone', async () => {
    demo = true;
    const a = await phone();
    await a.choosePack('celestial');
    await a.setPicture('today', PNG);
    expect(a.iconAt('today')).toEqual({ own: PNG });
    expect(a.iconAt('health')).toEqual({ pack: 'celestial' });
    expect(a.disk.size()).toBe(0);
    const again = await phone(a.disk);
    expect(again.iconAt('today')).toEqual({ pack: 'line' });   // a fresh demo starts from the planner's own
  });
});
