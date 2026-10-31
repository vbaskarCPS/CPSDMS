// src/planner/features/plan/TodoList.tsx — the day's to-do list (day.todos): tick, time, text, remove, add.
// In the order you want to tackle it (move up/down); a time beside an item is a reminder, not a sort.
// Used by the Brief's last step (editing), Today's "Tackle the list" block and the day page.
import { useState } from 'react';
import { Check, Plus, X, Clock, ChevronUp, ChevronDown, Star } from 'lucide-react';
import { uid } from '../../ui/primitives';
import { clock } from '../../lib/routine';
import { moveTodo, sortedTodos, syncPriorities, toggleMust, toggleTodo, type Day, type Todo } from './types';

export function TodoList({ day, set, edit = true, compact = false, suggestions = [] }: { day: Day; set: (fn: (d: Day) => Day) => void; edit?: boolean; compact?: boolean; suggestions?: { text: string; time?: string; must?: boolean }[] }) {
  const [adding, setAdding] = useState('');
  const [timing, setTiming] = useState<string | null>(null);
  const list = sortedTodos(day.todos);
  const patch = (id: string, p: Partial<Todo>) => set(d => syncPriorities({ ...d, todos: d.todos.map(t => (t.id === id ? { ...t, ...p } : t)) }));
  const remove = (id: string) => set(d => syncPriorities({ ...d, todos: d.todos.filter(t => t.id !== id) }));
  const add = (text = adding.trim(), time?: string, must = false) => { if (!text) return; set(d => syncPriorities({ ...d, todos: [...d.todos, { id: uid(), text, done: false, from: 'me', time, must }] })); setAdding(''); };
  const onList = new Set(day.todos.map(t => t.text.trim().toLowerCase()));
  const offer = suggestions.filter(s => !onList.has(s.text.trim().toLowerCase()));
  const done = day.todos.filter(t => t.done).length;
  return (
    <div className={`todo ${compact ? 'todo--compact' : ''}`}>
      {list.length === 0 && <p className="pl-muted" style={{ fontSize: 13, margin: '4px 0' }}>Nothing on the list yet.</p>}
      {list.map((t, i) => (
        <div key={t.id} className={`todo__row ${t.done ? 'is-done' : ''} ${t.must ? 'is-priority' : ''}`}>
          {edit && <span className="todo__move"><button type="button" aria-label="Move up" disabled={i === 0} onClick={() => set(d => moveTodo(d, t.id, -1))}><ChevronUp size={14} /></button><button type="button" aria-label="Move down" disabled={i === list.length - 1} onClick={() => set(d => moveTodo(d, t.id, 1))}><ChevronDown size={14} /></button></span>}
          <button type="button" className={`pl-check ${t.done ? 'is-on' : ''}`} aria-label={t.done ? 'Mark not done' : 'Mark done'} onClick={() => set(d => toggleTodo(d, t.id))}><Check /></button>
          <div className="todo__main">
            {edit
              ? <input className="todo__text" value={t.text} onChange={e => patch(t.id, { text: e.target.value })} />
              : <span className="todo__text">{t.text}</span>}
            {(t.note || t.must) && <small className="pl-muted">{t.must ? 'must do' : ''}{t.must && t.note ? ' · ' : ''}{t.note || ''}</small>}
          </div>
          <button type="button" className={`todo__must ${t.must ? 'is-on' : ''}`} disabled={!edit && !t.must} aria-label={t.must ? 'Not a must-do' : 'Must do'} onClick={() => edit && set(d => toggleMust(d, t.id))}><Star size={15} /></button>
          {edit && timing === t.id
            ? <input type="time" className="todo__time-input" autoFocus value={t.time || ''} onChange={e => patch(t.id, { time: e.target.value || undefined })} onBlur={() => setTiming(null)} />
            : <button type="button" className={`todo__time ${t.time ? 'is-set' : ''}`} disabled={!edit} onClick={() => setTiming(t.id)} aria-label="Set a time">{t.time ? clock(t.time) : <Clock size={14} />}</button>}
          {edit && <button type="button" className="todo__x" aria-label="Remove" onClick={() => remove(t.id)}><X size={14} /></button>}
        </div>
      ))}
      {edit && offer.length > 0 && (
        <div className="todo__suggest">
          <small className="pl-muted">Tap to add{offer.some(s => s.must) ? ' · ★ = Coach Claude thinks it\'s a must' : ' — often on your list'}</small>
          <div className="todo__chips">{offer.map(s => <button key={s.text} type="button" className={s.must ? 'is-must' : ''} onClick={() => add(s.text, s.time, !!s.must)}>{s.must ? '★ ' : ''}{s.text}{s.time ? <em> {clock(s.time)}</em> : null}</button>)}</div>
        </div>
      )}
      {edit && (
        <div className="todo__add">
          <input className="pl-input" placeholder="Add to the list…" value={adding} onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <button type="button" className="pl-btn pl-btn--small" onClick={() => add()} disabled={!adding.trim()}><Plus size={16} /></button>
        </div>
      )}
      {list.length > 0 && <p className="pl-muted" style={{ fontSize: 12, margin: '6px 0 0' }}>{done}/{list.length} done</p>}
    </div>
  );
}
