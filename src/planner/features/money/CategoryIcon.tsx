// src/planner/features/money/CategoryIcon.tsx — the icon and colour of a category.
// Named imports only: `import * as` would put every lucide icon in the planner's bundle.
import {
  ShoppingCart, Utensils, Coffee, Bus, Fuel, Home, Zap, Smartphone, Shield, HeartPulse, Dumbbell, ShoppingBag, Baby, Film,
  Repeat, Plane, Gift, GraduationCap, Scissors, ArrowLeftRight, CreditCard, Banknote, Percent, Wallet, CircleDashed, type LucideIcon,
} from 'lucide-react';
import { byName } from './categories';

const ICONS: Record<string, LucideIcon> = {
  ShoppingCart, Utensils, Coffee, Bus, Fuel, Home, Zap, Smartphone, Shield, HeartPulse, Dumbbell, ShoppingBag, Baby, Film,
  Repeat, Plane, Gift, GraduationCap, Scissors, ArrowLeftRight, CreditCard, Banknote, Percent, Wallet, CircleDashed,
};

export function CategoryIcon({ name, size = 16 }: { name: string; size?: number }) {
  const c = byName(name);
  const Icon = ICONS[c.icon] || CircleDashed;
  return <Icon style={{ width: size, height: size, color: c.color, flex: 'none' }} aria-hidden />;
}
export const categoryColor = (name: string) => byName(name).color;
