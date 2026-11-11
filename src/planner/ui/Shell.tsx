// src/planner/ui/Shell.tsx — the bottom bar around every signed-in screen: Today · RV · Health · Wealth · Lifestyle
// (ui/nav.ts says which screens sit under which button). RV is Arvy: the one button that stands out, it opens the
// chat panel and closes it again. Health and Lifestyle open their menu pages (screens/Hub.tsx).
import { useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass, HeartPulse, Sparkles, Sunrise, Wallet, X, type LucideIcon } from 'lucide-react';
import { Arvy } from '../features/arvy/Arvy';
import { arvyIsOpen, onArvyOpenChange, toggleArvy } from '../features/arvy/arvy';
import { groupOf, NAV_TO, type NavGroup } from './nav';

const TABS: { group: NavGroup; label: string; Icon: LucideIcon }[] = [
  { group: 'today', label: 'Today', Icon: Sunrise },
  { group: 'health', label: 'Health', Icon: HeartPulse },
  { group: 'wealth', label: 'Wealth', Icon: Wallet },
  { group: 'lifestyle', label: 'Lifestyle', Icon: Compass },
];

export function Shell({ children }: { children: ReactNode }) {
  const here = groupOf(useLocation().pathname);
  const chatOpen = useSyncExternalStore(onArvyOpenChange, arvyIsOpen);
  const tab = (t: typeof TABS[number]) => (
    <Link key={t.group} to={NAV_TO[t.group]} className={here === t.group ? 'active' : ''} aria-current={here === t.group ? 'page' : undefined}>
      <t.Icon aria-hidden /> {t.label}
    </Link>
  );
  return (
    <>
      {children}
      <Arvy />
      <nav className="pl-nav" aria-label="Planner">
        {tab(TABS[0])}
        <button type="button" className={`pl-nav__rv ${chatOpen ? 'is-open' : ''}`} onClick={toggleArvy} aria-expanded={chatOpen} aria-label={chatOpen ? 'Close Arvy' : 'Ask Arvy'}>
          <i aria-hidden>{chatOpen ? <X /> : <Sparkles />}</i>
          <span>RV</span>
        </button>
        {TABS.slice(1).map(tab)}
      </nav>
    </>
  );
}
