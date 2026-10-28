// src/v2/ui/MsLogo.tsx — the MainstreetAI logo: a brick wall with the top of a maple leaf carved into the
// centre brick (dark maroon), a sparkle, and "Mainstreet" + "AI". The sparkle and "AI" share a gradient:
// gold for the first half, then teal, then blue. tone "light" sits on white or cream, "dark" on a dark background.
import React from 'react';

/** An 11-point maple leaf in a 100-unit box. */
const LEAF = 'M50 0 L56 12 L63 9 L61 30 L72 19 L75 26 L88 23 L84 37 L92 41 L70 59 L73 67 L53 64 L54 86 L46 86 L47 64 L27 67 L30 59 L8 41 L16 37 L12 23 L25 26 L28 19 L39 30 L37 9 L44 12 Z';
const SPARK = 'M0 -1 C0.12 -0.12 0.12 -0.12 1 0 C0.12 0.12 0.12 0.12 0 1 C-0.12 0.12 -0.12 0.12 -1 0 C-0.12 -0.12 -0.12 -0.12 0 -1 Z';

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
  const leaf = (fill: string, dy: number) => (
    <g clipPath={`url(#k${id})`}><path transform={`translate(30.5 ${39.5 + dy}) scale(.57)`} d={LEAF} fill={fill} /></g>);
  return (
    <svg width={size * 1.25} height={size} viewBox="0 0 120 96" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          {STOPS.map(([o, i]) => <stop key={o} offset={o} stopColor={c.grad[i]} />)}
        </linearGradient>
        <clipPath id={`k${id}`}><rect x="32" y="36" width="54" height="26" rx="3" /></clipPath>
      </defs>
      <g fill={c.brick}>
        <rect x="2" y="66" width="54" height="26" rx="3" /><rect x="62" y="66" width="54" height="26" rx="3" />
        <rect x="2" y="36" width="24" height="26" rx="3" /><rect x="32" y="36" width="54" height="26" rx="3" /><rect x="92" y="36" width="24" height="26" rx="3" />
        <rect x="2" y="6" width="54" height="26" rx="3" />
      </g>
      {leaf(c.edge, 0.9)}{leaf(c.carve, 0)}
      <path transform="translate(89 18) scale(17)" d={SPARK} fill={`url(#g${id})`} />
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
