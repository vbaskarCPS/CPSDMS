// src/planner/ui/Shell.tsx — bottom navigation around every signed-in screen.
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Sunrise, BookOpen, Repeat, Dumbbell, Utensils, Wallet, Heart } from 'lucide-react';
import { getPass } from '../lib/auth';
import { profileOf } from '../lib/app';

const base = [
  { to: '/', label: 'Today', Icon: Sunrise, end: true },
  { to: '/plan', label: 'Plan', Icon: BookOpen },
  { to: '/habits', label: 'Habits', Icon: Repeat },
  { to: '/workout', label: 'Train', Icon: Dumbbell },
  { to: '/food', label: 'Food', Icon: Utensils },
  { to: '/money', label: 'Money', Icon: Wallet },
];
// the morning profile (Rosh) also has the cycle tracker
const morning = [base[0], base[1], { to: '/cycle', label: 'Cycle', Icon: Heart }, ...base.slice(2)];

export function Shell({ children }: { children: ReactNode }) {
  const tabs = profileOf(getPass()?.user.settings as { profile?: string } | undefined) === 'morning' ? morning : base;
  const seven = tabs.length === 7;
  return (
    <>
      {children}
      <nav className={`pl-nav ${seven ? 'pl-nav--7' : ''}`} aria-label="Planner">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <t.Icon aria-hidden /> {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
