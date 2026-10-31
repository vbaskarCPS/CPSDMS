// src/planner/features/habits/HabitForm.tsx — /habits/new and /habits/:id/edit, built around the Four Laws.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, Header, Card, Button, Field, Input, TextArea, useToast, uid } from '../../ui/primitives';
import { getDoc, getDocs, putDoc } from '../../lib/docs';
import { emptyHabit, DAY_SHORT, type Habit } from './types';
import { AUTO_LABELS, type AutoTrigger } from './auto';
import { Sparkles } from 'lucide-react';
import { planHabit } from '../../lib/ai';
import { blocks, loadRoutine, routineNow, type Block, type Routine } from '../../lib/routine';

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
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [idea, setIdea] = useState('');
  const [planning, setPlanning] = useState(false);
  const [coachNote, setCoachNote] = useState<string | null>(null);
  const [existing, setExisting] = useState<string[]>([]);
  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  const slots: Block[] = blocks(routine);

  useEffect(() => {
    if (!id) {
      getDocs<Habit>('habit').then(ds => { setH(x => ({ ...x, order: ds.length })); setExisting(ds.map(d => d.data?.name).filter(Boolean)); }).catch(() => undefined);
      return;
    }
    getDoc<Habit>('habit', id).then(d => { if (d) setH({ ...emptyHabit(), ...d, cue: d.cue || { time: '', place: '' }, days: d.days?.length ? d.days : emptyHabit().days }); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  const set = (patch: Partial<Habit>) => setH(x => ({ ...x, ...patch }));
  const slotOf = (id?: string) => slots.find(s => s.id === id);
  /** Anchor → the cue time and a stack sentence, unless the person typed their own. */
  const setAnchor = (block: string, when: 'before' | 'after') => {
    if (!block) { set({ anchor: undefined }); return; }
    const s = slotOf(block);
    const time = s ? (when === 'after' ? (s.until || s.at) : s.at) : h.cue.time;
    set({ anchor: { block, when }, cue: { ...h.cue, time: time || h.cue.time }, stack: h.stack.trim() && !/^(after|before) /i.test(h.stack) ? h.stack : `${when === 'after' ? 'After' : 'Before'} ${s ? s.label.toLowerCase() : ''}` });
  };
  const plan = async () => {
    if (!idea.trim() || planning) return;
    setPlanning(true); setCoachNote(null);
    try {
      const r = await planHabit(idea.trim(), slots.map(s => ({ id: s.id, label: s.label, at: s.at, until: s.until })), existing);
      const valid = slotOf(r.anchor?.block) ? r.anchor : undefined;
      const auto = r.auto && (Object.keys(AUTO_LABELS) as string[]).includes(r.auto) ? (r.auto as Habit['auto']) : undefined;
      set({ name: r.name || h.name, identity: r.identity || '', why: r.why || '', twoMinute: r.twoMinute || '', stack: r.stack || '', cue: { time: r.cue?.time || '', place: r.cue?.place || '' }, days: Array.isArray(r.days) && r.days.length ? r.days.filter(d => d >= 0 && d <= 6) : h.days, anchor: valid, auto });
      setCoachNote(r.coach_note || null);
    } catch (x) { say(x instanceof Error ? x.message : "Couldn't reach Coach Claude", 'bad'); }
    finally { setPlanning(false); }
  };
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
  const stack = h.stack.trim() && h.name.trim() ? <>{/^before/i.test(h.stack.trim()) ? 'Before' : 'After'} I <em>{h.stack.trim().replace(/^(after|before)( i)?\s+/i, '').replace(/[.,]+$/, '')}</em>, I will <em>{h.name.trim()}</em>.</> : null;

  if (loading) return <Page><Header back="/habits" title="Habit" /><p className="pl-muted">Loading…</p></Page>;

  return (
    <Page>
      <Header back={id ? `/habits/${id}` : '/habits'} eyebrow={id ? 'Edit habit' : 'New habit'} title={id ? h.name || 'Habit' : 'Build a habit'} />
      <form className="pl-stack" style={{ gap: 16 }} onSubmit={submit}>
        {!id && (
          <Card accent className="pl-stack" style={{ gap: 8 }}>
            <b><Sparkles size={16} aria-hidden style={{ verticalAlign: -2 }} /> Plan it with Coach Claude</b>
            <p style={{ fontSize: 13, margin: 0, opacity: .85 }}>Say what you want to do. Coach Claude writes the implementation intention, picks where it stacks in your day, and fills in the rest — edit anything below.</p>
            <TextArea rows={2} value={idea} onChange={e => setIdea(e.target.value)} placeholder="e.g. read 10 pages a day · stretch my hips · call my mum weekly · 2 L of water" style={{ background: 'color-mix(in srgb, var(--accent-ink) 12%, transparent)', color: 'inherit' }} />
            <Button small type="button" disabled={planning || !idea.trim()} onClick={plan} style={{ background: 'var(--accent-ink)', color: 'var(--accent)', border: 0 }}>{planning ? 'Planning…' : 'Design this habit'}</Button>
            {coachNote && <p style={{ fontSize: 13, margin: 0 }}>{coachNote}</p>}
          </Card>
        )}
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
          <Field label="Stack it on your day" hint="Every habit sits before or after one slot of the routine — that slot is the trigger.">
            <div className="pl-grid-2">
              <select className="pl-input" value={h.anchor?.when || 'after'} onChange={e => setAnchor(h.anchor?.block || slots[0]?.id || '', e.target.value as 'before' | 'after')}><option value="after">After</option><option value="before">Before</option></select>
              <select className="pl-input" value={h.anchor?.block || ''} onChange={e => setAnchor(e.target.value, h.anchor?.when || 'after')}>
                <option value="">— pick a slot —</option>
                {slots.map(s => <option key={s.id} value={s.id}>{s.label} · {fmtTime(s.at)}</option>)}
              </select>
            </div>
          </Field>
          <Field label="The stack sentence" hint="“After I [finish that], I will …”">
            <Input value={h.stack} onChange={e => set({ stack: e.target.value })} placeholder="After I finish the Bed Brief" />
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
          <Field label="Ticks itself when…" hint="Tie it to something the planner already records, so you never have to tick it by hand.">
            <select className="pl-input" value={h.auto || ''} onChange={e => set({ auto: (e.target.value || undefined) as Habit['auto'] })}>
              <option value="">I tick it by hand</option>
              {(Object.keys(AUTO_LABELS) as AutoTrigger[]).map(k => <option key={k} value={k}>{AUTO_LABELS[k]}</option>)}
            </select>
          </Field>
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
