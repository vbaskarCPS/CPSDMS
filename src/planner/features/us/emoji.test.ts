// The chat's emoji packs (emoji.tsx): what each pack holds, how one of ours is written into a message and read back
// out, when a message is drawn big, and what a backspace does to one while a message is being written.
import { describe, expect, it } from 'vitest';
import { cleanMessage, pushLine } from '../../../../supabase/functions/planner-chat/chat';
import { EMOJI, bigEmoji, bigSize, caretOutside, emojiText, hasOurs, healDraft, packOf, partsOf, putIn } from './emoji';
import { upcoming } from './occasions';
import { SMILEYS } from './smileys';
import { STICKERS, bare } from './stickers';

const E = (id: string) => EMOJI.find(e => e.id === id)!;
const ids = (text: string) => partsOf(text).map(p => (typeof p === 'string' ? p : `<${p.id}>`));
const OCCASIONS = ['halloween', 'diwali', 'christmas', 'newyear', 'valentine', 'easter', 'birthday'] as const;

describe('the packs', () => {
  it('every occasion has five or six smileys and its three things, smileys first', () => {
    for (const o of OCCASIONS) {
      const pack = packOf(o), faces = pack.filter(e => e.smiley);
      expect(faces.length, o).toBeGreaterThanOrEqual(5);
      expect(faces.length, o).toBeLessThanOrEqual(6);
      expect(pack.length - faces.length, o).toBe(3);
      expect(pack.slice(0, faces.length).every(e => e.smiley), o).toBe(true);
    }
    expect(EMOJI).toHaveLength(SMILEYS.length + STICKERS.length);
    expect(upcoming('2026-11-11').every(o => packOf(o.id).length >= 8)).toBe(true);
  });
  it('each has its own short name to travel under, and one ordinary emoji it stands for', () => {
    expect(new Set(EMOJI.map(e => e.id)).size).toBe(EMOJI.length);
    for (const e of EMOJI) {
      expect(e.id, e.id).toMatch(/^[a-z0-9]{2,10}$/);
      expect([...bare(e.emoji)], e.id).toHaveLength(1);   // one character, so it can carry the hidden name
      expect(e.name.trim(), e.id).not.toBe('');
    }
    expect(SMILEYS.every(e => e.id.length <= 8)).toBe(true);   // short, so a few of them fit a notification
    expect(new Set(EMOJI.map(e => `${bare(e.emoji)}|${e.id}`)).size).toBe(EMOJI.length);
  });
  it('the 21 drawings from before are still there, under the same names', () => {
    expect(STICKERS.map(s => s.id)).toEqual(['pumpkin', 'ghost', 'bat', 'diya', 'fireworks', 'rangoli', 'tree', 'gift', 'snowflake', 'sparkler', 'cheers', 'popper', 'heart', 'loveletter', 'twohearts', 'egg', 'bunny', 'tulip', 'cake', 'balloon', 'cupcake']);
    expect(packOf('christmas').map(e => e.id)).toEqual(['santa', 'elf', 'deer', 'snowman', 'brr', 'angel', 'tree', 'gift', 'snowflake']);
  });
});

describe('one of ours in a message', () => {
  it('is its look-alike with an invisible name: every one comes back out as itself', () => {
    for (const e of EMOJI) {
      const t = emojiText(e);
      expect(t.startsWith(bare(e.emoji)), e.id).toBe(true);
      expect(partsOf(t), e.id).toEqual([e]);
      expect(partsOf(`a ${t} b`), e.id).toEqual(['a ', e, ' b']);
      expect(/\p{L}{2,}/u.test(t), e.id).toBe(false);          // no words in it: Arvy doesn't read an emoji-only message
      expect(t.replace(/[\u{E0000}-\u{E007F}]/gu, ''), e.id).toBe(`${bare(e.emoji)}️`);   // what a phone that doesn't know ours shows
    }
  });
  it('a message splits into its words and its emoji, in order', () => {
    const t = `Tree up ${emojiText(E('santa'))}${emojiText(E('tree'))} see you at 6 ${emojiText(E('hearteye'))}`;
    expect(ids(t)).toEqual(['Tree up ', '<santa>', '<tree>', ' see you at 6 ', '<hearteye>']);
    expect(hasOurs(t)).toBe(true);
  });
  it('plain words, ordinary emoji and flags are left exactly as they are', () => {
    for (const t of ['see you at 6', 'yes!! 🎄🎁', '❤️', '🎅', 'England 🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} won', '']) {
      expect(partsOf(t)).toEqual(t ? [t] : []);
      expect(hasOurs(t)).toBe(false);
    }
  });
  it('a name it doesn’t know, or a name on the wrong emoji, is not one of ours', () => {
    const unknown = emojiText(E('santa')).replace(/[\u{E0020}-\u{E007E}]+/u, m => m.slice(0, 2));   // a shorter, unknown name
    expect(partsOf(unknown)).toEqual([unknown]);
    const wrong = `x${emojiText(E('santa')).slice(bare(E('santa').emoji).length)}`;
    expect(partsOf(wrong)).toEqual([wrong]);
  });
  it('gets through the server’s clean-up whole, and a notification shows the ordinary emoji', () => {
    const t = `on my way ${emojiText(E('brr'))}`;
    expect(cleanMessage({ text: t }, 'h')?.text).toBe(t);
    expect(pushLine({ text: t }).replace(/[\u{E0000}-\u{E007F}]/gu, '')).toBe('on my way 🥶️');
    // six of the longest-named smileys alone still fit the line a notification shows
    const six = Array.from({ length: 6 }, () => emojiText(E('hearteye'))).join('');
    expect(pushLine({ text: six })).toBe(six);
  });
});

