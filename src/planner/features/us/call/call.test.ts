// Video calls between the two of them: the plain rules (call.ts). Whose phone rings, what a phone in a call does next,
// what happens when both call at once, which calls were missed, which docs are thrown away, and the words.
import { describe, expect, it } from 'vitest';
import { CALL_KIND, CALL_TEXT, KEEP_MS, TIMES, answerKey, callKey, cameraProblem, clock, doneKeys, earlier, endWords, isRinging, missedFor, newCallId, nextStep, oldKeys, pairsFrom, pollEvery, ringingFor, timesFrom,
  type AnswerDoc, type CallDoc, type Ended, type Mine, type Pair } from './call';

const T0 = Date.parse('2026-11-11T15:00:00.000Z');
const at = (secs: number) => new Date(T0 + secs * 1000).toISOString();
/** Vijay calls Rosh at T0 (or `secs` after it). */
const call = (id = 'c1', secs = 0, more: Partial<CallDoc> = {}): CallDoc => ({ id, from: 'vijay', to: 'rosh', at: at(secs), offer: 'v=0 offer', ...more });
const answered = (c: CallDoc, secs: number, more: Partial<AnswerDoc> = {}): AnswerDoc => ({ id: c.id, by: c.to, at: at(secs), state: 'answered', answer: 'v=0 answer', ...more });
const declined = (c: CallDoc, secs: number): AnswerDoc => ({ id: c.id, by: c.to, at: at(secs), state: 'declined' });
const ended = (secs: number, why: Ended['why'], talked?: number): Ended => ({ at: at(secs), why, ...(talked ? { secs: talked } : {}) });
const docs = (...list: (CallDoc | AnswerDoc)[]) => list.map(d => ('from' in d ? { key: callKey(d), data: d } : { key: `${[...list].find((c): c is CallDoc => 'from' in c && c.id === d.id)!.at}~${d.id}~answer`, data: d }));
const pairs = (...list: (CallDoc | AnswerDoc)[]): Pair[] => pairsFrom(docs(...list));
const now = (secs: number) => T0 + secs * 1000;
const calling = (c: CallDoc): Mine => ({ role: 'caller', phase: 'calling', id: c.id, at: c.at });

describe('the two docs of a call', () => {
  it('each phone writes its own: the caller call/<started>~<id>, the one called the same with ~answer', () => {
    const c = call('ab12cd34');
    expect(CALL_KIND).toBe('call');
    expect(callKey(c)).toBe('2026-11-11T15:00:00.000Z~ab12cd34');
    expect(answerKey(c)).toBe('2026-11-11T15:00:00.000Z~ab12cd34~answer');
    expect(answerKey(c).length).toBeLessThan(120);   // the longest key the database takes
    expect(newCallId()).toMatch(/^[a-z0-9]{4,8}$/);
    expect(newCallId()).not.toBe(newCallId());
  });
  it('read back as calls with their answers, oldest first', () => {
    const a = call('a', 0), b = call('b', 30, { from: 'rosh', to: 'vijay' });
    const got = pairsFrom([...docs(b, a, answered(a, 5))].reverse());
    expect(got.map(p => [p.call.id, p.answer?.state])).toEqual([['a', 'answered'], ['b', undefined]]);
  });
  it('anything that is not a call is left out: junk, a call to oneself, a key that does not match, an answer from the wrong person', () => {
    const c = call();
    const got = pairsFrom([
      { key: 'junk', data: 'hello' }, { key: 'null', data: null }, { key: callKey(c), data: c },
      { key: '2026-11-11T15:00:01.000Z~x', data: { id: 'x', from: 'vijay', to: 'vijay', at: at(1) } },
      { key: 'wrong-key', data: call('y', 2) },
      { key: '2026-11-11T15:00:03.000Z~z', data: { id: 'z', from: 'vijay', to: 'rosh', at: 'not a time' } },
      { key: answerKey(c), data: { id: c.id, by: 'vijay', at: at(4), state: 'answered', answer: 'x' } },   // the caller can't answer their own call
      { key: '2026-11-11T14:00:00.000Z~gone~answer', data: declined(call('gone', -3600), -3590) },             // an answer with no call
    ]);
    expect(got).toEqual([{ call: c }]);
  });
});

