// src/planner/features/money/CategoryIcon.tsx — the icon and colour of a category.
import * as L from 'lucide-react';
import { byName } from './categories';

export function CategoryIcon({ name, size = 16 }: { name: string; size?: number }) {
  const c = byName(name);
  const Icon = ((L as unknown as Record<string, L.LucideIcon>)[c.icon] || L.CircleDashed) as L.LucideIcon;
  return <Icon style={{ width: size, height: size, color: c.color, flex: 'none' }} aria-hidden />;
}
export const categoryColor = (name: string) => byName(name).color;
