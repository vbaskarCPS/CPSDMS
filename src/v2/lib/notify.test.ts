import { describe, expect, it } from 'vitest';
import { clock, grouped, type NotifyEvent } from './notify';

const ev = (key: string, group: string, group_label: string): NotifyEvent =>
  ({ key, group, group_label, label: key, help: null, scopes: ['team', 'center'], on: true, scope: 'team', minutes: null });

describe('notification settings', () => {
  it('keeps the groups in the order the database gives them', () => {
    const g = grouped([ev('rm.a', 'rm', 'Route managing'), ev('rm.b', 'rm', 'Route managing'), ev('wb.a', 'wb', 'Workerbook'), ev('all.mail', 'all', 'Everyone')]);
    expect(g.map(x => x.label)).toEqual(['Route managing', 'Workerbook', 'Everyone']);
    expect(g[0].events.map(e => e.key)).toEqual(['rm.a', 'rm.b']);
  });
  it('reads a 24-hour time the way people say it', () => {
    expect(clock('21:00')).toBe('9:00 pm');
    expect(clock('07:30')).toBe('7:30 am');
    expect(clock('00:15')).toBe('12:15 am');
    expect(clock('12:00')).toBe('12:00 pm');
    expect(clock('junk')).toBe('junk');
  });
});
