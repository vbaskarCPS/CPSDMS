// Ramp crews (the asphalt crews) are a sealing thing: other services' team boards show carts only.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamBoard } from './TeamBoard';

const noop = () => {};
const board = (ramps?: boolean) => renderToStaticMarkup(
  <TeamBoard people={[]} members={{}} managers={[{ id: 'm1', full_name: 'Jo Lee', username: 'jo', phone: null }]}
    teams={[{ name: '1', kind: 'cart', managerId: 'm1' }]}
    onAssign={noop} onNewTeam={noop} onRamp={noop} onManager={noop} onRemove={noop} ramps={ramps} />);

describe('team board ramp crews', () => {
  it('sealing (default) offers ramp crews', () => {
    const html = board();
    expect(html).toContain('New ramp crew');
    expect(html).toContain('Ramp crew 1');
  });
  it('other services show carts only', () => {
    const html = board(false);
    expect(html).not.toMatch(/ramp/i);
    expect(html).toContain('New cart');
  });
});
