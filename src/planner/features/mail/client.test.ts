// The app's side of a connected mailbox (mail.ts): what it asks the planner-mail function, which address Connect
// may open, which mailbox is meant, and what the address it comes back to says. Made-up people and addresses.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
let demo = false;
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../lib/app', () => ({ isDemo: () => demo, appId: () => 'roshplanner' }));
const { ago, cameBack, connectStart, disconnect, inbox, mailboxes, MailProblem, pickMailbox, readMail, sendMail, setWatch, signInAddressOk } = await import('./mail');

const BOX = { id: 'mb-1', provider: 'google', address: 'rosh.test@example.com', since: '2026-11-11T19:00:00.000Z', todos: true, checkedAt: null, problem: null, canSend: true, needsSignIn: false };
const WORK = { ...BOX, id: 'mb-2', address: 'rosh@studio.example' }, OLD = { ...BOX, id: 'mb-3', address: 'rosh.old@example.com' };
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=made-up&state=abc';
beforeEach(() => { invoke.mockReset(); demo = false; });

describe('what the app asks about mailboxes', () => {
  it('every call goes to the planner-mail function', async () => {
    invoke.mockResolvedValue({ mailboxes: [BOX], ready: true, ok: true, revoked: true, mails: [], mail: { id: 'aaaaaa1' } });
    await mailboxes(); await setWatch('mb-1', false); await disconnect('mb-1'); await inbox('mb-1', { search: 'dentist', unread: true, max: 8 }); await readMail('mb-1', 'aaaaaa1');
    await sendMail({ mailbox: 'mb-1', to: ['a@example.com'], subject: 's', body: 'b', replyTo: 'aaaaaa1' });
    expect(invoke.mock.calls.map(c => c[1])).toEqual(Array(6).fill('planner-mail'));
    expect(invoke.mock.calls.map(c => c[0])).toEqual([{ action: 'list' }, { action: 'watch', mailbox: 'mb-1', on: false }, { action: 'disconnect', mailbox: 'mb-1' },
      { action: 'inbox', mailbox: 'mb-1', search: 'dentist', unread: true, max: 8 }, { action: 'read', mailbox: 'mb-1', id: 'aaaaaa1' },
      { action: 'send', mailbox: 'mb-1', to: ['a@example.com'], subject: 's', body: 'b', reply_to: 'aaaaaa1' }]);
  });
  it('the list is what the server says, tidied: a row that isn’t a mailbox is left out', async () => {
    invoke.mockResolvedValue({ mailboxes: [BOX, null, { id: 7 }, { id: 'x' }, { ...WORK, problem: 'The sign-in for this mailbox has run out. Connect it again.', needsSignIn: true, token_enc: 'never sent, but dropped if it were' }], ready: false });
    const r = await mailboxes();
    expect(r.ready).toBe(false);
    expect(r.mailboxes).toEqual([BOX, { ...WORK, problem: 'The sign-in for this mailbox has run out. Connect it again.', needsSignIn: true }]);
    expect(JSON.stringify(r)).not.toContain('token_enc');
    invoke.mockResolvedValue({});
    expect(await mailboxes()).toEqual({ mailboxes: [], ready: true });
  });
  it('something a mailbox can’t do right now comes back in plain words, not as a fault', async () => {
    invoke.mockResolvedValue({ problem: 'The sign-in for this mailbox has run out. Connect it again.', code: 'expired' });
    const e = await inbox('mb-1').catch(x => x);
    expect(e).toBeInstanceOf(MailProblem);
    expect([e.message, e.code]).toEqual(['The sign-in for this mailbox has run out. Connect it again.', 'expired']);
    await expect(sendMail({ mailbox: 'mb-1', to: ['a@example.com'], subject: 's', body: 'b' })).rejects.toBeInstanceOf(MailProblem);
    invoke.mockRejectedValue(new Error('Something went wrong'));
    await expect(inbox('mb-1')).rejects.not.toBeInstanceOf(MailProblem);
  });
  it('an opened email is cut to size and keeps only the names of attachments', async () => {
    invoke.mockResolvedValue({ mail: { id: 'aaaaaa1', from: 'A <a@example.com>', to: 'me@example.com', subject: 'S', when: '2026-11-11T19:00:00.000Z', text: 'x'.repeat(9000), cut: true, attachments: ['form.pdf', 5, null], answerTo: 'a@example.com', thread: 't' } });
    const m = await readMail('mb-1', 'aaaaaa1');
    expect(m.text).toHaveLength(8000);
    expect(m).toMatchObject({ cut: true, attachments: ['form.pdf'], answerTo: 'a@example.com' });
    expect(m).not.toHaveProperty('thread');
    invoke.mockResolvedValue({});
    await expect(readMail('mb-1', 'aaaaaa1')).rejects.toThrow('That email couldn’t be opened.');
  });
});

describe('Connect', () => {
  it('asks for the sign-in page for this planner, and opens only Google’s own', async () => {
    invoke.mockResolvedValue({ url: GOOGLE });
    expect(await connectStart()).toBe(GOOGLE);
    expect(invoke).toHaveBeenCalledWith({ action: 'connect_start', provider: 'google', app: 'roshplanner' }, 'planner-mail');
    for (const bad of ['https://accounts.google.com.evil.example/o/oauth2/v2/auth?x=1', 'http://accounts.google.com/o/oauth2/v2/auth?x=1', 'https://evil.example/?next=https://accounts.google.com/o/oauth2/v2/auth?x=1',
      'javascript:alert(1)', 'https://accounts.google.com/signin?x=1', 'https://accounts.google.com/o/oauth2/v2/auth', ' https://accounts.google.com/o/oauth2/v2/auth?x=1', '', null, 42, { url: GOOGLE }]) {
      expect(signInAddressOk(bad), String(bad)).toBe(false);
      invoke.mockResolvedValue({ url: bad });
      await expect(connectStart()).rejects.toThrow('The sign-in page couldn’t be opened. Try again.');
    }
    expect(signInAddressOk(GOOGLE)).toBe(true);
  });
  it('“Email isn’t set up yet” is passed on as it is', async () => {
    invoke.mockResolvedValue({ problem: 'Email isn’t set up yet.', code: 'not_set_up' });
    await expect(connectStart()).rejects.toThrow('Email isn’t set up yet.');
  });
});