describe('drawn big', () => {
  it('a message that is only ours: one is biggest, two or three smaller, four to six smaller again', () => {
    expect([1, 2, 3, 4, 5, 6].map(bigSize)).toEqual([112, 72, 72, 48, 48, 48]);
    const s = emojiText(E('santa')), t = emojiText(E('tree'));
    expect(bigEmoji(s)).toEqual({ list: [E('santa')], size: 112 });
    expect(bigEmoji(`${s} ${t}`)).toEqual({ list: [E('santa'), E('tree')], size: 72 });
    expect(bigEmoji(` ${s}${t}${s}\n`)?.size).toBe(72);
    expect(bigEmoji(s.repeat(4))?.size).toBe(48);
    expect(bigEmoji(s.repeat(6))?.list).toHaveLength(6);
  });
  it('more than six, or any words with them, is an ordinary message', () => {
    const s = emojiText(E('santa'));
    expect(bigEmoji(s.repeat(7))).toBeNull();
    expect(bigEmoji(`${s} ok`)).toBeNull();
    expect(bigEmoji(`${s}😀`)).toBeNull();
    expect(bigEmoji('see you at 6')).toBeNull();
    expect(bigEmoji('')).toBeNull();
    expect(bigEmoji(undefined)).toBeNull();
  });
  it('one ordinary emoji we have a drawing of, typed on any keyboard, still becomes ours', () => {
    expect(bigEmoji('🎄')).toEqual({ list: [E('tree')], size: 112 });
    expect(bigEmoji('❤️')?.list[0].id).toBe('heart');
    expect(bigEmoji('🎅')).toBeNull();     // the look-alike of a smiley on its own is just that emoji
    expect(bigEmoji('🎄🎁')).toBeNull();
    expect(bigEmoji('😀')).toBeNull();
  });
});

describe('while a message is being written', () => {
  const s = emojiText(E('santa'));
  it('a tap puts it in where the caret is, and the caret moves past it', () => {
    expect(putIn('', E('santa'))).toEqual({ text: s, caret: s.length });
    expect(putIn('hi  there', E('santa'), 3)).toEqual({ text: `hi ${s} there`, caret: 3 + s.length });
    const two = putIn(s, E('tree'), s.length);
    expect(ids(two.text)).toEqual(['<santa>', '<tree>']);
  });
  it('a caret inside one of ours (its name is invisible) is moved to just after it', () => {
    expect(caretOutside(`a${s}b`, 4)).toBe(1 + s.length);
    expect(caretOutside(`a${s}b`, 1)).toBe(1);
    expect(caretOutside(`a${s}b`, 1 + s.length)).toBe(1 + s.length);
    expect(ids(putIn(`a${s}b`, E('tree'), 5).text)).toEqual(['a', '<santa>', '<tree>', 'b']);
  });
  it('one backspace takes the whole emoji, not just its invisible end', () => {
    const cut = (t: string) => t.slice(0, -2);   // a backspace: the last invisible character goes (two units long)
    expect(healDraft(cut(`on my way ${s}`))).toEqual({ text: 'on my way ', caret: 10 });
    expect(healDraft(cut(`${s}${s}`))).toEqual({ text: s, caret: s.length });
    // in the middle of a message, with the caret where the backspace left it
    const mid = `a${cut(s)}b`;
    expect(healDraft(mid, mid.length - 1)).toEqual({ text: 'ab', caret: 1 });
    // a keyboard that takes half a character at a time
    expect(healDraft(`ok ${s}`.slice(0, -1))).toEqual({ text: 'ok ', caret: 3 });
  });
  it('whole emoji, words, ordinary emoji and flags are not touched', () => {
    for (const t of ['', 'hello', `hi ${s} there`, 'yes 🎄🎁 ❤️', 'England 🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', '👨‍👩‍👦 home']) {
      expect(healDraft(t, 2)).toEqual({ text: t, caret: Math.min(2, t.length) });
    }
  });
});
