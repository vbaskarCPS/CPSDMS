// src/pages/Dialer/BadgeIcons.tsx
//
// 50 custom SVG badge icons for the AutoSniper gamification system.
// Each badge gets a unique tactical icon with category-themed coloring.
// Usage: getBadgeIcon(badgeId, size?) returns a React SVG element.
//

import React from 'react';

// --- Category accent colors ---
const C = {
  streak: '#e74c3c',
  prepay: '#f1c40f',
  street: '#2ecc71',
  time: '#e67e22',
  spree: '#ff5722',
  special: '#00BCD4',
  headhunter: '#9b59b6',
  dead: '#8e44ad',
  rank: '#f1c40f',
  milestone: '#3498db',
  workhorse: '#95a5a6',
};

// --- SVG wrapper ---
function I({ children, size = 24, vb = '0 0 32 32' }: { children: React.ReactNode; size?: number; vb?: string }) {
  return (
    <svg width={size} height={size} viewBox={vb} fill="none" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// --- STREAK ICONS ---

const DoubleKill = (s: number) => (
  <I size={s}><path d="M10 8L16 4L22 8V18L16 22L10 18V8Z" stroke={C.streak} strokeWidth="1.5" fill={`${C.streak}15`}/><circle cx="13" cy="12" r="1.5" fill={C.streak}/><circle cx="19" cy="12" r="1.5" fill={C.streak}/><path d="M13 16L16 18L19 16" stroke={C.streak} strokeWidth="1.2"/></I>
);

const TripleKill = (s: number) => (
  <I size={s}><path d="M16 3L26 9V19L16 25L6 19V9L16 3Z" stroke={C.streak} strokeWidth="1.5" fill={`${C.streak}15`}/><circle cx="11" cy="12" r="1.3" fill={C.streak}/><circle cx="16" cy="10" r="1.3" fill={C.streak}/><circle cx="21" cy="12" r="1.3" fill={C.streak}/><path d="M11 17L16 20L21 17" stroke={C.streak} strokeWidth="1.2"/></I>
);

const Unstoppable = (s: number) => (
  <I size={s}><path d="M16 4C16 4 20 8 22 12C24 16 22 22 16 28C10 22 8 16 10 12C12 8 16 4 16 4Z" fill={`${C.streak}25`} stroke={C.streak} strokeWidth="1.5"/><path d="M16 10C16 10 18 13 18 16C18 19 16 22 16 22C16 22 14 19 14 16C14 13 16 10 16 10Z" fill={C.streak} opacity="0.6"/><circle cx="16" cy="15" r="2" fill="#fff" opacity="0.8"/></I>
);

const Ace = (s: number) => (
  <I size={s}><rect x="8" y="5" width="16" height="22" rx="2" stroke={C.streak} strokeWidth="1.5" fill={`${C.streak}10`}/><path d="M16 10L19 18H13L16 10Z" fill={C.streak} opacity="0.7"/><circle cx="16" cy="20" r="1.5" fill={C.streak}/><text x="16" y="9" textAnchor="middle" fill={C.streak} fontSize="5" fontWeight="bold">A</text></I>
);

const Rampage = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="11" stroke={C.streak} strokeWidth="1.5" fill={`${C.streak}10`}/><path d="M12 20L16 8L20 20" stroke={C.streak} strokeWidth="2" strokeLinecap="round"/><path d="M8 16L12 14L16 16L20 14L24 16" stroke={C.streak} strokeWidth="1" opacity="0.5"/><circle cx="16" cy="12" r="2" fill={C.streak} opacity="0.8"/></I>
);

const GodLike = (s: number) => (
  <I size={s}><circle cx="16" cy="18" r="9" stroke="#00ffff" strokeWidth="1.5" fill="rgba(0,255,255,0.08)"/><path d="M16 9V6" stroke="#00ffff" strokeWidth="1.5"/><path d="M11 7L13 10" stroke="#00ffff" strokeWidth="1"/><path d="M21 7L19 10" stroke="#00ffff" strokeWidth="1"/><circle cx="16" cy="18" r="4" fill="rgba(0,255,255,0.2)" stroke="#00ffff" strokeWidth="1"/><path d="M10 12L16 6L22 12" stroke="#ffd700" strokeWidth="1.8" fill="rgba(255,215,0,0.15)"/><circle cx="16" cy="18" r="1.5" fill="#00ffff"/></I>
);

const Legendary = (s: number) => (
  <I size={s}><path d="M16 4L19 12L28 13L21 19L23 28L16 24L9 28L11 19L4 13L13 12L16 4Z" fill={`${C.streak}20`} stroke="#ffd700" strokeWidth="1.5"/><circle cx="16" cy="15" r="3" fill="rgba(255,215,0,0.3)" stroke="#ffd700" strokeWidth="1"/><circle cx="16" cy="15" r="1" fill="#ffd700"/></I>
);

const TacticalNuke = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="10" stroke="#ff0000" strokeWidth="1.5" fill="rgba(255,0,0,0.08)"/><path d="M16 6L16 16" stroke="#ff0000" strokeWidth="2"/><path d="M16 16L23 21" stroke="#ff0000" strokeWidth="2"/><path d="M16 16L9 21" stroke="#ff0000" strokeWidth="2"/><circle cx="16" cy="16" r="3" fill="rgba(255,0,0,0.3)" stroke="#ff0000" strokeWidth="1"/><circle cx="16" cy="16" r="1" fill="#ff0000"/></I>
);

