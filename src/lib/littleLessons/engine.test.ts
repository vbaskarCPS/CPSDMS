import { describe, expect, it } from 'vitest';
import { applySettings, lastDays, nextQuestion, pickLevel, pickSubject, readProgress, readSettings, recordAnswer, DEFAULT_SETTINGS } from './engine';
import { LEVELS, SUBJECTS, answerOf, lessonLine, numberChoices, rng, wordChoices } from './levels';
import { ALL_WORDS, WORD_GROUPS, lookAlikes } from './words';
import { LESSONS } from '../littleChess/lessons';

const S = readSettings(null);
const fresh = () => readProgress({});

describe('levels', () => {
  it('has every level, with a story and a cast', () => {
    expect(LEVELS.chess).toHaveLength(LESSONS.length);
    expect(LEVELS.words).toHaveLength(WORD_GROUPS.length);
    expect(LEVELS.math.map(l => l.id)).toEqual(['math:count-3', 'math:count-5', 'math:count-8', 'math:count-10', 'math:count-20',
      'math:cadd-3', 'math:cadd-5', 'math:cadd-10', 'math:csub-5', 'math:csub-10', 'math:add-5', 'math:add-10', 'math:add-20', 'math:sub-5', 'math:sub-10', 'math:sub-20']);
    for (const s of SUBJECTS) for (const l of LEVELS[s]) { expect(l.story.lines.length).toBeGreaterThan(0); expect(l.story.said.length).toBeGreaterThan(10); }
    expect(new Set(SUBJECTS.flatMap(s => LEVELS[s].map(l => l.id))).size).toBe(SUBJECTS.reduce((n, s) => n + LEVELS[s].length, 0));
  });
  it('makes good math questions: the answer is a choice, numbers stay in range', () => {
    for (const l of LEVELS.math) for (let k = 0; k < 200; k++) {
      const q = l.make(rng(k * 31 + 7), k);
      const a = answerOf(q) as number;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(20);
      expect('options' in q && (q.options as number[]).includes(a)).toBe(true);
      expect(new Set((q as { options: number[] }).options).size).toBe(3);
      expect(lessonLine(q)).not.toBeNull();
    }
  });
  it('counting starts small, and never offers 0', () => {
    for (let k = 0; k < 100; k++) { const q = LEVELS.math[0].make(rng(k), k); expect(q.kind === 'count' && q.n <= 3 && !q.options.includes(0)).toBe(true); }
  });
  it('makes sight-word questions from words he has met, with more choices later', () => {
    LEVELS.words.forEach((l, i) => {
      const known = WORD_GROUPS.slice(0, i + 1).flat();
      for (let k = 0; k < 40; k++) {
        const q = l.make(rng(k + i * 100), k);
        if (q.kind !== 'sight') throw new Error('not a word');
        expect(q.options).toContain(q.word);
        expect(q.options.every(w => known.includes(w))).toBe(true);
        expect(new Set(q.options).size).toBe(q.options.length);
        expect(q.options.length).toBe(Math.min(wordChoices(i).count, known.length));
      }
    });
    expect(lookAlikes('the')).toContain('then');
    expect(ALL_WORDS).toHaveLength(133);
  });
  it('makes chess questions with fresh boards, never the hello', () => {
    for (const l of LEVELS.chess) for (let k = 0; k < 8; k++) {
      const q = l.make(rng(k), k);
      expect(q.kind).not.toBe('hello');
      if (q.kind === 'board') expect(q.targets.length).toBeGreaterThan(0);
    }
  });
  it('gives close number choices', () => {
    for (let k = 0; k < 50; k++) { const c = numberChoices(rng(k), 0); expect(c).toContain(0); expect(c.every(n => n >= 0)).toBe(true); }
  });
});

describe('moving along gradually', () => {
  it('ten right answers make a new level fully current, mixing it in along the way', () => {
    let p = fresh();
    // right answers on level 0 carry him only part way into level 1
    for (let i = 0; i < 20; i++) p = recordAnswer(p, S, 'math', 0, true, 'math:count-3');
    expect(p.pos.math).toBeCloseTo(0.6);
    // then level 1's own questions take him the rest of the way
    for (let i = 0; i < 4; i++) p = recordAnswer(p, S, 'math', 1, true, 'math:count-5');
    expect(p.pos.math).toBeCloseTo(1);
    expect(p.best.math).toBe(1);
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
  it('picks subjects by the mix', () => {
    const s = readSettings({ mix: { chess: 0, words: 100, math: 0 } });
    const r = rng(1);
    for (let i = 0; i < 100; i++) expect(pickSubject(s, r)).toBe('words');
    const q = nextQuestion(fresh(), s, r);
    expect(q.q.subject).toBe('words');
  });
});

describe('settings and saved progress', () => {
  it('fills in bad settings', () => {
    expect(readSettings({ perLevel: 1, session: 99, review: 2 })).toMatchObject({ perLevel: 3, session: 30, review: 0.5 });
    expect(readSettings({ mix: { chess: 0, words: 0, math: 0 } }).mix).toEqual(DEFAULT_SETTINGS.mix);
  });
  it('carries Little Chess over the first time', () => {
    const done = LESSONS.slice(0, 18).map(l => l.id);
    const p = readProgress(null, { done, stickers: ['🦁', '🐘'], voice: false });
    expect(p.pos.chess).toBe(18);
    expect(LEVELS.chess[18].id).toBe(`chess:${LESSONS[18].id}`);
    expect(p.stickers).toEqual(['🦁', '🐘']);
    expect(p.told).toContain(LEVELS.chess[0].id);
    expect(p.voice).toBe(false);
  });
  it("applies a grown-up's level change once", () => {
    const s = readSettings({ set: { words: { pos: 5, at: '2026-10-29T12:00:00Z' } } });
    let p = applySettings(fresh(), s);
    expect(p.pos.words).toBe(5);
    p = recordAnswer(p, s, 'words', 5, true, 'words:6');
    expect(applySettings(p, s).pos.words).toBeCloseTo(5.1);
  });
});
