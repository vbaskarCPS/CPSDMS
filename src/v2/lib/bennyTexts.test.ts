import { describe, expect, it } from 'vitest';
import { personSub, textHref, textOf, textsCopy, textsFoot, textsSaid, textsTitle, TEXT_MAX, type TextPerson, type TextsCheck } from './bennyTexts';
import { forServer } from './benny';

const person = (over: Partial<TextPerson> = {}): TextPerson => ({ hire_id: 'h1', cn: 'I1169', name: 'Steven Doherty', first: 'Steven', phone: '6045550101',
  text: 'Steven if you dont get out of bed right now you can start packing', days_worked: 3, days_on_list: 10, last_worked: '2026-11-04', ...over });
const check = (over: Partial<TextsCheck> = {}): TextsCheck => ({ ok: true, date: '2026-11-11', who: 'no_shows', own_words: true,
  people: [person(), person({ cn: 'I2002', name: 'Wilson Ricardo', first: 'Wilson', text: 'Wilson, call me.', days_worked: 0, days_on_list: 11, last_worked: undefined })], ...over });

describe('the texts card', () => {
  it('is titled by who it is for', () => {
    expect(textsTitle(check())).toBe('Text 2 who didn’t show · Wed, Nov 11');
    expect(textsTitle(check({ who: 'showed' }))).toBe('Text 2 who showed · Wed, Nov 11');
    expect(textsTitle(check({ who: 'booked' }))).toBe('Text everyone on the list (2) · Wed, Nov 11');
    expect(textsTitle(check({ who: 'named' }))).toBe('Text Steven and Wilson · Wed, Nov 11');
    expect(textsTitle(check({ who: 'named', people: [person(), person(), person()] }))).toBe('Text 3 workers · Wed, Nov 11');
  });
  it('says what the app knows about each worker', () => {
    expect(personSub(person(), '2026-11-11')).toBe('worked 3 of 10 days · last Nov 4');
    expect(personSub(person({ days_worked: 9, days_on_list: 11, last_worked: '2026-11-10' }), '2026-11-11')).toBe('worked 9 of 11 days · last yesterday');
    expect(personSub(person({ days_worked: 0, days_on_list: 11, last_worked: undefined }), '2026-11-11')).toBe('never worked · 11 days on the list');
    expect(personSub(person({ days_worked: 0, days_on_list: 0, last_worked: undefined }), '2026-11-11')).toBe('first day on the list');
    expect(personSub(person({ days_worked: 1, days_on_list: 1, last_worked: '2026-10-31' }), '2026-11-01')).toBe('worked 1 of 1 day · last yesterday');   // across a month
    expect(personSub(person({ days_worked: 4, days_on_list: 2 }), '2026-11-11')).toContain('worked 4 of 4 days');   // never "4 of 2"
    // texts opened for them from here before (the database hands on the latest three)
    expect(personSub(person({ earlier: 1 }), '2026-11-11')).toBe('worked 3 of 10 days · last Nov 4 · 1 earlier text');
    expect(personSub(person({ days_worked: 0, days_on_list: 11, last_worked: undefined, earlier: 3 }), '2026-11-11')).toBe('never worked · 11 days on the list · 3 or more earlier texts');
  });
  it('a changed text replaces the one the card came with; an emptied one does not', () => {
    const p = person();
    expect(textOf(p)).toBe(p.text);
    expect(textOf(p, { edits: { I1169: '  Steven, van leaves at 8.  ' } })).toBe('Steven, van leaves at 8.');
    expect(textOf(p, { edits: { I1169: '   ' } })).toBe(p.text);
    expect(textOf(p, { edits: { I2002: 'someone else' } })).toBe(p.text);
    expect(textOf(p, { edits: { I1169: 'x'.repeat(TEXT_MAX + 50) } })).toHaveLength(TEXT_MAX);
  });
  it('the Text button is an sms link with the text written, whatever the number looks like', () => {
    expect(textHref('(604) 555-0101', 'Steven, call me & hurry?')).toBe('sms:6045550101?&body=Steven%2C%20call%20me%20%26%20hurry%3F');
    expect(textHref('+1 604 555 0101', 'Hi')).toBe('sms:+16045550101?&body=Hi');
    expect(decodeURIComponent(textHref('6045550101', 'ligne 1\n“été”').split('body=')[1])).toBe('ligne 1\n“été”');
  });
  it('Copy all gives names and texts, with any change, and no numbers', () => {
    const copied = textsCopy(check(), { edits: { I2002: 'Wilson, 10 minutes.' } });
    expect(copied).toBe('Steven Doherty: Steven if you dont get out of bed right now you can start packing\nWilson Ricardo: Wilson, 10 minutes.');
    expect(copied).not.toContain('604');
  });
  it('says whose words they are, that nothing is sent from here, and who has no cell number', () => {
    expect(textsFoot(check())).toBe('Your wording, with each name filled in. Each button opens Messages with the text written. You press send; nothing is sent from here.');
    expect(textsFoot(check({ own_words: false, tone: 'firm, last warning' }))).toBe('Tone: firm, last warning. Written by the Benny: tap a text to change it. Each button opens Messages with the text written. You press send; nothing is sent from here.');
    expect(textsFoot(check({ own_words: false, no_cell: ['Tim Chan'] }))).toContain('nothing is sent from here. No cell number: Tim Chan.');
  });
  it('says whose Messages was opened, never that a text was sent', () => {
    const people = check().people;
    expect(textsSaid(people)).toBe('No text opened yet.');
    expect(textsSaid(people, { opened: { I1169: 1 } })).toBe('Opened Messages for 1 of 2 (not Wilson).');
    expect(textsSaid(people, { opened: { I1169: 1, I2002: 2 } })).toBe('Opened Messages for all 2.');
    expect(textsSaid([people[0]], { opened: { I1169: 1 } })).toBe('Opened Messages for Steven Doherty.');
    for (const said of [textsSaid(people, { opened: { I1169: 1 } }), textsFoot(check())]) expect(said).not.toMatch(/\bsent to\b|was sent|texted/i);
  });
  it('the Benny is told what happened on the card, and never a number', () => {
    const card = { role: 'assistant' as const, text: 'Two texts are set up.', proposal: { kind: 'texts' as const, check: check() } };
    expect(forServer([card])[0].content).toBe('Two texts are set up.\n\n[The card: No text opened yet.]');
    expect(forServer([{ ...card, texts: { opened: { I2002: 5 } } }])[0].content).toBe('Two texts are set up.\n\n[The card: Opened Messages for 1 of 2 (not Steven).]');
    expect(forServer([{ ...card, texts: { opened: { I2002: 5 } }, outcome: { state: 'done' as const, text: 'Opened Messages for 1 of 2 (not Steven). You press send in Messages.' } }])[0].content)
      .toBe('Two texts are set up.\n\n[The card: confirmed, done: Opened Messages for 1 of 2 (not Steven). You press send in Messages.]');
    expect(JSON.stringify(forServer([{ ...card, texts: { opened: { I1169: 1, I2002: 5 } } }]))).not.toContain('604');
  });
});
