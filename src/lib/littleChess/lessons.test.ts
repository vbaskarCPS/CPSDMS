import { describe, expect, it } from 'vitest';
import { LEVELS, currentLevel, levelDone, levelOpen, levelStart, lessonsOf, BOARD, EAT_ORDER, HOW, LESSONS, MOVE_ORDER, NAME_ORDER, canMove, cheers, notThereLine, oopsLine, slowLine, clipId, freshProgress, isOpen, movesFrom, nextLesson, readProgress, sentenceFor, speakerFor, spokenFor, stickerFor, stickerLine, voiceLines, type Round } from './lessons';

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
  it('add guessing games after the review and before MOVES: mixed find, mixed word, shadow, peekaboo, two of each', () => {
    const ids = LESSONS.map(l => l.id);
    const guess = LESSONS.filter(l => l.layer === 'guess');
    expect(guess.map(l => l.id)).toEqual(['mix-find-1', 'mix-find-2', 'mix-word-1', 'mix-word-2', 'shadow-1', 'shadow-2', 'peek-1', 'peek-2']);
    expect(ids.indexOf('mix-find-1')).toBe(ids.indexOf('names-review') + 1);
    expect(ids.indexOf('peek-2')).toBeLessThan(ids.indexOf('moves-rook'));
    for (const l of guess) {
      expect(l.icon).toBeTruthy();
      expect([...l.rounds.map(r => (r as { piece: string }).piece)].sort()).toEqual([...NAME_ORDER].sort());   // every piece once
    }
    expect(LESSONS.find(l => l.id === 'mix-find-2')!.rounds.every(r => (r as { options: unknown[] }).options.length === 4)).toBe(true);
    expect(LESSONS.find(l => l.id === 'shadow-2')!.rounds.every(r => r.kind === 'shadow' && r.answer === 'word')).toBe(true);
    expect(sentenceFor(LESSONS.find(l => l.id === 'peek-1')!.rounds[0])).toBe('WHO IS PEEKING?');
  });
  it('find, word, shadow and peek rounds always include the right answer once, among different pieces', () => {
    for (const l of LESSONS) for (const r of l.rounds) if (r.kind === 'find' || r.kind === 'word' || r.kind === 'shadow' || r.kind === 'peek') {
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
  it('speak in full sentences, not the short screen words', () => {
    const lines = voiceLines(['Kiaan']);
    for (const l of lines) { expect(l.spoken).not.toBe(l.text); expect(l.spoken).not.toMatch(/^[A-Z !?.,']+$/); }
    expect(spokenFor('rook', 'THIS IS ROOK.')).toMatch(/I'm the Rook/);
    expect(spokenFor('narrator', 'FIND THE KING.')).toBe('Can you find the King? Tap the King!');
    expect(spokenFor('pawn', 'KIAAN DID IT!', 'Kiaan')).toBe('Kiaan did it! Hooray!');
  });
  it('have a gentle oops for every piece and square, and a slow-down line', () => {
    const ids = new Set(voiceLines(['Kiaan']).map(l => l.id));
    for (const p of NAME_ORDER) {
      expect(ids.has(clipId('narrator', oopsLine(p)))).toBe(true);
      expect(ids.has(clipId('narrator', notThereLine(p)))).toBe(true);
    }
    expect(ids.has(clipId('narrator', slowLine('Kiaan')))).toBe(true);
    expect(oopsLine('bishop')).toBe('THAT IS BISHOP.');
    expect(spokenFor('narrator', 'THAT IS BISHOP.')).toBe('Oops! That one is the Bishop. Look carefully and try again.');
    expect(notThereLine('rook')).toBe('NOT THERE! ROOK GOES STRAIGHT.');
    expect(spokenFor('narrator', notThereLine('rook'))).toBe("Oops! The Rook can't go there. Remember, the Rook goes straight.");
    expect(spokenFor('narrator', slowLine('Kiaan'), 'Kiaan')).toMatch(/^Whoa, slow down Kiaan!/);
  });
});

describe('the voice script', () => {
  it("has the same lines as the game (re-copy them into public/minigame/make-little-chess-voices.mjs if this fails)", async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('public/minigame/make-little-chess-voices.mjs', 'utf8');
    const block = src.slice(src.indexOf('// LINES-START'), src.indexOf('// LINES-END'));
    const lines = JSON.parse(block.slice(block.indexOf('['), block.lastIndexOf(']') + 1));
    expect(lines).toEqual(voiceLines(['Kiaan']).map(l => [l.speaker, l.text, l.spoken]));
  });
});

describe('levels', () => {
  it('group every lesson into NAMES, GUESS, MOVES, EAT, in order', () => {
    expect(LEVELS.map(l => l.label)).toEqual(['NAMES', 'GUESS', 'MOVES', 'EAT']);
    expect(LEVELS.flatMap(lessonsOf).map(l => l.id)).toEqual(LESSONS.map(l => l.id));
    expect(lessonsOf(LEVELS[0]).slice(-1)[0].id).toBe('names-review');
  });
  it('open one after another, start at the first unfinished lesson, and replay from the top once done', () => {
    const p = freshProgress();
    expect(currentLevel(p)!.id).toBe('names');
    expect(levelOpen(p, LEVELS[0])).toBe(true);
    expect(levelOpen(p, LEVELS[1])).toBe(false);
    expect(levelStart(p, LEVELS[0])).toBe(0);
    p.done.push('names-rook', 'names-knight');
    expect(levelStart(p, LEVELS[0])).toBe(2);
    p.done.push(...lessonsOf(LEVELS[0]).map(l => l.id));
    expect(levelDone(p, LEVELS[0])).toBe(true);
    expect(levelStart(p, LEVELS[0])).toBe(0);
    expect(currentLevel(p)!.id).toBe('guess');
    expect(levelOpen(p, LEVELS[1])).toBe(true);
    expect(levelOpen(p, LEVELS[2])).toBe(false);
    expect(levelOpen({ ...p, unlockAll: true }, LEVELS[3])).toBe(true);
  });
});
