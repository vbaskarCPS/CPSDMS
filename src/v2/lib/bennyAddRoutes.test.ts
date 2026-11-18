import { describe, expect, it } from 'vitest';
import { addRoutesCard, addedRoutesSaid, routeSpan, type AddRoutesCheck } from './bennyAddRoutes';
import { toolCall } from '../../../supabase/functions/benny-assist/tools';

const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const check: AddRoutesCheck = { ok: true, date: '2026-11-18', stamp: 't', manager: { id: 'rm_jovanchung', name: 'Jovan Chung' },
  maps: [{ map: 'SOUTHWEST SURREY #2', total: 26, new: 23 }],
  new: nums(34, 56).map(n => ({ code: `SWS${n}`, area: 'SOUTHWEST SURREY #2', number: n })),
  mine: ['SWS57'], other: [{ code: 'SWS58', manager: 'Franklyn Mitchell' }, { code: 'SWS59', manager: 'Franklyn Mitchell' }], open_prebooks: 2 };

describe('add routes to the live day', () => {
  it('says the map, the count and the run of routes before the tap', () => {
    const c = addRoutesCard(check);
    expect(c.title).toBe('Add 23 routes to Jovan’s live map');
    expect(c.lines[0]).toBe('SOUTHWEST SURREY #2: 23 new routes (SWS34–SWS56) of 26');
    expect(c.lines).toContain('Already on Jovan’s map: SWS57');
    expect(c.lines).toContain('Left off, another manager has them: SWS58–SWS59 (Franklyn Mitchell)');
    expect(c.lines).toContain('2 open prebooks come with them');
    expect(c.lines).toContain('Mid-day, routes can only be added, not taken off again.');
    expect(c.action).toBe('Add the routes');
    expect(addRoutesCard({ ...check, manager: { ...check.manager, me: true } }).title).toBe('Add 23 routes to your live map');
    expect(addedRoutesSaid(check, 23)).toContain('Added 23 routes to Jovan Chung’s live map (SOUTHWEST SURREY #2)');
  });
  it('spans', () => {
    expect(routeSpan(['SWS40'])).toBe('SWS40');
    expect(routeSpan(['A1', 'A3'])).toBe('A1, A3');
    expect(routeSpan(['A1', 'A3', 'A5', 'A7', 'A9', 'A11', 'A13'])).toBe('A1, A3, A5, A7, A9 and 2 more');
  });
  it('the tool asks the database with "me" by default', () => {
    const t = toolCall('propose_add_routes', { maps: ['Southwest Surrey 2'] }, { center_id: 'c1' });
    expect(t).toMatchObject({ fn: 'benny_check_add_routes', args: { p_center: 'c1', p_manager: 'me', p_maps: ['Southwest Surrey 2'], p_routes: [] }, card: { kind: 'add_routes' } });
  });
});
describe('who gets the tool', () => {
  it('Workerbook only', async () => {
    const { toolsFor } = await import('../../../supabase/functions/benny-assist/tools');
    expect(toolsFor('admin').map(t => t.name)).toContain('propose_add_routes');
    expect(toolsFor('rm').map(t => t.name)).not.toContain('propose_add_routes');
  });
});
