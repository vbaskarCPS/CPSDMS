// src/planner/features/habits/HabitForm.tsx — /habits/new and /habits/:id/edit, built around the Four Laws.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, Header, Card, Button, Field, Input, TextArea, useToast, uid } from '../../ui/primitives';
import { getDoc, getDocs, putDoc } from '../../lib/docs';
import { emptyHabit, DAY_SHORT, type Habit } from './types';

function fmtTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ap = h >= 12 ? 'pm' : 'am', hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

export function HabitForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [h, setH] = useState<Habit>(() => emptyHabit());
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [toast, say] = useToast();
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!id) {
      getDocs<Habit>('habit').then(ds => setH(x => ({ ...x, order: ds.length }))).catch(() => undefined);
      return;
    }
    getDoc<Habit>('habit', id).then(d => { if (d) setH({ ...emptyHabit(), ...d, cue: d.cue || { time: '', place: '' }, days: d.days?.length ? d.days : emptyHabit().days }); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  const set = (patch: Partial<Habit>) => setH(x => ({ ...x, ...patch }));
  const toggleDay = (d: number) => set({ days: h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d].sort() });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!h.name.trim() || busy) return;
    setBusy(true);
    const doc: Habit = { ...h, id: h.id || uid(), name: h.name.trim(), days: h.days.length ? h.days : emptyHabit().days };
    try { await putDoc('habit', doc.id, doc); nav(id ? `/habits/${doc.id}` : '/habits', { replace: true }); }
    catch (x) { say(x instanceof Error ? x.message : 'Could not save', 'bad'); setBusy(false); }
  };

  const archive = async () => {
    if (!confirmArchive) { setConfirmArchive(true); return; }
    try { await putDoc('habit', h.id, { ...h, archived: true }); nav('/habits', { replace: true }); }
    catch (x) { say(x instanceof Error ? x.message : 'Could not archive', 'bad'); }
  };

  const intention = h.name.trim() ? <>I will <em>{h.name.trim()}</em>{h.cue.time ? <> at <em>{fmtTime(h.cue.time)}</em></> : ''}{h.cue.place.trim() ? <> in <em>{h.cue.place.trim()}</em></> : ''}.</> : null;
  const stack = h.stack.trim() && h.name.trim() ? <>After I <em>{h.stack.trim().replace(/^after i\s+/i, '').replace(/[.,]+$/, '')}</em>, I will <em>{h.name.trim()}</em>.</> : null;

  if (loading) return <Page><Header back="/habits" title="Habit" /><p className="pl-muted">Loading…</p></Page>;

  return (
    <Page>
      <Header back={id ? `/habits/${id}` : '/habits'} eyebrow={id ? 'Edit habit' : 'New habit'} title={id ? h.name || 'Habit' : 'Build a habit'} />
      <form className="pl-stack" style={{ gap: 16 }} onSubmit={submit}>
        <Card>
          <Field label="The habit" hint="Name the action, not the outcome. “Read 1 page”, not “become a reader”.">
            <Input value={h.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Read 10 pages" required autoFocus={!id} />
          </Field>
        </Card>

        <Card className="hb-law">
          <div className="hb-law__title"><span className="hb-law__n">1</span><div><h3>Make it obvious</h3><p className="hb-law__blurb">Tie it to a time and a place. Vague plans don't happen.</p></div></div>
          <div className="pl-grid-2">
            <Field label="Time"><Input type="time" value={h.cue.time} onChange={e => set({ cue: { ...h.cue, time: e.target.value } })} /></Field>
            <Field label="Place"><Input value={h.cue.place} onChange={e => set({ cue: { ...h.cue, place: e.target.value } })} placeholder="kitchen table" /></Field>
          </div>
          {intention && <p className="hb-sentence">{intention}</p>}
          <Field label="Stack it on a habit you already have" hint="“After I pour my coffee…”">
            <Input value={h.stack} onChange={e => set({ stack: e.target.value })} placeholder="After I pour my morning coffee" />
          </Field>
          {stack && <p className="hb-sentence">{stack}</p>}
          <Field label="Which days">
            <div className="hb-days">{DAY_SHORT.map((d, i) => <button type="button" key={i} className={h.days.includes(i) ? 'is-on' : ''} aria-pressed={h.days.includes(i)} onClick={() => toggleDay(i)}>{d[0]}</button>)}</div>
          </Field>
        </Card>

        <Card className="hb-law">
          <div className="hb-law__title"><span className="hb-law__n">2</span><div><h3>Make it attractive</h3><p className="hb-law__blurb">Every rep is a vote for the person you want to be.</p></div></div>
          <Field label="Identity" hint="Finish the sentence: I'm the kind of person who…">
            <Input value={h.identity} onChange={e => set({ identity: e.target.value })} placeholder="I'm the kind of person who reads every day" />
          </Field>
          <Field label="Why it matters to you">
            <TextArea value={h.why} onChange={e => set({ why: e.target.value })} placeholder="What does this give you a year from now?" />
          </Field>
        </Card>

        <Card className="hb-law">
          <div className="hb-law__title"><span className="hb-law__n">3</span><div><h3>Make it easy</h3><p className="hb-law__blurb">Scale it down until it's impossible to say no.</p></div></div>
          <Field label="The two-minute version" hint="What's the version that takes under 2 minutes? On a bad day, that still counts.">
            <Input value={h.twoMinute} onChange={e => set({ twoMinute: e.target.value })} placeholder="Open the book and read one paragraph" />
          </Field>
        </Card>

        <Card className="hb-law">
          <div className="hb-law__title"><span className="hb-law__n">4</span><div><h3>Make it satisfying</h3><p className="hb-law__blurb">The streak and the weekly scorecard are your reward. Never miss twice: one off day is fine, two in a row resets the chain.</p></div></div>
        </Card>

        {toast}
        <Button primary block disabled={busy || !h.name.trim()}>{busy ? 'Saving…' : id ? 'Save changes' : 'Start this habit'}</Button>
        {id && !h.archived && (
          <Button type="button" ghost danger block onClick={archive}>{confirmArchive ? 'Tap again to archive' : 'Archive this habit'}</Button>
        )}
      </form>
    </Page>
  );
}