describe('which mailbox is meant', () => {
  it('the only one when none is named; all of them when there are several', () => {
    expect(pickMailbox([BOX] as never, undefined)).toEqual(BOX);
    expect(pickMailbox([BOX, WORK] as never, '')).toEqual([BOX, WORK]);
    expect(pickMailbox([], undefined)).toBeNull();
  });
  it('by its address, or a word from it', () => {
    const all = [BOX, WORK, OLD] as never;
    expect(pickMailbox(all, 'Rosh@Studio.example')).toEqual(WORK);
    expect(pickMailbox(all, ' <rosh@studio.example> ')).toEqual(WORK);
    expect(pickMailbox(all, 'studio')).toEqual(WORK);
    expect(pickMailbox(all, 'my studio email')).toEqual(WORK);
    expect(pickMailbox(all, 'the old one')).toEqual(OLD);
    expect(pickMailbox(all, 'example.com')).toEqual([BOX, OLD]);   // fits two: asked which
    expect(pickMailbox(all, 'hotmail')).toBeNull();
    expect(pickMailbox(all, 'the mailbox')).toBeNull();            // names none
  });
});

describe('coming back from Google’s page', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('reads which mailbox was connected, or why not', () => {
    expect(cameBack(q('connected=Rosh.Test%40Example.com'))).toEqual({ connected: 'rosh.test@example.com' });
    expect(cameBack(q('problem=The+sign-in+at+Google+wasn%E2%80%99t+finished%2C+so+nothing+was+connected.'))).toEqual({ problem: 'The sign-in at Google wasn’t finished, so nothing was connected.' });
    expect(cameBack(q('problem=That%E2%80%99s+as+many+mailboxes+as+one+planner+takes+%286%29.+Disconnect+one+first.'))).toEqual({ problem: 'That’s as many mailboxes as one planner takes (6). Disconnect one first.' });
    expect(cameBack(q(''))).toEqual({});
    expect(cameBack(q('other=1'))).toEqual({});
  });
  it('every problem the server can send back is shown as it was written', () => {
    // the sentences the callback sends (supabase/functions/planner-mail/handle.ts)
    for (const words of ['That sign-in took too long. Tap Connect Gmail again.', 'Email isn’t set up yet.', 'The sign-in at Google wasn’t finished, so nothing was connected.',
      'Google didn’t let the planner stay connected. Tap Connect Gmail again.', 'The planner wasn’t allowed to read this mailbox. Tap Connect Gmail again and tick both boxes on Google’s page.',
      'That’s as many mailboxes as one planner takes (6). Disconnect one first.', 'Google didn’t answer. Tap Connect Gmail again in a minute.', 'Google didn’t finish the sign-in. Tap Connect Gmail again.'])
      expect(cameBack(new URLSearchParams({ problem: words }))).toEqual({ problem: words });
  });
  it('shows nothing that somebody could have written into the address to mislead', () => {
    const plain = { problem: 'The mailbox wasn’t connected. Try again.' };
    for (const crafted of ['problem=Your+account+is+locked.+Sign+in+at+evil.example+now', 'problem=Go+to+https://evil.example', 'problem=<b>hi</b>', 'problem=call+me+at+x@evil.example', `problem=${'a'.repeat(300)}`,
      'connected=<script>', 'connected=not+an+address', 'connected=a@b', 'problem=Visit+www+dot+evil'])
      expect(cameBack(q(crafted)), crafted).toEqual(plain);
  });
});

describe('how long ago', () => {
  const now = Date.parse('2026-11-11T19:00:00Z');
  it('says it in a few words', () => {
    expect(ago('2026-11-11T18:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-11T18:48:00Z', now)).toBe('12 minutes ago');
    expect(ago('2026-11-11T18:00:00Z', now)).toBe('1 hour ago');
    expect(ago('2026-11-11T07:00:00Z', now)).toBe('12 hours ago');
    expect(ago('2026-11-08T12:00:00Z', now)).toMatch(/^on Nov\.? 8$/);
    expect(ago(null, now)).toBe('');
    expect(ago('nonsense', now)).toBe('');
  });
});

describe('the demo', () => {
  it('has one pretend mailbox, sends nothing anywhere, and can’t connect one', async () => {
    demo = true;
    const { mailboxes: list } = await mailboxes();
    expect(list.map(m => m.address)).toEqual(['you@example.com']);
    expect((await inbox('demo')).mails.length).toBeGreaterThan(0);
    expect((await readMail('demo', 'demo-dentist-1')).answerTo).toBe('office@mapleleafdental.example');
    await sendMail({ mailbox: 'demo', to: ['office@mapleleafdental.example'], subject: 's', body: 'b' });
    await expect(connectStart()).rejects.toThrow(/isn’t part of the demo/);
    await setWatch('demo', false);
    expect((await mailboxes()).mailboxes[0].todos).toBe(false);
    await disconnect('demo');
    expect((await mailboxes()).mailboxes).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
