// A message in the chat addressed to Arvy, and Arvy's answer there (supabase/functions/planner-chat/chat.ts): which
// messages are for Arvy, that such a message is not also read along, what the server keeps of an answer a phone posts
// and who may post it, what Arvy set up becoming proposals and who can confirm each kind, and what never gets into a
// chat message. Running the answer on the phone is in asking.test.ts; what Arvy is offered there is in
// ../arvy/chatmode.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ARVY, ASK_PATIENCE_MS, MAX_ASK, MAX_CHANGES, MAX_OWN_INPUT, MAX_PLACES, MAX_SOURCES, MAX_TEXT, OWN_TOOLS, SHARED_TOOLS,
  answerProposals, arvyAnswer, askLine, askedNext, buttonOk, canConfirm, canDismiss, cleanAnswer, cleanPicked, cleanPlaces, cleanSources, isArvy, isShared, noSecrets, pushLine, readText, readingOf, resolveProposal, toArvy,
  type ChatMsg, type Proposal,
} from '../../../../supabase/functions/planner-chat/chat';
import { cleanLinks, linkOk } from '../../../../supabase/functions/planner-arvy/places';
import { CHAT_NEVER, TOOLS, changeOf } from '../../../../supabase/functions/planner-arvy/tools';
import { EMOJI, emojiText } from './emoji';

const members = [{ username: 'vijay', name: 'Vijay' }, { username: 'rosh', name: 'Rosh' }];
const KEY = '2026-11-11T19:30:00.000Z~abc123';
const at = '2026-11-11T19:31:00.000Z';
let n = 0;
const id = () => `p${++n}`;
const asking = (more: Partial<ChatMsg> = {}): ChatMsg => ({ id: 'abc123', at: '2026-11-11T19:30:00.000Z', by: 'vijay', name: 'Vijay', text: 'RV plan a nice date for us on friday\nafter we drop kiaan off', ask: { state: 'working', at: '2026-11-11T19:30:00.000Z' }, ...more });
const post = (raw: unknown, more: Partial<Parameters<typeof arvyAnswer>[0]> = {}) => arvyAnswer({ asking: asking(), key: KEY, raw, user: { username: 'vijay' }, members, today: '2026-11-11', at, id, ...more });
const DENTAL = { name: 'Maple Leaf Dental', where: '100 Example St E, Hamilton', buttons: [{ kind: 'call', url: 'tel:+19055550134' }, { kind: 'site', url: 'https://www.mapleleafdental.example/' }, { kind: 'map', url: 'https://maps.google.com/?cid=1' }] };

