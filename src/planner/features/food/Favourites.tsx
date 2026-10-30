// src/planner/features/food/Favourites.tsx — meals you eat often, one tap to log again.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Trash2, Utensils } from 'lucide-react';
import { getDocs, putDoc } from '../../lib/docs';
import { Card, Empty, Header, Page, useToast } from '../../ui/primitives';
import type { FavMeal } from './model';
import { ensureShakeFavourite } from './fasting';

export function Favourites() {
  const [favs, setFavs] = useState<FavMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, show] = useToast();
  useEffect(() => {
    getDocs<FavMeal>('favmeal')
      .then(async d => { const list = d.map(x => x.data); const shake = await ensureShakeFavourite(list); if (!list.some(f => f.id === shake.id)) list.push(shake); setFavs(list.sort((a, b) => b.uses - a.uses)); })
      .finally(() => setLoading(false));
  }, []);
  const remove = async (f: FavMeal) => {
    if (!window.confirm(`Remove “${f.name}” from favourites?`)) return;
    try { await putDoc('favmeal', f.id, null); setFavs(fs => fs.filter(x => x.id !== f.id)); show('Removed'); } catch { show('Could not remove', 'bad'); }
  };
  return (
    <Page>
      <Header title="Favourites" eyebrow="Log again in one tap" back="/food" />
      <Card>
        {loading ? <p className="pl-muted">Loading…</p> : favs.length === 0 ? (
          <Empty icon={<Star />} title="No favourites yet" blurb="Tick “Save as favourite” when you log a meal you eat often." action={<Link to="/food/add" className="pl-btn pl-btn--primary">Add a meal</Link>} />
        ) : (
          <div className="pl-list">
            {favs.map(f => (
              <div key={f.id} className="pl-item">
                {f.thumb ? <img className="fd-thumb" src={f.thumb} alt="" /> : <span className="fd-thumb"><Utensils /></span>}
                <div className="pl-grow"><b>{f.name}</b><small>{f.totals.kcal} kcal · {f.totals.protein} g protein · used {f.uses}×</small></div>
                <button className="pl-btn pl-btn--ghost pl-btn--small" style={{ border: 0, padding: '0 6px' }} aria-label="Remove" onClick={() => void remove(f)}><Trash2 style={{ width: 18, height: 18 }} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <p className="pl-muted" style={{ fontSize: 13 }}>To log one, go to <Link to="/food/add">Add a meal → Favourites</Link>.</p>
      {toast}
    </Page>
  );
}
