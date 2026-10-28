// src/v2/ui/MsLogo.tsx — the MainstreetAI logo: a brick wall with a maple leaf carved softly across it, rising
// from the bottom edge, a sparkle, and "Mainstreet" + "AI". The sparkle and "AI" share a gradient:
// gold for the first half, then teal, then blue. tone "light" sits on white or cream, "dark" on a dark background.
import React from 'react';

/** A maple leaf with exaggerated points, in a 100-unit box (tip at -8). */
const LEAF = 'M50 -8 L55.5 13 L67 5 L59.5 34 L72.5 18 L77 25.5 L97 16 L82 40.5 L101 42 L68.5 61 L74 70 L53 65 L54 86 L46 86 L47 65 L26 70 L31.5 61 L-1 42 L18 40.5 L3 16 L23 25.5 L27.5 18 L40.5 34 L33 5 L44.5 13 Z';
const SPARK = 'M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1 Z';
/** The wall: three rows, tight joints; the top-right space holds the sparkle. [x, y, w, h] */
const BRICKS: [number, number, number, number][] = [
  [2, 6, 55, 26.7],
  [2, 35.7, 25, 26.6], [31, 35.7, 56, 26.6], [91, 35.7, 25, 26.6],
  [2, 65.3, 55, 26.7], [61, 65.3, 55, 26.7],
];
/** The leaf, carved softly across the wall, low down: it rises from the bottom edge. */
const LEAF_AT = 'translate(7 39.2) scale(.9)';

const C = {
  light: { brick: '#b5452b', carve: '#5c1410', edge: '#cf6248', word: '#1c1b1a', grad: ['#F5B82A', '#1FAE9A', '#2F7BF5'] },
  dark: { brick: '#d4644a', carve: '#5c1410', edge: '#e88a6f', word: '#f6f1e7', grad: ['#FFD54A', '#3EE0C0', '#5AA9FF'] },
};
/** Gold holds to 45%, teal at 72%, blue at the end. */
const STOPS: [number, 0 | 1 | 2][] = [[0, 0], [0.45, 0], [0.72, 1], [1, 2]];
export const msGradientCss = (tone: 'light' | 'dark' = 'light') =>
  `linear-gradient(135deg, ${STOPS.map(([o, i]) => `${C[tone].grad[i]} ${Math.round(o * 100)}%`).join(', ')})`;

export const MsMark: React.FC<{ size?: number; tone?: 'light' | 'dark' }> = ({ size = 24, tone = 'light' }) => {
  const c = C[tone];
  const id = React.useId().replace(/:/g, '');
  const bricks = BRICKS.map(([x, y, w, h]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="3" />);
  return (
    <svg width={size * 1.25} height={size} viewBox="0 0 120 96" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          {STOPS.map(([o, i]) => <stop key={o} offset={o} stopColor={c.grad[i]} />)}
        </linearGradient>
        <clipPath id={`k${id}`}>{bricks}</clipPath>
      </defs>
      <g fill={c.brick}>{bricks}</g>
      <g clipPath={`url(#k${id})`} opacity={0.55}>
        <path transform={`translate(0 .9) ${LEAF_AT}`} d={LEAF} fill={c.edge} />
        <path transform={LEAF_AT} d={LEAF} fill={c.carve} />
      </g>
      <path transform="translate(88.5 18) scale(17)" d={SPARK} fill={`url(#g${id})`} />
    </svg>
  );
};

/** The full logo. `stack` puts the wall above the name (sign-in); otherwise side by side (bars). */
export const MsLogo: React.FC<{ size?: number; tone?: 'light' | 'dark'; stack?: boolean; className?: string }> = ({ size = 20, tone = 'light', stack, className }) => {
  const c = C[tone];
  return (
    <span className={className} role="img" aria-label="MainstreetAI"
      style={{ display: 'inline-flex', flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'flex-start' : 'center', gap: stack ? size * 0.45 : size * 0.4 }}>
      <MsMark size={stack ? size * 1.6 : size * 1.05} tone={tone} />
      <span aria-hidden="true" style={{ fontFamily: "'Inter Display', Inter, system-ui, sans-serif", fontWeight: 700, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, color: c.word, whiteSpace: 'nowrap' }}>
        Mainstreet<span style={{ backgroundImage: msGradientCss(tone), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', paddingRight: '0.04em' }}>AI</span>
      </span>
    </span>
  );
};

/** The browser tab shows MainstreetAI (icon and title) while a MainstreetAI page is open. */
export function useMsTab(title = 'MainstreetAI') {
  React.useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const prev = { href: link?.href, type: link?.type, title: document.title };
    if (link) { link.href = '/mainstreet-icon.svg'; link.type = 'image/svg+xml'; }
    document.title = title;
    return () => { if (link && prev.href) { link.href = prev.href; link.type = prev.type || 'image/png'; } document.title = prev.title; };
  }, [title]);
}

export const MsTab: React.FC<{ title?: string }> = ({ title }) => { useMsTab(title); return null; };
