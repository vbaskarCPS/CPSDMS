// The copy of the questionnaire and proposal a rep can email to the owner.
import { describe, expect, it } from 'vitest';
import { deckEmail, SAVINGS_DISCLAIMER } from './deckEmail';
import type { DeckAnswers } from './meetings';

const a: DeckAnswers = {
  v: 1, answers: { expenses: '25_50', staff: '3' } as unknown as Record<string, string>,
  summary: [['Talking with', 'Dana (Owner) · 403 555 0100'], ['Monthly business expenses', '$25K–$50K'], ['Staff on payroll', '3']],
  contact: { name: 'Dana Lee', role: 'Owner', phone: '403 555 0100', email: 'dana@trop.ca' },
  proposal: { lines: [['Core bookkeeping', '$549/mo'], ['Corporate return (T2 Standard)', 'from $1,500/yr'], ['Payroll', '$79/mo'], ['Bundle discount', '−15%']],
    monthly: 640, yearly: 7681, quoted: false, today_yearly: 10500, savings: 2819, fit: 'taxifi takes over the monthly bookkeeping.' },
};

describe('the questionnaire & proposal email', () => {
  it('greets the contact, lists their answers (not the contact row) and the proposal', () => {
    const e = deckEmail({ business: 'The Trop', campaign: 'Taxifi', answers: a });
    expect(e.subject).toBe('Your Taxifi questionnaire and proposal: The Trop');
    expect(e.html).toContain('<p>Hi Dana,</p>');
    expect(e.html).toContain('<li>Monthly business expenses: $25K–$50K</li>');
    expect(e.html).not.toContain('Talking with');
    expect(e.html).toContain('<li>Core bookkeeping: $549/mo</li>');
    expect(e.html).toContain('About $7,681 a year');
  });
  it('shows the savings as a rough estimate, with the disclaimer', () => {
    const e = deckEmail({ business: 'The Trop', campaign: 'Taxifi', answers: a });
    expect(e.html).toContain('Rough estimate:');
    expect(e.html).toContain('save you about $2,819 a year');
    expect(e.html).toContain(SAVINGS_DISCLAIMER.replace(/’/g, '’'));
    const none = deckEmail({ business: 'X', campaign: 'Taxifi', answers: { ...a, proposal: { ...a.proposal!, savings: -200 } } });
    expect(none.html).not.toContain('Rough estimate');
  });
  it('says when the rep will follow up', () => {
    const e = deckEmail({ business: 'The Trop', campaign: 'Taxifi', answers: a, followUpAt: '2026-11-05T17:00:00Z', tz: 'America/Edmonton' });
    expect(e.html).toContain('I’ll follow up with you on Thursday, November 5 at 10:00 AM.');
  });
  it('escapes what the owner typed', () => {
    const e = deckEmail({ business: 'A&B <Shop>', campaign: 'Taxifi', answers: { ...a, contact: { ...a.contact!, name: '<b>x</b>' } } });
    expect(e.html).toContain('A&amp;B &lt;Shop&gt;');
    expect(e.html).not.toContain('<b>x</b>');
  });
});
