// src/planner/features/us/stickers.tsx — the chat's own stickers: small drawings that move, three for each occasion
// (occasions.ts). A sticker travels as its ordinary emoji, so nothing about sending changes: a message that is only
// that emoji is drawn as the sticker here, a notification shows the emoji, and Arvy doesn't read it (it has no words).
// The drawings are ours; the movement is in us.css (st-…) and stops for anyone who has asked their phone for less motion.
import type { ReactNode } from 'react';
import type { OccasionId } from './occasions';

export interface StickerDef { id: string; emoji: string; name: string; occasion: OccasionId; art: ReactNode }

const HEART = 'M32 54 C10 38 8 22 20 16 C27 13 32 19 32 23 C32 19 37 13 44 16 C56 22 54 38 32 54 Z';
const STAR = 'M32 4 L35 12 L43 12 L37 17 L39 25 L32 20 L25 25 L27 17 L21 12 L29 12 Z';
const dots = (pts: [number, number, string][], r = 2.4) => pts.map(([x, y, c], i) => <circle key={i} className="st-twinkle" style={{ animationDelay: `${(i % 5) * 0.3}s` }} cx={x} cy={y} r={r} fill={c} />);
const rays = (cx: number, cy: number, from: number, to: number, colors: string[], n = 12) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  return <line key={i} x1={cx + c * from} y1={cy + s * from} x2={cx + c * to} y2={cy + s * to} stroke={colors[i % colors.length]} strokeWidth="3" strokeLinecap="round" />;
});

