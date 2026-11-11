import { describe, expect, it } from 'vitest';
import { removeCard, removedSaid, rosterLine, type RemoveWorker } from './bennyRemove';

const kev: RemoveWorker = { cn: 'I1479', name: 'Kevontae Ragguette', manager: 'rm_franklynmitchell', manager_name: 'Franklyn Mitchell', cart_id: 's4', routes: ['NSR42'], frees: ['NSR42'],
  roster: { id: 'r1', now: 'showed', then: 'not marked' } };
const kenan: RemoveWorker = { cn: 'I1012', name: 'Kenan Francis-Bull', manager: 'rm_franklynmitchell', manager_name: 'Franklyn Mitchell', cart_id: 's7', roster: { id: 'r2', now: 'showed', then: 'not marked' } };

describe('taking a worker off today: the card', () => {
  it('says who comes off, what they leave behind, what the list will say, and that it can’t be undone here', () => {
    expect(removeCard({ workers: [kev, kenan] })).toEqual({ title: 'Take 2 workers off today', action: 'Remove from today', lines: [
      'Kevontae Ragguette (I1479), Franklyn Mitchell’s team: NSR42 goes back to free',
      'Kenan Francis-Bull (I1012), Franklyn Mitchell’s team: no route',
      'Today’s list will no longer have them marked as showed.',
      'Nothing is logged for any of them today. Their logsheets for today are erased, and this can’t be undone from here: if they turn up, add them again from the day page (Late arrival).'] });
    const one = removeCard({ workers: [kenan] });
    expect(one.title).toBe('Take Kenan Francis-Bull off today');
    expect(one.lines[one.lines.length - 1]).toBe('Nothing is logged for them today. Their logsheet for today is erased, and this can’t be undone from here: if they turn up, add them again from the day page (Late arrival).');
  });
  it('a shared cart, several routes and prebooks are spelled out', () => {
    const w: RemoveWorker = { cn: 'I1', name: 'Ann Lee', mates: ['Bo Ray', 'Cy Dunn'], routes: ['A1', 'A2', 'A3'], frees: ['A2', 'A3'], prebooks: 3 };
    expect(removeCard({ workers: [w] }).lines[0]).toBe('Ann Lee (I1): leaves Bo Ray and Cy Dunn on the cart; A2 and A3 go back to free (3 prebooks stay on them)');
    expect(removeCard({ workers: [{ ...w, frees: ['A2'], prebooks: 1 }] }).lines[0]).toBe('Ann Lee (I1): leaves Bo Ray and Cy Dunn on the cart; A2 goes back to free (1 prebook stays on it)');
    // routes they share with the cart stay with it: nothing goes back to free, and that isn't "no route"
    expect(removeCard({ workers: [{ ...w, frees: undefined, prebooks: undefined }] }).lines[0]).toBe('Ann Lee (I1): leaves Bo Ray and Cy Dunn on the cart');
  });
  it('today’s list: a no-show in the city, the showed mark taken off on a road trip, nothing said when nothing changes', () => {
    expect(rosterLine([kev])).toBe('Today’s list will no longer have them marked as showed.');
    expect(rosterLine([{ roster: { id: 'r', now: 'showed', then: 'no_show' } }])).toBe('Today’s list will have them as a no-show.');
    expect(rosterLine([{ roster: { id: 'r', now: 'not marked', then: 'not marked' } }, {}])).toBeNull();   // not marked already, and one not on the list
    expect(rosterLine([kev, { roster: { id: 'r', now: 'not marked', then: 'not marked' } }, {}])).toBe('Today’s list will no longer have 1 of them marked as showed.');
  });
  it('afterwards it says only what the database found: who is off, which routes are free, what the list says', () => {
    expect(removedSaid({ workers: [kev, kenan] }, { state: 'done', workers: [{ cn: 'I1479', name: 'Kevontae Ragguette', state: 'done', roster: 'not marked' }, { cn: 'I1012', name: 'Kenan Francis-Bull', state: 'done', roster: 'not marked' }] }))
      .toBe('Kevontae Ragguette and Kenan Francis-Bull are off today’s map. NSR42 is free again. Today’s list no longer has them marked as showed.');
    expect(removedSaid({ workers: [kenan] }, { state: 'done', workers: [{ cn: 'I1012', name: 'Kenan Francis-Bull', state: 'done', roster: 'no_show' }] }))
      .toBe('Kenan Francis-Bull is off today’s map. Today’s list has Kenan as a no-show.');
    // one of two came off: the other's route is not called free
    expect(removedSaid({ workers: [kev, kenan] }, { state: 'partly', workers: [{ cn: 'I1479', name: 'Kevontae Ragguette', state: 'not_removed' }, { cn: 'I1012', name: 'Kenan Francis-Bull', state: 'done' }] }))
      .toBe('Kenan Francis-Bull is off today’s map.');
  });
});
