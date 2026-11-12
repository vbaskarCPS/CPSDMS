// The app's side of a connected mailbox (mail.ts): what it asks the planner-mail function, which address Connect
// may open, which mailbox is meant, and what the address it comes back to says. Made-up people and addresses.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
let demo = false;
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../lib/app', () => ({ isDemo: () => demo, appId: () => 'roshplanner' }));
const { ago, cameBack, connectFinish, connectStart, disconnect, inbox, mailboxes, MailProblem, pickMailbox, readMail, sendMail, setWatch, signInAddressOk } = await import('./mail');
const { finishReturn, forgetReturn, readReturn, returnWaiting, WAIT_MS } = await import('./finish');

const BOX = { id: 'mb-1', provider: 'google', address: 'rosh.test@example.com', since: '2026-11-11T19:00:00.000Z', todos: true, checkedAt: null, problem: null, canSend: true, needsSignIn: false };
const WORK = { ...BOX, id: 'mb-2', address: 'rosh@studio.example' }, OLD = { ...BOX, id: 'mb-3', address: 'rosh.old@example.com' };
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=made-up&state=abc';
beforeEach(() => { invoke.mockReset(); demo = false; forgetReturn(); });

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

describe('coming back from Google’s page without a code', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('reads why nothing was connected', () => {
    // the one sentence the callback sends this way (supabase/functions/planner-mail/handle.ts)
    const words = 'The sign-in at Google wasn’t finished, so nothing was connected.';
    expect(cameBack(new URLSearchParams({ problem: words }))).toEqual({ problem: words });
    expect(cameBack(q(''))).toEqual({});
    expect(cameBack(q('other=1'))).toEqual({});
  });
  it('shows nothing that somebody could have written into the address to mislead, and never takes a mailbox from it', () => {
    const plain = { problem: 'The mailbox wasn’t connected. Try again.' };
    for (const crafted of ['problem=Your+account+is+locked.+Sign+in+at+evil.example+now', 'problem=Go+to+https://evil.example', 'problem=<b>hi</b>', 'problem=call+me+at+x@evil.example', `problem=${'a'.repeat(300)}`,
      'problem=Visit+www+dot+evil', 'problem='])
      expect(cameBack(q(crafted)), crafted).toEqual(plain);
    // "connected" is only ever what the server answered to the finish: an address can't claim it
    expect(cameBack(q('connected=someone%40example.com'))).toEqual({});
  });
});