const BeyondGodlike = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="11" stroke="#ff00ff" strokeWidth="1" fill="rgba(255,0,255,0.05)"/><circle cx="16" cy="16" r="7" stroke="#ff00ff" strokeWidth="1.5" fill="rgba(255,0,255,0.1)"/><path d="M16 5L18 13H26L20 18L22 26L16 21L10 26L12 18L6 13H14L16 5Z" fill="rgba(255,0,255,0.2)" stroke="#ff00ff" strokeWidth="1"/><circle cx="16" cy="16" r="2" fill="#ff00ff" opacity="0.8"/><path d="M8 8L11 12" stroke="#ff00ff" strokeWidth="0.8" opacity="0.5"/><path d="M24 8L21 12" stroke="#ff00ff" strokeWidth="0.8" opacity="0.5"/></I>
);

// --- PREPAY STREAK ICONS ---

const DoubleTap = (s: number) => (
  <I size={s}><rect x="13" y="6" width="3" height="12" rx="1.5" fill={C.prepay} opacity="0.7"/><rect x="18" y="8" width="3" height="12" rx="1.5" fill={C.prepay} opacity="0.5"/><path d="M12 22L14 18" stroke={C.prepay} strokeWidth="1" opacity="0.4"/><path d="M17 24L19 20" stroke={C.prepay} strokeWidth="1" opacity="0.4"/><circle cx="14.5" cy="6" r="1" fill={C.prepay}/><circle cx="19.5" cy="8" r="1" fill={C.prepay}/></I>
);

const HatTrick = (s: number) => (
  <I size={s}><path d="M16 5L22 14H10L16 5Z" fill={`${C.prepay}30`} stroke={C.prepay} strokeWidth="1.5"/><rect x="8" y="14" width="16" height="3" rx="1" fill={C.prepay} opacity="0.5"/><circle cx="16" cy="10" r="1.5" fill={C.prepay}/><path d="M12 20L16 24L20 20" stroke={C.prepay} strokeWidth="1.2" opacity="0.6"/></I>
);

const GrandSlam = (s: number) => (
  <I size={s}><path d="M16 4L20 16L16 28L12 16L16 4Z" fill={`${C.prepay}25`} stroke={C.prepay} strokeWidth="1.5"/><path d="M4 16L16 12L28 16L16 20L4 16Z" fill={`${C.prepay}15`} stroke={C.prepay} strokeWidth="1"/><circle cx="16" cy="16" r="2.5" fill={C.prepay} opacity="0.6"/><circle cx="16" cy="16" r="1" fill="#fff" opacity="0.8"/></I>
);

const RoyalFlush = (s: number) => (
  <I size={s}><path d="M10 12L16 6L22 12" stroke={C.prepay} strokeWidth="2" fill={`${C.prepay}20`}/><rect x="10" y="12" width="12" height="12" rx="1" stroke={C.prepay} strokeWidth="1.5" fill={`${C.prepay}10`}/><text x="16" y="21" textAnchor="middle" fill={C.prepay} fontSize="8" fontWeight="bold">$</text></I>
);