describe('is this message for Arvy?', () => {
  it('yes: it opens with RV or Arvy, the ways people type it', () => {
    for (const line of [
      'RV plan a nice date for us on friday after we drop kiaan off at daycare (later due to turtle appt)',
      'rv, what’s on this weekend', 'Rv add milk and eggs to the list', 'RV: put the dentist on the calendar thursday at 3', 'RV - find a physio near Stoney Creek',
      'Arvy can you find a sushi place that’s open now', 'arvy what time does Costco close', 'Arvy, remind Rosh to call the plumber', 'ARVY!! we need a babysitter idea',
      'hey RV', 'Hey rv what should we make for dinner', 'hi arvy, any yoga classes tonight?', 'ok RV book it for 7', 'Okay Arvy: add it', 'so rv which one is closer', 'please RV look up the number for Smile Dental',
      '@rv what’s the number for the vet', 'can you check the calendar @arvy', 'Friday works. @RV put it on the calendar', 'R.V. what’s for dinner', 'Arvie find me a dentist', 'arvi whats on friday',
      'RV?', 'Arvy', '👋 RV are you there', '…RV find a place for brunch', 'RV 🙏 add wine to the list',
    ]) expect(toArvy(line), line).toBe(true);
  });
  it('yes: a question that starts with is, can, did… is still a question to it', () => {
    for (const line of [
      'RV is the pharmacy on Main still open', 'rv is there milk on the list', 'RV can you put that on the calendar', 'Arvy could you look up flights', 'RV did Rosh add the dentist', 'RV will it rain on Friday',
      'rv does Costco close at 9?', 'RV should we bring a coat tomorrow', 'Arvy has anyone booked the turtle appointment', 'RV would you pick the first one', 'RV can’t you just add it?', 'RV was that today',
      'RV just add milk', 'RV also can you check Saturday',
    ]) expect(toArvy(line), line).toBe(true);
  });
  it('no: the two of them talking, with RV or Arvy somewhere in it', () => {
    for (const line of [
      'the RV park was full', 'did you ask Arvy about it?', 'I asked rv and it said friday', 'we could rent an RV this summer', 'arvy’s idea was good', "Arvy's answer made me laugh", 'RV’s wrong about the time',
      'thanks RV', 'love you', 'ok', 'can you get apples and oranges', 'dentist Thursday at 3', 'RVs are so expensive', 'the arvy thing is cool', 'email me at vijay@rv.example', 'see arvy.example for more',
    ]) expect(toArvy(line), line).toBe(false);
  });
  it('no: it opens with the name but is a remark about it, or about a camper', () => {
    for (const line of [
      'RV park is booked for July', 'RV trip this summer?', 'rv rental prices are crazy', 'RV camping with your parents sounds fun', 'RV or tent this year', 'RV for sale down the street', 'RV-friendly campsite near Tobermory', 'RV/trailer show is this weekend', 'rv.example has the listings',
      'RV is great', 'Arvy is the best', 'RV isn’t working', 'Arvy was wrong about the time', 'RV can do that for us', 'RV can’t find it', 'Arvy will know', 'RV has been slow today', 'RV doesn’t get it', 'RV won’t answer me',
      'RV said the dentist is closed', 'Arvy thinks we should go Saturday', 'RV found a good one', 'RV added it twice', 'Arvy forgot the milk', 'RV just told me it’s closed', 'Arvy already answered that', 'RV really is the best', 'RV messed up the calendar', 'Arvy keeps getting the day wrong', 'RV suggested the Thai place',
    ]) expect(toArvy(line), line).toBe(false);
  });
  it('nothing is nothing, and one of our own emoji in the name’s place hides no name', () => {
    expect([toArvy(''), toArvy('   '), toArvy(undefined), toArvy(null), toArvy(42), toArvy('❤️')]).toEqual([false, false, false, false, false, false]);
    const santa = emojiText(EMOJI.find(e => e.id === 'santa')!);
    expect(toArvy(`${santa} RV add a tree to the list`)).toBe(true);   // an emoji before the name is not in the way
    expect(toArvy(`${santa} see you at 6`)).toBe(false);
  });
});

describe('what a new message sets off', () => {
  it('for Arvy, from an app that can answer it: asked. It is not read along too', () => {
    expect(readingOf({ text: 'RV plan a nice date for us on friday', turn: true })).toBe('asked');
    expect(readingOf({ text: 'hey RV', turn: true, looks: 2 })).toBe('asked');
    expect(readingOf({ text: 'find somewhere for this', turn: true, picked: 2 })).toBe('asked');   // picked messages, their own words
  });
  it('for Arvy, from an app from before this: read along as it always was', () => {
    expect(readingOf({ text: 'RV plan a nice date for us on friday' })).toBe('read');
    expect(readingOf({ text: 'RV plan a nice date for us on friday', turn: false })).toBe('read');
    expect(readingOf({ text: 'find somewhere for this', picked: 2 })).toBe('read');
  });
  it('not for Arvy: exactly as before, whatever the app can do', () => {
    for (const turn of [true, false]) {
      expect(readingOf({ text: 'can you get apples and oranges', turn })).toBe('read');
      expect(readingOf({ text: 'the RV park was full', turn })).toBe('read');
      expect(readingOf({ text: '❤️', turn })).toBe('none');
      expect(readingOf({ text: 'k', turn })).toBe('none');
      expect(readingOf({ text: '2', reply: true, turn })).toBe('read');   // a reply can be shorter and still mean something
      expect(readingOf({ text: '', looks: 1, turn })).toBe('read');        // a photo with no words
      expect(readingOf({ turn })).toBe('none');
    }
  });
  it('picked messages come as keys: each one a message’s, none twice, oldest first, no more than Arvy reads at a time', () => {
    const k = (i: number) => `2026-11-11T19:${String(i).padStart(2, '0')}:00.000Z~m${String(i).padStart(3, '0')}`;
    expect(cleanPicked([k(3), k(1), k(3)])).toEqual([k(1), k(3)]);
    expect(cleanPicked(undefined)).toEqual([]);
    expect(cleanPicked([k(1), 'not-a-key'])).toBeNull();
    expect(cleanPicked('nope')).toBeNull();
    expect(cleanPicked(Array.from({ length: MAX_ASK + 1 }, (_, i) => k(i)))).toBeNull();
  });
});

