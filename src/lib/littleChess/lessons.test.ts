import { describe, expect, it } from 'vitest';
import { BOARD, EAT_ORDER, HOW, LESSONS, MOVE_ORDER, NAME_ORDER, canMove, cheers, clipId, freshProgress, isOpen, movesFrom, nextLesson, readProgress, sentenceFor, speakerFor, stickerFor, stickerLine, voiceLines, type Round } from './lessons';

const key = (s: [number, number]) => s.join(',');

describe('how the pieces move', () => {
  it('rook goes straight, bishop climbs stairs on its own colour, queen both', () => {
    expect(movesFrom('rook', [0, 0]).map(key).sort()).toEqual(['0,1', '0,2', '0,3', '1,0', '2,0', '3,0']);
    expect(movesFrom('bishop', [0, 0]).map(key)).toEqual(['1,1', '2,2', '3,3']);
    for (const [r, c] of movesFrom('bishop', [1, 2])) expect((r + c) % 2).toBe((1 + 2) % 2);
    expect(movesFrom('queen', [1, 1]).length).toBe(movesFrom('rook', [1, 1]).length + movesFrom('bishop', [1, 1]).length);
  });
  it('king steps once, knight jumps L, pawn steps up', () => {
    expect(movesFrom('king', [0, 0]).map(key).sort()).toEqual(['0,1', '1,0', '1,1']);
    expect(movesFrom('knight', [0, 0]).map(key).sort()).toEqual(['1,2', '2,1']);
    expect(movesFrom('pawn', [3, 2]).map(key)).toEqual(['2,2']);
    expect(movesFrom('pawn', [0, 2])).toEqual([]);
  });
  it('every piece has a short sentence', () => {
    for (const p of NAME_ORDER) expect(HOW[p].split(' ').length).toBeLessThanOrEqual(3);
  });
});

describe('the lessons', () => {
  it('go names (easy shapes first), a review, moves (teachers\' order), then eating', () => {
    expect(LESSONS.filter(l => l.layer === 'names').map(l => l.piece)).toEqual(NAME_ORDER);
    expect(LESSONS.findIndex(l => l.id === 'names-review')).toBe(NAME_ORDER.length);
    expect(LESSONS.filter(l => l.layer === 'moves').map(l => l.piece)).toEqual(MOVE_ORDER);
    expect(LESSONS.filter(l => l.layer === 'eat').map(l => l.piece)).toEqual(EAT_ORDER);
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(LESSONS.length);
  });
  it('find and word rounds always include the right answer once, among different pieces', () => {
    for (const l of LESSONS) for (const r of l.rounds) if (r.kind === 'find' || r.kind === 'word') {
      expect(r.options.filter(p => p === r.piece).length).toBe(1);
      expect(new Set(r.options).size).toBe(r.options.length);
      expect(r.options.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('every star and apple can be collected one move at a time, on the board', () => {
    const boards = LESSONS.flatMap(l => l.rounds).filter((r): r is Extract<Round, { kind: 'board' }> => r.kind === 'board');
    expect(boards.length).toBeGreaterThan(20);
    for (const b of boards) {
      let at = b.start;
      for (const t of b.targets) {
        expect(t.every(v => v >= 0 && v < BOARD)).toBe(true);
        expect(canMove(b.piece, at, t)).toBe(true);
        at = t;
      }
      expect(new Set(b.targets.map(key)).size).toBe(b.targets.length);
      expect(b.targets.some(t => key(t) === key(b.start))).toBe(false);
    }
  });
  it('are the same every time (fixed seeds)', () => {
    expect(JSON.stringify(LESSONS)).toBe(JSON.stringify(LESSONS));
  });
});

describe('progress', () => {
  it('opens one lesson at a time, unless a grown-up unlocks all', () => {
    const p = freshProgress();
    expect(nextLesson(p)!.id).toBe('names-rook');
    expect(isOpen(p, 'names-rook')).toBe(true);
    expect(isOpen(p, 'names-knight')).toBe(false);
    p.done.push('names-rook');
    expect(nextLesson(p)!.id).toBe('names-knight');
    expect(isOpen(p, 'names-rook')).toBe(true);
    expect(isOpen({ ...p, unlockAll: true }, 'eat-knight')).toBe(true);
  });
  it('reads saved progress safely and hands out stickers in order', () => {
    expect(readProgress(null)).toEqual(freshProgress());
    const p = readProgress({ done: ['names-rook', 'nope'], stickers: ['🦁'], voice: false } as never);
    expect(p.done).toEqual(['names-rook']);
    expect(p.voice).toBe(false);
    expect(stickerFor(p)).toBe('🐘');
  });
});

describe('voice lines', () => {
  it('cover every sentence and cheer the game can say, each with one clip name', () => {
    const lines = voiceLines(['Kiaan']);
    const ids = new Set(lines.map(l => l.id));
    expect(ids.size).toBe(lines.length);
    for (const l of LESSONS) for (const r of l.rounds) expect(ids.has(clipId(speakerFor(r), sentenceFor(r)))).toBe(true);
    for (const p of NAME_ORDER) for (const c of cheers('Kiaan')) expect(ids.has(clipId(p, c))).toBe(true);
    expect(ids.has(clipId('narrator', stickerLine('Kiaan')))).toBe(true);
    expect(clipId('king', 'THIS IS KING.')).toBe('king--this-is-king');
    expect(clipId('rook', 'KIAAN DID IT!')).toBe('rook--kiaan-did-it');
    expect(lines.length).toBeLessThan(80);
  });
});

describe('the voice script', () => {
  it("has the same lines as the game (re-copy them into scripts/make-little-chess-voices.mjs if this fails)", async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('scripts/make-little-chess-voices.mjs', 'utf8');
    const block = src.slice(src.indexOf('// LINES-START'), src.indexOf('// LINES-END'));
    const lines = JSON.parse(block.slice(block.indexOf('['), block.lastIndexOf(']') + 1));
    expect(lines).toEqual(voiceLines(['Kiaan']).map(l => [l.speaker, l.text]));
  });
});