const Domination = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="10" stroke={C.prepay} strokeWidth="2" fill={`${C.prepay}10`}/><path d="M12 18V14L16 10L20 14V18" stroke={C.prepay} strokeWidth="2" strokeLinecap="round"/><path d="M10 20L16 16L22 20" stroke={C.prepay} strokeWidth="1.5"/><circle cx="16" cy="12" r="1.5" fill={C.prepay}/></I>
);

// --- STREET ICONS ---

const LinkShotKill = (s: number) => (
  <I size={s}><circle cx="12" cy="14" r="4" stroke={C.street} strokeWidth="1.5" fill="none"/><circle cx="20" cy="14" r="4" stroke={C.street} strokeWidth="1.5" fill="none"/><circle cx="16" cy="20" r="4" stroke={C.street} strokeWidth="1.5" fill="none"/><circle cx="16" cy="14" r="1" fill={C.street}/></I>
);

const DucksInARow = (s: number) => (
  <I size={s}><circle cx="8" cy="16" r="2.5" fill={`${C.street}40`} stroke={C.street} strokeWidth="1"/><circle cx="16" cy="16" r="2.5" fill={`${C.street}40`} stroke={C.street} strokeWidth="1"/><circle cx="24" cy="16" r="2.5" fill={`${C.street}40`} stroke={C.street} strokeWidth="1"/><line x1="10.5" y1="16" x2="13.5" y2="16" stroke={C.street} strokeWidth="1" strokeDasharray="1 1"/><line x1="18.5" y1="16" x2="21.5" y2="16" stroke={C.street} strokeWidth="1" strokeDasharray="1 1"/><path d="M4 10L16 6L28 10" stroke={C.street} strokeWidth="1" opacity="0.3"/></I>
);

const Ducksplosion = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="4" fill={`${C.street}30`} stroke={C.street} strokeWidth="1.5"/><path d="M16 12L17 8" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><path d="M20 14L24 11" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><path d="M20 18L24 21" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><path d="M16 20L17 24" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><path d="M12 18L8 21" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><path d="M12 14L8 11" stroke={C.street} strokeWidth="1.5" strokeLinecap="round"/><circle cx="16" cy="16" r="1.5" fill={C.street}/></I>
);

// --- TIME ICONS ---

const EarlyBird = (s: number) => (
  <I size={s}><path d="M6 22C6 22 10 14 16 14C22 14 26 22 26 22" fill={`${C.time}20`} stroke={C.time} strokeWidth="1.5"/><circle cx="16" cy="10" r="4" fill={`${C.time}30`} stroke={C.time} strokeWidth="1.5"/><path d="M16 6V3" stroke={C.time} strokeWidth="1.5" strokeLinecap="round"/><path d="M12 7L10 5" stroke={C.time} strokeWidth="1" strokeLinecap="round"/><path d="M20 7L22 5" stroke={C.time} strokeWidth="1" strokeLinecap="round"/><circle cx="16" cy="10" r="1.5" fill={C.time}/></I>
);

const BuzzerBeater = (s: number) => (
  <I size={s}><path d="M20 8C20 8 24 12 24 18C24 22 20 26 16 26C12 26 8 22 8 18C8 14 10 12 10 12" stroke={C.time} strokeWidth="1.5" fill={`${C.time}15`}/><circle cx="14" cy="14" r="1" fill={C.time}/><circle cx="20" cy="16" r="0.8" fill={C.time} opacity="0.5"/><circle cx="12" cy="20" r="0.6" fill={C.time} opacity="0.3"/><path d="M18 6L22 4" stroke={C.time} strokeWidth="1" opacity="0.5"/></I>
);

// --- SPREE ICONS ---

const KillingSpree = (s: number) => (
  <I size={s}><path d="M16 4L18 14L16 28" stroke={C.spree} strokeWidth="2" strokeLinecap="round"/><path d="M12 10L20 10" stroke={C.spree} strokeWidth="2.5" strokeLinecap="round"/><circle cx="16" cy="14" r="1" fill={C.spree}/></I>
);

const Warpath = (s: number) => (
  <I size={s}><path d="M10 6L22 26" stroke={C.spree} strokeWidth="2" strokeLinecap="round"/><path d="M22 6L10 26" stroke={C.spree} strokeWidth="2" strokeLinecap="round"/><circle cx="16" cy="16" r="3" fill={`${C.spree}20`} stroke={C.spree} strokeWidth="1"/><circle cx="16" cy="16" r="1" fill={C.spree}/></I>
);

