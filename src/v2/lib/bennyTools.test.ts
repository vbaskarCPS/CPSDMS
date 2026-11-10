// The Benny's tools (supabase/functions/benny-assist/tools.ts): who gets which, and that each one goes somewhere.
import { describe, it, expect } from 'vitest';
import { TOOLS, system, toolCall, toolsFor } from '../../../supabase/functions/benny-assist/tools';

const ctx = { center_id: 'c1', center_name: 'BC Fall RJ', today: '2026-11-10', rm_manager: 'rm_x' };

describe('the Benny’s tools', () => {
  it('every tool calls a database function or files a bug', () => {
    for (const t of TOOLS) {
      const call = toolCall(t.name, {}, ctx);
      expect(call, t.name).not.toBeNull();
      if (call && 'fn' in call) { expect(call.fn).toMatch(/^benny_/); expect(call.args.p_center).toBe('c1'); }
    }
    expect(toolCall('nope', {}, ctx)).toBeNull();
  });
  it('route managers get their team’s tools, not the office’s', () => {
    const rm = toolsFor('rm').map(t => t.name);
    expect(rm).toEqual(expect.arrayContaining(['live_team', 'connected_routes', 'propose_give_route', 'propose_partner', 'propose_solo', 'report_bug', 'show_map']));
    for (const no of ['find_people', 'day', 'maps', 'propose_start_day']) expect(rm).not.toContain(no);
    expect(toolsFor('admin').map(t => t.name)).toEqual(TOOLS.map(t => t.name));
    expect(toolsFor('rm')[0]).not.toHaveProperty('roles');   // only what the model's API accepts is sent
  });
  it('changes become cards; lookups don’t', () => {
    const kinds = TOOLS.map(t => { const c = toolCall(t.name, {}, ctx); return c && 'fn' in c && c.card ? c.card.kind : null; }).filter(Boolean);
    expect(kinds.sort()).toEqual(['give_route', 'partner', 'solo', 'start_day']);
    const start = toolCall('propose_start_day', { assign: [], team_mode: 'whatever' }, ctx);
    expect(start && 'fn' in start && start.card?.team_mode).toBe('roster');
    expect(toolCall('propose_start_day', {}, ctx)).toMatchObject({ args: { p_date: '2026-11-10' } });
  });
  it('“my team” on the RM map is the map that’s open', () => {
    expect(toolCall('live_team', {}, ctx)).toMatchObject({ args: { p_manager: 'rm_x' } });
    expect(toolCall('live_team', { manager: 'rm_y' }, ctx)).toMatchObject({ args: { p_manager: 'rm_y' } });
    expect(system({ ...ctx, screen: 'rm' }, 'rm')).toContain('route manager map');
    expect(system(ctx, 'rm')).not.toContain('starting the day,');
    expect(system(ctx, 'admin')).toContain('starting the day,');
  });
});
