// src/v2/ui/MsLogo.tsx — the MainstreetAI logo: a brick wall with a spark, and "Mainstreet" + "AI".
// tone "light" sits on white or cream, "dark" on a dark background.
import React from 'react';

const C = {
  light: { brick: '#b5452b', spark: '#0f766e', word: '#1c1b1a', ai: '#0f766e' },
  dark: { brick: '#d4644a', spark: '#5eead4', word: '#f6f1e7', ai: '#5eead4' },
};

export const MsMark: React.FC<{ size?: number; tone?: 'light' | 'dark' }> = ({ size = 24, tone = 'light' }) => {
  const c = C[tone];
  return (
    <svg width={size * 1.25} height={size} viewBox="0 0 120 96" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <g fill={c.brick}>
        <rect x="2" y="66" width="54" height="26" rx="3" /><rect x="62" y="66" width="54" height="26" rx="3" />
        <rect x="2" y="36" width="24" height="26" rx="3" /><rect x="32" y="36" width="54" height="26" rx="3" /><rect x="92" y="36" width="24" height="26" rx="3" />
        <rect x="2" y="6" width="54" height="26" rx="3" />
      </g>
      <path d="M88 0 L92 13 L105 17 L92 21 L88 34 L84 21 L71 17 L84 13 Z" fill={c.spark} />
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
        Mainstreet<span style={{ color: c.ai }}>AI</span>
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