const Onslaught = (s: number) => (
  <I size={s}><path d="M16 4L22 10V22L16 28L10 22V10L16 4Z" stroke={C.spree} strokeWidth="1.5" fill={`${C.spree}15`}/><path d="M16 10V22" stroke={C.spree} strokeWidth="1.5"/><path d="M12 14L20 14" stroke={C.spree} strokeWidth="1.5"/><circle cx="16" cy="16" r="2" fill={C.spree} opacity="0.5"/></I>
);

const Massacre = (s: number) => (
  <I size={s}><circle cx="16" cy="12" r="5" stroke={C.spree} strokeWidth="1.5" fill={`${C.spree}15`}/><circle cx="13" cy="11" r="1.5" fill={C.spree}/><circle cx="19" cy="11" r="1.5" fill={C.spree}/><path d="M12 15L16 18L20 15" stroke={C.spree} strokeWidth="1.2"/><path d="M10 20L16 28L22 20" stroke={C.spree} strokeWidth="1.5" fill={`${C.spree}10`}/></I>
);

const Annihilation = (s: number) => (
  <I size={s}><path d="M16 6C16 6 14 12 14 16C14 20 16 26 16 26C16 26 18 20 18 16C18 12 16 6 16 6Z" fill={`${C.spree}30`} stroke={C.spree} strokeWidth="1"/><path d="M10 14C10 14 13 16 16 16C19 16 22 14 22 14" stroke={C.spree} strokeWidth="1.5"/><path d="M8 18C8 18 12 20 16 20C20 20 24 18 24 18" stroke={C.spree} strokeWidth="1" opacity="0.5"/><circle cx="16" cy="12" r="2" fill={C.spree} opacity="0.6"/><path d="M16 6L16 3" stroke={C.spree} strokeWidth="1.5" strokeLinecap="round"/></I>
);

// --- SPECIAL ICONS ---

const FirstBlood = (s: number) => (
  <I size={s}><path d="M16 6C16 6 20 12 20 18C20 22 18 26 16 26C14 26 12 22 12 18C12 12 16 6 16 6Z" fill={`${C.special}30`} stroke={C.special} strokeWidth="1.5"/><circle cx="16" cy="17" r="2.5" fill={C.special} opacity="0.4"/><circle cx="16" cy="17" r="1" fill="#fff" opacity="0.7"/></I>
);

const NoScope = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="10" stroke={C.special} strokeWidth="1.5" fill="none"/><circle cx="16" cy="16" r="5" stroke={C.special} strokeWidth="1" fill={`${C.special}10`}/><line x1="16" y1="6" x2="16" y2="11" stroke={C.special} strokeWidth="1.2"/><line x1="16" y1="21" x2="16" y2="26" stroke={C.special} strokeWidth="1.2"/><line x1="6" y1="16" x2="11" y2="16" stroke={C.special} strokeWidth="1.2"/><line x1="21" y1="16" x2="26" y2="16" stroke={C.special} strokeWidth="1.2"/><circle cx="16" cy="16" r="1.5" fill={C.special}/><path d="M10 10L13 13" stroke={C.special} strokeWidth="0.8" opacity="0.4"/><path d="M22 10L19 13" stroke={C.special} strokeWidth="0.8" opacity="0.4"/></I>
);

const FastStart = (s: number) => (
  <I size={s}><path d="M14 26L14 14L10 14L18 4L18 14L22 14L14 26Z" fill={`${C.special}30`} stroke={C.special} strokeWidth="1.5"/><circle cx="16" cy="14" r="1.5" fill={C.special}/></I>
);

// --- HEADHUNTER ICONS ---

const Headhunter = (s: number) => (
  <I size={s}><path d="M16 4L18 12" stroke={C.headhunter} strokeWidth="1.5" strokeLinecap="round"/><path d="M16 4L14 6L16 5L18 6L16 4Z" fill={C.headhunter}/><circle cx="18" cy="16" r="4" stroke={C.headhunter} strokeWidth="1.5" fill={`${C.headhunter}15`}/><circle cx="18" cy="16" r="1.5" fill={C.headhunter} opacity="0.6"/><path d="M14 22L18 20" stroke={C.headhunter} strokeWidth="1" opacity="0.4"/></I>
);

