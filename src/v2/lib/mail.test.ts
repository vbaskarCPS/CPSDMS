import { describe, expect, it } from 'vitest';
import { fileSize, htmlToText, initials, isEmail, mailWhen, reSubject, splitAddresses } from './mail';

describe('mail words', () => {
  it('splits pasted addresses', () => {
    expect(splitAddresses('Ann <Ann@x.ca>, bob@y.ca; carl@z.ca junk')).toEqual(['ann@x.ca', 'bob@y.ca', 'carl@z.ca']);
    expect(splitAddresses('')).toEqual([]);
  });
  it('knows an email', () => { expect(isEmail('a@b.ca')).toBe(true); expect(isEmail('a@b')).toBe(false); });
  it('adds Re: once', () => { expect(reSubject('Hello')).toBe('Re: Hello'); expect(reSubject('RE: Hello')).toBe('RE: Hello'); });
  it('turns html into text', () => {
    expect(htmlToText('<p>Hi <b>Sam</b></p><ul><li>One</li><li>Two</li></ul><p><a href="https://x.ca">book</a> &amp; go</p>'))
      .toBe('Hi Sam\n• One\n• Two\nbook (https://x.ca) & go');
    expect(htmlToText('<p><a href="https://x.ca">https://x.ca</a></p>')).toBe('https://x.ca');
  });
  it('dates a list row', () => {
    const now = new Date('2026-10-28T15:00:00');
    expect(mailWhen('2026-10-28T09:05:00', now)).toMatch(/9:05/);
    expect(mailWhen('2026-10-26T09:05:00', now)).toMatch(/Mon/);
    expect(mailWhen('2026-03-02T09:05:00', now)).toMatch(/Mar/);
    expect(mailWhen('2025-03-02T09:05:00', now)).toMatch(/2025/);
    expect(mailWhen('nope', now)).toBe('');
  });
  it('initials and sizes', () => {
    expect(initials('Ann Lee')).toBe('AL'); expect(initials('', 'bob.smith@x.ca')).toBe('BS');
    expect(fileSize(500)).toBe('500 B'); expect(fileSize(2048)).toBe('2 KB'); expect(fileSize(3 * 1048576)).toBe('3.0 MB');
  });
});
