// src/planner/features/food/FoodToday.tsx — the day: ring, macros, meals; plus the Today-screen card.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, ChevronLeft, ChevronRight, Plus, Utensils, X, History, Target, Star } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { dayKey } from '../../lib/docs';
import { Card, Header, Page, Progress, Ring } from '../../ui/primitives';
import { addDays, addTotals, DEFAULT_TARGETS, loadTargets, mealKey, mealsForDay, prettyDay, round, ZERO, type Meal, type Targets, type Totals } from './model';

const TIPS_KEY = 'vijay-planner-food-tips';

function useDay(day: string) {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [targets, setTargets] = useState<Targets | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ms, t] = await Promise.all([mealsForDay(day), loadTargets()]);
      setMeals(ms.map(d => d.data)); setTargets(t);
    } finally { setLoading(false); }
  }, [day]);
  useEffect(() => { void reload(); }, [reload]);
  const totals: Totals = round(meals.reduce((t, m) => addTotals(t, m.totals), { ...ZERO }));
  return { meals, targets, totals, loading, reload };
}

function Thumb({ m }: { m: Meal }) {
  return m.thumb ? <img className="fd-thumb" src={m.thumb} alt="" /> : <span className="fd-thumb"><Utensils /></span>;
}

function Macro({ label, value, max }: { label: string; value: number; max?: number }) {
  return (
    <div className="fd-macro">
      <b>{label}</b>
      <Progress value={value} max={max || Math.max(value, 1)} tone={max && value > max ? 'amber' : undefined} />
      <small>{value}{max ? ` / ${max} g` : ' g'}</small>
    </div>
  );
}

export function FoodToday() {
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || dayKey();
  const nav = useNavigate();
  const { meals, targets, totals, loading } = useDay(day);
  const t = targets || DEFAULT_TARGETS;
  const [tips, setTips] = useState(() => { try { return localStorage.getItem(TIPS_KEY) !== '1'; } catch { return true; } });
  const dismissTips = () => { setTips(false); try { localStorage.setItem(TIPS_KEY, '1'); } catch { /* fine */ } };
  const go = (k: string) => setParams(k === dayKey() ? {} : { day: k });
  const remaining = t.kcal - totals.kcal;

  return (
    <Page>
      <Header title="Food" eyebrow="Photo → confirm → logged" right={
        <div className="pl-row" style={{ gap: 4 }}>
          <Link to="/food/history" className="pl-btn pl-btn--ghost pl-btn--small" aria-label="History" style={{ border: 0, padding: '0 6px' }}><History /></Link>
          <Link to="/food/favourites" className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Favourites" style={{ border: 0, padding: '0 6px' }}><Star /></Link>
          <Link to="/food/targets" className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Targets" style={{ border: 0, padding: '0 6px' }}><Target /></Link>
        </div>
      } />

      <div className="fd-datestrip">
        <button className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Previous day" onClick={() => go(addDays(day, -1))}><ChevronLeft /></button>
        <h2>{prettyDay(day)}</h2>
        <button className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Next day" onClick={() => go(addDays(day, 1))} disabled={day >= dayKey()}><ChevronRight /></button>
      </div>

      {targets === null && (
        <Card accent>
          <div className="pl-stack" style={{ gap: 8 }}>
            <p className="pl-eyebrow">Set your targets</p>
            <h2>What are you aiming for?</h2>
            <p className="pl-muted">Using 2200 kcal / 160 g protein until you set your own.</p>
            <Link to="/food/targets" className="pl-btn" style={{ background: 'var(--accent-ink)', color: 'var(--accent)', borderColor: 'transparent' }}>Set targets</Link>
          </div>
        </Card>
      )}

      <Card>
        <div className="fd-hero">
          <Ring value={totals.kcal} max={t.kcal} size={110} label={totals.kcal} sub="kcal" />
          <div className="fd-hero__text">
            <span className="pl-eyebrow">{remaining >= 0 ? 'Remaining' : 'Over'}</span>
            <span className={`fd-hero__big ${remaining < 0 ? '' : ''}`} style={remaining < 0 ? { color: 'var(--amber-2)' } : undefined}>{Math.abs(remaining)}</span>
            <span className="pl-muted" style={{ fontSize: 13 }}>of {t.kcal} kcal</span>
          </div>
        </div>
        <hr className="pl-divider" style={{ margin: '14px 0' }} />
        <div className="pl-stack" style={{ gap: 8 }}>
          <Macro label="Protein" value={totals.protein} max={t.protein} />
          <Macro label="Carbs" value={totals.carbs} max={t.carbs} />
          <Macro label="Fat" value={totals.fat} max={t.fat} />
        </div>
      </Card>

      {tips && (
        <Card>
          <div className="pl-row" style={{ alignItems: 'flex-start' }}>
            <Camera style={{ color: 'var(--accent)', flex: 'none' }} />
            <div className="pl-grow pl-stack" style={{ gap: 4 }}>
              <b>Better photos, better numbers</b>
              <p className="pl-muted" style={{ fontSize: 13 }}>Shoot plates from overhead and bowls at 45°. Keep items apart. Put a fork or your hand in the frame for scale. Snap before you eat.</p>
            </div>
            <button className="pl-btn pl-btn--ghost pl-btn--small" style={{ border: 0, padding: '0 6px' }} aria-label="Got it" onClick={dismissTips}><X /></button>
          </div>
        </Card>
      )}

      <Card>
        <p className="pl-eyebrow" style={{ marginBottom: 6 }}>Meals</p>
        {loading && meals.length === 0 ? <p className="pl-muted">Loading…</p> : meals.length === 0 ? (
          <p className="pl-muted">Nothing logged {day === dayKey() ? 'yet today' : 'this day'}.</p>
        ) : (
          <div className="pl-list">
            {meals.map(m => (
              <Link key={m.id} to={`/food/meal/${encodeURIComponent(mealKey(m))}`} className="pl-item">
                <Thumb m={m} />
                <div className="pl-grow"><b>{m.name || 'Meal'}</b><small>{m.time} · {m.items.map(i => i.name).slice(0, 3).join(', ')}{m.items.length > 3 ? '…' : ''}</small></div>
                <span className="fd-kcal">{m.totals.kcal}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <button className="pl-fab" aria-label="Add meal" onClick={() => nav(day === dayKey() ? '/food/add' : `/food/add?day=${day}`)}><Plus /></button>
    </Page>
  );
}

/** The card on the Today screen. */
export function FoodTodayCard({ pass }: { pass: PlannerPass }) {
  void pass;
  const { meals, targets, totals } = useDay(dayKey());
  const t = targets || DEFAULT_TARGETS;
  const last = meals[meals.length - 1];
  return (
    <Card>
      <div className="pl-row" style={{ gap: 14 }}>
        <Ring value={totals.kcal} max={t.kcal} size={72} label={totals.kcal} sub="kcal" />
        <div className="pl-grow pl-stack" style={{ gap: 6 }}>
          <div className="pl-row"><Link to="/food" className="pl-grow" style={{ textDecoration: 'none', fontWeight: 700 }}>Food</Link><Link to="/food/add" className="pl-btn pl-btn--primary pl-btn--small"><Plus style={{ width: 16, height: 16 }} /> Add</Link></div>
          <Macro label="Protein" value={totals.protein} max={t.protein} />
          <small className="pl-muted">{last ? `Last: ${last.name || 'Meal'} at ${last.time}` : 'Nothing logged yet today'}</small>
        </div>
      </div>
    </Card>
  );
}
