// Replying to a message in the chat: the quote a reply carries and what the server keeps of what an app sends
// (supabase/functions/planner-chat/chat.ts), how a reply reads in a notification and to Arvy, and sending one from
// the phone (us.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_QUOTE, arvyLine, cleanMessage, clip, isKey, plainEmoji, pushLine, quoteOf, quoteWords, readSystem, readText, replyFrom, type ChatMsg } from '../../../../supabase/functions/planner-chat/chat';
import { EMOJI, emojiText, partsOf } from './emoji';

const invoke = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } } }));
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a), shrinkImage: vi.fn() }));
vi.mock('../../lib/app', () => ({ isDemo: () => false, profileOf: () => 'night' }));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ token: 't', user: { id: 'u1', username: 'vijay', display_name: 'Vijay', settings: {} } }) }));
vi.mock('../../lib/docs', () => ({ docsChanged: vi.fn(), getDoc: async () => null, getDocs: async () => [], putDoc: async () => undefined, dayKey: () => '2026-11-11', calendarKey: () => '2026-11-11' }));
vi.mock('../arvy/act', () => ({ prepare: vi.fn() }));
vi.mock('../arvy/arvy', () => ({ arvyIsOpen: () => false, onArvyChange: () => () => undefined, setArvyOpen: vi.fn() }));
const { replyTo, say, usRows } = await import('./us');

const E = (id: string) => EMOJI.find(e => e.id === id)!;
const HIDDEN = /[\u{E0000}-\u{E007F}]/u;
const folder = '11111111-2222-3333-4444-555555555555';
const KEY = '2026-11-11T19:30:00.000Z~abc123';
const apples: ChatMsg = { id: 'abc123', at: '2026-11-11T19:30:00.000Z', by: 'vijay', name: 'Vijay', text: 'should I get apples?\nor pears' };
beforeEach(() => invoke.mockReset());

describe('the quote of a message', () => {
  it('words: the first line, and nothing after it', () => {
    expect(quoteOf(apples)).toEqual({ text: 'should I get apples?' });
    expect(quoteOf({ text: '\n\n  second   line first  \nthird' })).toEqual({ text: 'second line first' });
    expect(quoteOf({ text: 'x'.repeat(500) }).text).toBe(`${'x'.repeat(MAX_QUOTE)}…`);
    expect(quoteWords(quoteOf(apples))).toBe('should I get apples?');
  });
  it('emoji only: the emoji themselves, still ours to draw, and an ordinary emoji where a drawing can’t go', () => {
    const t = `${emojiText(E('santa'))} ${emojiText(E('tree'))}`;
    expect(partsOf(quoteOf({ text: t }).text!)).toEqual([E('santa'), ' ', E('tree')]);
    expect(quoteWords(quoteOf({ text: t }))).toBe('🎅️ 🎄️');
    expect(HIDDEN.test(quoteWords(quoteOf({ text: t })))).toBe(false);
  });
  it('a photo or a video with no words says what it was; with words, the words', () => {
    expect(quoteOf({ media: [{ kind: 'image', path: 'p' }] })).toEqual({ media: 'image' });
    expect(quoteOf({ media: [{ kind: 'image', path: 'p' }, { kind: 'video', path: 'q' }] })).toEqual({ media: 'video' });
    expect(quoteWords({ media: 'image' })).toBe('Photo');
    expect(quoteWords({ media: 'video' })).toBe('Video');
    expect(quoteOf({ text: 'look at him', media: [{ kind: 'image', path: 'p' }] })).toEqual({ text: 'look at him', media: 'image' });
  });
  it('is never cut through one of our emoji: no half an invisible name is left behind', () => {
    const s = emojiText(E('hearteye'));
    for (let n = 1; n <= [...s].length + 2; n++) {
      const cut = clip(`ab${s}cd`, n);
      const whole = partsOf(cut).filter(p => typeof p !== 'string').length;
      expect(HIDDEN.test(cut) ? whole : 1, `cut at ${n}`).toBe(1);   // either the whole emoji is there, or none of its invisible name
      expect(HIDDEN.test(plainEmoji(cut)), `cut at ${n}`).toBe(false);
    }
    expect(clip('short', 10)).toBe('short');
    expect(clip('a longer line', 8)).toBe('a longer…');
  });
  it('plain: our emoji lose their invisible names, a flag keeps its own', () => {
    expect(plainEmoji(`on my way ${emojiText(E('brr'))}!`)).toBe('on my way 🥶️!');
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(plainEmoji(`${england} won ${emojiText(E('cheers'))}`)).toBe(`${england} won ${E('cheers').emoji}\uFE0F`);
    expect(plainEmoji('\u{E0061}\u{E007F}stray')).toBe('stray');
  });
});