describe('Arvy’s answer, as the server keeps it', () => {
  it('a message from Arvy, to the one who asked, tied to the asking message like a reply', () => {
    n = 0;
    const r = post({ text: '  Two ideas for Friday.\u0007  ', links: [DENTAL], sources: [{ title: 'Google Maps: date night', url: 'https://www.google.com/maps/search/?api=1&query=date' }] });
    if ('error' in r) throw new Error(r.error);
    expect(r.key).toBe(`${at}~p1`);
    expect(r.msg).toEqual({ id: 'p1', at, by: ARVY, name: 'Arvy', text: 'Two ideas for Friday.', to: 'vijay',
      reply: { key: KEY, name: 'Vijay', text: 'RV plan a nice date for us on friday' }, links: [DENTAL], sources: [{ title: 'Google Maps: date night', url: 'https://www.google.com/maps/search/?api=1&query=date' }] });
    expect(isArvy(r.msg)).toBe(true);
    expect(r.asking.ask).toEqual({ state: 'answered', at: '2026-11-11T19:30:00.000Z', answer: r.key });
    expect(r.asking.text).toBe(asking().text);   // the asking message is otherwise as it was
    expect(pushLine({ text: r.msg.text })).toBe('Two ideas for Friday.');   // what the other phone is told
  });
  it('who is posting comes from the sign-in, never from the app: a name sent along changes nothing', () => {
    const r = post({ text: 'Hello', by: 'rosh', name: 'Rosh', to: 'rosh', id: 'evil', at: '2020-01-01T00:00:00.000Z', reply: { key: 'x', name: 'Someone' }, arvy: { state: 'done', proposals: [{ id: 'x', tool: 'add_event', state: 'done' }] } });
    if ('error' in r) throw new Error(r.error);
    expect(r.msg).toMatchObject({ by: ARVY, name: 'Arvy', to: 'vijay', at });
    expect(r.msg.arvy).toBeUndefined();
    expect(r.msg.reply?.name).toBe('Vijay');
  });
  it('only the one who asked posts it: not the other one, and not somebody outside the household', () => {
    expect(post({ text: 'Hello' }, { user: { username: 'rosh' } })).toEqual({ error: 'Only the one who asked Arvy can post its answer.', status: 403 });
    expect(post({ text: 'Hello' }, { user: { username: 'mallory' } })).toMatchObject({ status: 403 });
    // a stranger who names themselves vijay is still not in this household
    expect(post({ text: 'Hello' }, { members: [{ username: 'mallory', name: 'Mallory' }] })).toMatchObject({ status: 403 });
  });
  it('another household’s message, a made-up key, a message that is gone: nothing is found there, so nothing is posted', () => {
    // index.ts looks the key up in the poster's own household only: for anybody else's message that comes back empty
    expect(post({ text: 'Hello' }, { asking: null })).toEqual({ error: 'That message isn’t in your chat any more.', status: 404 });
    expect(post({ text: 'Hello' }, { asking: undefined })).toMatchObject({ status: 404 });
    expect(post({ text: 'Hello' }, { key: 'not-a-key' })).toMatchObject({ status: 404 });
  });
  it('only for a message that was addressed to Arvy: an ordinary message takes no answer', () => {
    expect(post({ text: 'Hello' }, { asking: asking({ ask: undefined, text: 'can you get apples' }) })).toMatchObject({ status: 403 });
  });
  it('once: the same answer posted again, or a second phone’s, is turned away', () => {
    const first = post({ text: 'Here you go.' });
    if ('error' in first) throw new Error(first.error);
    expect(post({ text: 'Here you go.' }, { asking: first.asking })).toEqual({ error: 'Arvy has already answered that.', status: 409 });
    // after a try that gave up, the answer may still land (a slow phone), and so may the one from asking again
    expect('error' in post({ text: 'Late, but here.' }, { asking: asking({ ask: { state: 'failed', at } }) })).toBe(false);
  });
  it('too long is cut, with nothing odd left in it; no words is nothing to post', () => {
    const r = post({ text: `${'word '.repeat(900)}\u0000end` });
    if ('error' in r) throw new Error(r.error);
    expect([...r.msg.text!].length).toBeLessThanOrEqual(MAX_TEXT + 1);
    expect(r.msg.text!.endsWith('…')).toBe(true);
    expect(post({ text: '   \n ' })).toEqual({ error: 'Nothing to say', status: 400 });
    expect(post({ links: [DENTAL] })).toMatchObject({ status: 400 });
    expect(post(null)).toMatchObject({ status: 400 });
    const lines = cleanAnswer({ text: 'One.\n\n\n\n\nTwo.\tThree.' }, { today: '2026-11-11', members, asker: 'vijay', id });
    expect(lines?.text).toBe('One.\n\nTwo.\tThree.');   // its paragraphs stay
  });
  it('bad links never become buttons: only tel: and https:, Directions only to Google Maps', () => {
    const r = post({ text: 'Rigged Clinic is the one.', links: [
      { name: 'Rigged Clinic', buttons: [{ kind: 'site', url: 'javascript:alert(1)' }, { kind: 'call', url: 'tel:not-a-number' }, { kind: 'map', url: 'http://maps.google.com/?cid=2' }, { kind: 'map', url: 'https://evil.example/maps' }, { kind: 'book', url: 'https://user:pw@book.example/' }, { kind: 'site', url: 'data:text/html,hi' }, { kind: 'steal', url: 'https://ok.example/' }] },
      { name: 'Lakeside Physio', buttons: [{ kind: 'call', url: 'tel:+19055550177' }, { kind: 'call', url: 'tel:+19055550199' }, { kind: 'book', url: 'https://lakesidephysio.janeapp.example/' }, { kind: 'site', url: 'https://lakesidephysio.example/' }] },
      { name: '', buttons: [{ kind: 'call', url: 'tel:+19055550100' }] }, 'nonsense', null,
    ], sources: [{ title: 'ok', url: 'https://bake.example/banana' }, { title: 'http', url: 'http://plain.example/' }, { title: 'js', url: 'javascript:1' }, { title: 'again', url: 'https://bake.example/banana' }, { url: 'ftp://x.example/' }] });
    if ('error' in r) throw new Error(r.error);
    expect(r.msg.links).toEqual([{ name: 'Lakeside Physio', buttons: [{ kind: 'call', url: 'tel:+19055550177' }, { kind: 'book', url: 'https://lakesidephysio.janeapp.example/' }] }]);
    expect(r.msg.sources).toEqual([{ title: 'ok', url: 'https://bake.example/banana' }]);
    expect(JSON.stringify(r.msg)).not.toMatch(/javascript|evil|data:|http:\/\/|user:pw|ftp:/);
  });
  it('a small fixed number of places and links, however many are sent', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Place ${i}`, buttons: [{ kind: 'call', url: `tel:+1905555${String(1000 + i)}` }] }));
    expect(cleanPlaces(many)).toHaveLength(MAX_PLACES);
    expect(cleanSources(Array.from({ length: 12 }, (_, i) => ({ title: `S${i}`, url: `https://site${i}.example/` })))).toHaveLength(MAX_SOURCES);
    expect(cleanPlaces(null)).toEqual([]);
    expect(cleanSources('x')).toEqual([]);
  });
  it('the button rule here is the one Arvy’s own chat uses (planner-arvy/places.ts): the two never disagree', () => {
    const urls = ['tel:+19055550134', 'tel:9055550134', 'tel:123', 'tel:+1 905 555 0134', 'https://www.mapleleafdental.example/', 'http://www.mapleleafdental.example/', 'https://maps.google.com/?cid=1', 'https://www.google.com/maps/place/x',
      'https://www.google.ca/maps?q=x', 'https://maps.app.goo.gl/abc', 'https://www.google.com/search?q=x', 'https://evil.example/maps', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@x.example/', 'https://localhost/', 'https://x.example/a b', '', `https://x.example/${'a'.repeat(600)}`];
    for (const kind of ['call', 'book', 'site', 'map', 'other', undefined]) for (const url of [...urls, null, 7]) expect(buttonOk(kind, url), `${kind} ${url}`).toBe(linkOk(kind, url));
    const sets = [[DENTAL], [DENTAL, DENTAL, { name: 'B', buttons: [{ kind: 'site', url: 'https://b.example/' }, { kind: 'book', url: 'https://b.example/book' }] }, { name: 'None', buttons: [] }]];
    for (const s of sets) expect(cleanPlaces(s)).toEqual(cleanLinks(s));
  });
});

