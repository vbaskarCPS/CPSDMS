// Mr Monkey's conversations with the other characters: every character talks, every moment has an exchange.
import { describe, expect, it } from 'vitest';
import { CAST, afterStory, allBanterLines, cheer, comfort, handoff, monkeyTap, monkeyWelcome, opener, stickerParty, thinking } from './banter';
import { clipId, type Speaker } from '../littleChess/lessons';

describe('banter', () => {
  it('every character has every kind of exchange, Mr Monkey always in it', () => {
    for (const c of CAST) {
      for (const [n, ex] of [[4, opener(c, 1)], [2, handoff(c, 1)], [2, cheer(c, 1)], [2, comfort(c, 1)], [2, afterStory(c, 1)], [2, stickerParty(c, 1)]] as const) {
        expect(ex).toHaveLength(n);
        expect(ex.some(l => l.who === 'narrator')).toBe(true);
        expect(ex.some(l => l.who === c)).toBe(true);
        for (const l of ex) { expect(l.text).toBe(l.text.toUpperCase()); expect(l.said.length).toBeGreaterThan(l.text.length / 2); }
      }
    }
  });
  it('different seeds give different openers', () => {
    const a = opener('rook', 1).map(l => l.text).join('|'), b = opener('rook', 7).map(l => l.text).join('|');
    expect(a).not.toBe(b);
  });
  it('is a lot of dialogue, with no two clips sharing a name', () => {
    const all = allBanterLines(['Kiaan']);
    expect(all.length).toBeGreaterThan(300);
    expect(all.filter(l => l.who === 'narrator').length).toBeGreaterThan(120);
    const ids = all.map(l => clipId(l.who as Speaker, l.text));
    expect(new Set(ids).size).toBe(ids.length);
    expect(monkeyTap('Kiaan').length).toBeGreaterThan(20);
    expect(monkeyWelcome('Kiaan')[0].said).toContain('Kiaan');
    expect(thinking(3).who).toBe('narrator');
  });
});
