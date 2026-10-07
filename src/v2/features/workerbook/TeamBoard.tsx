// src/v2/features/workerbook/TeamBoard.tsx — build teams by dragging people between carts, ramp crews and managers.
import React, { useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { GripVertical, Plus, Truck, X } from 'lucide-react';
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
  onManager: (team: string, managerId: string) => void;
  onRemove: (team: string) => void;
  /** Shown in the pool when everyone is on a team. */
  emptyPoolText?: string;
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

const Drop: React.FC<{ id: string; className?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ id, className, children, style }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className || ''}${isOver ? ' over' : ''}`} style={style}>{children}</div>;
};

export const TeamBoard: React.FC<Props> = ({ people, teams, members, managers, onAssign, onNewTeam, onRamp, onManager, onRemove, emptyPoolText, side }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<RosterRow | null>(null);
  const byHire = new Map(people.map(r => [r.hire_id, r]));
  const teamNames = new Set(teams.map(t => t.name));
  const unassigned = people.filter(r => !members[r.hire_id] || !teamNames.has(members[r.hire_id]));
  const sortByName = (a: RosterRow, b: RosterRow) => fullName(a.hire.person).localeCompare(fullName(b.hire.person));

  const onStart = (e: DragStartEvent) => setDragging(byHire.get(String(e.active.data.current?.hireId)) || null);
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const hireId = String(e.active.data.current?.hireId || '');
    const over = e.over ? String(e.over.id) : '';
    if (!hireId || !over) return;
    if (over === 'pool') onAssign(hireId, null);
    else if (over.startsWith('team:')) onAssign(hireId, over.slice(5));
    else if (over.startsWith('new:')) { const [, mid, kind] = over.split(':'); onNewTeam(mid, kind as PlanTeam['kind'], hireId); }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
      <div className={side ? 'v2-plan' : undefined}>
      {side && <Drop id="pool" className="v2-drop v2-side-drop">{side({ Draggable: SideDraggable })}</Drop>}
      <div className="v2-stack">
        {!side && <Drop id="pool" className="v2-card v2-drop">
          <div className="v2-row" style={{ marginBottom: 8 }}>
            <b>Not on a team</b><span className="v2-mut v2-small">{unassigned.length}</span>
            <span className="v2-spacer" /><span className="v2-mut v2-small">Drag people onto a cart, a ramp crew, or a “new” box</span>
          </div>
          <div className="v2-people">
            {unassigned.sort(sortByName).map(r => <Person key={r.hire_id} row={r} />)}
            {unassigned.length === 0 && <span className="v2-mut v2-small">{people.length ? (emptyPoolText || 'Everyone who showed is on a team.') : 'Tick who showed in roll call first.'}</span>}
          </div>
        </Drop>}

        {managers.map(m => {
          const mine = teams.filter(t => t.managerId === m.id);
          return (
            <div key={m.id} className="v2-card">
              <div className="v2-row" style={{ marginBottom: 10 }}><b>{m.full_name}</b>
                <span className="v2-mut v2-small">{mine.length} team{mine.length === 1 ? '' : 's'} · {people.filter(r => mine.some(t => t.name === members[r.hire_id])).length} on teams</span></div>
              <div className="v2-teams">
                {mine.map(t => {
                  const inTeam = people.filter(r => members[r.hire_id] === t.name).sort(sortByName);
                  return (
                    <Drop key={t.name} id={`team:${t.name}`} className={`v2-team v2-drop${t.kind === 'ramp' ? ' ramp' : ''}`}>
                      <div className="v2-row" style={{ gap: 6, flexWrap: 'nowrap', marginBottom: 6 }}>
                        <b className="v2-small" style={{ flex: 1 }}>{teamLabel(t)}</b>
                        <label className="v2-row v2-small" style={{ gap: 4, flexWrap: 'nowrap' }} title="Ramp crews do the asphalt work">Ramp
                          <Toggle on={t.kind === 'ramp'} onChange={v => onRamp(t.name, v)} label={`Ramp crew ${t.name}`} /></label>
                        <select className="v2-sel" style={{ padding: '2px 4px', width: 84, fontSize: 12 }} value={t.managerId} aria-label={`Manager for ${teamLabel(t)}`}
                          onChange={e => onManager(t.name, e.target.value)}>
                          {managers.map(o => <option key={o.id} value={o.id}>{o.full_name.split(' ')[0]}</option>)}
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
                <Drop id={`new:${m.id}:cart`} className="v2-team v2-drop new">
                  <button type="button" className="v2-link" onClick={() => onNewTeam(m.id, 'cart')}><Plus size={14} /> New cart</button>
                  <span className="v2-mut v2-small">or drop someone here</span>
                </Drop>
                <Drop id={`new:${m.id}:ramp`} className="v2-team v2-drop new">
                  <button type="button" className="v2-link" onClick={() => onNewTeam(m.id, 'ramp')}><Truck size={14} /> New ramp crew</button>
                  <span className="v2-mut v2-small">or drop someone here</span>
                </Drop>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <DragOverlay dropAnimation={null}>{dragging ? <Person row={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
};
