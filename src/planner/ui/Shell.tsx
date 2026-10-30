// src/planner/ui/Shell.tsx — bottom navigation around every signed-in screen.
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Sunrise, BookOpen, Repeat, Dumbbell, Utensils } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Today', Icon: Sunrise, end: true },
  { to: '/plan', label: 'Plan', Icon: BookOpen },
  { to: '/habits', label: 'Habits', Icon: Repeat },
  { to: '/workout', label: 'Workout', Icon: Dumbbell },
  { to: '/food', label: 'Food', Icon: Utensils },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <nav className="pl-nav" aria-label="Planner">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <t.Icon aria-hidden /> {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
