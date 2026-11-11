// A photo taken from the bottom bar, on its way to the screen that uses it (lib/quickShot.ts).
import { describe, expect, it } from 'vitest';
import { giveShot, onShot, SHOT_TO, takeShot } from './quickShot';

const photo = (name: string) => ({ name }) as unknown as File;

describe('a photo from the bar', () => {
  it('waits for the screen and is handed over once', () => {
    expect(takeShot('meal')).toBeNull();
    giveShot('meal', [photo('plate.jpg')]);
    expect(takeShot('meal')?.map(f => f.name)).toEqual(['plate.jpg']);
    expect(takeShot('meal')).toBeNull();
  });
  it('a meal photo never lands on the receipt screen', () => {
    giveShot('receipt', [photo('costco.jpg')]);
    expect(takeShot('meal')).toBeNull();
    expect(takeShot('receipt')?.map(f => f.name)).toEqual(['costco.jpg']);
  });
  it('tells a screen that is already open, and stops once it has closed', () => {
    const seen: string[] = [];
    const off = onShot(k => seen.push(k));
    giveShot('meal', [photo('a.jpg')]);
    off();
    giveShot('meal', [photo('b.jpg')]);
    expect(seen).toEqual(['meal']);
    expect(takeShot('meal')?.map(f => f.name)).toEqual(['a.jpg', 'b.jpg']);   // nothing picked up in between: both wait
  });
  it('a cancelled camera (no photo) is nothing', () => {
    const seen: string[] = [];
    const off = onShot(k => seen.push(k));
    giveShot('receipt', []);
    off();
    expect(seen).toEqual([]);
    expect(takeShot('receipt')).toBeNull();
  });
  it('goes to the screens that take the photo', () => {
    expect(SHOT_TO).toEqual({ meal: '/food/add', receipt: '/money/receipt' });
  });
});