describe('whose phone rings', () => {
  it('Vijay calls: Rosh’s phone shows the banner, his own does not', () => {
    const c = call();
    expect(ringingFor(pairs(c), 'rosh', now(3))).toEqual(c);
    expect(ringingFor(pairs(c), 'vijay', now(3))).toBeNull();
  });
  it('it rings for a minute, on every phone of hers that has the planner open', () => {
    const p = pairs(call());
    expect([0, 1, 30, 59.9].map(s => !!ringingFor(p, 'rosh', now(s)))).toEqual([true, true, true, true]);
    expect([60, 61, 600].map(s => !!ringingFor(p, 'rosh', now(s)))).toEqual([false, false, false]);
  });
  it('answered (on this phone or her other one), declined or hung up: the banner goes', () => {
    const c = call();
    expect(ringingFor(pairs(c, answered(c, 8)), 'rosh', now(9))).toBeNull();
    expect(ringingFor(pairs(c, declined(c, 8)), 'rosh', now(9))).toBeNull();
    expect(ringingFor(pairs(call('c1', 0, { offer: undefined, ended: ended(8, 'cancelled') })), 'rosh', now(9))).toBeNull();
  });
  it('a stale call is ignored: one left ringing by a phone that died never rings again, however often the planner is opened', () => {
    const stale = call('old', -3600);
    expect(isRinging({ call: stale }, now(0))).toBe(false);
    expect(ringingFor(pairs(stale), 'rosh', now(0))).toBeNull();
    // …and a fresh one after it does ring
    const fresh = call('new', -5);
    expect(ringingFor(pairs(stale, fresh), 'rosh', now(0))).toEqual(fresh);
  });
  it('a phone whose clock runs a little behind still rings (a call that seems to start in the future is new, not stale)', () => {
    expect(ringingFor(pairs(call('c1', 20)), 'rosh', now(0))).not.toBeNull();
  });
  it('called twice in a row (his first try was lost): the newer call is the one to answer', () => {
    expect(ringingFor(pairs(call('first', 0), call('again', 20)), 'rosh', now(25))?.id).toBe('again');
  });
});

describe('what the caller’s phone does next', () => {
  it('ringing: it waits', () => {
    const c = call();
    expect(nextStep(calling(c), pairs(c), 'vijay', now(10))).toEqual({ do: 'wait' });
    expect(nextStep(calling(c), [], 'vijay', now(10))).toEqual({ do: 'wait' });   // its own doc isn't back from the server yet
  });
  it('answered: it connects with her connection details', () => {
    const c = call();
    expect(nextStep(calling(c), pairs(c, answered(c, 12)), 'vijay', now(13))).toEqual({ do: 'connect', answer: 'v=0 answer' });
  });
  it('declined: the call ends, and says she declined', () => {
    const c = call();
    expect(nextStep(calling(c), pairs(c, declined(c, 6)), 'vijay', now(7))).toEqual({ do: 'end', why: 'declined', by: 'them' });
    expect(endWords('declined', 'them', 'Rosh')).toEqual({ title: 'Rosh declined the call' });
  });
  it('timed out: no answer after a minute (and a moment’s grace for an Answer tapped on the last ring)', () => {
    const c = call();
    expect(nextStep(calling(c), pairs(c), 'vijay', now(59))).toEqual({ do: 'wait' });
    expect(nextStep(calling(c), pairs(c), 'vijay', now(62))).toEqual({ do: 'wait' });
    expect(nextStep(calling(c), pairs(c), 'vijay', now(64))).toEqual({ do: 'end', why: 'noanswer', by: 'me' });
    expect(nextStep(calling(c), [], 'vijay', now(70))).toEqual({ do: 'end', why: 'noanswer', by: 'me' });   // offline all along: it still gives up
    expect(endWords('noanswer', 'me', 'Rosh')).toEqual({ title: 'Rosh didn’t answer' });
    // an answer that got in during the grace still connects
    expect(nextStep(calling(c), pairs(c, answered(c, 61)), 'vijay', now(64))).toMatchObject({ do: 'connect' });
  });
  it('she answered and then her phone gave up before his had looked: it ends the way hers did', () => {
    const c = call();
    expect(nextStep(calling(c), pairs(c, answered(c, 5, { answer: undefined, ended: ended(30, 'failed') })), 'vijay', now(31))).toEqual({ do: 'end', why: 'failed', by: 'them' });
  });
  it('answered, but the two phones never reach each other: “couldn’t connect”, with the Wi-Fi hint', () => {
    const c = call(), p = pairs(c, answered(c, 5));
    const mine: Mine = { role: 'caller', phase: 'connecting', id: c.id, at: c.at, connectingAt: now(6) };
    expect(nextStep(mine, p, 'vijay', now(20))).toEqual({ do: 'wait' });
    expect(nextStep(mine, p, 'vijay', now(31))).toEqual({ do: 'end', why: 'failed', by: 'me' });
    const words = endWords('failed', 'me', 'Rosh');
    expect(words?.title).toBe('Couldn’t connect');
    expect(words?.more).toMatch(/mobile data/);
    expect(words?.more).toMatch(/Wi-Fi/);
  });
});

