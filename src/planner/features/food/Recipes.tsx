// src/planner/features/food/Recipes.tsx — /food/recipes: the recipe box, protein per serving first. Add from a link, pasted
// text, a photo of a cookbook page or a meal you logged; or ask Arvy for a high-protein idea.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Camera, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { importRecipe, recipeIdea, shrinkImage } from '../../lib/ai';
import { Button, Card, Empty, Field, Header, Input, Page, Segmented, Sheet, TextArea, useToast } from '../../ui/primitives';
import { addDays, mealsBetween, type Meal } from './model';
import { fromDraft, loadRecipes, recipeFromMeal, saveRecipe, type Recipe } from './recipes';

type From = 'link' | 'text' | 'photo' | 'meal';

/** The sheet that turns a link / text / photo / logged meal / an idea into a saved recipe. `onSaved` gets the new recipe. */
export function AddRecipeSheet({ open, onClose, onSaved, ideaFor, avoid = [] }: { open: boolean; onClose: () => void; onSaved: (r: Recipe) => void; ideaFor?: number; avoid?: string[] }) {
  const [from, setFrom] = useState<From>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [idea, setIdea] = useState(String(ideaFor || 50));
  const [ideaNote, setIdeaNote] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setErr(''); setIdea(String(ideaFor || 50)); } }, [open, ideaFor]);
  useEffect(() => {
    if (from !== 'meal' || meals) return;
    mealsBetween(addDays(dayKey(), -21), dayKey()).then(d => setMeals(d.map(x => x.data).filter(Boolean).reverse())).catch(() => setMeals([]));
  }, [from, meals]);

  const run = async (label: string, fn: () => Promise<Recipe>) => {
    setBusy(label); setErr('');
    try { const r = await fn(); await saveRecipe(r); onSaved(r); setUrl(''); setText(''); setIdeaNote(''); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that recipe"); }
    finally { setBusy(null); }
  };
  const photo = (f: File | undefined) => { if (!f) return; void run('Reading the photo…', async () => { const [big, small] = await Promise.all([shrinkImage(f, 1600, 0.85), shrinkImage(f, 160, 0.6)]); return fromDraft(await importRecipe({ image: { media_type: big.mediaType, data: big.base64 }, text: text.trim() || undefined }), { thumb: small.dataUrl }); }); };

  return (
    <Sheet open={open} onClose={onClose} title="Add a recipe">
      <div className="pl-stack">
        <div className="rc-idea">
          <p className="pl-label" style={{ margin: 0 }}><Sparkles size={14} aria-hidden /> Ask Arvy for an idea</p>
          <div className="pl-row" style={{ gap: 8 }}>
            <Input inputMode="numeric" value={idea} onChange={e => setIdea(e.target.value.replace(/\D/g, ''))} style={{ width: 70 }} aria-label="Grams of protein per serving" />
            <span className="pl-muted" style={{ fontSize: 13 }}>g protein a serving</span>
          </div>
          <Input value={ideaNote} onChange={e => setIdeaNote(e.target.value)} placeholder="Optional: chicken, Indian, 20 minutes, no oven…" />
          <Button onClick={() => void run('Arvy is cooking something up…', async () => fromDraft(await recipeIdea(Number(idea) || 50, ideaNote.trim() || undefined, avoid)))} disabled={!!busy}><Sparkles size={15} /> Give me a recipe</Button>
        </div>
        <hr className="pl-divider" />
        <Segmented value={from} onChange={setFrom} options={[{ value: 'link', label: 'Link' }, { value: 'text', label: 'Text' }, { value: 'photo', label: 'Photo' }, { value: 'meal', label: 'A meal' }]} />
        {from === 'link' && <>
          <Field label="Recipe link" hint="Most recipe sites work — Claude reads the page and skips the life story."><Input type="url" inputMode="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></Field>
          <Button primary onClick={() => void run('Reading the page…', async () => fromDraft(await importRecipe({ url: url.trim() })))} disabled={!!busy || !/^https?:\/\/\S+\.\S+/.test(url.trim())}>Import</Button>
        </>}
        {from === 'text' && <>
          <Field label="Paste or type the recipe"><TextArea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'Butter chicken (serves 4)\n2 lb chicken thighs\n1 cup Greek yogurt\n…\n\nMarinate the chicken…'} /></Field>
          <Button primary onClick={() => void run('Reading the recipe…', async () => fromDraft(await importRecipe({ text: text.trim() })))} disabled={!!busy || text.trim().length < 15}>Import</Button>
        </>}
        {from === 'photo' && (
          <label className="fd-bigbtn"><Camera /><span>Snap the cookbook page</span><input type="file" accept="image/*" onChange={e => photo(e.target.files?.[0])} disabled={!!busy} /></label>
        )}
        {from === 'meal' && (meals === null ? <p className="pl-muted">Loading your meals…</p> : meals.length === 0 ? <p className="pl-muted">No meals logged in the last three weeks.</p> : (
          <div className="pl-list rc-meals">
            {meals.slice(0, 30).map(m => (
              <button type="button" key={`${m.date}${m.id}`} className="pl-item" onClick={() => void run('Saving…', async () => recipeFromMeal(m))} disabled={!!busy}>
                <div className="pl-grow"><b>{m.name || 'Meal'}</b><small>{m.date} · {m.items.map(i => i.name).slice(0, 3).join(', ')}</small></div>
                <span className="rc-tag">{Math.round(m.totals.protein)} g</span>
              </button>
            ))}
          </div>
        ))}
        {busy && <p className="pl-muted" style={{ margin: 0 }}>{busy}</p>}
        {err && <p className="pl-error" style={{ margin: 0, fontSize: 13 }}>{err}</p>}
      </div>
    </Sheet>
  );
}

