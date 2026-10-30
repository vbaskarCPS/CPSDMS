// src/planner/features/workout/Templates.tsx — /workout/templates and /workout/templates/:id.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { Page, Header, Card, Button, Field, Input, Empty, useToast, uid } from '../../ui/primitives';
import { loadCustomExercises, loadTemplates, saveTemplate, WEEKDAYS } from './store';
import type { Exercise, Template, TemplateExercise } from './types';
import { ExercisePicker } from './parts';

export function Templates() {
  const [list, setList] = useState<Template[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const nav = useNavigate();
  useEffect(() => { void loadTemplates().then(setList); }, []);
  const live = list.filter(t => !t.archived), archived = list.filter(t => t.archived);

  const create = async () => {
    const t: Template = { id: uid(), name: 'New plan', exercises: [], order: list.length };
    await saveTemplate(t); nav(`/workout/templates/${t.id}`);
  };

  return (
    <Page>
      <Header back="/workout" eyebrow="Train" title="Templates" right={<Button small primary onClick={() => void create()}><Plus size={16} /> New</Button>} />
      {!live.length && <Card><Empty title="No plans" blurb="A plan is a list of exercises with sets, reps and rest." action={<Button primary onClick={() => void create()}>Make one</Button>} /></Card>}
      {live.map(t => (
        <Link key={t.id} className="pl-tile" to={`/workout/templates/${t.id}`}>
          <div className="pl-grow"><b>{t.name}</b><small>{t.exercises.length} exercises{t.days?.length ? ` · ${t.days.map(d => WEEKDAYS[d]).join(', ')}` : ''}</small></div>
        </Link>
      ))}
      {archived.length > 0 && (
        <>
          <Button ghost onClick={() => setShowArchived(s => !s)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</Button>
          {showArchived && archived.map(t => <Link key={t.id} className="pl-tile" to={`/workout/templates/${t.id}`} style={{ opacity: 0.6 }}><div className="pl-grow"><b>{t.name}</b><small>archived</small></div></Link>)}
        </>
      )}
    </Page>
  );
}

export function TemplateEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState<Template | null>(null);
  const [custom, setCustom] = useState<Exercise[]>([]);
  const [picker, setPicker] = useState(false);
  const [toast, say] = useToast();
  const timer = useState<{ id?: number }>(() => ({}))[0];

  useEffect(() => {
    void loadTemplates().then(list => setT(list.find(x => x.id === id) || null));
    void loadCustomExercises().then(setCustom);
  }, [id]);

  const update = (p: Partial<Template>) => {
    if (!t) return;
    const next = { ...t, ...p }; setT(next);
    window.clearTimeout(timer.id);
    timer.id = window.setTimeout(() => { void saveTemplate(next).catch(() => say("Couldn't save", 'bad')); }, 600);
  };
  const updateEx = (i: number, p: Partial<TemplateExercise>) => t && update({ exercises: t.exercises.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  const move = (i: number, d: -1 | 1) => {
    if (!t) return; const j = i + d; if (j < 0 || j >= t.exercises.length) return;
    const ex = [...t.exercises]; [ex[i], ex[j]] = [ex[j], ex[i]]; update({ exercises: ex });
  };
  const duplicate = async () => {
    if (!t) return;
    const copy: Template = { ...t, id: uid(), name: `${t.name} (copy)`, order: t.order + 1, archived: false };
    await saveTemplate(copy); nav(`/workout/templates/${copy.id}`);
  };

  if (!t) return <Page><Header back="/workout/templates" title="Loading…" /></Page>;
  return (
    <Page>
      <Header back="/workout/templates" eyebrow="Template" title={t.name} />
      <Card className="pl-stack">
        <Field label="Name"><Input value={t.name} onChange={e => update({ name: e.target.value })} /></Field>
        <Field label="Planned days">
          <div className="wo-days">{[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} type="button" className={t.days?.includes(d) ? 'is-on' : ''} onClick={() => update({ days: t.days?.includes(d) ? t.days.filter(x => x !== d) : [...(t.days || []), d] })}>{WEEKDAYS[d]}</button>)}</div>
        </Field>
      </Card>

      <Card>
        <h3>Exercises</h3>
        {t.exercises.map((e, i) => (
          <div key={`${e.exerciseId}-${i}`} className="wo-tplex">
            <div>
              <b>{e.name}</b>
              <div className="wo-tplex__fields">
                <label>Sets<input className="pl-input" inputMode="numeric" value={e.targetSets} onChange={x => updateEx(i, { targetSets: Math.max(1, parseInt(x.target.value) || 1) })} /></label>
                <label>Reps<input className="pl-input" value={e.targetReps} placeholder="8-12" onChange={x => updateEx(i, { targetReps: x.target.value })} /></label>
                <label>Rest (s)<input className="pl-input" inputMode="numeric" value={e.restSec} onChange={x => updateEx(i, { restSec: Math.max(0, parseInt(x.target.value) || 0) })} /></label>
              </div>
            </div>
            <div className="wo-tplex__btns">
              <button type="button" aria-label="Up" onClick={() => move(i, -1)}><ArrowUp /></button>
              <button type="button" aria-label="Down" onClick={() => move(i, 1)}><ArrowDown /></button>
              <button type="button" aria-label="Remove" onClick={() => update({ exercises: t.exercises.filter((_, j) => j !== i) })}><Trash2 /></button>
            </div>
          </div>
        ))}
        <Button block style={{ marginTop: 10 }} onClick={() => setPicker(true)}><Plus size={18} /> Add exercise</Button>
      </Card>

      <div className="pl-grid-2">
        <Button onClick={() => void duplicate()}><Copy size={16} /> Duplicate</Button>
        <Button ghost onClick={() => { update({ archived: !t.archived }); say(t.archived ? 'Restored' : 'Archived'); }}>{t.archived ? <><ArchiveRestore size={16} /> Restore</> : <><Archive size={16} /> Archive</>}</Button>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} custom={custom} onCustomAdded={e => setCustom(c => [...c, e])}
        onPick={e => { update({ exercises: [...t.exercises, { exerciseId: e.id, name: e.name, targetSets: 3, targetReps: e.type === 'cardio' ? '1' : '8-12', restSec: 90 }] }); setPicker(false); }} />
      {toast}
    </Page>
  );
}
