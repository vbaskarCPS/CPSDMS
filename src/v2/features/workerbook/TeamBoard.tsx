// src/v2/features/workerbook/TeamBoard.tsx — build teams by dragging people between carts, ramp crews (sealing only) and managers.
// With pairing on (Start session), drag a manager's name onto another manager's card to pair them for
// the day: one shared card, whose teams and maps they manage together. ✕ on a name takes them back out.
import React, { useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical, Plus, Truck, Users, X } from 'lucide-react';
import type { PlanManager, PlanTeam } from '../../lib/startSession';
import { fullName, type RosterRow } from '../../lib/workerbook';
import { Toggle } from '../../ui';

interface Props {
  people: RosterRow[];                  // workers ticked as showed
  teams: PlanTeam[];
  members: Record<string, string>;      // hire_id → team name
  managers: PlanManager[];
  onAssign: (hireId: string, team: string | null) => void;
  onNewTeam: (managerId: string, kind: PlanTeam['kind'], hireId?: string) => void;
  onRamp: (team: string, ramp: boolean) => void;
  /** Ramp crews (asphalt) are a sealing thing; false hides the Ramp switch and "New ramp crew". Default true. */
  ramps?: boolean;
  onManager: (team: string, managerId: string) => void;
  onRemove: (team: string) => void;
  /** Shown in the pool when everyone is on a team. */
  emptyPoolText?: string;
  /** Managers paired for the day (ids, 2+ to a group). With onPair, managers can be paired by dragging. */
  pairs?: string[][];
  onPair?: (managerId: string, withManagerId: string) => void;
  onUnpair?: (managerId: string) => void;
  /**
   * A list beside the board that people are dragged from (e.g. the road-trip crew) instead of the
   * "Not on a team" pool. Dropping someone back on it takes them off their team.
   */
  side?: (drag: { Draggable: typeof SideDraggable }) => React.ReactNode;
}

/** A row in the side list that can be dragged onto a team. */
export const SideDraggable: React.FC<{ hireId: string; className?: string; children: React.ReactNode; label: string }> = ({ hireId, className, children, label }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `s:${hireId}`, data: { hireId } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-label={`${label}, drag to a team`} className={`${className || ''} v2-draggable`}
      style={{ opacity: isDragging ? 0.4 : 1 }}>
      <GripVertical size={14} color="#9ca3af" style={{ flexShrink: 0 }} />{children}
    </div>
  );
};

const teamLabel = (t: PlanTeam) => t.kind === 'ramp' ? t.name : `Cart ${t.name}`;

const Person: React.FC<{ row: RosterRow; overlay?: boolean }> = ({ row, overlay }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `p:${row.hire_id}`, data: { hireId: row.hire_id } });
  return (
    <div ref={overlay ? undefined : setNodeRef} {...(overlay ? {} : { ...attributes, ...listeners })}
      className={`v2-person${overlay ? ' overlay' : ''}`} style={{ opacity: isDragging && !overlay ? 0.35 : 1 }}
      aria-label={`${fullName(row.hire.person)}, drag to a team`}>
      <GripVertical size={13} color="#9ca3af" />
      <span className="nm">{fullName(row.hire.person)}</span>
      <span className="cn">{row.hire.cn}</span>
    </div>
  );
};

/** A manager's name on their card: drag it onto another manager's card to pair them. */
const ManagerChip: React.FC<{ m: PlanManager; draggable: boolean; paired: boolean; onUnpair?: () => void; overlay?: boolean }> = ({ m, draggable, paired, onUnpair, overlay }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `m:${m.id}`, data: { managerId: m.id }, disabled: !draggable || overlay });
  return (
    <span ref={overlay ? undefined : setNodeRef} {...(draggable && !overlay ? { ...attributes, ...listeners } : {})}
      className={`v2-mgr-chip${draggable ? ' v2-draggable' : ''}${overlay ? ' overlay' : ''}`} style={{ opacity: isDragging && !overlay ? 0.35 : 1 }}
      aria-label={draggable ? `${m.full_name}, drag onto another manager to pair` : m.full_name}>
      {draggable && <GripVertical size={13} color="#9ca3af" />}
      <b>{m.full_name}</b>
      {paired && onUnpair && !overlay && (
        <button type="button" className="v2-gbtn" style={{ width: 22, height: 22 }} aria-label={`Take ${m.full_name} out of the pair`}
          onPointerDown={e => e.stopPropagation()} onClick={onUnpair}><X size={12} /></button>
      )}
    </span>
  );
};