export const STICKERS: StickerDef[] = [
  // ── Halloween ──
  { id: 'pumpkin', emoji: '🎃', name: 'Pumpkin', occasion: 'halloween', art: <>
    <path d="M30 14 C30 9 34 7 37 8 L36 15 Z" fill="#4c8a3a" />
    <ellipse cx="20" cy="36" rx="13" ry="19" fill="#e8741c" /><ellipse cx="44" cy="36" rx="13" ry="19" fill="#e8741c" /><ellipse cx="32" cy="36" rx="14" ry="21" fill="#f58a2a" />
    <g className="st-flick" fill="#ffe27a"><path d="M19 30 L27 30 L23 23 Z" /><path d="M37 30 L45 30 L41 23 Z" /><path d="M17 40 L22 44 L27 40 L32 44 L37 40 L42 44 L47 40 L43 50 L21 50 Z" /></g></> },
  { id: 'ghost', emoji: '👻', name: 'Ghost', occasion: 'halloween', art: <g className="st-bob">
    <path d="M14 56 V28 C14 16 22 8 32 8 C42 8 50 16 50 28 V56 L44 50 L38 56 L32 50 L26 56 L20 50 Z" fill="#fff" stroke="#d9d7ea" strokeWidth="2" strokeLinejoin="round" />
    <ellipse cx="25" cy="27" rx="3.5" ry="5" fill="#2b2540" /><ellipse cx="39" cy="27" rx="3.5" ry="5" fill="#2b2540" /><ellipse cx="32" cy="38" rx="4" ry="5" fill="#2b2540" /></g> },
  { id: 'bat', emoji: '🦇', name: 'Bat', occasion: 'halloween', art: <g className="st-bob">
    <g className="st-flap" fill="#4a3b78"><path d="M30 30 C22 18 10 18 3 24 C9 25 10 30 9 35 C14 31 18 33 19 38 C22 34 27 34 30 38 Z" /><path d="M34 30 C42 18 54 18 61 24 C55 25 54 30 55 35 C50 31 46 33 45 38 C42 34 37 34 34 38 Z" /></g>
    <ellipse cx="32" cy="34" rx="8" ry="10" fill="#33285a" /><path d="M26 26 L27 19 L31 25 Z M38 26 L37 19 L33 25 Z" fill="#33285a" /><circle cx="29" cy="32" r="1.8" fill="#ffd166" /><circle cx="35" cy="32" r="1.8" fill="#ffd166" /></g> },
  // ── Diwali ──
  { id: 'diya', emoji: '🪔', name: 'Diya', occasion: 'diwali', art: <>
    <circle className="st-twinkle" cx="32" cy="22" r="15" fill="#ffd166" opacity=".35" />
    <g className="st-flick"><path d="M32 6 C40 16 39 26 32 30 C25 26 24 16 32 6 Z" fill="#ff9d2e" /><path d="M32 15 C36 20 35 26 32 28 C29 26 28 20 32 15 Z" fill="#fff1a8" /></g>
    <path d="M8 34 H56 C54 48 44 56 32 56 C20 56 10 48 8 34 Z" fill="#c2552b" /><path d="M8 34 H56 L52 39 H12 Z" fill="#e0763f" />
    {dots([[20, 46, '#ffd166'], [32, 49, '#ffd166'], [44, 46, '#ffd166']], 2)}</> },
  { id: 'fireworks', emoji: '🎆', name: 'Fireworks', occasion: 'diwali', art: <>
    <g className="st-pop">{rays(26, 26, 6, 20, ['#ff5d8f', '#ffd166', '#5fd0ff'])}</g>
    <g className="st-pop" style={{ animationDelay: '.7s' }}>{rays(46, 44, 4, 13, ['#9b7bff', '#7be495'], 10)}</g>
    {dots([[52, 14, '#ffd166'], [10, 48, '#ff5d8f'], [30, 56, '#5fd0ff']], 2)}</> },
  { id: 'rangoli', emoji: '🌸', name: 'Rangoli', occasion: 'diwali', art: <g className="st-spin">
    {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="32" cy="14" rx="7" ry="13" fill={i % 2 ? '#ff5d8f' : '#ff9d2e'} transform={`rotate(${i * 45} 32 32)`} />)}
    {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="32" cy="21" rx="4" ry="8" fill={i % 2 ? '#ffd166' : '#fff1a8'} transform={`rotate(${i * 45 + 22.5} 32 32)`} />)}
    <circle cx="32" cy="32" r="6" fill="#8e2a6b" /><circle cx="32" cy="32" r="2.5" fill="#ffd166" /></g> },
  // ── Christmas ──
  { id: 'tree', emoji: '🎄', name: 'Tree', occasion: 'christmas', art: <>
    <rect x="28" y="50" width="8" height="9" rx="1.5" fill="#8a5a33" />
    <path d="M32 12 L46 30 H18 Z" fill="#2f9e5b" /><path d="M32 22 L50 42 H14 Z" fill="#27894e" /><path d="M32 32 L54 52 H10 Z" fill="#1f7743" />
    <path className="st-twinkle" d={STAR} fill="#ffd166" transform="translate(0 -1) scale(.62) translate(19.6 4)" />
    {dots([[27, 30, '#ff5d8f'], [38, 36, '#ffd166'], [24, 42, '#5fd0ff'], [40, 46, '#ff5d8f'], [31, 47, '#ffd166'], [34, 26, '#5fd0ff']])}</> },
  { id: 'gift', emoji: '🎁', name: 'Gift', occasion: 'christmas', art: <g className="st-wobble">
    <rect x="12" y="28" width="40" height="28" rx="3" fill="#e23d4b" /><rect x="9" y="20" width="46" height="10" rx="3" fill="#f0525f" />
    <rect x="28" y="20" width="8" height="36" fill="#ffd166" /><path d="M32 20 C24 8 14 12 18 18 C20 21 27 21 32 20 Z M32 20 C40 8 50 12 46 18 C44 21 37 21 32 20 Z" fill="#ffd166" stroke="#e9b53a" strokeWidth="1.5" /></g> },
  { id: 'snowflake', emoji: '❄', name: 'Snowflake', occasion: 'christmas', art: <g className="st-spin" stroke="#7cc8f5" strokeWidth="3.5" strokeLinecap="round" fill="none">
    {[0, 60, 120].map(a => <g key={a} transform={`rotate(${a} 32 32)`}><line x1="32" y1="6" x2="32" y2="58" /><path d="M25 13 L32 19 L39 13 M25 51 L32 45 L39 51" /></g>)}
    <circle cx="32" cy="32" r="4" fill="#d8f0ff" stroke="none" /></g> },
  // ── New Year ──
  { id: 'sparkler', emoji: '🎇', name: 'Sparkler', occasion: 'newyear', art: <>
    <line x1="12" y1="58" x2="34" y2="28" stroke="#9aa0ad" strokeWidth="3" strokeLinecap="round" />
    <g className="st-pop">{rays(38, 22, 4, 17, ['#ffd166', '#fff1a8', '#ff9d2e'], 14)}</g><circle className="st-twinkle" cx="38" cy="22" r="5" fill="#fff6c9" /></> },
  { id: 'cheers', emoji: '🥂', name: 'Cheers', occasion: 'newyear', art: <>
    <g className="st-wobble"><path d="M12 12 H28 L26 30 C25 36 15 36 14 30 Z" fill="#fff6c9" stroke="#e9b53a" strokeWidth="2" /><path d="M13.5 22 H26.8 L26 30 C25 36 15 36 14 30 Z" fill="#ffd166" /><line x1="20" y1="35" x2="20" y2="52" stroke="#e9b53a" strokeWidth="2.5" /><line x1="13" y1="53" x2="27" y2="53" stroke="#e9b53a" strokeWidth="3" strokeLinecap="round" /></g>
    <g className="st-wobble" style={{ animationDelay: '.4s' }}><path d="M36 12 H52 L50 30 C49 36 39 36 38 30 Z" fill="#fff6c9" stroke="#e9b53a" strokeWidth="2" /><path d="M37.2 22 H50.5 L50 30 C49 36 39 36 38 30 Z" fill="#ffd166" /><line x1="44" y1="35" x2="44" y2="52" stroke="#e9b53a" strokeWidth="2.5" /><line x1="37" y1="53" x2="51" y2="53" stroke="#e9b53a" strokeWidth="3" strokeLinecap="round" /></g>
    {dots([[32, 8, '#ffd166'], [20, 18, '#fff'], [44, 17, '#fff'], [32, 20, '#ff5d8f']], 1.8)}</> },
  { id: 'popper', emoji: '🎉', name: 'Party popper', occasion: 'newyear', art: <>
    <path d="M8 56 L24 22 L42 40 Z" fill="#9b7bff" /><path d="M14 43 L21 50 M19 33 L31 45" stroke="#ffd166" strokeWidth="3" strokeLinecap="round" />
    {dots([[36, 14, '#ff5d8f'], [48, 22, '#5fd0ff'], [54, 36, '#ffd166'], [44, 8, '#7be495'], [56, 14, '#ff9d2e'], [30, 6, '#ffd166']], 2.8)}
    <path className="st-twinkle" d="M40 26 C44 22 44 18 48 16 M46 34 C50 32 54 34 58 30" stroke="#ff5d8f" strokeWidth="2.5" fill="none" strokeLinecap="round" /></> },
  // ── Valentine's Day ──
  { id: 'heart', emoji: '❤', name: 'Heart', occasion: 'valentine', art: <g className="st-beat"><path d={HEART} fill="#e8324f" /><path d="M20 22 C22 19 25 19 27 21" stroke="#ff9db0" strokeWidth="3" fill="none" strokeLinecap="round" /></g> },
  { id: 'loveletter', emoji: '💌', name: 'Love letter', occasion: 'valentine', art: <g className="st-wobble">
    <rect x="8" y="16" width="48" height="34" rx="4" fill="#fff" stroke="#f3b6c4" strokeWidth="2" /><path d="M8 20 L32 38 L56 20" fill="none" stroke="#f3b6c4" strokeWidth="2" />
    <path d={HEART} fill="#e8324f" transform="translate(19.2 22) scale(.4)" /></g> },
  { id: 'twohearts', emoji: '💕', name: 'Two hearts', occasion: 'valentine', art: <>
    <g className="st-bob"><path d={HEART} fill="#ff6fa8" transform="translate(-4 8) scale(.72)" /></g>
    <g className="st-bob" style={{ animationDelay: '.5s' }}><path d={HEART} fill="#e8324f" transform="translate(26 -6) scale(.56)" /></g></> },
  // ── Easter ──
  { id: 'egg', emoji: '🥚', name: 'Egg', occasion: 'easter', art: <g className="st-wobble">
    <path d="M32 6 C44 6 52 24 52 38 C52 50 43 58 32 58 C21 58 12 50 12 38 C12 24 20 6 32 6 Z" fill="#b9e3ff" />
    <path d="M13 34 L20 28 L26 34 L32 28 L38 34 L44 28 L51 34" fill="none" stroke="#ff8fb1" strokeWidth="4" strokeLinejoin="round" /><path d="M13 44 H51" stroke="#ffd166" strokeWidth="4" />
    {dots([[24, 18, '#fff'], [38, 16, '#fff'], [32, 50, '#fff']], 2)}</g> },
  { id: 'bunny', emoji: '🐰', name: 'Bunny', occasion: 'easter', art: <g className="st-hop">
    <ellipse cx="24" cy="16" rx="6" ry="14" fill="#fff" stroke="#e3dfe8" strokeWidth="2" /><ellipse cx="40" cy="16" rx="6" ry="14" fill="#fff" stroke="#e3dfe8" strokeWidth="2" />
    <ellipse cx="24" cy="17" rx="2.6" ry="9" fill="#ffc2d4" /><ellipse cx="40" cy="17" rx="2.6" ry="9" fill="#ffc2d4" />
    <ellipse cx="32" cy="40" rx="19" ry="17" fill="#fff" stroke="#e3dfe8" strokeWidth="2" /><circle cx="25" cy="36" r="2.4" fill="#2b2540" /><circle cx="39" cy="36" r="2.4" fill="#2b2540" />
    <path d="M30 42 H34 L32 45 Z" fill="#ff8fb1" /><path d="M32 45 C30 49 27 49 26 47 M32 45 C34 49 37 49 38 47" stroke="#2b2540" strokeWidth="1.6" fill="none" strokeLinecap="round" /></g> },
  { id: 'tulip', emoji: '🌷', name: 'Tulip', occasion: 'easter', art: <g className="st-wobble">
    <path d="M32 30 V58" stroke="#3f9d5a" strokeWidth="4" strokeLinecap="round" /><path d="M32 50 C24 50 18 44 17 36 C25 37 31 42 32 50 Z M32 46 C40 46 45 41 46 34 C39 35 33 39 32 46 Z" fill="#4fb56c" />
    <path d="M20 12 C24 14 26 16 26 20 C28 14 30 10 32 8 C34 10 36 14 38 20 C38 16 40 14 44 12 C46 24 42 34 32 34 C22 34 18 24 20 12 Z" fill="#ff6fa8" /></g> },
  // ── birthdays ──
  { id: 'cake', emoji: '🎂', name: 'Cake', occasion: 'birthday', art: <>
    <g className="st-flick"><path d="M32 4 C36 9 35 13 32 15 C29 13 28 9 32 4 Z" fill="#ff9d2e" /></g><rect x="30" y="15" width="4" height="10" rx="1" fill="#5fd0ff" />
    <rect x="14" y="25" width="36" height="14" rx="4" fill="#ffc2d4" /><rect x="8" y="38" width="48" height="18" rx="4" fill="#f58a2a" />
    <path d="M8 44 C14 50 20 40 26 46 C32 52 38 40 44 46 C50 52 54 44 56 44 V40 H8 Z" fill="#fff6c9" />{dots([[20, 31, '#e8324f'], [32, 31, '#9b7bff'], [44, 31, '#e8324f']], 2)}</> },
  { id: 'balloon', emoji: '🎈', name: 'Balloon', occasion: 'birthday', art: <g className="st-bob">
    <path d="M32 44 C30 50 36 52 32 60" stroke="#9aa0ad" strokeWidth="2" fill="none" strokeLinecap="round" />
    <ellipse cx="32" cy="24" rx="16" ry="20" fill="#e8324f" /><path d="M29 43 H35 L32 47 Z" fill="#c4263f" /><path d="M24 14 C26 10 30 9 33 10" stroke="#ff9db0" strokeWidth="3" fill="none" strokeLinecap="round" /></g> },
  { id: 'cupcake', emoji: '🧁', name: 'Cupcake', occasion: 'birthday', art: <g className="st-wobble">
    <path d="M16 36 H48 L44 58 H20 Z" fill="#5fd0ff" /><path d="M24 36 L26 58 M32 36 V58 M40 36 L38 58" stroke="#3aa9dc" strokeWidth="2" />
    <path d="M12 36 C10 28 18 24 22 26 C22 16 34 12 40 20 C48 18 56 26 52 36 Z" fill="#ffc2d4" /><circle cx="33" cy="12" r="5" fill="#e8324f" /><path d="M33 8 C34 4 37 3 39 3" stroke="#3f9d5a" strokeWidth="2" fill="none" strokeLinecap="round" /></g> },
];

// the emoji as typed can carry an invisible "show as a picture" mark (U+FE0F): the same sticker with or without it
const bare = (s: string) => s.replace(/️/g, '').trim();
const BY_EMOJI = new Map(STICKERS.map(s => [bare(s.emoji), s]));
/** The sticker a message is, when the message is nothing but that one emoji. */
export function stickerOf(text?: string | null): StickerDef | null {
  return (text && BY_EMOJI.get(bare(text))) || null;
}
/** What is sent for a sticker: its emoji, marked to show as a picture where the sticker isn't drawn (a notification). */
export const stickerText = (s: StickerDef): string => `${bare(s.emoji)}️`;

export function Sticker({ s, size = 96 }: { s: StickerDef; size?: number }) {
  return <svg className="st" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={s.name}>{s.art}</svg>;
}