describe('a reply, as the server keeps it', () => {
  it('good: the key and a short copy get through the check, and the quote is then taken from the original', () => {
    const clean = cleanMessage({ text: 'yes get two', reply: { key: KEY, name: 'Vijay', text: 'should I get apples?' } }, folder)!;
    expect(clean).toEqual({ text: 'yes get two', media: [], reply: { key: KEY, text: 'should I get apples?' } });
    expect(replyFrom(clean.reply, apples)).toEqual({ key: KEY, name: 'Vijay', text: 'should I get apples?' });
    // a photo with no words
    expect(replyFrom({ key: KEY }, { ...apples, text: undefined, media: [{ kind: 'video', path: 'p' }] })).toEqual({ key: KEY, name: 'Vijay', media: 'video' });
  });
  it('missing, or not a message’s key: an ordinary message with no quote', () => {
    expect(cleanMessage({ text: 'hello' }, folder)).toEqual({ text: 'hello', media: [] });
    for (const reply of [null, 'x', {}, { key: 42 }, { key: 'abc' }, { key: '../../etc' }, { key: `${KEY}; drop` }, { key: '2026-11-11T19:30:00.000Z~local-ab12' }, { key: 'x'.repeat(5000) }]) {
      expect(cleanMessage({ text: 'hello', reply }, folder), JSON.stringify(reply).slice(0, 40)).toEqual({ text: 'hello', media: [] });
    }
    expect([isKey(KEY), isKey('2026-11-11T19:30:00.000Z~n1x2y'), isKey('2026-11-11~abc123'), isKey(undefined)]).toEqual([true, true, false, false]);
    expect(cleanMessage({ reply: { key: KEY, text: 'only a quote' } }, folder)).toBeNull();   // a reply with nothing said is nothing to send
  });
  it('too long: the copy is cut to a line, and odd characters are taken out', () => {
    const r = cleanMessage({ text: 'ok', reply: { key: KEY, text: `a\u0000b\n${'x'.repeat(5000)}`, media: 'gif' } }, folder)!.reply!;
    expect([...r.text!].length).toBe(MAX_QUOTE + 1);   // and the …
    expect(r.text!.startsWith('a b x')).toBe(true);
    expect(r.media).toBeUndefined();
    expect(cleanMessage({ text: 'ok', reply: { key: KEY, media: 'video' } }, folder)!.reply).toEqual({ key: KEY, media: 'video' });
  });
  it('a made-up name is never kept: who wrote it comes from the original, and so does what it said', () => {
    const clean = cleanMessage({ text: 'told you', reply: { key: KEY, name: 'Rosh', by: 'rosh', text: 'I owe you a hundred' } }, folder)!;
    expect(clean.reply).toEqual({ key: KEY, text: 'I owe you a hundred' });
    expect('name' in clean.reply!).toBe(false);
    expect(replyFrom(clean.reply, apples)).toEqual({ key: KEY, name: 'Vijay', text: 'should I get apples?' });
    // the original couldn't be looked up just now: the checked copy stays, with no name on it
    expect(replyFrom(clean.reply, undefined)).toEqual({ key: KEY, text: 'I owe you a hundred' });
  });
  it('a reply to a key outside the household: nothing is found there, so there is no quote at all', () => {
    const clean = cleanMessage({ text: 'hmm', reply: { key: '2026-01-01T00:00:00.000Z~zzzzzz', text: 'someone else’s words' } }, folder)!;
    expect(clean.reply?.key).toBe('2026-01-01T00:00:00.000Z~zzzzzz');   // it looks like a key…
    expect(replyFrom(clean.reply, null)).toBeUndefined();               // …but this household's chat has nothing under it
    expect(replyFrom(undefined, apples)).toBeUndefined();
  });
});

describe('a reply in a notification', () => {
  const reply = { key: KEY, name: 'Vijay', text: 'should I get apples?' };
  it('says what it answers, then the answer', () => {
    expect(pushLine({ text: 'yes get two', reply })).toBe('Replied to “should I get apples?”: yes get two');
    expect(pushLine({ text: 'so cute', reply: { key: KEY, media: 'image' } })).toBe('Replied to a photo: so cute');
    expect(pushLine({ text: 'ha', reply: { key: KEY, media: 'video' } })).toBe('Replied to a video: ha');
    expect(pushLine({ media: [{ kind: 'image', path: 'p' }], reply })).toBe('Replied to “should I get apples?” with a photo');
    expect(pushLine({ text: 'ok', reply: { key: KEY } })).toBe('Replied to a message: ok');
  });
  it('keeps a long quote short so the answer still fits, and shows our emoji as ordinary ones in the quote', () => {
    const line = pushLine({ text: 'y'.repeat(300), reply: { key: KEY, text: `${'q'.repeat(100)}` } });
    expect(line.startsWith(`Replied to “${'q'.repeat(40)}…”: yyy`)).toBe(true);
    expect([...line].length).toBeLessThanOrEqual(160);
    expect(pushLine({ text: 'me too', reply: { key: KEY, text: `love it ${emojiText(E('hearteye'))}` } })).toBe('Replied to “love it 😍️”: me too');
  });
  it('a message that isn’t a reply reads as it always did', () => {
    expect(pushLine({ text: 'can you get apples?' })).toBe('can you get apples?');
    expect(pushLine({ media: [{ kind: 'video', path: 'p' }] })).toBe('Sent a video');
  });
});