describe('finishing: what Google’s page handed back', () => {
  const STATE = 'pZ3k_9-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', CODE = '4/0AbC-d_e.F';
  const T = Date.parse('2026-11-11T19:00:00Z');
  /** The browser as it lands: an address, and a history whose last entry can be rewritten. */
  const landed = (pathname: string, hash: string, search = '') => {
    const hist = { state: { key: 'k1' }, replaceState: vi.fn((_s: unknown, _t: string, _url?: string | URL | null) => undefined) };
    return { loc: { pathname, search, hash }, hist };
  };
  const hashOf = (code = CODE, state = STATE) => `#${new URLSearchParams({ mail_code: code, mail_state: state }).toString()}`;
  const OK = { ok: true, connected: 'rosh.test@example.com', mailboxes: [BOX] };

  it('both are taken out of the address bar straight away, keeping the path, and held in memory only', () => {
    const { loc, hist } = landed('/roshplanner/settings/mail', hashOf());
    expect(returnWaiting(T)).toBe(false);
    readReturn(loc, hist, T);
    expect(hist.replaceState.mock.calls).toEqual([[{ key: 'k1' }, '', '/roshplanner/settings/mail']]);   // nothing after the path
    expect(returnWaiting(T)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();   // reading the address sends nothing
    // with a trailing slash, or something else in the query, the path and the query stay as they were
    const b = landed('/vijayplanner/settings/mail/', hashOf(), '?x=1');
    readReturn(b.loc, b.hist, T);
    expect(b.hist.replaceState.mock.calls[0][2]).toBe('/vijayplanner/settings/mail/?x=1');
  });
  it('the planner hands them to the server once, and gets the mailbox and the list back', async () => {
    const { loc, hist } = landed('/roshplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);
    invoke.mockResolvedValue(OK);
    expect(await finishReturn(T + 2000)).toEqual({ connected: 'rosh.test@example.com', mailboxes: [BOX] });
    expect(invoke.mock.calls).toEqual([[{ action: 'connect_finish', code: CODE, state: STATE }, 'planner-mail']]);
    expect(returnWaiting(T + 3000)).toBe(false);
    expect(finishReturn(T + 3000)).toBeNull();   // nothing left to finish
  });
  it('a screen drawn twice (or left and come back to) still makes one call, and both get the answer', async () => {
    const { loc, hist } = landed('/roshplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);
    let answer: (v: unknown) => void = () => undefined;
    invoke.mockReturnValue(new Promise(r => { answer = r; }));
    const first = finishReturn(T), second = finishReturn(T), third = finishReturn(T + 500);   // the effect run twice, then a re-mount
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(returnWaiting(T + 500)).toBe(true);   // "Finishing…" while it's on its way
    answer(OK);
    expect(await Promise.all([first, second, third])).toEqual(Array(3).fill({ connected: 'rosh.test@example.com', mailboxes: [BOX] }));
    expect(invoke).toHaveBeenCalledTimes(1);
    // Back and Forward bring the same page with a clean address: there is nothing to hand over again
    readReturn({ pathname: '/roshplanner/settings/mail', search: '', hash: '' }, hist, T + 9000);
    expect(finishReturn(T + 9000)).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('the planner’s sign-in screen first: they wait in memory, and the finish happens once the person is in', async () => {
    const { loc, hist } = landed('/roshplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);                                  // the planner loads, signed out: the router goes to /login
    expect(hist.replaceState).toHaveBeenCalledTimes(1);        // …but the code was already out of the address
    expect(invoke).not.toHaveBeenCalled();                     // and nothing is sent while nobody is signed in
    expect(returnWaiting(T + 3 * 60_000)).toBe(true);
    invoke.mockResolvedValue(OK);                              // three minutes later they've signed in, and Settings › Email opens
    expect(await finishReturn(T + 3 * 60_000)).toMatchObject({ connected: 'rosh.test@example.com' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('…but not after ten minutes: by then the sign-in is no good, so nothing is sent and the code is forgotten', async () => {
    const { loc, hist } = landed('/roshplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);
    expect(WAIT_MS).toBe(10 * 60_000);
    expect(returnWaiting(T + WAIT_MS + 1)).toBe(false);
    expect(await finishReturn(T + WAIT_MS + 1)).toEqual({ problem: 'That sign-in took too long. Tap Connect Gmail again.' });
    expect(invoke).not.toHaveBeenCalled();
    expect(finishReturn(T)).toBeNull();
  });
  it('the wrong person signed in there sees the server’s plain refusal, and nothing is connected', async () => {
    const { loc, hist } = landed('/vijayplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);
    const refusal = 'This sign-in was started from a different planner. Open Settings › Email in your own planner and tap Connect Gmail.';
    invoke.mockResolvedValue({ problem: refusal, code: 'someone_else' });
    expect(await finishReturn(T)).toEqual({ problem: refusal });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(finishReturn(T)).toBeNull();   // not tried again
  });
  it('the server not being reached says so; the code is gone either way', async () => {
    const { loc, hist } = landed('/vijayplanner/settings/mail', hashOf());
    readReturn(loc, hist, T);
    invoke.mockRejectedValue(new Error('Failed to send a request to the Edge Function'));
    expect(await finishReturn(T)).toEqual({ problem: 'The planner couldn’t be reached to finish connecting. Check the connection and tap Connect Gmail again.' });
    expect(finishReturn(T)).toBeNull();
  });
  it('only on Settings › Email, and only a code and a state that look like ones', async () => {
    // somewhere else in the planner: not ours to touch
    const other = landed('/vijayplanner/food', hashOf());
    readReturn(other.loc, other.hist, T);
    expect(other.hist.replaceState).not.toHaveBeenCalled();
    expect(returnWaiting(T)).toBe(false);
    // an ordinary address, or another kind of #
    for (const hash of ['', '#top', '#code=x&state=y']) { const o = landed('/vijayplanner/settings/mail', hash); readReturn(o.loc, o.hist, T); expect(o.hist.replaceState).not.toHaveBeenCalled(); }
    // pieces that aren't a code and a state: taken out of the address all the same, and nothing is sent
    for (const hash of [hashOf(CODE, 'short'), hashOf('', STATE), hashOf('has a space', STATE), hashOf('x'.repeat(1025), STATE), '#mail_code=abc', `#mail_state=${STATE}`]) {
      const bad = landed('/vijayplanner/settings/mail', hash);
      readReturn(bad.loc, bad.hist, T);
      expect(bad.hist.replaceState).toHaveBeenCalledTimes(1);
      expect(returnWaiting(T), hash).toBe(false);
      expect(finishReturn(T)).toBeNull();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it('the server’s answer is tidied like the list is, and an answer that names no mailbox is not a connection', async () => {
    invoke.mockResolvedValue({ ok: true, connected: 'rosh.test@example.com', mailboxes: [BOX, null, { id: 7 }, { ...WORK, token_enc: 'never sent, dropped if it were' }] });
    const r = await connectFinish(CODE, STATE);
    expect(r).toEqual({ connected: 'rosh.test@example.com', mailboxes: [BOX, WORK] });
    invoke.mockResolvedValue({ ok: true });
    await expect(connectFinish(CODE, STATE)).rejects.toThrow('The mailbox wasn’t connected. Tap Connect Gmail again.');
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
