// What Claude is asked to write for a follow-up step; how card titles become roles; map categories to kinds.
import { describe, expect, it } from 'vitest';
import { followupAsk } from './FollowupEmails';
import { kindFromCategory, roleFromTitle } from '../../lib/msField';

describe('follow-ups', () => {
  it('asks Claude for the right step, to the right person', () => {
    const a = followupAsk({ day: 4, step: 2, steps: 3, purpose: 'A short check-in.', contact_name: 'Linh Tran' });
    expect(a).toContain('Follow-up email 2 of 3, 4 days after my first visit, to Linh Tran.');
    expect(a).toContain('A short check-in.');
    expect(followupAsk({ day: 1, step: 1, steps: 3, purpose: 'Thanks.', contact_name: null })).toContain('1 day after my first visit.');
  });
});

describe('at the door', () => {
  it('turns a card title into a role', () => {
    expect(roleFromTitle('Owner & Head Chef')).toBe('Owner');
    expect(roleFromTitle('Office Manager')).toBe('Manager');
    expect(roleFromTitle('CPA, Controller')).toBe('Bookkeeper');
    expect(roleFromTitle('Sales Associate')).toBe('Other');
    expect(roleFromTitle(null)).toBe('');
  });
  it('guesses the kind of business from map data', () => {
    expect(kindFromCategory('restaurant, vietnamese')).toBe('restaurant');
    expect(kindFromCategory('dentist')).toBe('clinic');
    expect(kindFromCategory('hair salon')).toBe('salon');
    expect(kindFromCategory('')).toBeNull();
  });
});
