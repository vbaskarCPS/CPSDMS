import { describe, expect, it } from 'vitest';
import { fromMorningLink, morningText, openDayHref, whatsNewText, type MorningReport } from './bennyMorning';

const base: MorningReport = { due: true, today: '2026-11-13', line: '', new: [], open: [], can_start: false };
const five = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, title: `Thing ${i}`, how: `Does ${i}.`, ask: i ? `Try ${i}` : null, on: '2026-11-12' }));

describe('morning report', () => {
  it('says what was learned, the open day and offers to start', () => {
    const t = morningText({ ...base, new: five, open: [{ center_id: 'c', center: 'BC Fall RJ', day: '2026-11-12' }], can_start: true }, 'Vijay Baskaran');
    expect(t).toContain('Good morning, Vijay.');
    expect(t).toContain('I learned how to do 5 new things');
    expect(t).toContain('BC Fall RJ Thu, Nov 12 hasn’t been closed yet.');
    expect(t).toContain('Once that’s closed, want help starting today?');
  });
  it('one thing, no open day, no workerbook', () => {
    const t = morningText({ ...base, new: five.slice(0, 1) });
    expect(t).toContain('1 new thing since');
    expect(t).not.toContain('start');
  });
  it('nothing at all', () => {
    expect(morningText(base)).toContain('Nothing new this morning');
  });
  it('lists what is new', () => {
    const t = whatsNewText(five.slice(0, 2));
    expect(t.split('\n')).toHaveLength(3);
    expect(t).toContain('• **Thing 1**: Does 1.');
    expect(whatsNewText([])).toContain('Nothing new');
  });
  it('links', () => {
    expect(openDayHref({ center_id: 'c', center: 'x', day: '2026-11-12' })).toBe('/app/workerbook/days/2026-11-12');
    expect(fromMorningLink('?benny=morning')).toBe(true);
    expect(fromMorningLink('?x=1')).toBe(false);
  });
});