describe('ended by either side', () => {
  const c = call();
  it('she hangs up: his phone ends the call too', () => {
    const p = pairs(c, answered(c, 5, { answer: undefined, ended: ended(200, 'hangup', 190) }));
    expect(nextStep({ role: 'caller', phase: 'live', id: c.id, at: c.at }, p, 'vijay', now(201))).toEqual({ do: 'end', why: 'hangup', by: 'them' });
  });
  it('he hangs up: her phone ends the call too', () => {
    const p = pairs({ ...c, offer: undefined, ended: ended(200, 'hangup', 190) }, answered(c, 5));
    expect(nextStep({ role: 'callee', phase: 'live', id: c.id, at: c.at }, p, 'rosh', now(201))).toEqual({ do: 'end', why: 'hangup', by: 'them' });
    expect(nextStep({ role: 'callee', phase: 'connecting', id: c.id, at: c.at, connectingAt: now(190) }, p, 'rosh', now(201))).toEqual({ do: 'end', why: 'hangup', by: 'them' });
  });
  it('he takes the call back while her phone is still getting the camera ready: hers stops, and says he hung up', () => {
    const p = pairs({ ...c, offer: undefined, ended: ended(9, 'cancelled') });
    expect(nextStep({ role: 'callee', phase: 'answering', id: c.id, at: c.at }, p, 'rosh', now(10))).toEqual({ do: 'end', why: 'cancelled', by: 'them' });
    expect(endWords('cancelled', 'them', 'Vijay')).toEqual({ title: 'Vijay hung up' });
    expect(endWords('cancelled', 'me', 'Rosh')).toBeNull();   // his own screen just closes
  });
  it('while both are still talking, nothing ends it', () => {
    const p = pairs(c, answered(c, 5));
    expect(nextStep({ role: 'caller', phase: 'live', id: c.id, at: c.at }, p, 'vijay', now(4000))).toEqual({ do: 'wait' });
    expect(nextStep({ role: 'callee', phase: 'live', id: c.id, at: c.at }, p, 'rosh', now(4000))).toEqual({ do: 'wait' });
  });
  it('the words afterwards: an ordinary ending shows how long they talked', () => {
    expect(endWords('hangup', 'me', 'Rosh', 252)).toEqual({ title: 'Call ended', more: '4:12' });
    expect(endWords('hangup', 'them', 'Rosh')).toEqual({ title: 'Call ended' });
    expect(endWords('dropped', 'me', 'Rosh')?.title).toBe('The call dropped');
    expect(endWords('noanswer', 'them', 'Vijay')?.title).toBe('Too late');
    expect([clock(7), clock(252), clock(3723), clock(-3)]).toEqual(['0:07', '4:12', '1:02:03', '0:00']);
  });
});

