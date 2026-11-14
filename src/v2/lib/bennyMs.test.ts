// The Benny on MainstreetAI: its cards' words, and that a card saves only what was checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const assignRep = vi.fn();
const setZoneStatus = vi.fn();
const generateZonesOver = vi.fn();
const runToReady = vi.fn();
const acceptRun = vi.fn();
const discardRun = vi.fn();
vi.mock('./client', () => ({ db: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./mainstreet', () => ({ assignRep: (...a: unknown[]) => assignRep(...a), setZoneStatus: (...a: unknown[]) => setZoneStatus(...a),
  generateZonesOver: (...a: unknown[]) => generateZonesOver(...a), runToReady: (...a: unknown[]) => runToReady(...a),
  acceptRun: (...a: unknown[]) => acceptRun(...a), discardRun: (...a: unknown[]) => discardRun(...a),
  stepLabel: (s: { stage: string } | null) => (s ? `step:${s.stage}` : 'Setting up…') }));

import { moveSaid, msAssignCard, msAssignedSaid, msAssignFromBenny, msCutCard, msCutDiscard, msCutFromBenny, msCutSaveCard, msCutSaveFromBenny, msRunSaid, msZoneCard, msZoneFromBenny, repChanges,
  type MsAssignCheck, type MsCutCheck, type MsMove, type MsRunCheck, type MsZoneCheck } from './bennyMs';
import { fitWithin, MAX_PICS } from './benny';

const toNewton: MsMove = { zone_id: 'z3', zone: 'Hamilton South 3 (2)', city: 'Hamilton', campaign_id: 'c1', campaign: 'Taxifi', from_id: 'sina', from: 'Sina Kazeroonizand', to_id: 'newton', to: 'Newton Onaiwu' };
const toSina: MsMove = { zone_id: 'z1', zone: 'Hamilton South 1 (2)', city: 'Hamilton', campaign_id: 'c1', campaign: 'Taxifi', from_id: 'newton', from: 'Newton Onaiwu', to_id: 'sina', to: 'Sina Kazeroonizand' };
const swap: MsAssignCheck = { ok: true, stamp: 'abc', moves: [toNewton, toSina],
  ask: [{ zone: 'z3', campaign_id: 'c1', rep: 'newton' }, { zone: 'z1', campaign_id: 'c1', rep: 'sina' }] };

beforeEach(() => { for (const f of [rpc, assignRep, setZoneStatus, generateZonesOver, runToReady, acceptRun, discardRun]) f.mockReset(); });

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

