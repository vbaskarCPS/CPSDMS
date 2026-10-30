// src/planner/features/food/Targets.tsx — daily kcal and macro targets, with a quick helper.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPass } from '../../lib/auth';
import { routineNow } from '../../lib/routine';
import { isMorning, swayOnNow } from './sway/prefs';
import { putDoc } from '../../lib/docs';
import { Button, Card, Field, Header, Input, Page, Segmented, useToast } from '../../ui/primitives';
import { DEFAULT_TARGETS, loadTargets, suggestTargets, type Goal, type Targets } from './model';

export function TargetsScreen() {
  const nav = useNavigate();
  const units = getPass()?.user.settings.units === 'kg' ? 'kg' : 'lb';
  const [t, setT] = useState<Targets>(DEFAULT_TARGETS);
  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState<Goal>('maintain');
  const [saving, setSaving] = useState(false);
  const [toast, show] = useToast();

  useEffect(() => { loadTargets().then(x => { if (x) setT(x); }).catch(() => undefined); }, []);

  const n = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const w = Number(weight);
  const suggestion = w > 0 ? suggestTargets(w, units, goal) : null;
  const save = async () => {
    setSaving(true);
    try { await putDoc('foodprefs', 'targets', { kcal: t.kcal || DEFAULT_TARGETS.kcal, protein: t.protein || DEFAULT_TARGETS.protein, carbs: t.carbs || undefined, fat: t.fat || undefined }); show('Targets saved', 'good'); nav('/food', { replace: true }); }
    catch { show('Could not save', 'bad'); setSaving(false); }
  };

  return (
    <Page>
      <Header title="Targets" eyebrow={routineNow().fast ? 'Per day · 2 meals: dinner + shake' : 'Per day'} back="/food" />
      <Card>
        <div className="pl-stack">
          <p className="pl-eyebrow">Quick helper</p>
          <Field label={`Body weight (${units})`}><Input inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} placeholder={units === 'kg' ? '80' : '175'} /></Field>
          <Segmented value={goal} onChange={setGoal} options={[{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }]} />
          {suggestion ? (
            <div className="pl-row">
              <p className="pl-grow" style={{ fontSize: 14 }}><b>{suggestion.kcal} kcal</b> · {suggestion.protein} g protein · {suggestion.carbs} g carbs · {suggestion.fat} g fat</p>
              <Button small onClick={() => setT(suggestion)}>Use these</Button>
            </div>
          ) : <p className="pl-muted" style={{ fontSize: 13 }}>Rule of thumb: 14 / 15 / 17 kcal per lb for lose / maintain / gain, and 0.8 g protein per lb.</p>}
        </div>
      </Card>
      <Card>
        <div className="pl-stack">
          <div className="pl-grid-2">
            <Field label="Calories"><Input inputMode="numeric" value={t.kcal || ''} onChange={e => setT({ ...t, kcal: n(e.target.value) })} /></Field>
            <Field label="Protein (g)"><Input inputMode="numeric" value={t.protein || ''} onChange={e => setT({ ...t, protein: n(e.target.value) })} /></Field>
            <Field label="Carbs (g)" hint="optional"><Input inputMode="numeric" value={t.carbs || ''} onChange={e => setT({ ...t, carbs: n(e.target.value) })} /></Field>
            <Field label="Fat (g)" hint="optional"><Input inputMode="numeric" value={t.fat || ''} onChange={e => setT({ ...t, fat: n(e.target.value) })} /></Field>
          </div>
          <Button primary block onClick={save} disabled={saving || !t.kcal || !t.protein}>{saving ? 'Saving…' : 'Save targets'}</Button>
        </div>
      </Card>
      {isMorning() && !swayOnNow() && <p className="pl-muted" style={{ fontSize: 13, textAlign: 'center' }}>Trying for a girl? <Link to="/food/sway">Sway guide</Link></p>}
      {toast}
    </Page>
  );
}