const TrophyHunter = (s: number) => (
  <I size={s}><path d="M12 8H20V14C20 18 18 20 16 22C14 20 12 18 12 14V8Z" stroke={C.headhunter} strokeWidth="1.5" fill={`${C.headhunter}15`}/><path d="M12 10H8V13C8 15 10 16 12 16" stroke={C.headhunter} strokeWidth="1" fill="none"/><path d="M20 10H24V13C24 15 22 16 20 16" stroke={C.headhunter} strokeWidth="1" fill="none"/><rect x="14" y="22" width="4" height="2" fill={C.headhunter} opacity="0.5"/><rect x="12" y="24" width="8" height="2" rx="1" fill={C.headhunter} opacity="0.3"/></I>
);

const ApexPredator = (s: number) => (
  <I size={s}><path d="M16 6L10 14V20L16 26L22 20V14L16 6Z" stroke={C.headhunter} strokeWidth="1.5" fill={`${C.headhunter}15`}/><circle cx="13" cy="15" r="1.5" fill={C.headhunter}/><circle cx="19" cy="15" r="1.5" fill={C.headhunter}/><path d="M13 20L16 22L19 20" stroke={C.headhunter} strokeWidth="1.2"/><path d="M10 14L6 12" stroke={C.headhunter} strokeWidth="1" opacity="0.4"/><path d="M22 14L26 12" stroke={C.headhunter} strokeWidth="1" opacity="0.4"/></I>
);

// --- RAISE THE DEAD ICONS ---

const GraveDigger = (s: number) => (
  <I size={s}><rect x="12" y="6" width="8" height="14" rx="3" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}15`}/><path d="M14 10H18" stroke={C.dead} strokeWidth="1.2"/><path d="M16 8V14" stroke={C.dead} strokeWidth="1.2"/><path d="M8 20H24" stroke={C.dead} strokeWidth="1.5"/><path d="M10 20L10 26" stroke={C.dead} strokeWidth="1" opacity="0.3"/><path d="M22 20L22 26" stroke={C.dead} strokeWidth="1" opacity="0.3"/></I>
);

const Necromancer = (s: number) => (
  <I size={s}><circle cx="16" cy="12" r="6" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}15`}/><circle cx="13" cy="11" r="2" fill={C.dead} opacity="0.6"/><circle cx="19" cy="11" r="2" fill={C.dead} opacity="0.6"/><circle cx="13" cy="11" r="0.8" fill="#000"/><circle cx="19" cy="11" r="0.8" fill="#000"/><path d="M13 15L16 17L19 15" stroke={C.dead} strokeWidth="1"/><path d="M12 20L16 28L20 20" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}10`}/></I>
);

const LichKing = (s: number) => (
  <I size={s}><circle cx="16" cy="14" r="6" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}15`}/><path d="M11 8L14 11" stroke="#ffd700" strokeWidth="1.5"/><path d="M16 5L16 9" stroke="#ffd700" strokeWidth="1.5"/><path d="M21 8L18 11" stroke="#ffd700" strokeWidth="1.5"/><circle cx="13" cy="13" r="1.5" fill={C.dead}/><circle cx="19" cy="13" r="1.5" fill={C.dead}/><path d="M13 17L16 19L19 17" stroke={C.dead} strokeWidth="1"/><path d="M12 22L16 26L20 22" stroke={C.dead} strokeWidth="1" opacity="0.4"/></I>
);

