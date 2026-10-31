// src/planner/features/calendar/Calendar.tsx — /calendar: the household's month, a day's events, add/edit.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Users } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { calendarKey } from '../../lib/docs';
import { clock } from '../../lib/routine';
import { Page, Header, Card, Button, Sheet, Field, Input, TextArea, useToast, uid } from '../../ui/primitives';
import { loadEvents, removeEvent, saveEvent } from './store';
import { addDays, addMonths, eventsOn, WHO_LABEL, type CalEvent, type Repeat, type Who } from './types';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

function blank(date: string, who: Who, by: string): CalEvent {
  return { id: uid(), title: '', date, who, repeat: 'none', createdBy: by, createdAt: new Date().toISOString() };
}

export function Calendar({ pass }: { pass: PlannerPass }) {
  const today = calendarKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<CalEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const me: Who = pass.user.username === 'rosh' ? 'rosh' : 'vijay';

  // the visible grid: from the Sunday before the 1st to the Saturday after the last day
  const grid = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00`);
    const start = addDays(`${month}-01`, -first.getDay());
    const days: string[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));
    return days.slice(0, days[35].slice(0, 7) === month ? 42 : 35);
  }, [month]);

  const reload = useCallback(async () => {
    try { setEvents(await loadEvents(grid[0], grid[grid.length - 1])); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not load', 'bad'); }
    finally { setLoading(false); }
  }, [grid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);

  const byDay = useMemo(() => Object.fromEntries(grid.map(d => [d, eventsOn(events, d)])), [grid, events]);
  const dayEvents = byDay[selected] || eventsOn(events, selected);

  const save = async () => {
    if (!edit || !edit.title.trim() || busy) return;
    setBusy(true);
    try {
      const e = { ...edit, title: edit.title.trim(), time: edit.time || undefined, endTime: edit.time ? edit.endTime || undefined : undefined, notes: edit.notes?.trim() || undefined, repeat: edit.repeat === 'none' ? undefined : edit.repeat, until: edit.repeat && edit.repeat !== 'none' && edit.until ? edit.until : undefined };
      await saveEvent(e);
      setEvents(list => (list.some(x => x.id === e.id) ? list.map(x => (x.id === e.id ? e : x)) : [...list, e]));
      setEdit(null); say('Saved', 'good');
    } catch (x) { say(x instanceof Error ? x.message : "Couldn't save", 'bad'); }
    finally { setBusy(false); }
  };
  const remove = async (e: CalEvent, onlyThisDay?: string) => {
    setBusy(true);
    try {
      if (onlyThisDay && e.repeat && e.repeat !== 'none') {
        const next = { ...e, skip: [...(e.skip || []), onlyThisDay] };
        await saveEvent(next); setEvents(list => list.map(x => (x.id === e.id ? next : x)));
      } else {
        await removeEvent(e); setEvents(list => list.filter(x => x.id !== e.id));
      }
      setEdit(null);
    } catch (x) { say(x instanceof Error ? x.message : "Couldn't remove", 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Page>
      <Header back="/" eyebrow={<span className="pl-row" style={{ gap: 4 }}><Users size={12} /> Vijay &amp; Rosh</span>} title="Calendar" right={<Button small primary onClick={() => setEdit(blank(selected, 'both', pass.user.username))}><Plus size={16} /> Event</Button>} />

      <Card className="cal">
        <div className="cal__head">
          <button type="button" className="pl-btn pl-btn--ghost cal__nav" aria-label="Previous month" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><ChevronLeft /></button>
          <b>{monthLabel(month)}</b>
          <button type="button" className="pl-btn pl-btn--ghost cal__nav" aria-label="Next month" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}><ChevronRight /></button>
        </div>
        <div className="cal__grid">
          {DOW.map((d, i) => <span key={i} className="cal__dow">{d}</span>)}
          {grid.map(d => {
            const evs = byDay[d] || [];
            return (
              <button type="button" key={d} className={`cal__day ${d.slice(0, 7) !== month ? 'is-out' : ''} ${d === today ? 'is-today' : ''} ${d === selected ? 'is-selected' : ''}`} onClick={() => { setSelected(d); if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7)); }}>
                <span>{Number(d.slice(8))}</span>
                {evs.length > 0 && <span className="cal__dots">{evs.slice(0, 3).map(e => <i key={e.id} className={`is-${e.who}`} />)}</span>}
              </button>
            );
          })}
        </div>
        {month !== today.slice(0, 7) && <Button small ghost onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</Button>}
      </Card>

      <Card>
        <div className="pl-row" style={{ marginBottom: 6 }}><h3 className="pl-grow">{selected === today ? 'Today' : selected === addDays(today, 1) ? 'Tomorrow' : dayLabel(selected)}</h3><Button small ghost onClick={() => setEdit(blank(selected, 'both', pass.user.username))}><Plus size={14} /> Add</Button></div>
        {loading ? <p className="pl-muted">Loading…</p> : dayEvents.length === 0 ? <p className="pl-muted" style={{ fontSize: 14 }}>Nothing on.</p> : (
          <div className="cal__list">
            {dayEvents.map(e => (
              <button type="button" key={e.id} className={`cal__event is-${e.who}`} onClick={() => setEdit({ ...e, repeat: e.repeat || 'none' })}>
                <span className="cal__time">{e.time ? clock(e.time) + (e.endTime ? `–${clock(e.endTime)}` : '') : 'all day'}</span>
                <span className="cal__title">{e.title}{e.repeat && e.repeat !== 'none' ? <small> · repeats</small> : null}{e.notes ? <small> · {e.notes}</small> : null}</span>
                <span className="cal__who">{WHO_LABEL[e.who]}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
      <p className="pl-muted" style={{ fontSize: 12, textAlign: 'center' }}>One calendar for the household — {me === 'rosh' ? 'Vijay' : 'Rosh'} sees the same events in {me === 'rosh' ? 'his' : 'her'} app.</p>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit && events.some(x => x.id === edit.id) ? 'Edit event' : 'New event'}>
        {edit && (
          <div className="pl-stack">
            <Field label="What"><Input autoFocus value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} placeholder="Kiaan's swim · Dinner at Mum's · Dentist" /></Field>
            <div className="pl-grid-2">
              <Field label="Date"><Input type="date" value={edit.date} onChange={e => setEdit({ ...edit, date: e.target.value })} /></Field>
              <Field label="Time (blank = all day)"><Input type="time" value={edit.time || ''} onChange={e => setEdit({ ...edit, time: e.target.value })} /></Field>
            </div>
            {edit.time && <Field label="Ends"><Input type="time" value={edit.endTime || ''} onChange={e => setEdit({ ...edit, endTime: e.target.value })} /></Field>}
            <Field label="Who">
              <div className="cal__whochips">{(Object.keys(WHO_LABEL) as Who[]).map(w => <button type="button" key={w} className={`is-${w} ${edit.who === w ? 'is-on' : ''}`} onClick={() => setEdit({ ...edit, who: w })}>{WHO_LABEL[w]}</button>)}</div>
            </Field>
            <div className="pl-grid-2">
              <Field label="Repeats">
                <select className="pl-input" value={edit.repeat || 'none'} onChange={e => setEdit({ ...edit, repeat: e.target.value as Repeat })}>
                  <option value="none">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                </select>
              </Field>
              {edit.repeat && edit.repeat !== 'none' && <Field label="Until (optional)"><Input type="date" value={edit.until || ''} onChange={e => setEdit({ ...edit, until: e.target.value })} /></Field>}
            </div>
            <Field label="Notes"><TextArea rows={2} value={edit.notes || ''} onChange={e => setEdit({ ...edit, notes: e.target.value })} placeholder="Address, what to bring…" /></Field>
            <Button block primary disabled={busy || !edit.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
            {events.some(x => x.id === edit.id) && (
              <div className="pl-row" style={{ gap: 8 }}>
                {edit.repeat && edit.repeat !== 'none' && <Button small ghost danger disabled={busy} onClick={() => void remove(edit, selected)}><Trash2 size={14} /> Just this day</Button>}
                <Button small ghost danger disabled={busy} onClick={() => void remove(edit)}><Trash2 size={14} /> {edit.repeat && edit.repeat !== 'none' ? 'All of them' : 'Remove'}</Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}
