// src/pages/Minigame/chessCharacters.tsx — Little Chess's own cartoon cast. Each one keeps the real
// chess piece's shape (so Kiaan learns the actual pieces) and adds a face: big eyes that blink, rosy
// cheeks, and a mouth that changes with the mood. All drawn here as SVG; no outside artwork.
import React from 'react';
import type { Piece } from '../../lib/littleChess/lessons';

export type Mood = 'idle' | 'happy' | 'munch';

const INK = '#1f2937', BODY = '#fffbeb', SHADE = '#f5e6c8', GOLD = '#facc15', CHEEK = '#fda4af';

/** Two eyes (blinking), cheeks and a mouth, centred on (cx, cy). */
export const Face: React.FC<{ cx: number; cy: number; mood: Mood; scale?: number; one?: boolean }> = ({ cx, cy, mood, scale = 1, one }) => {
  const s = scale, ex = 11 * s, er = 5.2 * s;
  const eyes = one ? [cx] : [cx - ex, cx + ex];
  return (
    <g>
      {eyes.map((x, i) => (
        <g key={i} className="lc-blink" style={{ transformOrigin: `${x}px ${cy}px`, transformBox: 'view-box' as React.CSSProperties['transformBox'] }}>
          <ellipse cx={x} cy={cy} rx={er} ry={er * 1.2} fill={INK} />
          <circle cx={x + er * 0.35} cy={cy - er * 0.45} r={er * 0.38} fill="#fff" />
        </g>
      ))}
      {!one && <>
        <ellipse cx={cx - ex - 4 * s} cy={cy + 9 * s} rx={4.2 * s} ry={2.8 * s} fill={CHEEK} opacity={0.85} />
        <ellipse cx={cx + ex + 4 * s} cy={cy + 9 * s} rx={4.2 * s} ry={2.8 * s} fill={CHEEK} opacity={0.85} />
      </>}
      {mood === 'idle' && <path d={`M${cx - 6 * s} ${cy + 9 * s} Q${cx} ${cy + 14 * s} ${cx + 6 * s} ${cy + 9 * s}`} fill="none" stroke={INK} strokeWidth={2.6 * s} strokeLinecap="round" />}
      {mood === 'happy' && <path d={`M${cx - 8 * s} ${cy + 8 * s} Q${cx} ${cy + 20 * s} ${cx + 8 * s} ${cy + 8 * s} Z`} fill="#be123c" stroke={INK} strokeWidth={2.4 * s} strokeLinejoin="round" />}
      {mood === 'munch' && <ellipse cx={cx} cy={cy + 12 * s} rx={5 * s} ry={6 * s} fill="#be123c" stroke={INK} strokeWidth={2.4 * s} />}
    </g>
  );
};

const base = <rect x="12" y="100" width="76" height="15" rx="7" fill={SHADE} stroke={INK} strokeWidth="4" />;
const stroke = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const };

function body(piece: Piece, mood: Mood): React.ReactNode {
  switch (piece) {
    case 'pawn': return <>
      <path d="M28 100 C30 84 36 74 42 66 L58 66 C64 74 70 84 72 100 Z" fill={BODY} {...stroke} />
      <rect x="32" y="58" width="36" height="10" rx="5" fill={SHADE} {...stroke} />
      <circle cx="50" cy="36" r="24" fill={BODY} {...stroke} />
      <Face cx={50} cy={34} mood={mood} scale={0.95} />
      {base}
    </>;
    case 'rook': return <>
      <path d="M22 14 H34 V24 H44 V14 H56 V24 H66 V14 H78 V38 H22 Z" fill={BODY} {...stroke} />
      <path d="M26 38 H74 L70 100 H30 Z" fill={BODY} {...stroke} />
      <path d="M30 88 H70" stroke={INK} strokeWidth="3" opacity=".25" />
      <Face cx={50} cy={60} mood={mood} />
      {base}
    </>;
    case 'bishop': return <>
      <circle cx="50" cy="9" r="6" fill={GOLD} {...stroke} />
      <path d="M50 15 C70 30 74 56 66 86 L34 86 C26 56 30 30 50 15 Z" fill={BODY} {...stroke} />
      <path d="M58 26 L48 42" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <rect x="28" y="84" width="44" height="9" rx="4.5" fill={GOLD} {...stroke} />
      <path d="M32 93 L30 100 H70 L68 93 Z" fill={BODY} {...stroke} />
      <Face cx={50} cy={60} mood={mood} scale={0.9} />
      {base}
    </>;
    case 'king': return <>
      <rect x="46" y="2" width="8" height="24" rx="2" fill={GOLD} {...stroke} />
      <rect x="38" y="9" width="24" height="8" rx="2" fill={GOLD} {...stroke} />
      <path d="M28 26 H72 L68 40 H32 Z" fill={GOLD} {...stroke} />
      <path d="M32 40 C26 60 26 84 30 100 H70 C74 84 74 60 68 40 Z" fill={BODY} {...stroke} />
      <Face cx={50} cy={64} mood={mood} />
      {base}
    </>;
    case 'queen': return <>
      {[24, 37, 50, 63, 76].map((x, i) => <circle key={i} cx={x} cy={i === 2 ? 8 : i % 2 ? 14 : 18} r="5" fill={GOLD} {...stroke} strokeWidth={3} />)}
      <path d="M24 22 L32 40 L37 18 L44 38 L50 12 L56 38 L63 18 L68 40 L76 22 L72 44 H28 Z" fill={GOLD} {...stroke} />
      <path d="M30 44 C24 62 25 84 30 100 H70 C75 84 76 62 70 44 Z" fill={BODY} {...stroke} />
      <Face cx={50} cy={66} mood={mood} />
      {base}
    </>;
    case 'knight': return <>
      {/* a horse's head looking left, with a mane down its back */}
      <path d="M74 100 C80 80 82 58 76 40 C72 26 62 16 52 12 L50 2 L42 14 C34 18 26 28 20 40 C14 50 12 58 16 64 C20 70 28 70 34 66 C38 64 42 64 44 68 C40 78 32 88 28 100 Z"
        fill={BODY} {...stroke} />
      <path d="M58 14 C70 22 80 36 82 54 C84 70 82 86 78 100" fill="none" stroke="#b45309" strokeWidth="7" strokeLinecap="round" />
      <circle cx="21" cy="57" r="2.6" fill={INK} />
      <Face cx={46} cy={34} mood="idle" scale={1} one />
      {mood === 'idle' && <path d="M24 64 Q30 68 36 64" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />}
      {mood === 'happy' && <path d="M22 62 Q30 72 38 62 Z" fill="#be123c" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />}
      {mood === 'munch' && <ellipse cx="29" cy="65" rx="5" ry="5.5" fill="#be123c" stroke={INK} strokeWidth="2.4" />}
      <ellipse cx="54" cy="44" rx="4.5" ry="3" fill={CHEEK} opacity=".85" />
      {base}
    </>;
  }
}

/** One character, `size` pixels tall. */
export const Character: React.FC<{ piece: Piece; size: number; mood?: Mood; className?: string; style?: React.CSSProperties }> = ({ piece, size, mood = 'idle', className, style }) => (
  <svg viewBox="0 -2 100 120" width={size * 100 / 120} height={size} className={className} aria-hidden="true"
    style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))', display: 'inline-block', ...style }}>
    {body(piece, mood)}
  </svg>
);

/** CSS for the blink; include once on the page. */
export const CHARACTER_CSS = `
  @keyframes lc-blink { 0%, 92%, 100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
  .lc-blink { animation: lc-blink 4.2s infinite; }
`;