const Resurrection = (s: number) => (
  <I size={s}><path d="M16 26L16 14" stroke={C.dead} strokeWidth="2" strokeLinecap="round"/><path d="M12 18L16 10L20 18" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}20`}/><circle cx="16" cy="8" r="3" stroke={C.dead} strokeWidth="1.5" fill={`${C.dead}15`}/><path d="M8 24L16 20L24 24" stroke={C.dead} strokeWidth="1" opacity="0.3"/><path d="M14 5L16 3L18 5" stroke={C.dead} strokeWidth="1" opacity="0.5"/></I>
);

// --- RANK ICONS (military chevrons/stars) ---

const Sergeant = (s: number) => (
  <I size={s}><path d="M10 18L16 14L22 18" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M10 22L16 18L22 22" stroke={C.rank} strokeWidth="2" fill="none" opacity="0.5" strokeLinecap="round"/></I>
);

const Lieutenant = (s: number) => (
  <I size={s}><path d="M10 16L16 12L22 16" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M10 20L16 16L22 20" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/></I>
);

const Captain = (s: number) => (
  <I size={s}><path d="M10 14L16 10L22 14" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M10 18L16 14L22 18" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M10 22L16 18L22 22" stroke={C.rank} strokeWidth="2.5" fill="none" strokeLinecap="round"/></I>
);

const Commander = (s: number) => (
  <I size={s}><path d="M16 6L19 12L26 13L21 18L22 25L16 22L10 25L11 18L6 13L13 12L16 6Z" stroke={C.rank} strokeWidth="1.5" fill={`${C.rank}20`}/><circle cx="16" cy="15" r="2" fill={C.rank} opacity="0.5"/></I>
);

const General = (s: number) => (
  <I size={s}><path d="M16 4L19 10L26 11L21 16L22 23L16 20L10 23L11 16L6 11L13 10L16 4Z" stroke={C.rank} strokeWidth="1.5" fill={`${C.rank}30`}/><circle cx="16" cy="14" r="2.5" fill={C.rank} opacity="0.6"/><circle cx="16" cy="14" r="1" fill="#fff" opacity="0.7"/></I>
);

const FieldMarshal = (s: number) => (
  <I size={s}><circle cx="16" cy="14" r="8" stroke={C.rank} strokeWidth="1.5" fill={`${C.rank}15`}/><path d="M16 6L18 11L23 12L19 16L20 21L16 18L12 21L13 16L9 12L14 11L16 6Z" fill={C.rank} opacity="0.5"/><circle cx="16" cy="14" r="1.5" fill="#fff" opacity="0.7"/><rect x="14" y="23" width="4" height="3" rx="1" fill={C.rank} opacity="0.4"/></I>
);

const Warlord = (s: number) => (
  <I size={s}><path d="M8 8L16 4L24 8V20L16 28L8 20V8Z" stroke={C.rank} strokeWidth="1.5" fill={`${C.rank}15`}/><path d="M12 12L16 8L20 12" stroke={C.rank} strokeWidth="2" strokeLinecap="round"/><path d="M12 16L16 12L20 16" stroke={C.rank} strokeWidth="2" strokeLinecap="round"/><path d="M12 20L16 16L20 20" stroke={C.rank} strokeWidth="2" strokeLinecap="round"/></I>
);

const SupremeCmdr = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="11" stroke={C.rank} strokeWidth="1.5" fill={`${C.rank}10`}/><path d="M16 5L18 11H24L19 15L21 21L16 17L11 21L13 15L8 11H14L16 5Z" fill={C.rank} opacity="0.6" stroke={C.rank} strokeWidth="0.8"/><circle cx="16" cy="14" r="2" fill="#fff" opacity="0.6"/><path d="M11 6L14 10" stroke={C.rank} strokeWidth="1" opacity="0.3"/><path d="M21 6L18 10" stroke={C.rank} strokeWidth="1" opacity="0.3"/></I>
);

// --- MILESTONE ICONS ---

const FirstDeploy = (s: number) => (
  <I size={s}><path d="M16 26L12 18L14 18L14 6L18 6L18 18L20 18L16 26Z" fill={`${C.milestone}30`} stroke={C.milestone} strokeWidth="1.5"/><path d="M12 8L10 10" stroke={C.milestone} strokeWidth="1" opacity="0.4"/><path d="M20 8L22 10" stroke={C.milestone} strokeWidth="1" opacity="0.4"/><circle cx="16" cy="4" r="1" fill={C.milestone} opacity="0.5"/></I>
);

const Sharpshooter = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="10" stroke={C.milestone} strokeWidth="1.5" fill="none"/><circle cx="16" cy="16" r="6" stroke={C.milestone} strokeWidth="1" fill={`${C.milestone}10`}/><circle cx="16" cy="16" r="2" fill={C.milestone} opacity="0.6"/><line x1="16" y1="6" x2="16" y2="10" stroke={C.milestone} strokeWidth="1.2"/><line x1="16" y1="22" x2="16" y2="26" stroke={C.milestone} strokeWidth="1.2"/><line x1="6" y1="16" x2="10" y2="16" stroke={C.milestone} strokeWidth="1.2"/><line x1="22" y1="16" x2="26" y2="16" stroke={C.milestone} strokeWidth="1.2"/></I>
);

const Veteran = (s: number) => (
  <I size={s}><path d="M16 4L20 12L28 14L22 20L24 28L16 24L8 28L10 20L4 14L12 12L16 4Z" stroke={C.milestone} strokeWidth="1.5" fill={`${C.milestone}20`}/><circle cx="16" cy="15" r="3" fill={C.milestone} opacity="0.3"/><text x="16" y="17" textAnchor="middle" fill={C.milestone} fontSize="6" fontWeight="bold">V</text></I>
);

const WarHero = (s: number) => (
  <I size={s}><path d="M16 6L19 12H25L20 16L22 22L16 19L10 22L12 16L7 12H13L16 6Z" stroke={C.milestone} strokeWidth="1.5" fill={`${C.milestone}25`}/><rect x="14" y="22" width="4" height="6" rx="1" fill={C.milestone} opacity="0.4"/><path d="M12 24H20" stroke={C.milestone} strokeWidth="1" opacity="0.3"/></I>
);

const Legend = (s: number) => (
  <I size={s}><path d="M12 8H20V14C20 18 18 22 16 24C14 22 12 18 12 14V8Z" stroke={C.milestone} strokeWidth="1.5" fill={`${C.milestone}20`}/><path d="M12 10H8V13C8 15 10 16 12 16" stroke={C.milestone} strokeWidth="1"/><path d="M20 10H24V13C24 15 22 16 20 16" stroke={C.milestone} strokeWidth="1"/><path d="M16 12L17 14H19L17.5 15.5L18 18L16 16.5L14 18L14.5 15.5L13 14H15L16 12Z" fill={C.milestone}/><rect x="14" y="24" width="4" height="2" fill={C.milestone} opacity="0.4"/></I>
);

// --- WORKHORSE ICONS ---

const Ironman = (s: number) => (
  <I size={s}><path d="M14 14C14 14 12 10 16 8C20 10 18 14 18 14" stroke={C.workhorse} strokeWidth="2" strokeLinecap="round"/><path d="M14 14L10 20" stroke={C.workhorse} strokeWidth="2.5" strokeLinecap="round"/><path d="M18 14L22 20" stroke={C.workhorse} strokeWidth="2.5" strokeLinecap="round"/><circle cx="16" cy="8" r="2" fill={C.workhorse} opacity="0.3"/></I>
);

const Machine = (s: number) => (
  <I size={s}><circle cx="16" cy="16" r="7" stroke={C.workhorse} strokeWidth="1.5" fill={`${C.workhorse}15`}/><circle cx="16" cy="16" r="3" fill={C.workhorse} opacity="0.3"/><circle cx="16" cy="16" r="1" fill={C.workhorse}/><path d="M16 9V6" stroke={C.workhorse} strokeWidth="2" strokeLinecap="round"/><path d="M16 26V23" stroke={C.workhorse} strokeWidth="2" strokeLinecap="round"/><path d="M9 16H6" stroke={C.workhorse} strokeWidth="2" strokeLinecap="round"/><path d="M26 16H23" stroke={C.workhorse} strokeWidth="2" strokeLinecap="round"/><path d="M11.1 11.1L9 9" stroke={C.workhorse} strokeWidth="1.5" strokeLinecap="round"/><path d="M23 23L20.9 20.9" stroke={C.workhorse} strokeWidth="1.5" strokeLinecap="round"/></I>
);

const Terminator = (s: number) => (
  <I size={s}><rect x="10" y="8" width="12" height="10" rx="3" stroke={C.workhorse} strokeWidth="1.5" fill={`${C.workhorse}15`}/><circle cx="13" cy="13" r="2" stroke="#e74c3c" strokeWidth="1" fill="rgba(231,76,60,0.2)"/><circle cx="13" cy="13" r="0.8" fill="#e74c3c"/><circle cx="19" cy="13" r="2" stroke={C.workhorse} strokeWidth="1" fill={`${C.workhorse}20`}/><path d="M13 17L19 17" stroke={C.workhorse} strokeWidth="1"/><path d="M12 18L12 24" stroke={C.workhorse} strokeWidth="1.5"/><path d="M20 18L20 24" stroke={C.workhorse} strokeWidth="1.5"/><path d="M14 20H18" stroke={C.workhorse} strokeWidth="1"/></I>
);

// =============================================================================
// BADGE ICON LOOKUP
// =============================================================================

const BADGE_ICON_MAP: Record<string, (size: number) => React.ReactNode> = {
  // Streaks
  double_kill: DoubleKill,
  triple_kill: TripleKill,
  unstoppable: Unstoppable,
  ace: Ace,
  rampage: Rampage,
  godlike: GodLike,
  legendary: Legendary,
  tactical_nuke: TacticalNuke,
  beyond_godlike: BeyondGodlike,
  // Prepay Streak
  double_tap: DoubleTap,
  hat_trick: HatTrick,
  grand_slam: GrandSlam,
  royal_flush: RoyalFlush,
  domination: Domination,
  // Street
  link_shot_kill: LinkShotKill,
  ducks_in_a_row: DucksInARow,
  ducksplosion: Ducksplosion,
  // Time
  early_bird: EarlyBird,
  buzzer_beater: BuzzerBeater,
  // Spree
  killing_spree: KillingSpree,
  warpath: Warpath,
  onslaught: Onslaught,
  massacre: Massacre,
  annihilation: Annihilation,
  // Special
  first_blood: FirstBlood,
  no_scope: NoScope,
  fast_start: FastStart,
  // Headhunter
  headhunter: Headhunter,
  trophy_hunter: TrophyHunter,
  apex_predator: ApexPredator,
  // Raise the Dead
  grave_digger: GraveDigger,
  necromancer: Necromancer,
  lich_king: LichKing,
  resurrection: Resurrection,
  // Ranks
  sergeant: Sergeant,
  lieutenant: Lieutenant,
  captain: Captain,
  commander: Commander,
  general: General,
  field_marshal: FieldMarshal,
  warlord: Warlord,
  supreme_cmdr: SupremeCmdr,
  // Milestones
  first_deploy: FirstDeploy,
  sharpshooter: Sharpshooter,
  veteran: Veteran,
  war_hero: WarHero,
  legend: Legend,
  // Workhorse
  ironman: Ironman,
  machine: Machine,
  terminator: Terminator,
};

/**
 * Get a custom SVG badge icon by badge ID.
 * Returns null if the badge ID is not found (falls back to emoji in the caller).
 */
export function getBadgeIcon(badgeId: string, size: number = 24): React.ReactNode | null {
  const fn = BADGE_ICON_MAP[badgeId];
  return fn ? fn(size) : null;
}

/**
 * Get badge category color by badge ID.
 */
export function getBadgeCategoryColor(badgeId: string): string {
  const sectionMap: Record<string, string> = {
    double_kill: C.streak, triple_kill: C.streak, unstoppable: C.streak, ace: C.streak,
    rampage: C.streak, godlike: C.streak, legendary: C.streak, tactical_nuke: C.streak, beyond_godlike: C.streak,
    double_tap: C.prepay, hat_trick: C.prepay, grand_slam: C.prepay, royal_flush: C.prepay, domination: C.prepay,
    link_shot_kill: C.street, ducks_in_a_row: C.street, ducksplosion: C.street,
    early_bird: C.time, buzzer_beater: C.time,
    killing_spree: C.spree, warpath: C.spree, onslaught: C.spree, massacre: C.spree, annihilation: C.spree,
    first_blood: C.special, no_scope: C.special, fast_start: C.special,
    headhunter: C.headhunter, trophy_hunter: C.headhunter, apex_predator: C.headhunter,
    grave_digger: C.dead, necromancer: C.dead, lich_king: C.dead, resurrection: C.dead,
    sergeant: C.rank, lieutenant: C.rank, captain: C.rank, commander: C.rank,
    general: C.rank, field_marshal: C.rank, warlord: C.rank, supreme_cmdr: C.rank,
    first_deploy: C.milestone, sharpshooter: C.milestone, veteran: C.milestone, war_hero: C.milestone, legend: C.milestone,
    ironman: C.workhorse, machine: C.workhorse, terminator: C.workhorse,
  };
  return sectionMap[badgeId] || '#2ecc71';
}