describe('cutting zones', () => {
  const cut: MsCutCheck = { ok: true, stamp: 'c1', city: { id: 'ham', name: 'Hamilton' }, campaign: { id: 'tax', name: 'Taxifi' }, target: 3, only: true,
    replace: [{ id: 'z3', name: 'Hamilton South 3 (2)', density: 14367, reps: 'Sina Kazeroonizand' }, { id: 'z4', name: 'Hamilton South 4 (2)', density: 28271, reps: 'Alireza Ghorbanzadeh' }],
    area: { blocks: 33, density: 42638, per_zone: 14213 }, zones_left_alone: 6, ask: { city: 'ham', target: 3, campaign: 'tax', zones: ['z3', 'z4'] } };
  const run: MsRunCheck = { ok: true, stamp: 'r1', run: 'run1', city: 'Hamilton', campaign: 'Taxifi', smallest: 6097, largest: 28271,
    zones: [{ name: 'Hamilton South 1', density: 6097, plazas: 254 }, { name: 'Hamilton South 2', density: 8270, plazas: 446 }, { name: 'Hamilton South 3', density: 28271, plazas: 322 }],
    replace: [{ id: 'z3', name: 'Hamilton South 3 (2)', reps: 'Sina Kazeroonizand' }, { id: 'z4', name: 'Hamilton South 4 (2)', reps: 'Alireza Ghorbanzadeh' }] };
  const map = { title: 'Proposed zones in Hamilton', zones: [{ name: 'Hamilton South 1', who: 'density 6097', polygon: { type: 'Polygon' as const, coordinates: [] } }] };

  it('the cut card says what is cut from what, and that nothing changes yet', () => {
    const card = msCutCard(cut);
    expect(card.title).toBe('Re-cut 2 zones into 3');
    expect(card.action).toBe('Work them out');
    expect(card.lines).toEqual([
      'From: Hamilton South 3 (2) (Sina Kazeroonizand), Hamilton South 4 (2) (Alireza Ghorbanzadeh)',
      '33 blocks · density 42,638 · about 14,213 a zone',
      'Campaign: Taxifi',
      'The other 6 zones in Hamilton stay as they are.',
      'Nothing changes yet. I work the zones out and show them on the map; you save them after.',
    ]);
    expect(msCutCard({ ...cut, all: true, only: false }).title).toBe('Re-cut Hamilton into 3 zones');
    const fresh = msCutCard({ ...cut, replace: [], only: false, target: 1, zones_left_alone: 1, proposals_waiting: 1 });
    expect(fresh.title).toBe('Cut 1 zone in Hamilton');
    expect(fresh.lines[0]).toBe('From the part of Hamilton that is in no zone yet.');
    expect(fresh.lines).toContain('The other 1 zone in Hamilton stays as it is.');
    expect(fresh.lines).toContain('A proposal for Hamilton is already waiting on the Zones screen. This makes another.');
  });

  it('tapping it works the zones out and hands back the map and the card that saves them; nothing is saved', async () => {
    rpc.mockImplementation(async (fn: string) => ({ data: fn === 'benny_ms_check_cut' ? cut : { ...run, map }, error: null }));
    generateZonesOver.mockResolvedValue('run1');
    runToReady.mockImplementation(async (_id: string, onStep: (s: { stage: string }) => void) => { onStep({ stage: 'growing' }); onStep({ stage: 'ready' }); });
    const notes: string[] = [];
    const next = await msCutFromBenny(cut, n => notes.push(n));
    expect(rpc).toHaveBeenCalledWith('benny_ms_check_cut', { p_city: 'ham', p_target: 3, p_zones: ['z3', 'z4'], p_campaign: 'tax' });
    expect(generateZonesOver).toHaveBeenCalledWith('ham', 'tax', 3, ['z3', 'z4'], true);
    expect(notes).toEqual(['Setting up…', 'step:growing', 'step:ready']);
    expect(next.text).toBe('Worked out 3 zones. They’re on the map below.');
    expect(next.then.map).toEqual(map);
    expect(next.then.proposal).toEqual({ kind: 'ms_cut_save', check: run });   // the shapes aren't kept on the card
    expect(next.then.text).toContain('**3 zones worked out for Hamilton.** Nothing is saved yet.');
    expect(acceptRun).not.toHaveBeenCalled();
  });

  it('starts nothing when the city’s zones changed since the check, and clears up a run that didn’t finish', async () => {
    rpc.mockResolvedValue({ data: { ...cut, stamp: 'c2' }, error: null });
    await expect(msCutFromBenny(cut)).rejects.toThrow('Hamilton’s zones changed since I checked');
    expect(generateZonesOver).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: cut, error: null });
    generateZonesOver.mockResolvedValue('run1'); runToReady.mockRejectedValue(new Error('taking too long')); discardRun.mockResolvedValue(undefined);
    await expect(msCutFromBenny(cut)).rejects.toThrow('taking too long');
    expect(discardRun).toHaveBeenCalledWith('run1');
  });

  it('says the zones and their sizes, and when they come out uneven', () => {
    const said = msRunSaid(run).split('\n');
    expect(said[1]).toBe('Hamilton South 1: density 6,097');
    expect(said).toContain('They come out uneven: a zone is made of whole blocks (the pieces between main roads), and a big block can’t be split.');
    expect(msRunSaid({ ...run, largest: 9000 })).not.toContain('uneven');
  });

  it('the save card says what is made, what is retired and who is left with no zone', () => {
    const card = msCutSaveCard(run);
    expect(card).toMatchObject({ title: 'Save 3 zones in Hamilton', action: 'Save the zones' });
    expect(card.lines).toEqual([
      'New: Hamilton South 1, Hamilton South 2, Hamilton South 3',
      'Retires: Hamilton South 3 (2) (Sina Kazeroonizand), Hamilton South 4 (2) (Alireza Ghorbanzadeh)',
      'Sina and Alireza will have no zone until you give each one.',
      'Campaign: Taxifi. The new zones start with no rep.',
      'A retired zone keeps its visits and can be brought back.',
    ]);
    expect(msCutSaveCard({ ...run, replace: undefined }).lines).toEqual(['New: Hamilton South 1, Hamilton South 2, Hamilton South 3', 'Campaign: Taxifi. The new zones start with no rep.']);
  });

  it('saving checks the proposal again, then uses the Zones screen’s own accept', async () => {
    rpc.mockResolvedValue({ data: { ...run, map }, error: null });
    acceptRun.mockResolvedValue(3);
    expect(await msCutSaveFromBenny(run)).toBe('Saved 3 zones in Hamilton and retired Hamilton South 3 (2), Hamilton South 4 (2). None has a rep yet: tell me who gets which.');
    expect(rpc).toHaveBeenCalledWith('benny_ms_run', { p_run: 'run1' });
    expect(acceptRun).toHaveBeenCalledWith('run1');
  });

  it('saves nothing when the proposal changed, was already saved, or a zone it replaces is gone', async () => {
    rpc.mockResolvedValue({ data: { ...run, stamp: 'r2' }, error: null });
    await expect(msCutSaveFromBenny(run)).rejects.toThrow('changed since I showed it');
    rpc.mockResolvedValue({ data: { ok: false, problems: ['Those zones were already saved.'] }, error: null });
    await expect(msCutSaveFromBenny(run)).rejects.toThrow('already saved');
    rpc.mockResolvedValue({ data: { ...run, replace: [{ ...run.replace![0], gone: true }] }, error: null });
    await expect(msCutSaveFromBenny(run)).rejects.toThrow('has changed since');
    expect(acceptRun).not.toHaveBeenCalled();
  });

  it('“Not now” on the save card discards the proposal', async () => {
    discardRun.mockResolvedValue(undefined);
    expect(await msCutDiscard(run)).toBe('Discarded. Nothing changed.');
    expect(discardRun).toHaveBeenCalledWith('run1');
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
