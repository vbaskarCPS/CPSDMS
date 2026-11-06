// src/planner/features/food/AddMeal.tsx — photo, description or favourite → the AI's draft → confirm.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Camera, Image, Loader2, Star, Utensils } from 'lucide-react';
import { estimateFoodPhoto, estimateFoodText, shrinkImage, type FoodEstimate } from '../../lib/ai';
import { dayKey, getDoc, getDocs, putDoc } from '../../lib/docs';
import { Button, Card, Empty, Field, Header, Page, Segmented, TextArea, useToast, uid } from '../../ui/primitives';
import { MealEditor, type Draft } from './MealEditor';
import { mealKey, nowTime, removeMeal, round, saveFavourite, saveMeal, sum, type FavMeal, type Meal } from './model';
import { fromRoad, likelySame } from './dupes';
import type { Day } from '../plan/types';

type Mode = 'photo' | 'text' | 'fav';

function guessName(time: string, items: { name: string }[]): string {
  const h = Number(time.split(':')[0]);
  if (items.length === 1) return items[0].name;
  return h < 10 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 18 ? 'Snack' : 'Dinner';
}

export function AddMeal() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const day = params.get('day') || dayKey();
  const [mode, setMode] = useState<Mode>('photo');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tips, setTips] = useState<string | undefined>();
  const [source, setSource] = useState<Meal['source']>('photo');
  const [fav, setFav] = useState<FavMeal | null>(null);
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [favs, setFavs] = useState<FavMeal[]>([]);
  const [saving, setSaving] = useState(false);
  const [same, setSame] = useState<Meal | null>(null);   // probably already logged: ask before adding it twice
  const [toast, show] = useToast();
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode === 'fav' && favs.length === 0) getDocs<FavMeal>('favmeal').then(d => setFavs(d.map(x => x.data).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)))).catch(() => undefined); }, [mode, favs.length]);

  const toDraft = (est: FoodEstimate, thumb?: string, src: Meal['source'] = 'photo') => {
    const time = nowTime();
    setDraft({ name: guessName(time, est.items), time, items: est.items, note: note || undefined, thumb, saveFav: false });
    setTips(est.tips || undefined); setSource(src);
  };

  const analyse = async (file: File) => {
    setError(null); setLastFile(file);
    setBusy('Looking at your plate…');
    try {
      const [big, small] = await Promise.all([shrinkImage(file, 1280, 0.82), shrinkImage(file, 160, 0.6)]);
      setPreview(big.dataUrl);
      const est = await estimateFoodPhoto(big.base64, big.mediaType, note);
      if (!est.items.length) setError("Couldn't find any food in that photo. Try again or describe it.");
      else toDraft(est, small.dataUrl, 'photo');
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void analyse(f); };

  const describe = async () => {
    if (!text.trim()) return;
    setError(null); setBusy('Working it out…');
    try {
      const est = await estimateFoodText(text.trim());
      if (!est.items.length) setError("Couldn't make a meal out of that. Add a bit more detail.");
      else toDraft(est, undefined, 'text');
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const useFav = (f: FavMeal) => {
    setFav(f);
    setDraft({ name: f.name, time: nowTime(), items: f.items.map(i => ({ ...i })), thumb: f.thumb, saveFav: false });
    setTips(undefined); setSource('favourite');
  };

  /** mode: undefined = check for a double first; 'replace' = this replaces `same`; 'both' = keep both. */
  const save = async (mode?: 'replace' | 'both') => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const meal: Meal = { id: uid(), date: day, time: draft.time || nowTime(), name: draft.name.trim() || 'Meal', items: draft.items, totals: round(sum(draft.items)), thumb: draft.thumb, note: draft.note, source };
      if (!mode) {
        const logged = (await getDocs<Meal>('meal', `${day}~`, `${day}~~`).catch(() => [])).map(d => d.data).filter(Boolean);
        const hit = likelySame(meal, logged);
        if (hit) { setSame(hit); setSaving(false); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      }
      await saveMeal(meal);
      if (mode === 'replace' && same) {
        await removeMeal(same);
        // a protein-road slot counted the old one: it now counts this one
        if (fromRoad(same)) {
          const d = await getDoc<Day>('day', day).catch(() => null);
          const old = mealKey(same);
          if (d?.protein?.slots.some(x => x.eaten === old)) await putDoc('day', day, { ...d, protein: { ...d.protein, slots: d.protein.slots.map(x => (x.eaten === old ? { ...x, eaten: mealKey(meal) } : x)) } });
        }
      }
      setSame(null);
      if (draft.saveFav) await saveFavourite(meal.name, meal.items, meal.thumb);
      else if (fav) await saveFavourite(fav.name, fav.items, fav.thumb, fav);   // count the use
      show(`Logged ${meal.totals.kcal} kcal`, 'good');
      nav(day === dayKey() ? '/food' : `/food?day=${day}`, { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false); }
  };

  if (draft) {
    return (
      <Page>
        <Header title="Check the plate" eyebrow="Nothing is saved until you tap Save" back="/food/add" />
        {error && <p className="pl-error">{error}</p>}
        {same && (
          <Card accent>
            <b>Already logged?</b>
            <p className="pl-muted" style={{ margin: '4px 0 10px', fontSize: 14 }}>
              “{same.name}” is in your log at {same.time}{fromRoad(same) ? ` (ticked on the ${same.note!.replace('Protein road · ', 'protein road as ')})` : ''}: {same.totals.kcal} kcal, {same.totals.protein} g protein. Is this the same food?
            </p>
            <div className="pl-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Button small primary onClick={() => void save('replace')} disabled={saving}>Same food: use this one</Button>
              <Button small onClick={() => void save('both')} disabled={saving}>Different: add both</Button>
              <Button small ghost onClick={() => { setSame(null); nav('/food', { replace: true }); }}>Don’t add</Button>
            </div>
          </Card>
        )}
        <MealEditor draft={draft} setDraft={setDraft} tips={tips} onSave={() => void save()} saving={saving} />
        <Button block ghost onClick={() => { setDraft(null); setPreview(null); }}>Start over</Button>
        {toast}
      </Page>
    );
  }

  return (
    <Page>
      <Header title="Add a meal" back="/food" />
      <Segmented value={mode} onChange={setMode} options={[{ value: 'photo', label: 'Photo' }, { value: 'text', label: 'Describe' }, { value: 'fav', label: 'Favourites' }]} />

      {busy ? (
        <Card><div className="fd-spinner"><Loader2 className="pl-spin" />{preview && <img className="fd-preview" src={preview} alt="" style={{ maxHeight: 180 }} />}<b>{busy}</b><small className="pl-muted">One look, about a cent.</small></div></Card>
      ) : mode === 'photo' ? (
        <>
          <label className="fd-bigbtn">
            <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={onPick} />
            <Camera /><span>Take a photo</span>
            <small className="pl-muted" style={{ fontWeight: 400 }}>Overhead for plates, 45° for bowls</small>
          </label>
          <label className="pl-btn pl-btn--block" style={{ cursor: 'pointer' }}>
            <input ref={libRef} type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} />
            <Image style={{ width: 18, height: 18 }} /> Choose from library
          </label>
          <Field label="Anything the photo can't show? (optional)" hint="e.g. “2 rotis, dal, cooked in ghee” — helps the estimate a lot">
            <TextArea value={note} onChange={e => setNote(e.target.value)} placeholder="2 rotis, dal, no oil" />
          </Field>
          {error && <Card><p className="pl-error">{error}</p>{lastFile && <Button small onClick={() => void analyse(lastFile)} style={{ marginTop: 8 }}>Try again</Button>}</Card>}
        </>
      ) : mode === 'text' ? (
        <>
          <Field label="What did you eat?" hint="Portions help: “1 cup rice, 1 chicken breast, salad with dressing”">
            <TextArea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Chicken shawarma wrap with garlic sauce, small fries" autoFocus />
          </Field>
          {error && <p className="pl-error">{error}</p>}
          <Button primary block onClick={describe} disabled={!text.trim()}>Estimate</Button>
        </>
      ) : (
        <Card>
          {favs.length === 0 ? <Empty icon={<Star />} title="No favourites yet" blurb="Tick “Save as favourite” when you log a meal you eat often." /> : (
            <div className="pl-list">
              {favs.map(f => (
                <button key={f.id} className="pl-item" style={{ background: 'none', border: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => useFav(f)}>
                  {f.thumb ? <img className="fd-thumb" src={f.thumb} alt="" /> : <span className="fd-thumb"><Utensils /></span>}
                  <div className="pl-grow"><b>{f.name}</b><small>{f.items.map(i => i.name).slice(0, 3).join(', ')} · used {f.uses}×</small></div>
                  <span className="fd-kcal">{f.totals.kcal}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
      {toast}
    </Page>
  );
}

/** /food/meal/:key — look at a logged meal, fix it, or remove it. */
export function EditMeal() {
  const { key = '' } = useParams();
  const nav = useNavigate();
  const [meal, setMeal] = useState<Meal | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, show] = useToast();
  const k = decodeURIComponent(key);

  useEffect(() => {
    getDocs<Meal>('meal', k, k).then(d => {
      const m = d[0]?.data ?? null; setMeal(m);
      if (m) setDraft({ name: m.name, time: m.time, items: m.items.map(i => ({ ...i })), note: m.note, thumb: m.thumb, saveFav: false });
    }).catch(() => setMeal(null));
  }, [k]);

  const back = () => nav(meal && meal.date !== dayKey() ? `/food?day=${meal.date}` : '/food', { replace: true });
  const save = async () => {
    if (!meal || !draft) return;
    setSaving(true); setError(null);
    try {
      const next: Meal = { ...meal, name: draft.name.trim() || 'Meal', time: draft.time || meal.time, items: draft.items, totals: round(sum(draft.items)) };
      if (mealKey(next) !== mealKey(meal)) await removeMeal(meal);   // time changed: the key moves
      await saveMeal(next);
      if (draft.saveFav) await saveFavourite(next.name, next.items, next.thumb);
      show('Saved', 'good'); back();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false); }
  };
  const remove = async () => {
    if (!meal || !window.confirm('Remove this meal?')) return;
    setSaving(true);
    try { await removeMeal(meal); back(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove.'); setSaving(false); }
  };

  if (meal === undefined) return <Page><Header title="Meal" back="/food" /><p className="pl-muted">Loading…</p></Page>;
  if (!meal || !draft) return <Page><Header title="Meal" back="/food" /><Empty title="That meal isn't here" blurb="It may have been removed." /></Page>;
  return (
    <Page>
      <Header title={meal.name || 'Meal'} eyebrow={`${meal.date} · ${meal.time}`} back="/food" />
      {error && <p className="pl-error">{error}</p>}
      <MealEditor draft={draft} setDraft={setDraft} onSave={save} saving={saving} onDelete={remove} />
      {toast}
    </Page>
  );
}

