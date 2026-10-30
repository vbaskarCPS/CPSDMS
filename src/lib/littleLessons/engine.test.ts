import { describe, expect, it } from 'vitest';
import {
  applySettings, introsFor, lastDays, lessonLength, lessonQuestion, lessonStarted, nextLesson, pickGame, pickLevel, pickSubject,
  readProgress, readSettings, recordAnswer, DEFAULT_SETTINGS,
} from './engine';
import { LEVELS, SENTENCES, SUBJECTS, answerOf, gamesAt, lessonLine, makeQuestion, metNames, numberChoices, rng, wordChoices, type Question } from './levels';
import { ALL_WORDS, WORD_GROUPS, lookAlikes } from './words';
import { LESSONS, canMove, sentenceFor, type Round } from '../littleChess/lessons';

const S = readSettings(null);
const fresh = () => readProgress({ v: 2 });
const DEPTHS = [0, 3, 6, 9, 12, 15, 20, 40];
const LITTLE_CHESS = ['find', 'word', 'shadow', 'peek', 'board', 'show'];

/** Every question every game of a level can make, at every depth. */
function* everyQuestion(subject: (typeof SUBJECTS)[number], seeds = 25) {
  for (const l of LEVELS[subject]) for (const g of l.games) for (const d of DEPTHS) for (let k = 0; k < seeds; k++)
    yield { l, d, q: makeQuestion(l, g.id, rng(k * 97 + d * 13 + 1), d) };
}