describe('what Arvy reads', () => {
  const yes: ChatMsg = { id: 'def456', at: '2026-11-11T19:40:00.000Z', by: 'rosh', name: 'Rosh', text: 'yes get two', reply: { key: KEY, name: 'Vijay', text: 'should I get apples?' } };
  it('a reply comes with what it answers, so “yes get two” under “should I get apples?” makes sense', () => {
    const t = readText([], yes, null);
    expect(t).toContain('The newest message, from Rosh:');
    expect(t).toContain('It is a reply to Vijay’s earlier message “should I get apples?”');
    expect(t.endsWith('yes get two')).toBe(true);
    expect(readSystem({ today: '2026-11-11', weekday: 'Wednesday', now: '2:30 PM', members: [{ username: 'vijay', name: 'Vijay' }], writer: 'Rosh' })).toMatch(/marked as a reply to an earlier one, read the two together/);
    // the original is far back (not among the few before it): the copy in the reply is all Arvy needs
    expect(readText([{ ...apples, text: 'something else' }], yes, null)).toContain('“should I get apples?”');
  });
  it('earlier replies say what they answered too; one with no words says what was sent', () => {
    expect(arvyLine(yes)).toBe('Rosh (replying to Vijay’s “should I get apples?”): yes get two');
    expect(arvyLine({ name: 'Rosh', text: 'aww', reply: { key: KEY, name: 'Vijay', media: 'image' } })).toBe('Rosh (replying to Vijay’s photo): aww');
    expect(arvyLine({ name: 'Rosh', text: 'aww', reply: { key: KEY, media: 'video' } })).toBe('Rosh (replying to a video): aww');
    expect(arvyLine({ name: 'Vijay', media: [{ kind: 'image', path: 'p' }] })).toBe('Vijay: (sent a photo)');
    const t = readText([apples, yes], { id: 'x', at: 'now', by: 'vijay', name: 'Vijay', text: 'ok', arvy: { state: 'reading' } }, 'photos');
    expect(t).toContain('Earlier in the chat:\nVijay: should I get apples?\nor pears\nRosh (replying to Vijay’s “should I get apples?”): yes get two');
    expect(t.endsWith('With it: the photos they sent.')).toBe(true);
  });
  it('is never handed the invisible names of our emoji: it gets the ordinary emoji', () => {
    const t = readText([{ ...apples, text: `tree up ${emojiText(E('tree'))}` }], { ...yes, text: `yes ${emojiText(E('santa'))}`, reply: { key: KEY, name: 'Vijay', text: `tree up ${emojiText(E('tree'))}` } }, null);
    expect(HIDDEN.test(t)).toBe(false);
    expect(t).toContain('tree up 🎄️');
    expect(t).toContain('yes 🎅️');
  });
});

describe('sending a reply from the phone', () => {
  const row = { key: KEY, msg: apples };
  it('the quote shows the moment it’s sent; the server is told where the original is, and never a name', async () => {
    let during: unknown;
    invoke.mockImplementationOnce(async () => { during = usRows()[usRows().length - 1]; return { key: '2026-11-11T19:41:00.000Z~m9', msg: { id: 'm9', at: '2026-11-11T19:41:00.000Z', by: 'vijay', name: 'Vijay', text: 'yes get two', reply: { key: KEY, name: 'Vijay', text: 'should I get apples?' } } }; });
    await say('yes get two', [], row);
    expect(during).toMatchObject({ sending: true, msg: { text: 'yes get two', reply: { key: KEY, name: 'Vijay', text: 'should I get apples?' } } });
    expect(invoke).toHaveBeenCalledWith({ action: 'say', text: 'yes get two', media: [], looks: [], reply: { key: KEY, text: 'should I get apples?' }, turn: true }, 'planner-chat');
    expect(usRows().find(r => r.msg.id === 'm9')?.msg.reply).toEqual({ key: KEY, name: 'Vijay', text: 'should I get apples?' });
  });
  it('a server that doesn’t know replies yet saves the message without the quote, and that is what shows', async () => {
    invoke.mockResolvedValueOnce({ key: '2026-11-11T19:42:00.000Z~m10', msg: { id: 'm10', at: '2026-11-11T19:42:00.000Z', by: 'vijay', name: 'Vijay', text: 'two' } });
    await say('two', [], row);
    expect(usRows().find(r => r.msg.id === 'm10')?.msg.reply).toBeUndefined();
  });
  it('a message still on its way can’t be replied to; without one, nothing about a reply is sent', async () => {
    expect(replyTo({ key: '2026-11-11T19:43:00.000Z~local-ab12cd3', sending: true, msg: apples })).toBeNull();
    expect(replyTo(row)).toEqual({ key: KEY, name: 'Vijay', text: 'should I get apples?' });
    invoke.mockResolvedValueOnce({ key: '2026-11-11T19:44:00.000Z~m11', msg: { id: 'm11', at: '2026-11-11T19:44:00.000Z', by: 'vijay', name: 'Vijay', text: 'plain' } });
    await say('plain');
    expect(invoke).toHaveBeenCalledWith({ action: 'say', text: 'plain', media: [], looks: [], turn: true }, 'planner-chat');
    expect(Object.keys(invoke.mock.calls[0][0])).not.toContain('reply');
  });
});
