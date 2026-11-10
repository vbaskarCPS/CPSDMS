// src/planner/features/shop/TodayCard.tsx — Today: the way into the shared list (always shown), with the count and best trip.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, ChevronRight } from 'lucide-react';
import { loadList } from './store';
import { useDocsChanged } from '../../lib/useDocsChanged';
import { ANYWHERE, storeOf, type ShopItem } from './types';

export function ShopTodayCard() {
  const [items, setItems] = useState<ShopItem[] | null>(null);
  useEffect(() => { loadList().then(setItems).catch(() => setItems([])); }, []);
  useDocsChanged(['shop'], () => { loadList().then(setItems).catch(() => undefined); });
  const open = (items || []).filter(i => !i.done);
  const byStore: Record<string, number> = {};
  for (const i of open) byStore[storeOf(i)] = (byStore[storeOf(i)] || 0) + 1;
  const trip = Object.entries(byStore).filter(([k]) => k !== ANYWHERE).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ');
  return (
    <Link to="/shop" className="pl-card pl-row" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
      <ShoppingCart aria-hidden style={{ width: 22, height: 22, color: 'var(--accent)', flex: 'none' }} />
      <div className="pl-grow"><b>Shopping{items === null ? '' : open.length ? ` · ${open.length} on the list` : ''}</b><small className="pl-muted" style={{ display: 'block' }}>{items === null ? '…' : open.length === 0 ? 'Nothing on the list — tap to add' : trip ? `Best trip: ${trip}` : 'No flyer deals yet'}</small></div>
      <ChevronRight />
    </Link>
  );
}
