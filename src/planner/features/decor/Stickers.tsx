// src/planner/features/decor/Stickers.tsx — Settings › Stickers: "Decorate a page". One row for each page that can
// carry stickers (decor.ts SECTIONS; Cycle only on the morning profile), saying how many it has. Tapping a row opens
// that page ready to decorate (Decorate.tsx): a tray of stickers comes up from the bottom and Done ends it.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, ChevronRight, Compass, Dumbbell, Heart, HeartPulse, Repeat, ShoppingCart, Sunrise, Utensils, Wallet, type LucideIcon } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { profileOf } from '../../lib/app';
import { Card, Header, Page } from '../../ui/primitives';
import { decoratePath, sectionsFor, type SectionId } from './decor';
import { GROUPS, LIBRARY, artOf, srcOf } from './library';
import { countPages } from './store';
import './decor.css';

const ICON: Record<SectionId, LucideIcon> = {
  today: Sunrise, plan: BookOpen, calendar: CalendarDays, habits: Repeat, workout: Dumbbell, food: Utensils, cycle: Heart,
  money: Wallet, shop: ShoppingCart, health: HeartPulse, lifestyle: Compass,
};
/** A few stickers to show what is in the library. */
const SAMPLES = ['fox', 'rose', 'mood-good', 'bow-pink', 'sticky', 'butterfly'];

export function Stickers({ pass }: { pass: PlannerPass }) {
  const [counts, setCounts] = useState<Partial<Record<SectionId, number>> | null>(null);   // null while it loads
  useEffect(() => {
    let on = true;
    void countPages().then(c => { if (on) setCounts(c); }, () => { if (on) setCounts({}); });
    return () => { on = false; };
  }, []);
  const line = (id: SectionId) => { if (!counts) return '…'; const n = counts[id] || 0; return n ? `${n} sticker${n === 1 ? '' : 's'}` : 'No stickers yet'; };
  return (
    <Page>
      <Header title="Stickers" back="/settings" />
      <Card className="pl-stack">
        <div className="dk-samples" aria-hidden>{SAMPLES.map(id => artOf(id)).map(s => s && <img key={s.id} src={srcOf(s)} alt="" />)}</div>
        <p className="pl-muted" style={{ fontSize: 14 }}>Dress a page up like a scrapbook. Pick a page, tap a sticker to put it on, then drag it where you want it: drag a corner to resize it, the round handle to turn it. There are {LIBRARY.length} stickers in {GROUPS.length} groups, and you can add pictures of your own.</p>
      </Card>
      <p className="pl-eyebrow">Decorate a page</p>
      <nav className="pl-stack" aria-label="Decorate a page" style={{ gap: 10 }}>
        {sectionsFor(profileOf(pass.user.settings)).map(s => {
          const Icon = ICON[s.id];
          return (
            <Link key={s.id} className="pl-tile" to={decoratePath(s)}>
              <Icon aria-hidden />
              <div className="pl-grow"><b>{s.name}</b><small>{line(s.id)}</small></div>
              <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
            </Link>
          );
        })}
      </nav>
    </Page>
  );
}
