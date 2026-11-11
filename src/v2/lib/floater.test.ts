import { describe, expect, it } from 'vitest';
import { floaterLegacyId, rmCenterFor, routeRuns } from './floater';
import { visibleComponents } from '../app/nav';
import type { Permission } from './permissions';

describe('floater route manager', () => {
  it('a route manager’s own map is their account’s center; a super admin’s is the center they are on', () => {
    const bc = { id: 'bc' };
    expect(rmCenterFor({ is_super_admin: false, rm_center_id: 'on' }, bc)).toBe('on');          // a manager works one center
    expect(rmCenterFor({ is_super_admin: true, rm_center_id: 'demo' }, bc)).toBe('bc');         // not the demo one left on the account
    expect(rmCenterFor({ is_super_admin: true, rm_center_id: 'demo' }, null)).toBe('demo');     // no center picked yet
    expect(rmCenterFor({ is_super_admin: false, rm_center_id: null }, bc)).toBe('bc');
    expect(rmCenterFor(null, null)).toBeNull();
  });
  it('shows route codes as short runs', () => {
    expect(routeRuns(['GA03', 'GA01', 'GA02', 'BR07', 'GA05'])).toBe('BR07, GA01–03, GA05');
    expect(routeRuns(['OR09', 'OR10', 'OR11'])).toBe('OR09–11');
    expect(routeRuns(['X', 'GA1', 'GA2'])).toBe('GA1–2, X');
    expect(routeRuns([])).toBe('');
  });
  it('signs in on the old map under its own id, never a real manager’s', () => {
    expect(floaterLegacyId('baski')).toBe('floater_baski');
    expect(floaterLegacyId('baski').startsWith('rm_')).toBe(false);
  });
  it('a Floater Route Manager sees Route Manager in the menu, with the Floater view', () => {
    const only = (ps: Permission[]) => (p: Permission) => ps.includes(p);
    const rm = visibleComponents(only(['rm_floater'])).find(c => c.key === 'rm');
    expect(rm?.subs.map(s => s.key)).toContain('floater');
    expect(visibleComponents(only(['workerbook'])).some(c => c.key === 'rm')).toBe(false);
  });
});