describe('both tap Call at the same moment', () => {
  const his = call('his', 0), hers = call('hers', 1, { from: 'rosh', to: 'vijay' });
  it('the earlier call wins: his phone keeps ringing hers and pays her later call no mind', () => {
    expect(nextStep(calling(his), pairs(his, hers), 'vijay', now(2))).toEqual({ do: 'wait' });
  });
  it('the later caller’s phone drops its own call and answers the earlier one', () => {
    expect(nextStep(calling(hers), pairs(his, hers), 'rosh', now(2))).toEqual({ do: 'yield', to: his });
  });
  it('started in the very same millisecond: the ids decide, and both phones agree on who gives way', () => {
    const a = call('aaa', 0), b = call('bbb', 0, { from: 'rosh', to: 'vijay' });
    expect([earlier(a, b), earlier(b, a)]).toEqual([true, false]);
    expect(nextStep(calling(a), pairs(a, b), 'vijay', now(1))).toEqual({ do: 'wait' });
    expect(nextStep(calling(b), pairs(a, b), 'rosh', now(1))).toEqual({ do: 'yield', to: a });
  });
  it('once hers has given way, his goes on as any call: her answer connects it, and her dropped call is not a missed one', () => {
    const dropped: CallDoc = { ...hers, offer: undefined, ended: ended(2, 'crossed') };
    const p = pairs(his, dropped, answered(his, 3));
    expect(nextStep(calling(his), p, 'vijay', now(4))).toMatchObject({ do: 'connect' });
    expect(ringingFor(p, 'vijay', now(4))).toBeNull();
    expect(missedFor(p, 'vijay', '', now(300))).toBeNull();
    expect(endWords('crossed', 'me', 'Vijay')).toBeNull();
  });
  it('a call of hers from long ago doesn’t make his new one give way', () => {
    expect(nextStep(calling(his), pairs(call('old', -500, { from: 'rosh', to: 'vijay' }), his), 'vijay', now(2))).toEqual({ do: 'wait' });
  });
});

describe('a missed call', () => {
  it('rang out with nobody there: missed, once it has stopped ringing', () => {
    const c = call();
    expect(missedFor(pairs(c), 'rosh', '', now(30))).toBeNull();   // still ringing: that's the banner's job
    expect(missedFor(pairs(c), 'rosh', '', now(90))).toEqual({ from: 'vijay', at: c.at, count: 1 });
    expect(missedFor(pairs({ ...c, offer: undefined, ended: ended(20, 'cancelled') }), 'rosh', '', now(21))).toEqual({ from: 'vijay', at: c.at, count: 1 });
    expect(missedFor(pairs(c), 'vijay', '', now(90))).toBeNull();   // not for the one who called
  });
  it('answered or declined is not missed', () => {
    const c = call();
    expect(missedFor(pairs(c, answered(c, 5, { ended: ended(50, 'hangup', 40) })), 'rosh', '', now(90))).toBeNull();
    expect(missedFor(pairs(c, declined(c, 5)), 'rosh', '', now(90))).toBeNull();
  });
  it('several are counted, and once she has been told (OK, called back, or talked since) they are not shown again', () => {
    const a = call('a', 0), b = call('b', 300), p = pairs(a, b);
    expect(missedFor(p, 'rosh', '', now(900))).toEqual({ from: 'vijay', at: b.at, count: 2 });
    expect(missedFor(p, 'rosh', a.at, now(900))).toEqual({ from: 'vijay', at: b.at, count: 1 });
    expect(missedFor(p, 'rosh', at(600), now(900))).toBeNull();
  });
});

