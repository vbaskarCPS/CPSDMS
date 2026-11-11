// Pictures sent to Arvy (pics.ts): finding them in what was pasted, and where a long screenshot is cut.
import { describe, expect, it } from 'vitest';
import { imagesFrom, slicesFor, MAX_PICS } from './pics';

const file = (name: string, type: string) => ({ name, type }) as unknown as File;

describe('what was pasted or dropped', () => {
  it('a screenshot on the clipboard is a file: taken; words and other files are left alone', () => {
    const shot = file('Screenshot.png', 'image/png'), pdf = file('bill.pdf', 'application/pdf');
    expect(imagesFrom({ files: [shot, pdf] })).toEqual([shot]);
    expect(imagesFrom({ files: [pdf] })).toEqual([]);
    expect(imagesFrom({ files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] })).toEqual([]);
    expect(imagesFrom(null)).toEqual([]);
  });
  it('some browsers only list it under items', () => {
    const shot = file('image.png', 'image/png');
    expect(imagesFrom({ files: [], items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => shot }, { kind: 'file', type: 'image/jpeg', getAsFile: () => null }] })).toEqual([shot]);
  });
});

describe('a long scrolling screenshot', () => {
  it('an ordinary screenshot or photo is one piece, even on a tall phone', () => {
    expect(slicesFor(1080, 2340)).toEqual([{ y: 0, h: 2340 }]);
    expect(slicesFor(1080, 2640)).toEqual([{ y: 0, h: 2640 }]);
    expect(slicesFor(4000, 3000)).toEqual([{ y: 0, h: 3000 }]);
    expect(slicesFor(0, 100)).toEqual([]);
  });
  it('a long one is cut from top to bottom, the pieces overlapping, nothing left out', () => {
    const cuts = slicesFor(1080, 6000);
    expect(cuts).toHaveLength(3);
    expect(cuts[0].y).toBe(0);
    expect(cuts[2].y + cuts[2].h).toBe(6000);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i].y).toBeLessThan(cuts[i - 1].y + cuts[i - 1].h);   // they overlap
    expect(cuts.every(c => c.h / 1080 < 2.6)).toBe(true);   // each piece is readable once shrunk
  });
  it('never more pieces than there is room for', () => {
    expect(slicesFor(1080, 30000)).toHaveLength(MAX_PICS);
    expect(slicesFor(1080, 30000, 2)).toHaveLength(2);
    expect(slicesFor(1080, 6000, 1)).toEqual([{ y: 0, h: 6000 }]);
    const two = slicesFor(1080, 30000, 2);
    expect(two[0].y).toBe(0);
    expect(two[1].y + two[1].h).toBe(30000);
  });
});
