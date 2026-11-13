// src/v2/features/benny/ManagerBoard.tsx — who's going out, as tiles. Every manager who can work that day is a tile. Tap
// one to send it out (or bring it back in). Drag a tile onto another to make one team (it carries both names), or tap
// one and then the other. Drag a team onto "Staying in" to take it off; Split pulls a team apart.
import React, { useRef, useState } from 'react';
import { groupKey, joinGroups, splitGroup, toggleOut, type WalkManager } from '../../lib/bennyWalk';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();

export const ManagerBoard: React.FC<{ managers: WalkManager[]; groups: string[][]; onChange: (g: string[][]) => void }> = ({ managers, groups, onChange }) => {
  const [pick, setPick] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; over: string | null } | null>(null);
  const start = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const name = (id: string) => managers.find(m => m.id === id)?.name || '?';
  const out = new Set(groups.flat());
  const staying = managers.filter(m => !out.has(m.id));

  // where the finger is: a team tile (its first manager's id), the "Staying in" area, or nothing
  const target = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null;
    return el?.dataset.drop || null;
  };
  const tap = (id: string) => {
    if (!out.has(id)) { setPick(null); onChange(toggleOut(groups, id)); return; }
    if (!pick) { setPick(id); return; }
    const a = groups.find(g => g.includes(pick)); const b = groups.find(g => g.includes(id));
    setPick(null);
    if (a && b && a !== b) onChange(joinGroups(groups, pick, id));
  };
  const down = (id: string) => (e: React.PointerEvent) => {
    start.current = { id, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current; if (!s) return;
    const dx = e.clientX - s.x; const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < 8) return;
    s.moved = true;
    setDrag({ id: s.id, dx, dy, over: target(e.clientX, e.clientY) });
  };
  const up = (e: React.PointerEvent) => {
    const s = start.current; start.current = null;
    if (!s) return;
    if (!s.moved) { tap(s.id); return; }
    const t = target(e.clientX, e.clientY);
    setDrag(null); setPick(null);
    if (!t) return;
    if (t === 'in') { if (out.has(s.id)) onChange(groups.map(g => g.filter(x => x !== s.id)).filter(g => g.length)); return; }
    if (t === 'out') { if (!out.has(s.id)) onChange(toggleOut(groups, s.id)); return; }
    const base = out.has(s.id) ? groups : toggleOut(groups, s.id);
    onChange(joinGroups(base, s.id, t));
  };
  const cancel = () => { start.current = null; setDrag(null); };

  const tile = (ids: string[], inside: boolean) => {
    const lead = ids[0];
    const dragging = drag && ids.includes(drag.id);
    const over = drag && !dragging && drag.over === lead;
    return (
      <div key={groupKey(ids)} className={`benny-mt${inside ? '' : ' in'}${ids.length > 1 ? ' pair' : ''}${pick && ids.includes(pick) ? ' pick' : ''}${over ? ' over' : ''}${dragging ? ' drag' : ''}`}
        data-drop={inside ? lead : undefined} style={dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)` } : undefined}>
        <div className="benny-mt-faces">
          {ids.map(id => (
            <button key={id} type="button" className="benny-mt-face" onPointerDown={down(id)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
              aria-label={`${name(id)}: ${inside ? 'going out. Drag onto another to pair, or tap two to pair' : 'staying in. Tap to send out'}`}>
              <span className="benny-mt-av">{initials(name(id))}</span>
              <span className="benny-mt-nm">{name(id).split(' ')[0]}</span>
            </button>))}
        </div>
        <span className="benny-mt-full">{ids.map(name).join(' + ')}</span>
        {inside && ids.length > 1 && <button type="button" className="benny-link" onClick={() => onChange(splitGroup(groups, ids))}>Split</button>}
      </div>
    );
  };

  return (
    <div className="benny-mboard" onPointerLeave={() => drag && setDrag(d => d && { ...d, over: null })}>
      <span className="benny-sub">Going out {groups.length ? `· ${groups.length === 1 ? 'one team' : `${groups.length} teams`}` : ''}</span>
      <div className={`benny-mzone${drag?.over === 'out' ? ' over' : ''}`} data-drop="out">
        {groups.map(g => tile(g, true))}
        {!groups.length && <span className="benny-mut">Tap a manager below to send them out.</span>}
      </div>
      <span className="benny-sub">Staying in</span>
      <div className={`benny-mzone in${drag?.over === 'in' ? ' over' : ''}`} data-drop="in">
        {staying.map(m => tile([m.id], false))}
        {!staying.length && <span className="benny-mut">Everyone’s going out.</span>}
      </div>
      <span className="benny-mut">{pick ? `Now tap who goes with ${name(pick).split(' ')[0]}.` : 'Drag one onto another to make one team, or tap one and then the other.'}</span>
    </div>
  );
};
