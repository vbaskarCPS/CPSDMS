// src/planner/features/food/RecipePage.tsx — /food/recipes/:id: one recipe. Servings scale the ingredients and the
// numbers; "Add to shopping list" sends the parts you pick; Edit fixes anything the import got wrong.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Minus, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { getDoc } from '../../lib/docs';
import { Button, Card, Field, Header, Input, Page, TextArea, useToast } from '../../ui/primitives';
import { fmtQty, ingredientLine, ingredientsText, parseIngredient, removeRecipe, saveRecipe, type Recipe } from './recipes';
import { ShopSheet } from './ShopSheet';

export function RecipePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [r, setR] = useState<Recipe | null | undefined>(undefined);
  const [servings, setServings] = useState(1);
  const [editing, setEditing] = useState(false);
  const [shop, setShop] = useState(false);
  const [toast, say] = useToast();
  useEffect(() => { getDoc<Recipe>('recipe', id).then(x => { setR(x); if (x) setServings(x.servings); }).catch(() => setR(null)); }, [id]);

  if (r === undefined) return <Page><Header title="Recipe" back="/food/recipes" /><p className="pl-muted">Loading…</p></Page>;
  if (r === null) return <Page><Header title="Recipe" back="/food/recipes" /><Card><p className="pl-muted">This recipe isn't here any more.</p></Card></Page>;
  if (editing) return <EditRecipe r={r} onDone={n => { setEditing(false); if (n) { setR(n); setServings(n.servings); say('Saved', 'good'); } }} />;

  const f = servings / (r.servings || 1);
  const p = r.perServing;
  const remove = async () => { if (!window.confirm(`Remove “${r.name}” from your recipes?`)) return; await removeRecipe(r).catch(() => undefined); nav('/food/recipes', { replace: true }); };
  return (
    <Page>
      <Header title={r.name} eyebrow={`${p.protein} g protein a serving`} back="/food/recipes" right={<Button small ghost onClick={() => setEditing(true)} aria-label="Edit"><Pencil size={16} /></Button>} />
      {r.thumb && <img className="fd-preview" src={r.thumb} alt="" style={{ maxHeight: 160 }} />}
      <Card>
        <div className="fd-totals">
          <div><b>{p.protein}</b><small>protein g</small></div>
          <div><b>{p.kcal}</b><small>kcal</small></div>
          <div><b>{p.carbs}</b><small>carbs g</small></div>
          <div><b>{p.fat}</b><small>fat g</small></div>
        </div>
        <p className="pl-muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Per serving · makes {r.servings}{r.minutes ? ` · about ${r.minutes} min` : ''}{r.source ? <> · <a href={r.source} target="_blank" rel="noreferrer">source <ExternalLink size={11} /></a></> : null}</p>
      </Card>

      <Card>
        <div className="rc-count">
          <h2 className="pl-grow" style={{ fontSize: 18 }}>Ingredients</h2>
          <Button small ghost aria-label="Fewer servings" onClick={() => setServings(s => Math.max(0.5, s - 0.5))} disabled={servings <= 0.5}><Minus size={14} /></Button>
          <b>{fmtQty(servings)}</b>
          <Button small ghost aria-label="More servings" onClick={() => setServings(s => Math.min(20, s + 0.5))}><Plus size={14} /></Button>
        </div>
        {servings !== r.servings && <p className="pl-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>For {fmtQty(servings)} servings · {Math.round(p.protein * servings)} g protein, {Math.round(p.kcal * servings)} kcal in all</p>}
        <ul className="rc-ingredients">
          {r.ingredients.map((i, k) => <li key={k} className={i.pantry ? 'is-pantry' : ''}>{ingredientLine(i, f)}</li>)}
        </ul>
        <Button primary block onClick={() => setShop(true)} disabled={!r.ingredients.length}><ShoppingCart size={16} /> Add to shopping list</Button>
      </Card>

      {r.steps.length > 0 && (
        <Card>
          <h2 style={{ fontSize: 18 }}>Steps</h2>
          <ol className="rc-steps">{r.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
        </Card>
      )}
      <Button ghost onClick={() => void remove()}><Trash2 size={15} /> Remove recipe</Button>
      <ShopSheet open={shop} onClose={() => setShop(false)} sources={[{ recipe: r, servings }]} />
      {toast}
    </Page>
  );
}

function EditRecipe({ r, onDone }: { r: Recipe; onDone: (r: Recipe | null) => void }) {
  const [name, setName] = useState(r.name);
  const [servings, setServings] = useState(String(r.servings));
  const [minutes, setMinutes] = useState(r.minutes ? String(r.minutes) : '');
  const [ps, setPs] = useState({ protein: String(r.perServing.protein), kcal: String(r.perServing.kcal), carbs: String(r.perServing.carbs), fat: String(r.perServing.fat) });
  const [ings, setIngs] = useState(ingredientsText(r));
  const [steps, setSteps] = useState(r.steps.join('\n'));
  const [busy, setBusy] = useState(false);
  const n = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const save = async () => {
    setBusy(true);
    // keep each ingredient's section and pantry flag when its line still names the same item
    const old = new Map(r.ingredients.map(i => [i.item.toLowerCase(), i]));
    const ingredients = ings.split('\n').map(parseIngredient).filter((i): i is NonNullable<typeof i> => !!i).map(i => { const o = old.get(i.item.toLowerCase()); return o ? { ...i, section: o.section, pantry: o.pantry } : i; });
    const next: Recipe = { ...r, name: name.trim() || r.name, servings: Math.max(1, n(servings)), minutes: n(minutes) || undefined,
      perServing: { protein: n(ps.protein), kcal: n(ps.kcal), carbs: n(ps.carbs), fat: n(ps.fat) }, ingredients, steps: steps.split('\n').map(s => s.trim()).filter(Boolean) };
    try { await saveRecipe(next); onDone(next); } catch { setBusy(false); }
  };
  return (
    <Page>
      <Header title="Edit recipe" back={`/food/recipes/${r.id}`} />
      <Card>
        <div className="pl-stack">
          <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <div className="pl-grid-2">
            <Field label="Makes (servings)"><Input inputMode="numeric" value={servings} onChange={e => setServings(e.target.value)} /></Field>
            <Field label="Minutes"><Input inputMode="numeric" value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
          </div>
          <p className="pl-label" style={{ margin: 0 }}>Per serving</p>
          <div className="pl-grid-2">
            <Field label="Protein g"><Input inputMode="numeric" value={ps.protein} onChange={e => setPs({ ...ps, protein: e.target.value })} /></Field>
            <Field label="Calories"><Input inputMode="numeric" value={ps.kcal} onChange={e => setPs({ ...ps, kcal: e.target.value })} /></Field>
            <Field label="Carbs g"><Input inputMode="numeric" value={ps.carbs} onChange={e => setPs({ ...ps, carbs: e.target.value })} /></Field>
            <Field label="Fat g"><Input inputMode="numeric" value={ps.fat} onChange={e => setPs({ ...ps, fat: e.target.value })} /></Field>
          </div>
          <Field label="Ingredients, one per line" hint="amount, unit, item, then a comma for prep: 1½ cup basmati rice, rinsed"><TextArea rows={Math.max(6, r.ingredients.length + 1)} value={ings} onChange={e => setIngs(e.target.value)} /></Field>
          <Field label="Steps, one per line"><TextArea rows={Math.max(4, r.steps.length + 1)} value={steps} onChange={e => setSteps(e.target.value)} /></Field>
          <div className="pl-row" style={{ gap: 8 }}>
            <Button primary onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            <Button ghost onClick={() => onDone(null)}>Cancel</Button>
          </div>
        </div>
      </Card>
    </Page>
  );
}