const Drop: React.FC<{ id: string; className?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ id, className, children, style }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className || ''}${isOver ? ' over' : ''}`} style={style}>{children}</div>;
};

export const TeamBoard: React.FC<Props> = ({ people, teams, members, managers, onAssign, onNewTeam, onRamp, onManager, onRemove, emptyPoolText, side, pairs, onPair, onUnpair, ramps = true }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<RosterRow | null>(null);
  const [draggingMgr, setDraggingMgr] = useState<PlanManager | null>(null);
  const mgrById = new Map(managers.map(m => [m.id, m]));
  /** the managers sharing a card: a pair, or one on their own */
  const groupOf = (id: string) => (pairs || []).find(g => g.includes(id)) || [id];
  const groups: PlanManager[][] = [];
  for (const m of managers) {
    if (groups.some(g => g.some(x => x.id === m.id))) continue;
    groups.push(groupOf(m.id).map(id => mgrById.get(id)).filter((x): x is PlanManager => !!x));
  }
  const groupName = (g: PlanManager[], first = false) => g.map(m => (first ? m.full_name.split(' ')[0] : m.full_name)).join(' & ');
  const byHire = new Map(people.map(r => [r.hire_id, r]));
  const teamNames = new Set(teams.map(t => t.name));
  const unassigned = people.filter(r => !members[r.hire_id] || !teamNames.has(members[r.hire_id]));
  const sortByName = (a: RosterRow, b: RosterRow) => fullName(a.hire.person).localeCompare(fullName(b.hire.person));

  const onStart = (e: DragStartEvent) => {
    const mid = e.active.data.current?.managerId;
    if (mid) { setDraggingMgr(mgrById.get(String(mid)) || null); return; }
    setDragging(byHire.get(String(e.active.data.current?.hireId)) || null);
  };
  const onEnd = (e: DragEndEvent) => {
    setDragging(null); setDraggingMgr(null);
    const over = e.over ? String(e.over.id) : '';
    // a manager dropped on another manager's card (anywhere on it): pair them; on the pool: un-pair
    const mid = e.active.data.current?.managerId ? String(e.active.data.current.managerId) : '';
    if (mid) {
      if (over === 'pool') { onUnpair?.(mid); return; }
      const target = over.startsWith('grp:') ? over.slice(4) : over.startsWith('team:') ? teams.find(t => t.name === over.slice(5))?.managerId
        : over.startsWith('new:') ? over.split(':')[1] : '';
      if (target && !groupOf(target).includes(mid)) onPair?.(mid, target);
      return;
    }
    const hireId = String(e.active.data.current?.hireId || '');
    if (!hireId || !over) return;
    if (over === 'pool') onAssign(hireId, null);
    else if (over.startsWith('team:')) onAssign(hireId, over.slice(5));
    else if (over.startsWith('new:')) { const [, mid, kind] = over.split(':'); onNewTeam(mid, kind as PlanTeam['kind'], hireId); }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => { setDragging(null); setDraggingMgr(null); }}>
      <div className={side ? 'v2-plan' : undefined}>
      {side && <Drop id="pool" className="v2-drop v2-side-drop">{side({ Draggable: SideDraggable })}</Drop>}
      <div className="v2-stack">
        {!side && <Drop id="pool" className="v2-card v2-drop">
          <div className="v2-row" style={{ marginBottom: 8 }}>
            <b>Not on a team</b><span className="v2-mut v2-small">{unassigned.length}</span>
            <span className="v2-spacer" /><span className="v2-mut v2-small">{ramps ? 'Drag people onto a cart, a ramp crew, or a “new” box' : 'Drag people onto a cart or the “new” box'}</span>
          </div>
          <div className="v2-people">
            {unassigned.sort(sortByName).map(r => <Person key={r.hire_id} row={r} />)}
            {unassigned.length === 0 && <span className="v2-mut v2-small">{people.length ? (emptyPoolText || 'Everyone who showed is on a team.') : 'Tick who showed in roll call first.'}</span>}
          </div>
        </Drop>}

        {groups.map(g => {
          const lead = g[0].id, ids = g.map(m => m.id), paired = g.length > 1;
          const mine = teams.filter(t => ids.includes(t.managerId));
          return (
            <Drop key={lead} id={`grp:${lead}`} className={`v2-card v2-drop${paired ? ' v2-paired' : ''}`}>
              <div className="v2-row" style={{ marginBottom: 10, gap: 8 }}>
                {paired && <Users size={16} color="#0d9488" aria-label="Paired managers" />}
                {g.map((m, k) => (
                  <React.Fragment key={m.id}>
                    {k > 0 && <span className="v2-mut">&amp;</span>}
                    <ManagerChip m={m} draggable={!!onPair && managers.length > 1} paired={paired} onUnpair={onUnpair ? () => onUnpair(m.id) : undefined} />
                  </React.Fragment>
                ))}
                <span className="v2-mut v2-small">{mine.length} team{mine.length === 1 ? '' : 's'} · {people.filter(r => mine.some(t => t.name === members[r.hire_id])).length} on teams</span>
                {onPair && !paired && managers.length > 1 && <span className="v2-mut v2-small">Drag another manager here to share these teams</span>}
                {paired && <span className="v2-small" style={{ color: '#0d9488' }}>Sharing these teams, their maps and their sales</span>}
              </div>
              <div className="v2-teams">
                {mine.map(t => {
                  const inTeam = people.filter(r => members[r.hire_id] === t.name).sort(sortByName);
                  return (
                    <Drop key={t.name} id={`team:${t.name}`} className={`v2-team v2-drop${t.kind === 'ramp' ? ' ramp' : ''}`}>
                      <div className="v2-row" style={{ gap: 6, flexWrap: 'nowrap', marginBottom: 6 }}>
                        <b className="v2-small" style={{ flex: 1 }}>{teamLabel(t)}</b>
                        {ramps && <label className="v2-row v2-small" style={{ gap: 4, flexWrap: 'nowrap' }} title="Ramp crews do the asphalt work">Ramp
                          <Toggle on={t.kind === 'ramp'} onChange={v => onRamp(t.name, v)} label={`Ramp crew ${t.name}`} /></label>}
                        <select className="v2-sel" style={{ padding: '2px 4px', width: 84, fontSize: 12 }} value={groupOf(t.managerId)[0]} aria-label={`Manager for ${teamLabel(t)}`}
                          onChange={e => onManager(t.name, e.target.value)}>
                          {groups.map(o => <option key={o[0].id} value={o[0].id}>{groupName(o, true)}</option>)}
                        </select>
                        <button className="v2-gbtn" style={{ width: 26, height: 26 }} aria-label={`Remove ${teamLabel(t)}`} onClick={() => onRemove(t.name)}><X size={13} /></button>
                      </div>
                      <div className="v2-people">
                        {inTeam.map(r => <Person key={r.hire_id} row={r} />)}
                        {inTeam.length === 0 && <span className="v2-mut v2-small">Drop people here</span>}
                      </div>
                    </Drop>
                  );
                })}
                <Drop id={`new:${lead}:cart`} className="v2-team v2-drop new">
                  <button type="button" className="v2-link" onClick={() => onNewTeam(lead, 'cart')}><Plus size={14} /> New cart</button>
                  <span className="v2-mut v2-small">or drop someone here</span>
                </Drop>
                {ramps && <Drop id={`new:${lead}:ramp`} className="v2-team v2-drop new">
                  <button type="button" className="v2-link" onClick={() => onNewTeam(lead, 'ramp')}><Truck size={14} /> New ramp crew</button>
                  <span className="v2-mut v2-small">or drop someone here</span>
                </Drop>}
              </div>
            </Drop>
          );
        })}
      </div>
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <Person row={dragging} overlay /> : draggingMgr ? <ManagerChip m={draggingMgr} draggable paired={false} overlay /> : null}</DragOverlay>
    </DndContext>
  );
};
