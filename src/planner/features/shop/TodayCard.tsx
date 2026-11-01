// src/planner/features/shop/TodayCard.tsx — Today: how many things are on the shared list and the best trip.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, ChevronRight } from 'lucide-react';
import { loadList } from './store';
import { ANYWHERE, storeOf, type ShopItem } from './types';

export function ShopTodayCard() {
  const [items, setItems] = useState<ShopItem[] | null>(null);
  useEffect(() => { loadList().then(setItems).catch(() => setItems([])); }, []);
  const open = (items || []).filter(i => !i.done);
  if (items !== null && open.length === 0) return null;
  const byStore: Record<string, number> = {};
  for (const i of open) byStore[storeOf(i)] = (byStore[storeOf(i)] || 0) + 1;
  const trip = Object.entries(byStore).filter(([k]) => k !== ANYWHERE).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ');
  return (
    <Link to="/shop" className="pl-card pl-row" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
      <ShoppingCart aria-hidden style={{ width: 22, height: 22, color: 'var(--accent)', flex: 'none' }} />
      <div className="pl-grow"><b>Shopping · {items === null ? '…' : open.length} on the list</b>{trip && <small className="pl-muted" style={{ display: 'block' }}>Best trip: {trip}</small>}</div>
      <ChevronRight />
    </Link>
  );
}