export function RecipeRow({ r, onClick, right }: { r: Recipe; onClick?: () => void; right?: React.ReactNode }) {
  const body = <>
    {r.thumb ? <img className="fd-thumb" src={r.thumb} alt="" /> : <span className="fd-thumb"><BookOpen /></span>}
    <div className="pl-grow"><b>{r.name}</b><small>{r.perServing.kcal} kcal · serves {r.servings}{r.minutes ? ` · ${r.minutes} min` : ''}</small></div>
    <span className="rc-tag">{r.perServing.protein} g</span>
    {right}
  </>;
  return onClick ? <button type="button" className="pl-item" onClick={onClick}>{body}</button> : <Link to={`/food/recipes/${r.id}`} className="pl-item">{body}<ChevronRight /></Link>;
}

export function Recipes() {
  const nav = useNavigate();
  const [list, setList] = useState<Recipe[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [toast] = useToast();
  useEffect(() => { loadRecipes().then(setList).catch(() => setList([])); }, []);
  const shown = (list || []).filter(r => !q.trim() || `${r.name} ${r.ingredients.map(i => i.item).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Page>
      <Header title="Recipes" eyebrow="Protein per serving, most first" back="/food" right={<Button small primary onClick={() => setAdding(true)}><Plus size={16} /> Add</Button>} />
      {list && list.length > 4 && <Input placeholder="Search recipes or ingredients" value={q} onChange={e => setQ(e.target.value)} />}
      <Card>
        {list === null ? <p className="pl-muted">Loading…</p> : list.length === 0 ? (
          <Empty icon={<BookOpen />} title="No recipes yet" blurb="Paste a link, snap a cookbook page, save a meal you logged — or ask Arvy for a 50 g idea." action={<Button primary onClick={() => setAdding(true)}><Plus size={16} /> Add a recipe</Button>} />
        ) : (
          <div className="pl-list">{shown.map(r => <RecipeRow key={r.id} r={r} />)}</div>
        )}
      </Card>
      <AddRecipeSheet open={adding} onClose={() => setAdding(false)} onSaved={r => { setAdding(false); nav(`/food/recipes/${r.id}`); }} avoid={(list || []).map(r => r.name)} />
      {toast}
    </Page>
  );
}