describe('what never gets into a chat message', () => {
  it('a card number is taken out of what Arvy writes, wherever it sits', () => {
    expect(noSecrets('Pay with 4111 1111 1111 1111 at the desk')).toBe('Pay with [removed] at the desk');
    expect(noSecrets('card 4111-1111-1111-1111.')).toBe('card [removed].');
    expect(noSecrets('5555555555554444 is the one')).toBe('[removed] is the one');
    // a phone number, a date, a price and an order number are not card numbers
    for (const fine of ['Call (905) 555-0134 or +1 905 555 0134', 'Friday 2026-11-13 at 7:30', 'about $1,250.00 for two', 'order 1234567890123 is on its way'])
      expect(noSecrets(fine)).toBe(fine);
  });
  it('what follows “password”, “verification code”, “PIN”, “CVV” is taken out', () => {
    expect(noSecrets('The wifi password is sunshine42, enjoy')).toBe('The wifi password is [removed] enjoy');
    expect(noSecrets('password: hunter2')).toBe('password: [removed]');
    expect(noSecrets('Your password for Netflix is “tr0ub4dor”')).toBe('Your password for Netflix is “[removed]”');
    expect(noSecrets('Your verification code is 482913.')).toBe('Your verification code is [removed].');
    expect(noSecrets('the security code: 123 456')).toBe('the security code: [removed]');
    expect(noSecrets('PIN 4821 and CVV 123')).toBe('PIN [removed] and CVV [removed]');
    expect(noSecrets('My PIN for the debit card is 4821')).toBe('My PIN for the debit card is [removed]');
    // talking about one without giving it stays as it was
    for (const fine of ['The password is on the fridge', 'Your password is the same as before', 'I’ll text you the code', 'Pin it to the board', 'The confirmation number is 583920', 'postal code L8E 2K1', 'the booking code ABX4'])
      expect(noSecrets(fine)).toBe(fine);
  });
  it('an ID number is taken out: a SIN, a health card, a passport, a licence', () => {
    expect(noSecrets('SIN 046 454 286')).toBe('SIN [removed]');
    expect(noSecrets('it is 046-454-286 on the form')).toBe('it is [removed] on the form');
    expect(noSecrets('Health card number: 1234-567-890-AB')).toBe('Health card number: [removed]');
    expect(noSecrets('passport no. AB123456')).toBe('passport no. [removed]');
    expect(noSecrets('driver’s licence A1234-56789-01234 expires in May'.replace('’', "'"))).toBe("driver's licence [removed] expires in May");
    for (const fine of ['Bring your health card and passport', 'the passport office on Main opens at 9', 'since 2019 we have gone 12 times', 'single 123456 78'])
      expect(noSecrets(fine)).toBe(fine);
  });
  it('…also out of anything it sets up: an event’s title and notes, a to-do, a change of the asker’s own', () => {
    n = 0;
    const ps = answerProposals([
      { tool: 'add_event', input: { title: 'Bank: card 4111 1111 1111 1111', date: '2026-11-13', notes: 'door code 4821, password: hunter2' } },
      { tool: 'add_todos', input: { todos: [{ text: 'renew passport no. AB123456' }] } },
      { tool: 'change_event', input: { date: '2026-11-13', notes: 'SIN 046 454 286' }, lines: ['Calendar: change Bank', '→ notes SIN 046 454 286'] },
    ], { today: '2026-11-11', members, asker: 'vijay', id });
    expect(JSON.stringify(ps)).not.toMatch(/4111|4821|hunter2|AB123456|046/);
    expect(ps.map(p => p.tool)).toEqual(['add_event', 'add_todos', 'change_event']);
    const r = post({ text: 'The code is on your card: 4111 1111 1111 1111. Your verification code is 482913.' });
    if ('error' in r) throw new Error(r.error);
    expect(r.msg.text).toBe('The code is on your card: [removed]. Your verification code is [removed].');
  });
});