describe('levels and their decks', () => {
  it('has every level, with a story, a cast and at least two games', () => {
    expect(LEVELS.chess.map(l => l.id)).toEqual(['chess:naming', 'chess:moves', 'chess:eating']);
    expect(LEVELS.words).toHaveLength(WORD_GROUPS.length);
    expect(LEVELS.math.map(l => l.id)).toEqual(['math:count-3', 'math:count-5', 'math:count-8', 'math:count-10', 'math:count-20',
      'math:cadd-3', 'math:cadd-5', 'math:cadd-10', 'math:csub-5', 'math:csub-10', 'math:add-5', 'math:add-10', 'math:add-20', 'math:sub-5', 'math:sub-10', 'math:sub-20']);
    for (const s of SUBJECTS) for (const l of LEVELS[s]) {
      expect(l.story.lines.length).toBeGreaterThan(0); expect(l.story.said.length).toBeGreaterThan(10);
      expect(l.games.length).toBeGreaterThanOrEqual(2);
      expect(gamesAt(l, 0).length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(SUBJECTS.flatMap(s => LEVELS[s].map(l => l.id))).size).toBe(SUBJECTS.reduce((n, s) => n + LEVELS[s].length, 0));
  });
  it('every game has something to say', () => {
    for (const s of SUBJECTS) for (const { q } of everyQuestion(s, 3)) {
      if (LITTLE_CHESS.includes(q.kind)) expect(sentenceFor(q as unknown as Round).length).toBeGreaterThan(3);
      else expect(lessonLine(q)).not.toBeNull();
    }
  });
  it('makes good math questions: the answer is a choice, numbers stay in range', () => {
    for (const { q } of everyQuestion('math')) {
      const a = answerOf(q);
      if (q.kind === 'more') { expect(q.a).not.toBe(q.b); expect(Math.min(q.a, q.b)).toBeGreaterThan(0); continue; }
      expect(typeof a).toBe('number');
      expect(a as number).toBeGreaterThanOrEqual(0);
      expect(a as number).toBeLessThanOrEqual(20);
      if ('options' in q) { expect(q.options as unknown[]).toContain(a); expect(new Set(q.options as unknown[]).size).toBe(3); }
      if (q.kind === 'feed') { expect(q.n).toBeGreaterThan(0); expect(q.pile).toBeGreaterThan(q.n); }
      if (q.kind === 'hop') { expect(q.by).not.toBe(0); expect(q.from + q.by).toBeLessThanOrEqual(q.max); expect(q.from).toBeLessThanOrEqual(q.max); }
    }
  });
  it('counting starts small, and never offers 0', () => {
    for (let k = 0; k < 100; k++) { const q = makeQuestion(LEVELS.math[0], 'count', rng(k), 0); expect(q.kind === 'count' && q.n <= 3 && !q.options.includes(0)).toBe(true); }
  });
  it('makes word questions from words he has met, with more choices later', () => {
    for (const { l, q } of everyQuestion('words', 8)) {
      const i = LEVELS.words.indexOf(l), known = WORD_GROUPS.slice(0, i + 1).flat();
      if (q.kind === 'pop') {
        const n = q.bubbles.filter(b => b === q.word).length;
        expect(q.bubbles).toHaveLength(6); expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(3);
        expect(q.bubbles.every(w => known.includes(w))).toBe(true);
        continue;
      }
      if (!('options' in q) || typeof q.options[0] !== 'string') throw new Error(`not a word game: ${q.kind}`);
      const opts = q.options as string[], word = answerOf(q) as string;
      expect(opts).toContain(word);
      expect(opts.every(w => known.includes(w))).toBe(true);
      expect(new Set(opts).size).toBe(opts.length);
      if (q.kind === 'sight') expect(opts.length).toBe(Math.min(wordChoices(i).count, known.length));
      if (q.kind === 'sentence') expect(SENTENCES[q.word]).toContain('_');
    }
    expect(lookAlikes('the')).toContain('then');
    expect(ALL_WORDS).toHaveLength(133);
    for (const s of Object.values(SENTENCES)) expect(s.split('_')).toHaveLength(2);
  });
  it('makes chess questions with fresh boards and pieces he has met', () => {
    for (const { l, d, q } of everyQuestion('chess', 10)) {
      expect(q.kind).not.toBe('hello');
      if ('options' in q) expect(q.options).toContain((q as Question & { piece: string }).piece);
      if (q.kind === 'board') expect(q.targets.length).toBeGreaterThan(0);
      if (q.kind === 'who') { expect(canMove(q.piece, q.start, q.target)).toBe(true); for (const o of q.options) if (o !== q.piece) expect(canMove(o, q.start, q.target)).toBe(false); }
      if (l.id === 'chess:naming' && 'piece' in q) expect(metNames(d)).toContain(q.piece);
    }
  });
  it('the pieces join one at a time, saying hello first', () => {
    expect(metNames(0)).toEqual(['rook', 'knight']);
    expect(metNames(12)).toHaveLength(6);
    const p = fresh();
    expect(introsFor(p, 'chess', 0).map(x => x.id)).toEqual(['chess:naming', 'chess:names-rook', 'chess:names-knight']);
    const later = { ...p, told: ['chess:naming', 'chess:names-rook', 'chess:names-knight'], right: { 'chess:naming': 3 } };
    expect(introsFor(later, 'chess', 0).map(x => x.id)).toEqual(['chess:names-king']);
  });
  it('harder games open up further into a level', () => {
    const naming = LEVELS.chess[0];
    expect(gamesAt(naming, 0).map(g => g.id)).toEqual(['find', 'same']);
    expect(gamesAt(naming, 9).map(g => g.id)).toContain('gone');
  });
  it('gives close number choices', () => {
    for (let k = 0; k < 50; k++) { const c = numberChoices(rng(k), 0); expect(c).toContain(0); expect(c.every(n => n >= 0)).toBe(true); }
  });
});

describe('lessons', () => {
  it('are 3 to 5 questions, and end right on the sticker', () => {
    for (const session of [3, 5, 8, 10, 12, 30]) for (let k = 0; k < 20; k++) {
      const r = rng(k); let left = session; const lens: number[] = [];
      while (left > 0) { const n = lessonLength(left, r); lens.push(n); left -= n; }
      expect(left).toBe(0);
      expect(lens.every(n => n >= 3 && n <= 5)).toBe(true);
    }
  });
  it('never play the same game twice in a row, and lean to the least played', () => {
    const p = { ...fresh(), last: { 'words:1': 'hear' }, played: { 'words:1/same': 9 } };
    const r = rng(3); const seen: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const g = pickGame(p, 'words:1', ['hear', 'same', 'pop'], r); seen[g] = (seen[g] || 0) + 1; }
    expect(seen.hear).toBeUndefined();
    expect(seen.pop).toBeGreaterThan(seen.same * 5);
    expect(pickGame(p, 'words:1', ['hear'], r)).toBe('hear');
  });
  it('a lesson keeps one game, and remembers it', () => {
    const s = readSettings({ mix: { chess: 0, words: 100, math: 0 } });
    const r = rng(1);
    for (let i = 0; i < 100; i++) expect(pickSubject(s, r)).toBe('words');
    const plan = nextLesson(fresh(), s, 10, r);
    expect(plan.subject).toBe('words');
    for (let i = 0; i < 5; i++) expect(lessonQuestion(plan, r).game).toBe(plan.game);
    const p = lessonStarted(fresh(), plan);
    expect(p.last[plan.level]).toBe(plan.game);
    expect(p.played[`${plan.level}/${plan.game}`]).toBe(1);
  });
});

