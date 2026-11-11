import { describe, expect, it } from 'vitest';
import { claimNews, firstName, newsText, toldLine, type BennyNews } from './bennyNews';

const req: BennyNews = { id: 'a1', kind: 'request', title: 'Remove workers from today', asked: 'Remove  Devante and Keenan\nfrom today', note: 'Say “take Kenan off today”, then tap Remove from today.' };

describe('the “it’s live” message', () => {
  it('says it is live, what they asked, and what to do now', () => {
    expect(newsText(req)).toBe('**It’s live: Remove workers from today**\nYou asked: “Remove Devante and Keenan from today”\n\nSay “take Kenan off today”, then tap Remove from today.');
  });
  it('a bug reads as fixed', () => {
    expect(newsText({ id: 'b1', kind: 'bug', title: 'Houses don’t load on RMD143', asked: 'the houses are missing', note: 'They load again.' }))
      .toBe('**Fixed: Houses don’t load on RMD143**\nYou told me: “the houses are missing”\n\nThey load again.');
  });
  it('leaves the quote out when there is none, and cuts a long one', () => {
    expect(newsText({ ...req, asked: '' })).toBe('**It’s live: Remove workers from today**\n\nSay “take Kenan off today”, then tap Remove from today.');
    const long = newsText({ ...req, asked: 'x'.repeat(400) });
    expect(long).toContain(`“${'x'.repeat(159)}…”`);
  });
});

describe('showing each notice once on a page', () => {
  it('hands a notice over once, and skips ones with nothing to say', () => {
    const seen = new Set<string>();
    expect(claimNews([req, { ...req, id: 'a2', note: '  ' }, { ...req, id: '' }], seen).map(n => n.id)).toEqual(['a1']);
    expect(claimNews([req, { ...req, id: 'a3' }], seen).map(n => n.id)).toEqual(['a3']);
    expect(claimNews(null as unknown as BennyNews[], seen)).toEqual([]);
  });
});

describe('the Bug log’s line about a notice', () => {
  const when = (iso: string) => iso.slice(11, 16);
  it('says when, whether it was seen and whether a notification went', () => {
    expect(toldLine({ at: '2026-11-11T20:00:00Z' }, when)).toBe('20:00 · not seen in the Benny yet · no notification (not turned on)');
    expect(toldLine({ at: '2026-11-11T20:00:00Z', seen_at: '2026-11-11T21:30:00Z', pushed_at: '2026-11-11T20:00:02Z', sent: 2 }, when)).toBe('20:00 · seen in the Benny 21:30 · notification sent to 2 devices');
    expect(toldLine({ at: '2026-11-11T20:00:00Z', pushed_at: '2026-11-11T20:00:02Z', sent: 0 }, when)).toBe('20:00 · not seen in the Benny yet · no notification got through');
  });
  it('first names', () => { expect(firstName('Franklyn Mitchell')).toBe('Franklyn'); expect(firstName('')).toBe('them'); expect(firstName(null)).toBe('them'); });
});