describe('what Arvy set up, as proposals on its message', () => {
  const from = (changes: unknown, asker = 'vijay') => { n = 0; return answerProposals(changes, { today: '2026-11-11', members, asker, id }); };
  it('the three shared kinds are the same proposals the chat has always had, made again by the server', () => {
    const ps = from([
      { tool: 'add_shopping_items', input: { items: [{ text: 'wine' }, 'candles', { text: 'WINE' }] }, lines: ['anything the phone says'] },
      { tool: 'add_event', input: { title: 'Date night', date: '2026-11-13', time: '18:30', end_time: '21:00', who: 'both', notes: 'Maple Leaf Bistro, 100 Example St', repeat: 'none' }, lines: ['Calendar: add EVERYTHING'] },
      { tool: 'add_todos', for: 'rosh', input: { todos: [{ text: 'book the sitter', time: '09:00', must: true }], date: '2026-11-12' } },
    ]);
    expect(ps).toEqual([
      { id: 'p1', state: 'waiting', tool: 'add_shopping_items', input: { items: [{ text: 'Wine' }, { text: 'Candles' }] }, lines: ['Shopping list: add Wine, Candles'] },
      { id: 'p2', state: 'waiting', tool: 'add_event', input: { title: 'Date night', date: '2026-11-13', time: '18:30', end_time: '21:00', who: 'both', notes: 'Maple Leaf Bistro, 100 Example St' }, lines: ['Calendar: Date night, Friday at 6:30 pm', 'Maple Leaf Bistro, 100 Example St'] },
      { id: 'p3', state: 'waiting', tool: 'add_todos', for: 'rosh', input: { todos: [{ text: 'Book the sitter', time: '09:00' }], date: '2026-11-12' }, lines: ['To-do for Rosh: Book the sitter (tomorrow)'] },
    ]);
    expect(ps.every(p => isShared(p.tool))).toBe(true);
    // the same checks as ever: an event needs a real day that isn't long gone, a to-do one of the two of them
    expect(from([{ tool: 'add_event', input: { title: 'No day' } }, { tool: 'add_event', input: { title: 'Long ago', date: '2026-10-01' } }, { tool: 'add_todos', for: 'kiaan', input: { todos: [{ text: 'tidy up' }] } }]))
      .toEqual([{ id: 'p1', state: 'waiting', tool: 'add_todos', for: 'vijay', input: { todos: [{ text: 'Tidy up' }], date: '2026-11-11' }, lines: ['To-do for Vijay: Tidy up'] }]);   // nobody else's: it is the asker's
    expect(from([{ tool: 'add_event', input: { title: 'Swim class', date: '2026-11-14', time: '10:00', who: 'kiaan', repeat: 'weekly', until: '2026-12-19' } }])[0])
      .toMatchObject({ input: { repeat: 'weekly', until: '2026-12-19', who: 'kiaan' }, lines: ['Calendar: Swim class, Saturday at 10 am, weekly until Sat Dec 19'] });
  });
  it('any other change is the asker’s own: kept as the phone worked it out, and for them only', () => {
    const ps = from([{ tool: 'change_event', input: { date: '2026-11-13', title: 'Dentist', new_time: '16:00' }, lines: ['Calendar: change Dentist, Fri Nov 13 3 PM for Rosh', '\u0007→ Dentist, Fri Nov 13 4 PM for Rosh'] }], 'rosh');
    expect(ps).toEqual([{ id: 'p1', state: 'waiting', tool: 'change_event', for: 'rosh', input: { date: '2026-11-13', title: 'Dentist', new_time: '16:00' }, lines: ['Calendar: change Dentist, Fri Nov 13 3 PM for Rosh', '→ Dentist, Fri Nov 13 4 PM for Rosh'] }]);
    expect(isShared(ps[0].tool)).toBe(false);
    // a "for" sent with it changes nothing: it is whoever asked
    expect(from([{ tool: 'log_body_weight', for: 'rosh', input: { weight: 181 }, lines: ['Body weight today: 181 lb'] }])[0].for).toBe('vijay');
    // with no line saying what it does, or too big to keep, it is not kept at all
    expect(from([{ tool: 'set_budget', input: { category: 'Dining', amount: 300 }, lines: [] }, { tool: 'plan_workout', input: { name: 'x', notes: 'n'.repeat(MAX_OWN_INPUT) }, lines: ['Train today'] }])).toEqual([]);
  });
  it('never kept, whatever a phone sends: the cycle tracker, email, a note to remember, a tool that doesn’t exist', () => {
    expect(from([
      { tool: 'log_period', input: { action: 'started' }, lines: ['Cycle: period started'] }, { tool: 'log_cycle_day', input: { flow: 'light' }, lines: ['Cycle today: flow light'] },
      { tool: 'email_send', input: { to: 'x@example.com' }, lines: ['Email: send'] }, { tool: 'remember', input: { note: 'x' }, lines: ['Note'] }, { tool: 'drop_tables', input: {}, lines: ['x'] },
      { tool: 42, input: {}, lines: ['x'] }, null, 'nonsense',
    ])).toEqual([]);
    for (const never of CHAT_NEVER) expect(OWN_TOOLS).not.toContain(never);
  });
  it('every change Arvy has is one of: a shared kind, the asker’s own, or never in the chat', () => {
    for (const t of TOOLS.filter(x => x.change)) expect([isShared(t.name), OWN_TOOLS.includes(t.name), CHAT_NEVER.includes(t.name)].filter(Boolean), t.name).toHaveLength(1);
    for (const name of [...OWN_TOOLS, ...SHARED_TOOLS]) expect(changeOf(name), name).toBeTruthy();   // each is a real change tool of Arvy's
  });
  it('a message never carries more than it can show', () => {
    const lots = Array.from({ length: 20 }, (_, i) => ({ tool: 'set_budget', input: { category: 'Dining', amount: i }, lines: [`Budget: Dining → $${i}`] }));
    expect(from(lots)).toHaveLength(MAX_CHANGES);
    const r = post({ text: 'Set up.', changes: [{ tool: 'add_event', input: { title: 'Date night', date: '2026-11-13' } }] });
    if ('error' in r) throw new Error(r.error);
    expect(r.msg.arvy).toMatchObject({ state: 'done', proposals: [{ tool: 'add_event', state: 'waiting', lines: ['Calendar: Date night, Friday'] }] });
  });
});

