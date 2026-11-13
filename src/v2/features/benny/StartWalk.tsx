// src/v2/features/benny/StartWalk.tsx — "help me start the day" in the Benny's chat: one question at a time, with buttons.
// Road trips first take attendance (a roll call here, or everyone now and remove later), then who's going out (tap two
// names to put them together as one team), their maps, how the crews are made, the carts, and product cost and tax as
// the last day started. At the end the Benny is asked for the Start the day card. Only Save roll call changes anything.
import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { loadWalk, saveRollCall } from '../../lib/bennyWalkLoad';
import {
  dealRandom, groupKey, groupName, joinGroups, mapChoices, moneyLine, nextStep, splitGroup, toggleOut, walkAsk,
  type CartWay, type CrewWay, type WalkState,
} from '../../lib/bennyWalk';

export { loadWalk };
const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

const Opt: React.FC<{ on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }> = ({ on, onClick, children, disabled }) => (
  <button type="button" className={`benny-opt${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled}>{on && <Check size={14} />}{children}</button>
);

export const StartWalk: React.FC<{
  state: WalkState; done: boolean; busy: boolean;
  onChange: (s: WalkState) => void;
  onAsk: (text: string, money: { productCostPercent: number; noTaxOnCash: boolean; line: string }) => void;
}> = ({ state: s, done, busy, onChange, onAsk }) => {
  const [pick, setPick] = useState<string | null>(null);
  const [find, setFind] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [roll, setRoll] = useState<Record<string, boolean>>(() => Object.fromEntries((s.crew || []).map(w => [w.rowId, w.here])));
  useEffect(() => { setErr(null); }, [s.step]);
  const go = (patch: Partial<WalkState>) => { const n = { ...s, ...patch }; onChange({ ...n, step: nextStep(n) }); };
  const here = (s.crew || []).filter(w => w.here);
  const name = (id: string) => s.managers.find(m => m.id === id)?.name || '?';
  if (done) return null;

  const saveRoll = async () => {
    setSaving(true); setErr(null);
    try {
      const changed = (s.crew || []).filter(w => roll[w.rowId] !== w.here);
      await saveRollCall(changed.map(w => ({ rowId: w.rowId, here: roll[w.rowId] })));
      go({ crew: (s.crew || []).map(w => ({ ...w, here: roll[w.rowId] })), rollSaved: true, step: 'attendance' });
    } catch (e) { setErr(e instanceof Error ? e.message : 'The roll call didn’t save'); } finally { setSaving(false); }
  };

  const body = (() => {
    switch (s.step) {
      case 'attendance': return <>
        <b>1 · Attendance</b>
        <p>{here.length} of {(s.crew || []).length} on {pretty(s.date)}’s crew are ticked as working.</p>
        <div className="benny-opts">
          <Opt onClick={() => onChange({ ...s, step: 'rollcall' })}>Take roll call now</Opt>
          <Opt onClick={() => go({})}>Load everyone, I’ll remove later</Opt>
        </div>
      </>;
      case 'rollcall': {
        const n = Object.values(roll).filter(Boolean).length;
        return <>
          <b>Roll call · {n} here</b>
          <p>Tap anyone who isn’t here.</p>
          <div className="benny-roll">
            {(s.crew || []).map(w => (
              <button key={w.rowId} type="button" className={`benny-roll-r${roll[w.rowId] ? ' on' : ''}`} aria-pressed={roll[w.rowId]} onClick={() => setRoll(r => ({ ...r, [w.rowId]: !r[w.rowId] }))}>
                <span className="benny-roll-x">{roll[w.rowId] ? <Check size={14} /> : null}</span>{w.name}<span className="benny-roll-s">{roll[w.rowId] ? 'Here' : 'Not here'}</span>
              </button>))}
          </div>
          <div className="benny-card-b">
            <button type="button" className="benny-go" onClick={() => void saveRoll()} disabled={saving}>{saving ? <Loader2 size={15} className="spin" /> : `Save roll call (${n} here)`}</button>
            <button type="button" className="benny-alt" onClick={() => onChange({ ...s, step: 'attendance' })} disabled={saving}>Back</button>
          </div>
        </>;
      }
      case 'who': return <>
        <b>{s.roadTrip ? '2' : '1'} · Who’s going out?</b>
        <p>Tap the managers going out. Then, to put two together as one team, tap one and then the other.</p>
        <div className="benny-opts">
          {s.managers.map(m => <Opt key={m.id} on={s.groups.some(g => g.includes(m.id))} onClick={() => { setPick(null); onChange({ ...s, groups: toggleOut(s.groups, m.id) }); }}>{m.name}</Opt>)}
          {!s.managers.length && <span className="benny-mut">Nobody can manage on {pretty(s.date)}: no route managers at this center, or they’re all off.</span>}
        </div>
        {s.groups.length > 1 && <div className="benny-teams">
          {s.groups.map(g => (
            <div key={groupKey(g)} className={`benny-team${g.some(id => id === pick) ? ' pick' : ''}`}>
              <button type="button" className="benny-team-n" onClick={() => {
                if (!pick) setPick(g[0]);
                else if (g.includes(pick)) setPick(null);
                else { onChange({ ...s, groups: joinGroups(s.groups, pick, g[0]) }); setPick(null); }
              }}>{groupName(g, s.managers)}{pick && !g.includes(pick) ? <span className="benny-mut"> · tap to join {name(pick).split(' ')[0]}</span> : null}</button>
              {g.length > 1 && <button type="button" className="benny-link" onClick={() => onChange({ ...s, groups: splitGroup(s.groups, g) })}>Split</button>}
            </div>))}
        </div>}
        {s.groups.length === 1 && s.groups[0].length > 1 && <div className="benny-teams"><div className="benny-team"><span className="benny-team-n">{groupName(s.groups[0], s.managers)} together</span>
          <button type="button" className="benny-link" onClick={() => onChange({ ...s, groups: splitGroup(s.groups, s.groups[0]) })}>Split</button></div></div>}
        <div className="benny-card-b"><button type="button" className="benny-go" disabled={!s.groups.length} onClick={() => go({})}>
          {s.groups.length ? `Next: ${s.groups.length === 1 ? 'one team' : `${s.groups.length} teams`}` : 'Pick who’s going out'}</button></div>
      </>;
      case 'maps': {
        const ok = s.groups.every(g => (s.maps[groupKey(g)] || []).length);
        return <>
          <b>Maps</b>
          {s.groups.map(g => {
            const k = groupKey(g); const mine = s.maps[k] || [];
            return <div key={k} className="benny-mapsfor">
              <span className="benny-sub">{groupName(g, s.managers)}</span>
              <input className="benny-walk-in" placeholder="Find a map, e.g. north van 1" value={find[k] || ''} onChange={e => setFind(f => ({ ...f, [k]: e.target.value }))} aria-label={`Find a map for ${groupName(g, s.managers)}`} />
              {!(find[k] || '').trim() && (s.recent || []).length > 0 && <span className="benny-mut">Last day’s maps:</span>}
              <div className="benny-opts">{mapChoices(s.areas, mine, find[k] || '', s.recent).map(a => <Opt key={a} on={mine.includes(a)}
                onClick={() => onChange({ ...s, maps: { ...s.maps, [k]: mine.includes(a) ? mine.filter(x => x !== a) : [...mine, a] } })}>{a}</Opt>)}</div>
            </div>;
          })}
          {!s.areas.length && <p className="benny-mut">No maps are assigned to this center yet.</p>}
          <div className="benny-card-b"><button type="button" className="benny-go" disabled={!ok} onClick={() => go({})}>{ok ? 'Next' : 'Pick a map for each team'}</button></div>
        </>;
      }
      case 'crews': {
        const ways: [CrewWay, string][] = [['balanced', 'Balanced by stats (snake draft)'], ['random', 'Random'], ['roster', 'Keep their roster managers']];
        return <>
          <b>Crews: who goes with whom?</b>
          <div className="benny-opts">{ways.map(([w, l]) => <Opt key={w} on={s.crews === w} onClick={() => onChange({ ...s, crews: w })}>{l}</Opt>)}
            <Opt disabled onClick={() => undefined}>Live draft (coming next)</Opt></div>
          <label className="benny-sub" htmlFor="benny-walk-rules">Anything to keep in mind? (optional)</label>
          <input id="benny-walk-rules" className="benny-walk-in" value={s.rules || ''} placeholder="e.g. don’t give Franklyn Kyle or David" onChange={e => onChange({ ...s, rules: e.target.value })} />
          <div className="benny-card-b"><button type="button" className="benny-go" disabled={!s.crews} onClick={() => go({})}>Next</button></div>
        </>;
      }
      case 'carts': {
        const ways: [CartWay, string][] = [['roster', 'As on the roster'], ['solo', 'Everyone solo'], ['pairs', 'Two to a cart']];
        return <>
          <b>Carts</b>
          <div className="benny-opts">{ways.map(([w, l]) => <Opt key={w} on={s.carts === w} onClick={() => go({ carts: w })}>{l}</Opt>)}</div>
        </>;
      }
      case 'money': {
        const m = s.money!;
        return <>
          <b>Product cost and tax</b>
          <p>{moneyLine(m)}{m.from && !m.changed ? ` · as on ${pretty(m.from)}` : m.changed ? ' · changed' : ' · from the season’s rate card'}</p>
          {m.changed !== undefined && <div className="benny-money">
            <label>Product cost <input type="number" min={0} max={100} step={0.5} className="benny-walk-in" value={m.productCostPercent}
              onChange={e => onChange({ ...s, money: { ...m, changed: true, productCostPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } })} />%</label>
            <Opt on={m.noTaxOnCash} onClick={() => onChange({ ...s, money: { ...m, changed: true, noTaxOnCash: !m.noTaxOnCash } })}>No tax on cash</Opt>
            <span className="benny-mut">{m.taxName} {m.taxRate}% is the season’s rate card (Workerbook › Rate cards).</span>
          </div>}
          <div className="benny-card-b">
            <button type="button" className="benny-go" onClick={() => go({})}>{m.changed ? 'Use these' : 'Keep'}</button>
            {m.changed === undefined && <button type="button" className="benny-alt" onClick={() => onChange({ ...s, money: { ...m, changed: false } })}>Change</button>}
          </div>
        </>;
      }
      case 'done': {
        const random = s.crews === 'random' && s.groups.length > 1 ? dealRandom(here.map(w => w.name), s.groups.length) : undefined;
        return <>
          <b>Ready</b>
          <p>{s.groups.map(g => `${groupName(g, s.managers)}: ${(s.maps[groupKey(g)] || []).join(', ')}`).join('\n')}</p>
          <div className="benny-card-b">
            <button type="button" className="benny-go" disabled={busy} onClick={() => onAsk(walkAsk(s, random), { productCostPercent: s.money!.productCostPercent, noTaxOnCash: s.money!.noTaxOnCash, line: moneyLine(s.money!) })}>Make the Start the day card</button>
          </div>
        </>;
      }
      default: return null;
    }
  })();
  return <div className="benny-walk" role="group" aria-label="Start the day, step by step">{body}{err && <p className="benny-err" role="alert">{err}</p>}</div>;
};
