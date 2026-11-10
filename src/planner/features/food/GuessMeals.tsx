// src/planner/features/food/GuessMeals.tsx — "Didn't log your meals?" on the Today screen, for a day with nothing logged
// (rules in guess.ts). Describe roughly what you ate, Claude estimates it (the same estimate as typing a meal in Food),
// you check the list and save it to that day as one "Rough guess" meal. Or say you didn't eat, or skip. Asked once per day.
import { useEffect, useState } from 'react';
import { Utensils } from 'lucide-react';
import { estimateFoodText } from '../../lib/ai';
import type { Routine } from '../../lib/routine';
import { Button, Card, TextArea, uid } from '../../ui/primitives';
import { daysWithMeals, guessDay, guessTime } from './guess';
import { addDays, mealsBetween, prettyDay, round, saveMeal, sum, type FoodItem } from './model';

const askedKey = (k: string) => `pl-guess-asked-${k}`;
const wasAsked = (k: string) => { try { return localStorage.getItem(askedKey(k)) === '1'; } catch { return false; } };
const markAsked = (k: string) => { try { localStorage.setItem(askedKey(k), '1'); } catch { /* private mode */ } };

export function GuessMeals({ routine, today }: { routine: Routine; today: string }) {
  const [target, setTarget] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [items, setItems] = useState<FoodItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void (async () => {
      const yesterday = addDays(today, -1);
      const docs = await mealsBetween(addDays(today, -15), today).catch(() => null);
      if (!docs || !on) return;
      const withMeals = daysWithMeals(docs.filter(d => d.data).map(d => d.key), addDays(today, -15), today);
      let tracked = 0;
      for (let i = 2; i <= 15; i++) if (withMeals.has(addDays(today, -i))) tracked++;
      setTarget(guessDay({ now: new Date(), today, yesterday, routine, trackedDays: tracked, asked: wasAsked, mealsOn: d => (withMeals.has(d) ? 1 : 0) }));
    })();
    return () => { on = false; };
  }, [today, routine]);

  if (done) return (
    <Card className="bed-missed"><Utensils aria-hidden /><div className="pl-grow"><b>Logged.</b><small className="pl-muted">{done} Tomorrow's targets stay the same.</small>
      <div className="bed-missed__row"><Button small ghost onClick={() => setDone(null)}>OK</Button></div></div></Card>
  );
  if (!target) return null;
  const when = target === today ? 'today' : prettyDay(target).toLowerCase();
  const close = () => { markAsked(target); setTarget(null); };

  async function estimate() {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await estimateFoodText(`Everything I ate in one day, roughly (estimate each food; it's a guess from memory): ${text.trim()}`);
      if (!r.items.length) throw new Error('Nothing came back. Try describing it a little more.');
      setItems(r.items);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t estimate that'); } finally { setBusy(false); }
  }
  async function save() {
    if (!items?.length || !target) return;
    setBusy(true); setErr('');
    try {
      const totals = round(sum(items));
      await saveMeal({ id: uid(), date: target, time: guessTime(routine), name: 'Rough guess', items, totals, note: text.trim(), source: 'text', guessed: true });
      markAsked(target);
      setDone(`About ${totals.kcal.toLocaleString()} kcal and ${totals.protein} g protein on ${when === 'today' ? 'today' : prettyDay(target)}.`);
      setTarget(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t save'); } finally { setBusy(false); }
  }

  if (items) {
    const t = round(sum(items));
    return (
      <Card accent className="bed-missed guess-meals">
        <Utensils aria-hidden />
        <div className="pl-grow">
          <b>About {t.kcal.toLocaleString()} kcal · {t.protein} g protein</b>
          <small className="pl-muted">A rough guess for {when}. Take out anything that's wrong.</small>
          <ul className="guess-meals__list">
            {items.map((i, k) => (
              <li key={k}><span>{i.name}{i.portion ? <small className="pl-muted"> · {i.portion}</small> : null}</span><b>{i.kcal}</b>
                <button type="button" className="guess-meals__x" aria-label={`Remove ${i.name}`} onClick={() => setItems(items.filter((_, j) => j !== k))}>×</button></li>
            ))}
          </ul>
          {err && <small className="pl-error">{err}</small>}
          <div className="bed-missed__row">
            <Button small primary disabled={busy || !items.length} onClick={() => void save()}>{busy ? 'Saving…' : `Save to ${when}`}</Button>
            <Button small ghost disabled={busy} onClick={() => setItems(null)}>Change the description</Button>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card accent className="bed-missed guess-meals">
      <Utensils aria-hidden />
      <div className="pl-grow">
        <b>No meals logged {when}. Roughly what did you eat?</b>
        <small className="pl-muted">A best guess is better than a blank. Claude works out the rough calories.</small>
        <TextArea rows={3} value={text} onChange={e => setText(e.target.value)} aria-label={`What you ate ${when}`}
          placeholder="e.g. 2 eggs and toast, a chicken burrito for lunch, 3 slices of pepperoni pizza and 2 beers" style={{ marginTop: 10 }} />
        {err && <small className="pl-error">{err}</small>}
        <div className="bed-missed__row">
          <Button small primary disabled={busy || !text.trim()} onClick={() => void estimate()}>{busy ? 'Working it out…' : 'Estimate it'}</Button>
          <Button small onClick={close}>I didn't eat</Button>
          <Button small ghost onClick={close}>Skip</Button>
        </div>
      </div>
    </Card>
  );
}
