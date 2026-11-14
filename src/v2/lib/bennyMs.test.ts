// The Benny on MainstreetAI: its cards' words, and that a card saves only what was checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const assignRep = vi.fn();
const setZoneStatus = vi.fn();
vi.mock('./client', () => ({ db: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./mainstreet', () => ({ assignRep: (...a: unknown[]) => assignRep(...a), setZoneStatus: (...a: unknown[]) => setZoneStatus(...a) }));

import { moveSaid, msAssignCard, msAssignedSaid, msAssignFromBenny, msZoneCard, msZoneFromBenny, repChanges, type MsAssignCheck, type MsMove, type MsZoneCheck } from './bennyMs';
import { fitWithin, MAX_PICS } from './benny';

const toNewton: MsMove = { zone_id: 'z3', zone: 'Hamilton South 3 (2)', city: 'Hamilton', campaign_id: 'c1', campaign: 'Taxifi', from_id: 'sina', from: 'Sina Kazeroonizand', to_id: 'newton', to: 'Newton Onaiwu' };
const toSina: MsMove = { zone_id: 'z1', zone: 'Hamilton South 1 (2)', city: 'Hamilton', campaign_id: 'c1', campaign: 'Taxifi', from_id: 'newton', from: 'Newton Onaiwu', to_id: 'sina', to: 'Sina Kazeroonizand' };
const swap: MsAssignCheck = { ok: true, stamp: 'abc', moves: [toNewton, toSina],
  ask: [{ zone: 'z3', campaign_id: 'c1', rep: 'newton' }, { zone: 'z1', campaign_id: 'c1', rep: 'sina' }] };

beforeEach(() => { rpc.mockReset(); assignRep.mockReset(); setZoneStatus.mockReset(); });

describe('the reassign card', () => {
  it('says each move, and what each rep ends up with on a swap', () => {
    expect(moveSaid(toNewton, false)).toBe('Hamilton South 3 (2): Sina Kazeroonizand → Newton Onaiwu');
    expect(repChanges(swap.moves)).toBe('Newton +1 −1, Sina +1 −1');
    const card = msAssignCard(swap);
    expect(card.title).toBe('Reassign 2 zones');
    expect(card.action).toBe('Reassign');
    expect(card.lines).toContain('Campaign: Taxifi');
    expect(card.lines).toContain('Zones each: Newton +1 −1, Sina +1 −1');
  });
  it('one zone: give it, or take the rep off', () => {
    expect(msAssignCard({ ...swap, moves: [toNewton] })).toMatchObject({ title: 'Give Hamilton South 3 (2) to Newton', action: 'Assign' });
    const off: MsMove = { ...toNewton, to_id: undefined, to: undefined };
    expect(msAssignCard({ ...swap, moves: [off] })).toMatchObject({ title: 'Take Sina off Hamilton South 3 (2)', action: 'Unassign' });
    expect(moveSaid(off, true)).toBe('Hamilton South 3 (2) · Taxifi: Sina Kazeroonizand → no rep');
    expect(msAssignedSaid([off])).toBe('Hamilton South 3 (2) has no rep now (it was Sina’s).');
    expect(msAssignedSaid([toNewton])).toBe('Hamilton South 3 (2) is Newton’s now (it was Sina’s).');
  });
  it('names the campaign on each line when the card has more than one', () => {
    const card = msAssignCard({ ...swap, moves: [toNewton, { ...toSina, campaign_id: 'c2', campaign: 'Roofing' }] });
    expect(card.lines[0]).toBe('Hamilton South 3 (2) · Taxifi: Sina Kazeroonizand → Newton Onaiwu');
    expect(card.lines.some(l => l.startsWith('Campaign:'))).toBe(false);
  });
});

describe('saving a reassign card', () => {
  it('checks again, then saves each move with the Zones screen’s own assign', async () => {
    rpc.mockResolvedValue({ data: swap, error: null });
    assignRep.mockResolvedValue(undefined);
    expect(await msAssignFromBenny(swap)).toBe('Done: Hamilton South 3 (2) → Newton, Hamilton South 1 (2) → Sina.');
    expect(rpc).toHaveBeenCalledWith('benny_ms_check_assign', { p_moves: swap.ask });
    expect(assignRep.mock.calls).toEqual([['z3', 'c1', 'newton'], ['z1', 'c1', 'sina']]);
  });
  it('saves nothing when the zones changed since the card was made', async () => {
    rpc.mockResolvedValue({ data: { ...swap, stamp: 'other' }, error: null });
    await expect(msAssignFromBenny(swap)).rejects.toThrow('changed since I checked');
    expect(assignRep).not.toHaveBeenCalled();
  });
  it('saves nothing when the check now says no, and says why', async () => {
    rpc.mockResolvedValue({ data: { ok: false, problems: ['Newton Onaiwu is switched off, so they can’t take a zone.'] }, error: null });
    await expect(msAssignFromBenny(swap)).rejects.toThrow('switched off');
    expect(assignRep).not.toHaveBeenCalled();
  });
  it('says how far it got when a move fails part way', async () => {
    rpc.mockResolvedValue({ data: swap, error: null });
    assignRep.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Not allowed.'));
    await expect(msAssignFromBenny(swap)).rejects.toThrow('Only 1 of 2 saved (Not allowed). Check the Zones screen before trying again.');
  });
});

describe('retiring a zone', () => {
  const check: MsZoneCheck = { ok: true, stamp: 's1', zone: { id: 'z9', name: 'Barrie 4', city: 'Barrie' }, from: 'active', to: 'retired', reps: 'Sam Lee (Taxifi)', businesses: 1 };
  it('the card says who is on it and that it can come back', () => {
    const card = msZoneCard(check);
    expect(card).toMatchObject({ title: 'Retire Barrie 4', action: 'Retire' });
    expect(card.lines).toEqual(['Barrie · 1 business in it', 'On it now: Sam Lee (Taxifi).', 'A retired zone can be brought back: ask me, or use Zones › Show retired.']);
    expect(msZoneCard({ ...check, from: 'retired', to: 'active', reps: undefined })).toMatchObject({ title: 'Bring back Barrie 4', action: 'Bring back' });
  });
  it('checks again by the zone’s id, then uses the Zones screen’s own save', async () => {
    rpc.mockResolvedValue({ data: check, error: null });
    setZoneStatus.mockResolvedValue(undefined);
    expect(await msZoneFromBenny(check)).toBe('Barrie 4 is retired.');
    expect(rpc).toHaveBeenCalledWith('benny_ms_check_zone', { p_zone: 'z9', p_status: 'retired' });
    expect(setZoneStatus).toHaveBeenCalledWith('z9', 'retired');
  });
  it('saves nothing when the zone changed', async () => {
    rpc.mockResolvedValue({ data: { ...check, stamp: 's2' }, error: null });
    await expect(msZoneFromBenny(check)).rejects.toThrow('Barrie 4 changed since I checked');
    expect(setZoneStatus).not.toHaveBeenCalled();
  });
});

describe('pictures', () => {
  it('are shrunk to fit the longest side, never grown', () => {
    expect(fitWithin(4032, 3024)).toEqual({ w: 1568, h: 1176 });
    expect(fitWithin(3024, 4032)).toEqual({ w: 1176, h: 1568 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(0, 0)).toEqual({ w: 1, h: 1 });
    expect(MAX_PICS).toBe(3);
  });
});
