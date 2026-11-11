// What's new in the planner (lib/news.ts): which entries Arvy tells after an update, and how it says them.
import { describe, expect, it } from 'vitest';
import { NEWS, asksWhatsNew, newsNote, newsSince, newsText, type News } from './news';

const list: News[] = [
  { id: 'e', date: '2026-11-14', title: 'Five', lines: ['newest'] },
  { id: 'd', date: '2026-11-13', title: 'Four', lines: ['for her'], for: 'morning' },
  { id: 'c', date: '2026-11-12', title: 'Three', lines: ['one', 'two'] },
  { id: 'b', date: '2026-11-11', title: 'Two', lines: ['x'] },
  { id: 'a', date: '2026-10-01', title: 'One', lines: ['long ago'] },
];
const ids = (n: News[]) => n.map(x => x.id).join('');

describe('what’s new', () => {
  it('after an update: everything above the last one told, for their kind of planner', () => {
    expect(ids(newsSince('b', 'night', '2026-11-14', list))).toBe('ec');
    expect(ids(newsSince('b', 'morning', '2026-11-14', list))).toBe('edc');
    expect(ids(newsSince('e', 'night', '2026-11-14', list))).toBe('');
    expect(ids(newsSince('d', 'night', '2026-11-14', list))).toBe('e');
  });
  it('the first time: the last three days, not the whole history; an id that’s gone from the list: just the newest', () => {
    expect(ids(newsSince(null, 'night', '2026-11-14', list))).toBe('ecb');
    expect(ids(newsSince(undefined, 'morning', '2026-11-20', list))).toBe('');
    expect(ids(newsSince('zzz', 'night', '2026-11-14', list))).toBe('e');
  });
  it('is said as one message from Arvy', () => {
    expect(newsText(newsSince('c', 'night', '2026-11-14', list))).toBe('Your planner was updated. Here’s what’s new:\n\n**Five**\n- newest');
    expect(newsText([])).toBe('');
  });
  it('knows when it’s being asked, and hands Arvy the list for that question', () => {
    for (const q of ['What’s new?', "what's new in the planner", 'what changed', 'what has changed lately?', 'any new features?', 'show me the release notes', 'has the planner been updated']) expect(asksWhatsNew(q)).toBe(true);
    for (const q of ['what’s next today?', 'add milk', 'anything new on the calendar this week?', 'what did I change in my routine']) expect(asksWhatsNew(q)).toBe(false);
    const note = newsNote('night', list);
    expect(note).toMatch(/^\[The planner’s release notes, newest first/);
    expect(note).toContain('2026-11-14 Five: newest');
    expect(note).not.toContain('for her');
  });
  it('the real list: every entry has what it needs, ids are unique, newest first', () => {
    expect(NEWS.length).toBeGreaterThan(0);
    expect(new Set(NEWS.map(n => n.id)).size).toBe(NEWS.length);
    for (const n of NEWS) {
      expect(n.id).toMatch(/^[a-z0-9-]{3,60}$/);
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.title.length).toBeGreaterThan(3);
      expect(n.lines.length).toBeGreaterThan(0);
      expect(n.lines.length).toBeLessThanOrEqual(4);
      if (n.for) expect(['morning', 'night']).toContain(n.for);
    }
    expect([...NEWS].sort((a, b) => b.date.localeCompare(a.date)).map(n => n.date)).toEqual(NEWS.map(n => n.date));
  });
});
