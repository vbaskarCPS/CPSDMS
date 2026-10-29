// src/pages/Minigame/lessonCharacters.tsx — Little Lessons' friends, drawn here as SVG in the same style as
// the chess pieces (big blinking eyes, rosy cheeks, a mouth for the mood): Ollie the Owl (sight words),
// Benny the Bear (counting) and Zip the Robot (adding and taking away). `CastShape` draws anyone.
import React from 'react';
import type { Cast, Friend } from '../../lib/littleLessons/levels';
import { Character, Face, type Mood } from './chessCharacters';

const INK = '#1f2937';
const stroke = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const };

function friend(who: Friend, mood: Mood): React.ReactNode {
  switch (who) {
    case 'ollie': return <>
      {/* a round purple owl with ear tufts, a book under her wing */}
      <path d="M22 26 L30 6 L40 22 Z" fill="#7c3aed" {...stroke} />
      <path d="M78 26 L70 6 L60 22 Z" fill="#7c3aed" {...stroke} />
      <ellipse cx="50" cy="62" rx="36" ry="44" fill="#8b5cf6" {...stroke} />
      <ellipse cx="50" cy="74" rx="22" ry="26" fill="#ede9fe" stroke={INK} strokeWidth="3" />
      <circle cx="38" cy="40" r="14" fill="#fff" stroke={INK} strokeWidth="3" />
      <circle cx="62" cy="40" r="14" fill="#fff" stroke={INK} strokeWidth="3" />
      <Face cx={50} cy={40} mood={mood} scale={1.05} />
      <path d="M46 54 L50 62 L54 54 Z" fill="#f59e0b" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="62" y="70" width="26" height="20" rx="3" fill="#f43f5e" {...stroke} transform="rotate(-12 75 80)" />
      <path d="M40 104 v6 M46 104 v6 M54 104 v6 M60 104 v6" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
    </>;
    case 'benny': return <>
      {/* a cuddly brown bear with a berry basket */}
      <circle cx="24" cy="18" r="12" fill="#a16207" {...stroke} />
      <circle cx="76" cy="18" r="12" fill="#a16207" {...stroke} />
      <circle cx="24" cy="18" r="5" fill="#fcd34d" />
      <circle cx="76" cy="18" r="5" fill="#fcd34d" />
      <ellipse cx="50" cy="84" rx="32" ry="26" fill="#a16207" {...stroke} />
      <circle cx="50" cy="42" r="32" fill="#ca8a04" {...stroke} />
      <ellipse cx="50" cy="54" rx="14" ry="10" fill="#fde68a" stroke={INK} strokeWidth="3" />
      <ellipse cx="50" cy="48" rx="5" ry="3.5" fill={INK} />
      <Face cx={50} cy={36} mood={mood} scale={1} />
      <path d="M30 92 h40 l-5 18 h-30 z" fill="#d97706" {...stroke} />
      <circle cx="40" cy="90" r="5" fill="#e11d48" stroke={INK} strokeWidth="2" /><circle cx="50" cy="88" r="5" fill="#2563eb" stroke={INK} strokeWidth="2" /><circle cx="60" cy="90" r="5" fill="#e11d48" stroke={INK} strokeWidth="2" />
    </>;
    case 'zip': return <>
      {/* a friendly teal robot with an antenna light and a number screen on its tummy */}
      <path d="M50 4 v12" stroke={INK} strokeWidth="4" />
      <circle cx="50" cy="6" r="6" fill="#facc15" {...stroke} className="ll-antenna" />
      <rect x="18" y="16" width="64" height="46" rx="14" fill="#2dd4bf" {...stroke} />
      <rect x="10" y="30" width="8" height="16" rx="3" fill="#0f766e" {...stroke} />
      <rect x="82" y="30" width="8" height="16" rx="3" fill="#0f766e" {...stroke} />
      <Face cx={50} cy={36} mood={mood} scale={1} />
      <rect x="24" y="64" width="52" height="40" rx="10" fill="#14b8a6" {...stroke} />
      <rect x="34" y="72" width="32" height="18" rx="4" fill="#042f2e" stroke={INK} strokeWidth="3" />
      <text x="50" y="86" textAnchor="middle" fontSize="13" fontWeight="900" fill="#5eead4" fontFamily="system-ui">1+2</text>
      <rect x="30" y="104" width="12" height="10" rx="3" fill="#0f766e" {...stroke} />
      <rect x="58" y="104" width="12" height="10" rx="3" fill="#0f766e" {...stroke} />
    </>;
  }
}

const isFriend = (c: Cast): c is Friend => c === 'ollie' || c === 'benny' || c === 'zip';

/** Any member of the cast, `size` pixels tall. */
export const CastShape: React.FC<{ who: Cast; size: number; mood?: Mood; className?: string; style?: React.CSSProperties }> = ({ who, size, mood = 'idle', className, style }) => (
  isFriend(who)
    ? <svg viewBox="0 -2 100 120" width={size * 100 / 120} height={size} className={className} aria-hidden="true"
        style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))', display: 'inline-block', ...style }}>{friend(who, mood)}</svg>
    : <Character piece={who} size={size} mood={mood} className={className} style={style} />
);

export const LESSON_CHARACTER_CSS = `
  @keyframes ll-blink-light { 0%,100% { fill: #facc15 } 50% { fill: #fde68a } }
  .ll-antenna { animation: ll-blink-light 1.4s ease-in-out infinite; }
`;
