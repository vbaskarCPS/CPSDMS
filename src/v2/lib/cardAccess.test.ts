// The "you can now process cards" email (supabase/functions/card-access/email.ts).
import { describe, expect, it } from 'vitest';
import { accessEmail } from '../../../supabase/functions/card-access/email';

describe('accessEmail', () => {
  it('says who turned it on, where to find it and how it works', () => {
    const { subject, text, html } = accessEmail({ firstName: 'Jovan', username: 'chujo', grantedBy: 'Vijay Baskaran' });
    expect(subject).toBe('You can now process cards in the Property Stars app');
    expect(text).toContain('Hi Jovan,');
    expect(text).toContain('Vijay Baskaran turned on Card Processing for your account.');
    expect(text).toContain('Where to find it: Sign in at propertystars.app/app, open the menu at the top left and choose Card Processing.');
    expect(text).toContain('1. Fill in the customer');
    expect(text).toContain('Open Card Processing: https://propertystars.app/app/cards');
    expect(text).toContain('Your username is chujo.');
    expect(html).toContain('href="https://propertystars.app/app/cards"');
  });
  it('still reads right with nobody named and no username, and escapes names', () => {
    const { text, html } = accessEmail({ firstName: 'A<b>', username: null, grantedBy: null });
    expect(text).toContain('Card Processing is now turned on for your account.');
    expect(text).not.toContain('Your username');
    expect(html).toContain('Hi A&lt;b&gt;,');
  });
});