describe('who can confirm what Arvy set up', () => {
  const shop: Proposal = { id: 's', tool: 'add_shopping_items', input: { items: [{ text: 'Wine' }] }, lines: ['Shopping list: add Wine'], state: 'waiting' };
  const event: Proposal = { id: 'e', tool: 'add_event', input: { title: 'Date night', date: '2026-11-13', who: 'both' }, lines: ['Calendar: Date night, Friday'], state: 'waiting' };
  const todo: Proposal = { id: 't', tool: 'add_todos', for: 'rosh', input: { todos: [{ text: 'Book the sitter' }], date: '2026-11-11' }, lines: ['To-do for Rosh: Book the sitter'], state: 'waiting' };
  const own: Proposal = { id: 'o', tool: 'change_event', for: 'vijay', input: { date: '2026-11-13', new_time: '16:00' }, lines: ['Calendar: change Dentist'], state: 'waiting' };
  const msg: ChatMsg = { id: 'a1', at, by: ARVY, name: 'Arvy', to: 'vijay', text: 'Set up.', arvy: { state: 'done', proposals: [shop, event, todo, own] } };
  it('shopping items and a calendar event: either of them, as always', () => {
    for (const p of [shop, event]) expect([canConfirm(p, 'vijay'), canConfirm(p, 'rosh'), canDismiss(p, 'vijay'), canDismiss(p, 'rosh')]).toEqual([true, true, true, true]);
    expect(resolveProposal(msg, 'e', 'done', 'rosh', at)?.arvy?.proposals?.[1]).toMatchObject({ state: 'done', by: 'rosh' });
  });
  it('a to-do: only the person it is for, though either can turn it down, as always', () => {
    expect([canConfirm(todo, 'vijay'), canConfirm(todo, 'rosh'), canDismiss(todo, 'vijay')]).toEqual([false, true, true]);
    expect(resolveProposal(msg, 't', 'done', 'vijay', at)).toBeNull();
    expect(resolveProposal(msg, 't', 'done', 'rosh', at)?.arvy?.proposals?.[2].state).toBe('done');
  });
  it('any other change: only the one who asked, to confirm it or to turn it down', () => {
    expect([canConfirm(own, 'vijay'), canConfirm(own, 'rosh'), canDismiss(own, 'vijay'), canDismiss(own, 'rosh')]).toEqual([true, false, true, false]);
    expect(resolveProposal(msg, 'o', 'done', 'rosh', at)).toBeNull();
    expect(resolveProposal(msg, 'o', 'dismissed', 'rosh', at)).toBeNull();
    expect(resolveProposal(msg, 'o', 'done', 'vijay', at)?.arvy?.proposals?.[3]).toMatchObject({ state: 'done', by: 'vijay' });
    expect(resolveProposal(msg, 'o', 'dismissed', 'vijay', at)?.arvy?.proposals?.[3].state).toBe('dismissed');
  });
  it('the first tap still wins, and a change that failed on the phone goes back to waiting as it was', () => {
    const done = resolveProposal(msg, 'o', 'done', 'vijay', at)!;
    expect(resolveProposal(done, 'o', 'done', 'vijay', at)).toBeNull();
    expect(resolveProposal(done, 'o', 'waiting', 'vijay', at)?.arvy?.proposals?.[3]).toEqual(own);
  });
});