describe('moving along gradually', () => {
  it('ten right answers make a new level fully current, mixing it in along the way', () => {
    let p = fresh();
    // right answers on level 0 carry him only part way into level 1
    for (let i = 0; i < 20; i++) p = recordAnswer(p, S, 'math', 0, true, 'math:count-3');
    expect(p.pos.math).toBeCloseTo(0.6);
    expect(p.right['math:count-3']).toBe(20);
    // then level 1's own questions take him the rest of the way
    for (let i = 0; i < 4; i++) p = recordAnswer(p, S, 'math', 1, true, 'math:count-5');
    expect(p.pos.math).toBeCloseTo(1);
    expect(p.best.math).toBe(1);
  });
  it('the big chess levels take three times as many', () => {
    let p = fresh();
    for (let i = 0; i < 15; i++) p = recordAnswer(p, S, 'chess', 0, true, 'chess:naming');
    expect(p.pos.chess).toBeCloseTo(0.5, 1);
    p = recordAnswer(p, S, 'chess', 0, false, 'chess:naming');
    expect(p.right['chess:naming']).toBe(15);
  });
  it('a miss pulls back half a step, never below a level fully reached', () => {
    let p = { ...fresh(), pos: { chess: 0, words: 2.3, math: 0 }, best: { chess: 0, words: 2, math: 0 } };
    p = recordAnswer(p, S, 'words', 3, false, 'words:4');
    expect(p.pos.words).toBeCloseTo(2.25);
    for (let i = 0; i < 20; i++) p = recordAnswer(p, S, 'words', 3, false, 'words:4');
    expect(p.pos.words).toBe(2);
  });
  it('reviews of older levels do not move him', () => {
    let p = { ...fresh(), pos: { chess: 0, words: 3.2, math: 0 }, best: { chess: 0, words: 3, math: 0 } };
    p = recordAnswer(p, S, 'words', 1, false, 'words:2');
    p = recordAnswer(p, S, 'words', 1, true, 'words:2');
    expect(p.pos.words).toBeCloseTo(3.2);
    expect(lastDays(p).words).toEqual([1, 1]);
  });
  it('the next level shows up as often as he is into it', () => {
    const p = { ...fresh(), pos: { chess: 0, words: 0, math: 4.3 }, best: { chess: 0, words: 0, math: 4 } };
    const r = rng(9); let next = 0, older = 0, now = 0;
    for (let i = 0; i < 5000; i++) { const lv = pickLevel(p, S, 'math', r); if (lv === 5) next++; else if (lv < 4) older++; else now++; }
    expect(older / 5000).toBeCloseTo(0.1, 1);
    expect(next / 5000).toBeCloseTo(0.9 * 0.3, 1);
    expect(now).toBeGreaterThan(next);
  });
});

describe('settings and saved progress', () => {
  it('fills in bad settings', () => {
    expect(readSettings({ perLevel: 1, session: 99, review: 2 })).toMatchObject({ perLevel: 3, session: 30, review: 0.5 });
    expect(readSettings({ mix: { chess: 0, words: 0, math: 0 } }).mix).toEqual(DEFAULT_SETTINGS.mix);
  });
  it('carries Little Chess over the first time', () => {
    const done = LESSONS.slice(0, 18).map(l => l.id);   // through the guessing games and three moves lessons
    const p = readProgress(null, { done, stickers: ['🦁', '🐘'], voice: false });
    expect(p.pos.chess).toBe(1);
    expect(p.right['chess:moves']).toBe(12);
    expect(p.right['chess:naming']).toBe(30);
    expect(p.stickers).toEqual(['🦁', '🐘']);
    expect(p.told).toContain('chess:names-rook');
    expect(p.voice).toBe(false);
  });
  it('moves progress saved with the old chess levels onto the new ones', () => {
    const p = readProgress({ pos: { chess: 9.4, words: 3.5, math: 2 }, best: { chess: 9, words: 3, math: 2 }, told: ['chess:names-rook'] });
    expect(p.pos.chess).toBe(0);
    expect(p.right['chess:naming']).toBe(22);
    expect(p.pos.words).toBeCloseTo(3.5);
    expect(p.v).toBe(2);
    expect(readProgress(p).pos.chess).toBe(0);
  });
  it("applies a grown-up's level change once", () => {
    const s = readSettings({ set: { words: { pos: 5, at: '2026-10-29T12:00:00Z' } } });
    let p = applySettings(fresh(), s);
    expect(p.pos.words).toBe(5);
    p = recordAnswer(p, s, 'words', 5, true, 'words:6');
    expect(applySettings(p, s).pos.words).toBeCloseTo(5.1);
  });
});