describe('clean-up', () => {
  const late = (secs: number) => now(secs) + TIMES.tidyMs;
  it('a call that is over goes two minutes later, both docs: by then the other phone has seen how it ended', () => {
    const c = call(), p = pairs({ ...c, offer: undefined, ended: ended(100, 'hangup', 90) }, answered(c, 5, { answer: undefined, ended: ended(101, 'hangup', 90) }));
    expect(doneKeys(p, 'vijay', '', now(150))).toEqual([]);
    expect(doneKeys(p, 'vijay', '', late(102))).toEqual([callKey(c), answerKey(c)]);
    expect(doneKeys(p, 'rosh', null, late(102))).toEqual([callKey(c), answerKey(c)]);   // whichever phone gets there first
  });
  it('declined, and a call that gave way to the other one’s, go the same way', () => {
    const c = call(), d = call('d', 1, { from: 'rosh', to: 'vijay', offer: undefined, ended: ended(2, 'crossed') });
    expect(doneKeys(pairs(c, declined(c, 6)), 'vijay', '', late(7))).toEqual([callKey(c), answerKey(c)]);
    expect(doneKeys(pairs(d), 'vijay', '', late(3))).toEqual([callKey(d)]);
  });
  it('a call still going is never thrown away, however long it lasts', () => {
    const c = call();
    expect(doneKeys(pairs(c, answered(c, 5)), 'vijay', '', now(5 * 3600))).toEqual([]);
    expect(doneKeys(pairs(c), 'vijay', '', now(30))).toEqual([]);
  });
  it('a missed call is kept until the one who missed it has been told, then it goes', () => {
    const c = call(), p = pairs({ ...c, offer: undefined, ended: ended(64, 'noanswer') });
    expect(doneKeys(p, 'vijay', '', late(65))).toEqual([]);          // his phone can't know she has seen it
    expect(doneKeys(p, 'rosh', '', late(65))).toEqual([]);           // she hasn't
    expect(doneKeys(p, 'rosh', null, late(65))).toEqual([]);         // her phone doesn't know yet what she has seen
    expect(doneKeys(p, 'rosh', at(500), late(65))).toEqual([callKey(c)]);
    // the same for one left ringing by a phone that died
    expect(doneKeys(pairs(c), 'rosh', at(500), late(65))).toEqual([callKey(c)]);
  });
  it('anything older than a day goes, whatever state it was left in', () => {
    const fresh = call('new', 0), stuck = call('stuck', -90_000);
    const list = [
      { key: callKey(fresh), updated_at: fresh.at }, { key: callKey(stuck), updated_at: stuck.at }, { key: answerKey(stuck), updated_at: stuck.at },
      { key: 'no-date-in-the-key', updated_at: at(-100_000) }, { key: 'no-date-at-all' },
    ];
    expect(KEEP_MS).toBe(24 * 3600 * 1000);
    expect(oldKeys(list, now(60))).toEqual([callKey(stuck), answerKey(stuck), 'no-date-in-the-key']);
  });
});

describe('the waits', () => {
  it('a minute of ringing, 25 seconds to connect, and looking about once a second only while a call is being set up', () => {
    expect(TIMES).toMatchObject({ ringMs: 60_000, connectMs: 25_000, tidyMs: 120_000 });
    expect((['starting', 'calling', 'answering', 'connecting'] as const).map(p => pollEvery(p, false))).toEqual([1000, 1000, 1000, 1000]);
    expect(pollEvery('idle', true)).toBe(1000);    // this phone is ringing
    expect([pollEvery('live', false), pollEvery('idle', false), pollEvery('over', false)]).toEqual([3000, 4000, 4000]);
  });
  it('a test can shorten them through a setting; anything that isn’t a sensible number is left as it was', () => {
    expect(timesFrom(null)).toEqual(TIMES);
    expect(timesFrom('{"ringMs":3000,"graceMs":500}')).toEqual({ ...TIMES, ringMs: 3000, graceMs: 500 });
    expect(timesFrom('{"ringMs":"soon","connectMs":-5,"lostMs":1e12,"other":1}')).toEqual(TIMES);
    expect(timesFrom('not json')).toEqual(TIMES);
    expect(timesFrom('[1,2]')).toEqual(TIMES);
  });
});

describe('words', () => {
  it('the chat message a call leaves', () => { expect(CALL_TEXT).toBe('📞 Video call'); });
  it('the phone refuses the camera or the microphone: said plainly, with what to do', () => {
    expect(cameraProblem('NotAllowedError')).toMatch(/blocked.*Allow them/);
    expect(cameraProblem('NotFoundError')).toMatch(/can’t find a camera/);
    expect(cameraProblem('NotReadableError')).toMatch(/Something else is using the camera/);
    expect(cameraProblem('NoCalls')).toMatch(/browser can’t make video calls/);
    expect(cameraProblem(undefined)).toMatch(/didn’t start/);
    for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'NoCalls', 'Other']) expect(cameraProblem(n)).not.toMatch(/permission|getUserMedia|WebRTC|config/i);
  });
});