describe('where an answer stands, under the message that asked', () => {
  const t0 = Date.parse('2026-11-11T19:30:00.000Z');
  it('working: Arvy is looking, on both phones', () => {
    for (const me of ['vijay', 'rosh']) expect(askLine(asking(), { me, now: t0 + 20_000 })).toEqual({ state: 'working', again: false });
  });
  it('answered, or never for Arvy: nothing under it', () => {
    expect(askLine(asking({ ask: { state: 'answered', at, answer: 'k' } }), { me: 'vijay', now: t0 })).toBeNull();
    expect(askLine({ by: 'rosh' }, { me: 'vijay', now: t0 })).toBeNull();
  });
  it('the phone gave up: a plain line, and the one who asked can ask again', () => {
    const failed = asking({ ask: { state: 'failed', at: '2026-11-11T19:30:00.000Z' } });
    expect(askLine(failed, { me: 'vijay', now: t0 + 5000 })).toEqual({ state: 'failed', again: true });
    expect(askLine(failed, { me: 'rosh', now: t0 + 5000 })).toEqual({ state: 'failed', again: false });
  });
  it('the app was closed half-way: never a spinner for ever. After a few minutes it says so', () => {
    expect(askLine(asking(), { me: 'rosh', now: t0 + ASK_PATIENCE_MS - 1000 })?.state).toBe('working');
    expect(askLine(asking(), { me: 'rosh', now: t0 + ASK_PATIENCE_MS + 1000 })).toEqual({ state: 'failed', again: false });
    expect(askLine(asking(), { me: 'vijay', now: t0 + ASK_PATIENCE_MS + 1000 })).toEqual({ state: 'failed', again: true });
    // …but the phone that is still at it knows it is
    expect(askLine(asking(), { me: 'vijay', now: t0 + ASK_PATIENCE_MS + 60_000, running: true })).toEqual({ state: 'working', again: false });
    expect(askLine(asking({ ask: { state: 'working', at: 'not a time' } }), { me: 'vijay', now: t0 })?.state).toBe('working');
  });
  it('“it gave up” and “ask again” come only from the one who asked, and never once it is answered', () => {
    const now = '2026-11-11T19:35:00.000Z';
    expect(askedNext(asking(), 'vijay', 'failed', now)).toEqual({ changed: true, msg: asking({ ask: { state: 'failed', at: '2026-11-11T19:30:00.000Z' } }) });
    expect(askedNext(asking({ ask: { state: 'failed', at, keys: [KEY] } }), 'vijay', 'working', now)).toEqual({ changed: true, msg: asking({ ask: { state: 'working', at: now, keys: [KEY] } }) });
    expect(askedNext(asking(), 'rosh', 'failed', now)).toMatchObject({ status: 403 });
    expect(askedNext(asking(), 'rosh', 'working', now)).toMatchObject({ status: 403 });
    expect(askedNext(null, 'vijay', 'failed', now)).toMatchObject({ status: 404 });
    expect(askedNext(asking({ ask: undefined }), 'vijay', 'working', now)).toMatchObject({ status: 403 });
    const answered = asking({ ask: { state: 'answered', at, answer: 'k' } });
    expect(askedNext(answered, 'vijay', 'working', now)).toEqual({ error: 'Arvy has already answered that.', status: 409 });
    expect(askedNext(answered, 'vijay', 'failed', now)).toEqual({ changed: false, msg: answered });   // a late "gave up" doesn't undo an answer
    expect(askedNext(asking(), 'vijay', 'answered', now)).toMatchObject({ status: 400 });
  });
});

describe('Arvy’s answers, when it later reads along', () => {
  it('an earlier answer of its own is there as context, with what it set up', () => {
    const answer: ChatMsg = { id: 'a1', at, by: ARVY, name: 'Arvy', to: 'vijay', text: 'Two ideas for Friday.', arvy: { state: 'done', proposals: [{ id: 'e', tool: 'add_event', input: {}, lines: ['Calendar: Date night, Friday'], state: 'waiting' }] } };
    const text = readText([asking(), answer], { id: 'm2', at, by: 'rosh', name: 'Rosh', text: 'the second one, 7 pm' }, null);
    expect(text).toContain('Arvy: Two ideas for Friday. [you proposed: Calendar: Date night, Friday]');
    expect(text).toMatch(/The newest message, from Rosh:\nthe second one, 7 pm$/);
  });
});
