// src/planner/features/icons/packs.tsx — the icon packs: for each pack, a drawing for every place an icon shows
// (choice.ts lists the places). 'line' is the planner's own set (the lucide icons it has always used); the others are
// our own drawings, each pack in one hand: the same pen width, the same way of shading, the same kind of subject.
// Every drawing is on a 24 × 24 grid and takes the colour of the text around it (currentColor), so it follows
// whichever colours are on: a pale wash is the same colour at a low strength, never a colour of its own.
// Each one still says what its button is for: Today is something rising, Health a heart, Wealth something saved,
// Train something to lift or do, Cycle a moon, a wreath or a flower, Habits a loop, a chain or something that grows.
import type { ReactNode, SVGProps } from 'react';
import { BookOpen, CalendarDays, Compass, Dumbbell, Heart, HeartPulse, Repeat, ShoppingCart, Sunrise, Utensils, Wallet, type LucideIcon } from 'lucide-react';
import type { PackId, Place } from './choice';
import { at, bow, heart, leaf, moon, on, spark, star } from './shapes';

export interface Pack {
  id: PackId; name: string;
  /** a few words on what is in it, for the screen */
  note: string;
  /** how this pack's pen draws: put on every drawing's <svg> */
  hand: SVGProps<SVGSVGElement>;
  /** the drawings (none for 'line': those are LINE below) */
  art?: Record<Place, ReactNode>;
}

/** The planner's own icons: exactly what the bar and the menu pages showed before there were packs. */
export const LINE: Record<Place, LucideIcon> = {
  today: Sunrise, health: HeartPulse, wealth: Wallet, lifestyle: Compass,
  train: Dumbbell, food: Utensils, cycle: Heart, plan: BookOpen, habits: Repeat, calendar: CalendarDays, shop: ShoppingCart,
};

// ── the ways of filling a shape ──
const wash = { fill: 'currentColor', fillOpacity: 0.2 } as const;      // a pale wash under the line
const full = { fill: 'currentColor', stroke: 'none' } as const;         // filled in, no line
const ink = (w: number) => ({ fill: 'none', stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round' } as const);   // a line, in a pack that fills

// ── pieces more than one pack draws ──
/** A calendar page: the frame with its two rings and the line under the month; `r` rounds its corners. */
const page = (r: number) => <><rect x="3.5" y="5" width="17" height="15.5" rx={r} /><path d="M8 3v4M16 3v4M3.5 10h17" /></>;
/** An open book, seen from above. */
const BOOK = 'M12 6.8C10 5.4 7 5 3 5.4v13.2c4-.4 7 0 9 1.4 2-1.4 5-1.8 9-1.4V5.4c-4-.4-7 0-9 1.4z';
/** Two arcs that chase each other round a circle, each stopping short (at LOOP_ENDS) to leave room for a tip: a leaf, a heart. */
const LOOP_ENDS = [318, 138];
const LOOP = LOOP_ENDS.map(end => `M${on(12, 12, 7.5, end - 123)}A7.5 7.5 0 0 1 ${on(12, 12, 7.5, end)}`).join('');
/** Petals round a centre: `count` ovals, each `along` long and `across` wide, their middles `dist` from the centre. */
const petals = (cx: number, cy: number, count: number, dist: number, along: number, across: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = -90 + (360 / count) * i, [x, y] = at(cx, cy, dist, a).map(v => v.toFixed(2));
    return <ellipse key={i} cx={x} cy={y} rx={along} ry={across} transform={`rotate(${a} ${x} ${y})`} />;
  });
/** Waves: one wavy line `y` down the grid, from `x0`, `count` crests of `step`. */
const wave = (x0: number, y: number, count: number, step = 4.75, lift = 1.3) =>
  `M${x0} ${y}` + Array.from({ length: count }, (_, i) => { const s = i % 2 ? 1 : -1, x = x0 + step * i; return `C${(x + step * 0.34).toFixed(2)} ${(y + s * lift).toFixed(2)} ${(x + step * 0.66).toFixed(2)} ${(y + s * lift).toFixed(2)} ${(x + step).toFixed(2)} ${y}`; }).join('');

// ── Woodland: a soft round pen with a wash; leaves, acorns, mushrooms ──
const woodland: Record<Place, ReactNode> = {
  // the sun coming up beside a fir
  today: <>
    <path d="M2 19.5h20" /><path d="M4 19.5a4.5 4.5 0 0 1 9 0" {...wash} />
    <path d="M8.5 11.6v1.6M2.95 13.95l1.1 1.1M14.05 13.95l-1.1 1.1" />
    <path d="M18.5 4.5L21 9h-1.2l2.2 5.5h-7L17.2 9H16z" {...wash} /><path d="M18.5 14.5v5" /></>,
  // a heart that is a leaf: a rib up the middle, a stalk below
  health: <>
    <path d={heart(12, 11, 8.6)} {...wash} />
    <path d="M12 8.6v11M12 12.2L8.9 9.9M12 12.2l3.1-2.3M12 15.4l-2.9-2.2M12 15.4l2.9-2.2M12 19.6c0 1.2.8 2 2.1 2.2" /></>,
  // an acorn: what a squirrel puts by
  wealth: <>
    <path d="M5.5 10.5c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6z" {...wash} />
    <path d="M6.8 10.5c0 5.4 2.5 9 5.2 11 2.7-2 5.2-5.6 5.2-11M12 4.5c0-1.2.6-2 1.6-2.3M9.2 7.6l1.4 1.2M12.6 6.6l1.4 1.2" /></>,
  // a birdhouse on its post
  lifestyle: <>
    <path d="M6.8 10.2v8.3h10.4v-8.3" {...wash} /><path d="M4.5 11.2L12 3.8l7.5 7.4" />
    <circle cx="12" cy="12.6" r="2" /><path d="M10.6 16h2.8M12 18.5V22" /></>,
  // a dumbbell cut from two logs, a leaf sprouting on the bar
  train: <>
    <rect x="2.8" y="6.5" width="4.6" height="11" rx="1.6" {...wash} /><rect x="16.6" y="6.5" width="4.6" height="11" rx="1.6" {...wash} />
    <path d="M7.4 12h9.2M5.1 9.3v1.8M5.1 13.6v1.1M18.9 9.3v1.1M18.9 12.9v1.8" />
    <path d={leaf(11.3, 11.7, -62, 5, 2.3)} {...wash} /></>,
  // a mushroom
  food: <>
    <path d="M3 12c0-5 4-8.5 9-8.5s9 3.5 9 8.5c0 .8-.6 1.2-1.5 1.2h-15c-.9 0-1.5-.4-1.5-1.2z" {...wash} />
    <path d="M9.5 13.2c0 2.3-.5 4.3-.9 5.8-.3 1.2.4 2 1.6 2h3.6c1.2 0 1.9-.8 1.6-2-.4-1.5-.9-3.5-.9-5.8" />
    <circle cx="8.2" cy="8.6" r="1.2" /><circle cx="13.2" cy="6.8" r="1" /><circle cx="16.6" cy="10" r=".9" /></>,
  // the moon, with a sprig across its open side
  cycle: <>
    <path d={moon(10.8, 12.4, 8.3, -35)} {...wash} />
    <path d="M14.2 12.6c0-2.6 1.5-4.2 4.1-4.4.2 2.6-1.4 4.3-4.1 4.4zM14.2 12.6l-1.6 1.9" /><path d="M16.2 15.2c1.3-1.3 2.9-1.4 4.3-.3-1.3 1.3-2.9 1.4-4.3.3z" /></>,
  // a nature diary: an open book with a leaf on the page
  plan: <>
    <path d={BOOK} /><path d="M12 6.8v13M5.6 9.2h3.8M5.6 12.2h3.8M5.6 15.2h2.2" />
    <path d="M14.4 14.4c0-2.8 1.5-4.4 4.2-4.6.2 2.8-1.4 4.5-4.2 4.6z" {...wash} /></>,
  // round and round, with a leaf at each end
  habits: <>
    <path d={LOOP} />
    {LOOP_ENDS.map(end => <path key={end} d={leaf(...at(12, 12, 7.5, end), end + 102, 5.2, 2.6)} {...wash} />)}</>,
  // a calendar page with a leaf pressed on it
  calendar: <>
    {page(2.5)}
    <path d="M9 18.2c0-3.6 2.1-5.4 5.8-5.6.2 3.7-1.9 5.6-5.8 5.6z" {...wash} /><path d="M9 18.2l3.6-3.4" /></>,
  // a woven basket
  shop: <>
    <path d="M4 11h16l-1.7 8.3c-.2 1-1 1.7-2 1.7H7.7c-1 0-1.8-.7-2-1.7z" {...wash} />
    <path d="M7 11c0-5 2-7.5 5-7.5s5 2.5 5 7.5M9 14.2v3.6M12 14.2v3.6M15 14.2v3.6" /></>,
};

// ── Cottage: a fine pen, a wash, and stitches; teacups, flowers, a little house ──
const stitch = { strokeDasharray: '1.5 1.9' } as const;
const cottage: Record<Place, ReactNode> = {
  // the sun coming up behind the cottage roof
  today: <>
    <path d="M7.17 16.56a6 6 0 1 1 9.66 0L12 12.5z" {...wash} /><path d="M2.5 20.5L12 12.5l9.5 8" /><circle cx="12" cy="18.2" r="1.4" />
    <path d="M12 3v1.8M5.2 5.8l1.3 1.3M18.8 5.8l-1.3 1.3M2.8 12.8h1.8M19.4 12.8h1.8" /></>,
  // a heart with a row of stitches inside
  health: <><path d={heart(12, 11.6, 9)} {...wash} /><path d={heart(12, 11.3, 5.6)} {...stitch} /></>,
  // a coin purse with a kiss clasp
  wealth: <>
    <path d="M5.5 9.5c-2 2.5-2.5 5.5-1.5 8 1 2.5 3.5 3.5 8 3.5s7-1 8-3.5c1-2.5.5-5.5-1.5-8" {...wash} />
    <path d="M5.5 9.5c1.5-2.7 3.7-3.7 6.5-3.7s5 1 6.5 3.7c-2.5-1.2-10.5-1.2-13 0z" />
    <circle cx="10.8" cy="4.5" r="1.1" /><circle cx="13.2" cy="4.5" r="1.1" /><path d={heart(12, 15, 2)} {...full} /></>,
  // the cottage: chimney, arched door
  lifestyle: <>
    <path d="M5.5 10.2v10.3h13V10.2" {...wash} /><path d="M3.5 11.5L12 4l8.5 7.5M16 7.5V4.5h2.3v5" />
    <path d="M10.2 20.5v-4.7a1.8 1.8 0 0 1 3.6 0v4.7" /></>,
  // a dumbbell with a ribbon tied round the bar
  train: <>
    <rect x="2.6" y="6.8" width="4" height="10.4" rx="1.7" {...wash} /><rect x="17.4" y="6.8" width="4" height="10.4" rx="1.7" {...wash} />
    <path d="M6.6 12h10.8" /><path d={bow(12, 12, 0.66)} {...wash} />
    <path d="M12 12l-1.4 3.6M12 12l1.4 3.6" /><circle cx="12" cy="12" r=".9" {...full} /></>,
  // a cup of tea
  food: <>
    <path d="M4.5 10h12v3c0 3.3-2.7 5.5-6 5.5s-6-2.2-6-5.5z" {...wash} />
    <path d="M16.5 11.2H18c1.7 0 2.6 1 2.6 2.3s-.9 2.3-2.6 2.3h-2.2M3 21h15M8 3.5c-1 1.3 1 2.3 0 3.7M12.5 3.5c-1 1.3 1 2.3 0 3.7" /></>,
  // the moon, with a flower in the crook of it
  cycle: <>
    <path d={moon(13, 12.3, 8.2, 200, 0.92, 0.5)} {...wash} />
    <g>{petals(8.9, 10.7, 5, 2.2, 1.5, 1.2)}</g><circle cx="8.9" cy="10.7" r=".7" {...full} /></>,
  // a notebook with a ribbon to keep the place
  plan: <>
    <rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8 3.5v17" />
    <path d="M13.5 3.5V10l1.75-1.4L17 10V3.5" {...wash} /><path d={heart(13.5, 15.3, 2.3)} /></>,
  // a seedling in a pot: a little more every day
  habits: <>
    <path d="M6.5 13h11l-1.2 7c-.1.6-.6 1-1.2 1H8.9c-.6 0-1.1-.4-1.2-1z" /><path d="M5.5 11h13v2h-13z" {...wash} />
    <path d="M12 11V7" /><path d="M12 8.2c-2.5 0-4-1.4-4.2-3.8 2.5 0 4.2 1.4 4.2 3.8zM12 7c0-2.2 1.4-3.6 4-3.8.2 2.4-1.4 3.8-4 3.8z" {...wash} /></>,
  // a calendar page, stitched, with a flower on it
  calendar: <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4M16 3v4" /><path d="M3.5 10h17" {...stitch} />
    <g {...wash}>{petals(12, 15.3, 5, 2.3, 1.5, 1.2)}</g><circle cx="12" cy="15.3" r=".7" {...full} /></>,
  // a market bag with a flower sewn on
  shop: <>
    <path d="M5 9h14l1 10.5c.1.9-.6 1.5-1.5 1.5h-13c-.9 0-1.6-.6-1.5-1.5z" {...wash} />
    <path d="M8.5 9c0-4 1.5-5.5 3.5-5.5s3.5 1.5 3.5 5.5" /><g>{petals(12, 15, 5, 2.3, 1.5, 1.2)}</g><circle cx="12" cy="15" r=".7" {...full} /></>,
};

// ── Celestial: a hairline pen with solid little stars; suns, moons, orbits ──
const celestial: Record<Place, ReactNode> = {
  // the sun rising, long and short rays in turn
  today: <>
    <path d="M7 17.5a5 5 0 0 1 10 0" {...wash} /><path d="M2.5 17.5h19M6.5 20.5h11" />
    <path d="M12 5.5v4M7.05 12.55L4.9 10.4M16.95 12.55l2.15-2.15M9.32 11.03l-.57-1.38M14.68 11.03l.57-1.38M5.53 14.82l-1.38-.57M18.47 14.82l1.38-.57" />
    <path d={spark(19.8, 4.8, 1.7)} {...full} /><circle cx="4.3" cy="6" r=".7" {...full} /></>,
  // a heart joined up from stars
  health: <>
    <path d="M12 20L5.2 13.5 3.2 8.5 7 4.5l5 3 5-3 3.8 4-2 5z" strokeWidth="1.1" />
    {[[12, 20], [5.2, 13.5], [3.2, 8.5], [12, 7.5], [20.8, 8.5], [18.8, 13.5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.2" {...full} />)}
    <path d={spark(7, 4.5, 2.1)} {...full} /><path d={spark(17, 4.5, 2.1)} {...full} /></>,
  // a thick coin with the moon struck on it
  wealth: <>
    <circle cx="11.5" cy="11.3" r="7.2" {...wash} /><path d="M4.3 11.3v2.2a7.2 7.2 0 0 0 14.4 0v-2.2" />
    <path d={moon(11.7, 11.3, 3.6, -30)} {...full} /><path d={spark(20, 4.2, 1.9)} {...full} /></>,
  // the north star: something to steer by
  lifestyle: <>
    <path d="M12 2.5l1.8 7.7 7.7 1.8-7.7 1.8-1.8 7.7-1.8-7.7L2.5 12l7.7-1.8z" {...wash} />
    <path d="M6.2 6.2l2 2M17.8 6.2l-2 2M6.2 17.8l2-2M17.8 17.8l-2-2" /><circle cx="12" cy="12" r="1.1" {...full} /></>,
  // a dumbbell, lifted among the stars
  train: <>
    <rect x="5" y="8" width="3" height="10" rx="1.2" {...wash} /><rect x="16" y="8" width="3" height="10" rx="1.2" {...wash} />
    <rect x="2.4" y="10.2" width="2.6" height="5.6" rx="1.1" /><rect x="19" y="10.2" width="2.6" height="5.6" rx="1.1" /><path d="M8 13h8" />
    <path d={spark(12, 5.4, 2.4)} {...full} /><path d={spark(17.6, 4, 1.2)} {...full} /><circle cx="6.6" cy="4.6" r=".7" {...full} /></>,
  // a bowl, with stars rising off it like steam
  food: <>
    <path d="M3.5 12h17c0 4.7-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12z" {...wash} /><path d="M9 20.5h6" />
    <path d={spark(8, 6, 2.2)} {...full} /><path d={spark(14.2, 4, 1.6)} {...full} /><path d={spark(17.5, 8, 1.3)} {...full} /></>,
  // the moon waxing, full and waning
  cycle: <>
    <path d="M3 8A4.05 4.05 0 0 1 3 16A6 6 0 0 0 3 8zM21 8A4.05 4.05 0 0 0 21 16A6 6 0 0 1 21 8z" {...full} />
    <circle cx="12" cy="12" r="3.8" {...wash} /><circle cx="12" cy="4.6" r=".7" {...full} /><circle cx="12" cy="19.4" r=".7" {...full} /></>,
  // a book of the sky: a constellation on one page, a star on the other
  plan: <>
    <path d={BOOK} /><path d="M12 6.8v13" /><path d="M5.8 9.8l2.8 2.3-2 3" strokeWidth=".9" />
    <circle cx="5.8" cy="9.8" r=".8" {...full} /><circle cx="8.6" cy="12.1" r=".8" {...full} /><circle cx="6.6" cy="15.1" r=".8" {...full} />
    <path d={spark(16.5, 12, 2.6)} {...full} /></>,
  // a moon going round its planet
  habits: <>
    <circle cx="12" cy="12" r="2.8" {...wash} /><path d={`M${on(12, 12, 8, 337)}A8 8 0 1 1 ${on(12, 12, 8, 293)}`} />
    <circle cx="17.66" cy="6.34" r="1.6" {...full} /></>,
  // a calendar page with the moon on it
  calendar: <>{page(2.5)}<path d={moon(11.6, 15.3, 3.4, -30)} {...full} /></>,
  // a bag with a star on it
  shop: <>
    <path d="M5.5 8.5h13l1 11c.1.8-.5 1.5-1.3 1.5H5.8c-.8 0-1.4-.7-1.3-1.5z" {...wash} />
    <path d="M9 11V7c0-2 1.2-3.5 3-3.5s3 1.5 3 3.5v4" /><path d={spark(12, 15.8, 2.6)} {...full} /><path d={spark(20.3, 4.3, 1.4)} {...full} /></>,
};

// ── Festive: a bold pen with solid touches; stars, a snow globe, presents ──
const festive: Record<Place, ReactNode> = {
  // the day's star, up over the snow
  today: <>
    <path d={star(12, 10.4, 5.8, 2.5)} {...wash} /><path d="M2.5 20.6c3.5-2.3 6.5-3.3 9.5-3.3s6 1 9.5 3.3" />
    <path d={[-54, -126].map(a => `M${on(12, 10.4, 5.4, a)}L${on(12, 10.4, 7.8, a)}`).join('') + [18, 162].map(a => `M${on(12, 10.4, 5.6, a)}L${on(12, 10.4, 8, a)}`).join('')} /></>,
  // a heart to hang on the tree
  health: <>
    <path d={heart(12, 13.7, 7.5)} {...wash} /><rect x="10.5" y="6.4" width="3" height="2.7" rx=".6" {...full} /><circle cx="12" cy="4.4" r="1.5" />
    <path d={star(12, 13.5, 2.7, 1.15)} {...full} /></>,
  // a sack, tied at the neck, with a star on it
  wealth: <>
    <path d="M8 8.5C4.5 11 3.5 14.5 4.2 17.5 4.8 20 6.5 21 12 21s7.2-1 7.8-3.5c.7-3-.3-6.5-3.8-9z" {...wash} />
    <path d="M8 8.5c-1-2-.5-4 1-5 1 .8 2 .8 3 0 1 .8 2 .8 3 0 1.5 1 2 3 1 5z" /><path d={star(12, 14.8, 3.3, 1.4)} {...full} /></>,
  // a snow globe with a tree in it
  lifestyle: <>
    <path d="M7.5 16.5a7.5 7.5 0 1 1 9 0" /><path d="M6 16.5h12l1 4.5H5z" {...wash} />
    <path d="M12 5.2l2 3h-.9l2.2 3.4H8.7l2.2-3.4H10z" {...full} /><path d="M12 11.6v2.1" /><circle cx="7.7" cy="8.2" r=".7" {...full} /><circle cx="16.4" cy="7.6" r=".7" {...full} /><circle cx="16.8" cy="12.5" r=".7" {...full} /><circle cx="7.3" cy="12.8" r=".7" {...full} /></>,
  // an ice skate
  train: <>
    <path d="M7 4.5h5v5.3c0 1.4.9 2.3 2.3 2.6l3.2.7c1.5.3 2.5 1.4 2.5 2.9v1H7z" {...wash} />
    <path d="M6.2 4.5h6.6M9.5 7.5H12M9.5 10H12M9 17v3.5M17 17v3.5M4.5 20.5h15c1.1 0 1.8-.6 2-1.5" /></>,
  // a gingerbread man
  food: <>
    <path d="M9.4 8.6H5.6c-1.1 0-1.9.8-1.9 1.8s.8 1.8 1.9 1.8h3v1.3L6.3 18c-.5 1-.1 2.2.9 2.6s2.1 0 2.6-1l2.2-4.1 2.2 4.1c.5 1 1.6 1.4 2.6 1s1.4-1.6.9-2.6l-2.3-4.5v-1.3h3c1.1 0 1.9-.8 1.9-1.8s-.8-1.8-1.9-1.8h-3.8" {...wash} />
    <circle cx="12" cy="6" r="3.2" {...wash} /><circle cx="12" cy="11" r=".8" {...full} /><circle cx="12" cy="13.5" r=".8" {...full} /></>,
  // a wreath with a bow
  cycle: <>
    <path fillRule="evenodd" d="M12 3.3a8 8 0 1 0 0 16 8 8 0 1 0 0-16zM12 7a4.3 4.3 0 1 1 0 8.6A4.3 4.3 0 1 1 12 7z" {...wash} />
    <circle cx="12" cy="5.2" r="1" {...full} /><circle cx="6.5" cy="8" r="1" {...full} /><circle cx="17.5" cy="8" r="1" {...full} />
    <path d="M12 18.8c-1.8-2.2-4.8-2-4.8.2s3 2.4 4.8.2zM12 18.8c1.8-2.2 4.8-2 4.8.2s-3 2.4-4.8.2z" {...full} /></>,
  // the list, on a scroll, with a star stuck to it
  plan: <>
    <path d="M7 16.5V4h12v13.5c0 1.9-1.4 3-3 3" /><path d="M16 20.5H6.5C4.8 20.5 4 19.3 4 18v-1.5h10V18c0 1.4.8 2.5 2 2.5z" {...wash} />
    <path d="M11.8 8h4.4M11.8 11h4.4M11.8 14h2.2" /><circle cx="9.6" cy="8" r=".9" {...full} /><circle cx="9.6" cy="11" r=".9" {...full} /></>,
  // a paper chain: don't break it
  habits: <>
    <ellipse cx="6.6" cy="12" rx="4.3" ry="2.9" transform="rotate(-28 6.6 12)" {...wash} /><ellipse cx="12" cy="12" rx="4.3" ry="2.9" transform="rotate(28 12 12)" />
    <ellipse cx="17.4" cy="12" rx="4.3" ry="2.9" transform="rotate(-28 17.4 12)" {...wash} /></>,
  // a calendar page with a tree on it
  calendar: <>{page(2.5)}<path d="M12 11.3l2 2.7h-.9l2.3 3.3H8.6l2.3-3.3H10z" {...full} /><path d="M12 17.3v1.6" /></>,
  // a present
  shop: <>
    <path d="M4.5 11.5h15v8c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5z" /><path d="M3.5 8h17v3.5h-17z" {...wash} />
    <path d="M12 8v13M12 8C10 4.5 6.5 4 6.5 6S9.5 8 12 8zM12 8c2-3.5 5.5-4 5.5-2S14.5 8 12 8z" /></>,
};

// ── Academia: a thin ink line, squared off, shaded with hatching; books, quills, a globe ──
const academia: Record<Place, ReactNode> = {
  // the sun coming up over an open book
  today: <>
    <path d="M2.5 16.5c3-1.3 7-1.1 9.5 1 2.5-2.1 6.5-2.3 9.5-1v4c-3-1.2-7-1-9.5 1-2.5-2-6.5-2.2-9.5-1zM12 17.5v4" />
    <path d="M7.4 14.3a4.8 4.8 0 0 1 9.2 0M12 3.8v3M5.3 7.2l2 2M18.7 7.2l-2 2M8.6 4.6l.8 2M15.4 4.6l-.8 2M3 12.6h2.4M18.6 12.6H21" /></>,
  // a heart in a laurel
  health: <>
    <path d={heart(12, 9.6, 6)} /><path d="M3.2 10.5c.2 5 3.4 9 7.8 10.3M20.8 10.5c-.2 5-3.4 9-7.8 10.3" />
    <path d={[[3.88, 14.04, 238], [5.53, 17.04, 212], [7.95, 19.35, 190]].map(([x, y, a]) => leaf(x, y, a, 3.4, 2) + leaf(24 - x, y, 180 - a, 3.4, 2)).join('')} {...full} /></>,
  // a stack of coins, and one stood on its edge
  wealth: <>
    <ellipse cx="8.5" cy="7.5" rx="5.2" ry="2.2" />
    <path d="M3.3 7.5v9.5c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V7.5M3.3 10.7c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2M3.3 13.9c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2" />
    <circle cx="18" cy="15.6" r="3.6" /><path d="M18 13.8v3.6" /></>,
  // a globe on its stand
  lifestyle: <>
    <circle cx="11.5" cy="10.3" r="6.2" /><path d="M5.3 10.3h12.4M11.5 4.1c-3 2.7-3 9.7 0 12.4M11.5 4.1c3 2.7 3 9.7 0 12.4" strokeWidth=".9" />
    <path d={`M${on(11.5, 10.3, 8.2, -62)}A8.2 8.2 0 0 1 ${on(11.5, 10.3, 8.2, 78)}M13 18.3v2.7M8 21h10`} /></>,
  // two foils, crossed
  train: <>
    <path d="M4.5 3.5l13.8 16.3M19.5 3.5L5.7 19.8" /><path d="M13.3 17.8c-.4-1.7 1.2-3.5 3.2-3.4M10.7 17.8c.4-1.7-1.2-3.5-3.2-3.4" />
    <circle cx="18.7" cy="20.3" r=".9" {...full} /><circle cx="5.3" cy="20.3" r=".9" {...full} /></>,
  // an apple
  food: <>
    <path d="M12 8c-1.5-1.4-4.2-1.8-6-.4-2.2 1.8-2.2 5.4-.8 8.6 1.2 2.8 3.2 4.8 5 4.8.8 0 1.2-.4 1.8-.4s1 .4 1.8.4c1.8 0 3.8-2 5-4.8 1.4-3.2 1.4-6.8-.8-8.6-1.8-1.4-4.5-1-6 .4z" />
    <path d="M12 8c0-2 .6-3.4 1.8-4.6M13.3 5.4c1-2.2 3.2-2.8 5.2-2.2-.6 2.2-2.8 3.2-5.2 2.2z" /><path d="M16.4 10.5c1 1.7 1 4.3 0 6.2M14.5 10.3c.8 2 .8 4.8 0 7" strokeWidth=".9" /></>,
  // the moon on its dial, as an almanac draws it
  cycle: <>
    <circle cx="12" cy="12" r="8.6" /><path d={moon(12, 12, 4.9, -28)} {...full} />
    <path d="M12 3.4v1.8M12 18.8v1.8M3.4 12h1.8M18.8 12h1.8" /></>,
  // a quill, and the line it has just written
  plan: <>
    <path d="M7.3 14.4C8 9.6 13 4.6 20 3.5c-.8 7-5 12-10.1 13.3z" /><path d="M4.2 19.8L17 7M11.2 12.8l4.2-.3M13.4 10.6l.2-3" strokeWidth=".9" />
    <path d="M9 20.8c2.5-1.5 4.5 1.5 7 0 1.3-.8 2.6-.6 3.5 0" /></>,
  // a tally: four strokes and one across
  habits: <path d="M5.8 5.2l-.4 13.6M9.8 5l-.2 14M13.8 5.2l.2 13.6M17.7 5l.4 14M2.8 16.8L21.2 7.2" />,
  // an almanac page: the days as little squares, today inked in
  calendar: <>
    <rect x="3.5" y="5" width="17" height="15.5" rx=".8" /><path d="M8 3v4M16 3v4M3.5 9.8h17M3.5 10.6h17" />
    <path d="M6.6 12.8h2.2v2.2H6.6zM15.2 12.8h2.2v2.2h-2.2zM6.6 16.4h2.2v2.2H6.6zM10.9 16.4h2.2v2.2h-2.2z" strokeWidth=".9" /><path d="M10.9 12.8h2.2v2.2h-2.2z" {...full} /></>,
  // a satchel
  shop: <>
    <rect x="3.5" y="8.5" width="17" height="12" rx="1.2" /><path d="M3.5 12.5c0 1.8 1.4 3 3.2 3h10.6c1.8 0 3.2-1.2 3.2-3M9 8.5v-2c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v2" />
    <path d="M8 8.5v5.8M16 8.5v5.8" strokeWidth=".9" /><path d="M6.9 14.4h2.2v2.3H6.9zM14.9 14.4h2.2v2.3h-2.2z" {...full} /></>,
};

// ── Coastal: a round pen and a wash, with the sea in most of them; sails, a chest, an anchor ──
const coastal: Record<Place, ReactNode> = {
  // the sun coming up out of the sea
  today: <>
    <path d="M7.59 16.4a4.8 4.8 0 1 1 8.82 0" {...wash} /><path d="M12 5v2M5.5 8l1.4 1.4M18.5 8l-1.4 1.4M3.2 13.8H5M19 13.8h1.8" />
    <path d={wave(2.5, 17.3, 4)} /><path d={wave(4.9, 20.7, 3)} /></>,
  // a heart half full of sea
  health: <>
    <path d="M3.6 12.66C5.4 11.2 7.6 11.2 9.4 12.66 11.2 14.1 12.8 14.1 14.6 12.66 16.4 11.2 18.6 11.2 20.4 12.66 18.98 15.01 16.21 17.5 12 20.6 7.79 17.5 5.02 15.01 3.6 12.66z" {...wash} stroke="none" />
    <path d={heart(12, 11.6, 9)} /><path d="M3.6 12.66C5.4 11.2 7.6 11.2 9.4 12.66 11.2 14.1 12.8 14.1 14.6 12.66 16.4 11.2 18.6 11.2 20.4 12.66" /></>,
  // a sea chest
  wealth: <>
    <path d="M4 11c0-3.3 2.4-5.5 5.4-5.5h5.2c3 0 5.4 2.2 5.4 5.5v8.5H4z" {...wash} />
    <path d="M4 11.8h16M8 5.8v13.7M16 5.8v13.7" /><rect x="10.6" y="10.2" width="2.8" height="3.6" rx=".9" {...full} /></>,
  // a sailing boat
  lifestyle: <>
    <path d="M3 15.8h18c-1 3-3.2 4.7-6 4.7H9c-2.8 0-5-1.7-6-4.7z" {...wash} />
    <path d="M11 3v12.8M11 3.8l7.3 9.2H11M8.8 7l-4 6h4z" /></>,
  // a swimmer
  train: <>
    <circle cx="16.8" cy="8.3" r="2.1" {...wash} /><path d="M4.5 13.8l4.7-4.6 4.6 3.6" />
    <path d={wave(2.5, 17, 4)} /><path d={wave(4.9, 20.5, 3)} /></>,
  // a fish
  food: <>
    <path d="M3 12c3-4.5 9-5.5 13.5-2L21 6.5v11L16.5 14C12 17.5 6 16.5 3 12z" {...wash} />
    <circle cx="7.2" cy="11.3" r="1" {...full} /><path d="M10.3 9.4c1 1.6 1 3.6 0 5.2" /></>,
  // the moon over the tide it pulls
  cycle: <>
    <path d={moon(11.5, 8.3, 5.8, -35)} {...wash} /><path d={wave(2.5, 17.3, 4)} /><path d={wave(4.9, 20.7, 3)} /></>,
  // a chart: the way there dotted in, a cross where it ends
  plan: <>
    <path d="M3.5 6.5L9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" {...wash} />
    <path d="M6.3 15.5c1-2.8 3.8-1.6 5.2-3.4 1-1.3 2-1.7 3.3-1.6" strokeDasharray=".1 2.5" /><path d="M16.4 8.2l2.3 2.3M18.7 8.2l-2.3 2.3" /></>,
  // an anchor: what holds a day steady
  habits: <>
    <circle cx="12" cy="5" r="2" {...wash} />
    <path d="M12 7v13.5M8.2 10.5h7.6M4.5 14c0 4 3.5 6.5 7.5 6.5s7.5-2.5 7.5-6.5M2.8 15.8l1.7-2.6 2.1 2.2M17.4 15.4l2.1-2.2 1.7 2.6" /></>,
  // a calendar page with the sun over a wave
  calendar: <>{page(2.5)}<path d={wave(6.8, 16.8, 3, 3.5, 1.2)} /><circle cx="15.3" cy="13.3" r="1.1" {...full} /></>,
  // a striped beach bag
  shop: <>
    <path d="M4.5 9.5h15l-1.2 10.1c-.1.8-.8 1.4-1.6 1.4H7.3c-.8 0-1.5-.6-1.6-1.4z" />
    <path d="M4.92 13h14.16l-.44 3.7H5.36z" {...wash} stroke="none" /><path d="M5 13h14M5.4 16.7h13.2M8 9.5c0-4 1.5-6 4-6s4 2 4 6" /></>,
};

// ── Spooky: filled-in shapes with the light cut out of them; bats, cats, a cauldron ──
const hole = { fillRule: 'evenodd' } as const;
const spooky: Record<Place, ReactNode> = {
  // the sun going up with a bat across it
  today: <>
    <path {...hole} d="M5 19a7 7 0 0 1 14 0zM12 14.2l.7-.9.4 1c1.2-.8 2.5-.7 3.3.1-.8.1-1.1.7-1 1.4-.8-.5-1.5-.2-1.8.6-.6-.5-1.2-.1-1.6.6-.4-.7-1-1.1-1.6-.6-.3-.8-1-1.1-1.8-.6.1-.7-.2-1.3-1-1.4.8-.8 2.1-.9 3.3-.1l.4-1z" />
    <path d="M2.5 20.8h19M12 6.8v2.4M5 9.8l1.7 1.7M19 9.8l-1.7 1.7M2.5 15.8h1.8M19.7 15.8h1.8" {...ink(1.7)} /></>,
  // a heart that has been sewn back together
  health: <path {...hole} d={`${heart(12, 11.6, 9)}M11.4 8h1.2v1.5h1.9v1.2h-1.9v1.7h1.9v1.2h-1.9v1.7h1.9v1.2h-1.9V18h-1.2v-1.5H9.5v-1.2h1.9v-1.7H9.5v-1.2h1.9v-1.7H9.5V9.5h1.9z`} />,
  // a cauldron brimming with gold
  wealth: <>
    <rect x="3" y="9.3" width="18" height="2.3" rx="1.15" /><path d="M4.6 12.6h14.8c1.1 3.6-.6 7.6-7.4 7.6s-8.5-4-7.4-7.6zM6.6 18.9l-1.5 3h2.8l.6-2.1zM17.4 18.9l1.5 3h-2.8l-.6-2.1z" />
    <circle cx="8.6" cy="6.3" r="1.9" /><circle cx="13" cy="4.3" r="1.9" /><circle cx="16.2" cy="7" r="1.5" /></>,
  // a house with a turret and the lights on
  lifestyle: <>
    <path d="M14 8.5l3.25-6 3.25 6z" /><path {...hole} d="M15 9.3h4.5V21H15zM16.5 11.3v2.6h1.5v-2.6z" />
    <path d="M2.8 13.4L9.3 7l5 4.9v1.5z" /><path {...hole} d="M4 14.2h10.3V21H4zM6 15.6v2h2v-2zM10.2 21v-3.3a1.3 1.3 0 0 1 2.6 0V21z" /></>,
  // a bone: the first dumbbell
  train: <>
    <path d="M8.2 15.8l7.6-7.6" {...ink(3.4)} />
    <circle cx="5.4" cy="16" r="2.5" /><circle cx="8" cy="18.6" r="2.5" /><circle cx="16" cy="5.4" r="2.5" /><circle cx="18.6" cy="8" r="2.5" /></>,
  // a wrapped sweet
  food: <>
    <path {...hole} d="M12 6.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 1 0 0-10.8zM10.1 8.7l1.3-.6c1.3 2.6 1.3 5.2 0 7.8l-1.3-.6c1.1-2.2 1.1-4.4 0-6.6zM13 8.1l1.3.6c1.1 2.2 1.1 4.4 0 6.6l-1.3.6c1.3-2.6 1.3-5.2 0-7.8z" />
    <path d="M7.4 12L2.3 8.2c.9 2.5.9 5.1 0 7.6zM16.6 12l5.1-3.8c-.9 2.5-.9 5.1 0 7.6z" /></>,
  // the moon, and a spider letting itself down from it
  cycle: <>
    <path d={moon(10.5, 11, 8.3, -12)} /><path d="M14.2 4.2v7M12 11.9l-1.2-.8M12 13.3l-1.3.7M16.4 11.9l1.2-.8M16.4 13.3l1.3.7" {...ink(1)} />
    <circle cx="14.2" cy="12.6" r="1.9" /></>,
  // a book of spells, a moon on its cover
  plan: <path {...hole} d={`M5 5.5a2 2 0 0 1 2-2h10.5a2 2 0 0 1 2 2v15H7a2 2 0 0 1-2-2zM7.3 16.9v1.3h9.9v-1.3z${moon(12.3, 10.2, 3.7, -30)}`} />,
  // a cat, its tail curled round: a creature of habit
  habits: <>
    <path {...hole} d="M6.2 3l2.4 2c.6-.2 1.3-.2 1.9 0l2.4-2 .2 4.2c.2 2.5-1.4 4.2-3.5 4.2S5.8 9.7 6 7.2zM8.2 6.8a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6zM11 6.8a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6z" />
    <path d="M6.7 10.8C5.2 13.8 5 17.8 6 21h8c.5-4-.3-7.6-1.5-10.2z" />
    <path d="M13.3 19.8c3.7.7 7.2-1.3 7.2-4.8 0-2.8-3.7-3-3.7-.4 0 1.4 1.4 1.6 1.8.6" {...ink(1.9)} /></>,
  // a calendar page with a ghost on it
  calendar: <>
    <path {...hole} d="M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM5.3 8.7v1.1h13.4V8.7zM9 18.9v-4.5c0-1.8 1.3-3 3-3s3 1.2 3 3v4.5l-1.5-1.1-1.5 1.1-1.5-1.1z" />
    <path d="M8 2.8V6M16 2.8V6" {...ink(1.9)} /><circle cx="11" cy="14.4" r=".7" /><circle cx="13" cy="14.4" r=".7" /></>,
  // a pumpkin pail for the treats
  shop: <>
    <path {...hole} d="M12 8.3c-6 0-8.5 3-8.5 6.4 0 3.8 3.5 6.3 8.5 6.3s8.5-2.5 8.5-6.3c0-3.4-2.5-6.4-8.5-6.4zM7.7 14l1.9-2.3 1 2.3zM13.4 14l1-2.3 1.9 2.3zM7.5 15.8l2 1 1.5-.8 1 1 1-1 1.5.8 2-1c-1 2.3-2.7 3.2-4.5 3.2s-3.5-.9-4.5-3.2z" />
    <path d="M5.6 9.8c0-4.3 2.9-6.8 6.4-6.8s6.4 2.5 6.4 6.8" {...ink(1.6)} /></>,
};

// ── Retro: a chunky pen and rings inside rings; sunbursts, rainbows, a record ──
const retro: Record<Place, ReactNode> = {
  // a sunburst
  today: <>
    <path d="M8.8 18a3.2 3.2 0 0 1 6.4 0z" {...full} /><path d="M5.6 18a6.4 6.4 0 0 1 12.8 0M3 21.2h18" />
    <path d={`M12 9.2V7M${on(12, 18, 8.8, -60)}L${on(12, 18, 11, -60)}M${on(12, 18, 8.8, -120)}L${on(12, 18, 11, -120)}M${on(12, 18, 8.8, -30)}L${on(12, 18, 10.6, -30)}M${on(12, 18, 8.8, -150)}L${on(12, 18, 10.6, -150)}`} /></>,
  // a heart inside a heart
  health: <><path d={heart(12, 11.8, 8.5)} /><path d={heart(12, 11.9, 3.5)} {...full} /></>,
  // a piggy bank, with a coin going in
  wealth: <>
    <ellipse cx="11.5" cy="13.5" rx="7.3" ry="5.3" /><path d="M18.6 11.8H21v3.4h-2.4M7.5 18.2v2.6M15.5 18.2v2.6M6.4 9.4l.4-3 2.7 1.6M4.2 13c-1.5-.5-1.5-2.4 0-2.2" />
    <circle cx="13.3" cy="4.3" r="1.8" {...full} /><circle cx="15.8" cy="12.2" r="1" {...full} /></>,
  // a rainbow
  lifestyle: <path d="M2.8 19.5V16a9.2 9.2 0 0 1 18.4 0v3.5M6.3 19.5V16a5.7 5.7 0 0 1 11.4 0v3.5M9.8 19.5V16a2.2 2.2 0 0 1 4.4 0v3.5" />,
  // a roller skate
  train: <>
    <path d="M6 3.5h5.5V9c0 1.4.9 2.2 2.3 2.5l3.2.7c1.8.4 3 1.7 3 3.3H6z" /><path d="M6 7.3h5.5" />
    <circle cx="8.7" cy="19.3" r="2.2" /><circle cx="17" cy="19.3" r="2.2" /></>,
  // a pair of cherries
  food: <>
    <circle cx="7.3" cy="16.8" r="3.3" /><circle cx="16.3" cy="17.5" r="3.3" />
    <path d="M8.3 13.7C9.3 10 10.8 7.3 13 4.8c1.3 3 2.3 6.1 2.8 9.5" /><path d="M13 4.8c2.2-1.9 5-1.8 7 .2-2.2 1.9-5 1.8-7-.2z" {...full} /></>,
  // a big daisy: petals all the way round
  cycle: <><g {...full}>{petals(12, 12, 8, 6.2, 3.2, 1.8)}</g><circle cx="12" cy="12" r="1.5" {...full} /></>,
  // a notebook with a sunburst on the cover
  plan: <>
    <rect x="5.5" y="3.5" width="14" height="17" rx="2" /><path d="M3.6 7.5H7M3.6 12H7M3.6 16.5H7M10.5 7.5h5.5" />
    <path d="M15.8 20.5a3.7 3.7 0 0 1 3.7-3.7M12 20.5A7.5 7.5 0 0 1 19.5 13" /></>,
  // a record: on repeat
  habits: <>
    <circle cx="12" cy="12" r="8.8" /><path {...full} fillRule="evenodd" d="M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6zM12 11.2a.8.8 0 1 1 0 1.6.8.8 0 1 1 0-1.6z" />
    <path d={`M${on(12, 12, 5.7, -80)}A5.7 5.7 0 0 1 ${on(12, 12, 5.7, -10)}M${on(12, 12, 5.7, 100)}A5.7 5.7 0 0 1 ${on(12, 12, 5.7, 170)}`} strokeWidth="1.5" /></>,
  // a calendar page with a sunburst on it
  calendar: <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v3.5M16 3v3.5M3.5 10h17" />
    <path d="M9.7 17.8a2.3 2.3 0 0 1 4.6 0z" {...full} /><path d="M7 17.8a5 5 0 0 1 10 0" strokeWidth="1.7" /></>,
  // a shopping bag with a sunburst on it
  shop: <>
    <path d="M4.8 9h14.4l-1 9.8c-.1 1.2-1.1 2.2-2.3 2.2H8.1c-1.2 0-2.2-1-2.3-2.2zM8.8 9V7.2a3.2 3.2 0 0 1 6.4 0V9" />
    <path d="M10.1 20.9a1.9 1.9 0 0 1 3.8 0z" {...full} /><path d="M7.6 20.9a4.4 4.4 0 0 1 8.8 0" strokeWidth="1.7" /></>,
};

// ── Blossom: a soft pen and a wash, with small solid hearts; bows, flowers, a butterfly ──
const blossom: Record<Place, ReactNode> = {
  // the sun coming up, a heart for its first ray
  today: <>
    <path d="M6.8 19.2a5.2 5.2 0 0 1 10.4 0z" {...wash} /><path d="M3 19.2h18" />
    <path d={[30, 60, 120, 150].map(a => `M${on(12, 19.2, 6.9, -a)}L${on(12, 19.2, 8.8, -a)}`).join('')} /><path d={heart(12, 8.6, 2.7)} {...full} /></>,
  // a heart with a bow on it
  health: <>
    <path d={heart(12, 13.6, 7.6)} {...wash} /><path d={bow(12, 7.8)} {...wash} />
    <path d="M12 7.8l-1.7 3.4M12 7.8l1.7 3.4" /><circle cx="12" cy="7.8" r="1.1" {...full} /></>,
  // two coins, a heart on the front one
  wealth: <>
    <path d="M10.21 7.01A5.5 5.5 0 1 1 16.99 13.79" /><circle cx="10.5" cy="13.5" r="6.5" {...wash} />
    <path d={heart(10.5, 13.7, 2.7)} {...full} /><path d={spark(19.6, 18.8, 1.7)} {...full} /></>,
  // a butterfly: go where you please
  lifestyle: <>
    <path d="M12 10.8C10 5.8 3.5 4.6 3 8.6c-.4 3.3 4 5.3 9 4zM12 10.8c2-5 8.5-6.2 9-2.2.4 3.3-4 5.3-9 4z" {...wash} />
    <path d="M12 12.6c-3.5.3-6.8 2.3-5.8 5.1 1 2.6 4.6 1.4 5.8-2.1zM12 12.6c3.5.3 6.8 2.3 5.8 5.1-1 2.6-4.6 1.4-5.8-2.1z" {...wash} />
    <path d="M12 8.3v9.4M12 8.3c-.5-2-1.5-3-2.7-3.3M12 8.3c.5-2 1.5-3 2.7-3.3" /></>,
  // a kettlebell with a heart on it
  train: <>
    <path d="M8.2 9.8c-2.9 1.5-4 5.4-2.2 8.5.9 1.6 2.4 2.5 3.8 2.5h4.4c1.4 0 2.9-.9 3.8-2.5 1.8-3.1.7-7-2.2-8.5z" {...wash} />
    <path d="M8.2 9.8c-1-1.4-1-4.6.8-5.4 1-.4 5-.4 6 0 1.8.8 1.8 4 .8 5.4" /><path d={heart(12, 15, 2.7)} {...full} /></>,
  // a strawberry
  food: <>
    <path d="M12 21c-4-2-7.5-6-7.5-10 0-2.5 2-4 4.5-3.7 1.2.2 2.2.7 3 .7s1.8-.5 3-.7c2.5-.3 4.5 1.2 4.5 3.7 0 4-3.5 8-7.5 10z" {...wash} />
    <path d="M12 8c-1.5-.5-3-2-3.5-4 2 .2 3.3 1.5 3.5 4zM12 8c1.5-.5 3-2 3.5-4-2 .2-3.3 1.5-3.5 4zM12 7V3.3" />
    {[[9, 11.6], [12, 11.2], [15, 11.6], [10.5, 14.6], [13.5, 14.6], [12, 17.6]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r=".7" {...full} />)}</>,
  // a flower: five petals round
  cycle: <><g {...wash}>{petals(12, 12, 5, 5, 3.4, 2.4)}</g><circle cx="12" cy="12" r="1.8" {...full} /></>,
  // a diary with a heart for a lock
  plan: <>
    <rect x="4.5" y="3.5" width="14" height="17" rx="2" {...wash} /><path d="M7.5 3.5v17M18.5 10.6H20c.6 0 1 .4 1 1v.8c0 .6-.4 1-1 1h-1.5M18.5 10.6h-3M18.5 13.4h-3" />
    <path d={heart(13.2, 12.1, 2.6)} {...full} /></>,
  // round and round, with a heart at each end
  habits: <>
    <path d={LOOP} /><path d={heart(19.3, 10.2, 2.3)} {...full} /><path d={heart(4.7, 14, 2.3)} {...full} /></>,
  // a calendar page hung by a bow, a heart on the day
  calendar: <>
    <rect x="3.5" y="6" width="17" height="14.5" rx="2.5" /><path d="M3.5 10.8h17" /><path d={bow(12, 6, 0.75)} {...wash} /><circle cx="12" cy="6" r=".9" {...full} />
    <path d={heart(12, 15.6, 2.8)} {...full} /></>,
  // a shop's bag, tied with a bow
  shop: <>
    <path d="M5 8.5h14v11c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5z" {...wash} /><path d="M9 8.5v-2c0-1.7 1.3-3 3-3s3 1.3 3 3v2" />
    <path d={bow(12, 14.2, 0.9)} /><path d="M12 14.2l-1.5 3.6M12 14.2l1.5 3.6" /><circle cx="12" cy="14.2" r="1" {...full} /></>,
};

const pen = (w: number, more: SVGProps<SVGSVGElement> = {}): SVGProps<SVGSVGElement> => ({ fill: 'none', stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round', ...more });

/** Every pack, in the order the screen shows them. */
export const PACKS: Pack[] = [
  { id: 'line', name: 'Planner', note: 'The planner’s own icons', hand: pen(2) },
  { id: 'woodland', name: 'Woodland', note: 'Leaves, acorns and mushrooms', hand: pen(1.7), art: woodland },
  { id: 'cottage', name: 'Cottage', note: 'Teacups, flowers and a little house', hand: pen(1.5), art: cottage },
  { id: 'celestial', name: 'Celestial', note: 'Suns, moons and little stars', hand: pen(1.4), art: celestial },
  { id: 'festive', name: 'Festive', note: 'Stars, a snow globe and presents', hand: pen(1.8), art: festive },
  { id: 'academia', name: 'Academia', note: 'Books, a quill and a globe, in ink', hand: pen(1.3, { strokeLinecap: 'square', strokeLinejoin: 'miter' }), art: academia },
  { id: 'coastal', name: 'Coastal', note: 'Waves, a sail and an anchor', hand: pen(1.7), art: coastal },
  { id: 'spooky', name: 'Spooky', note: 'Bats, cats and a cauldron', hand: { fill: 'currentColor', stroke: 'none' }, art: spooky },
  { id: 'retro', name: 'Retro', note: 'Sunbursts, rainbows and a record', hand: pen(2.2), art: retro },
  { id: 'blossom', name: 'Blossom', note: 'Bows, hearts and flowers', hand: pen(1.6), art: blossom },
];
export const packOf = (id: PackId): Pack => PACKS.find(p => p.id === id) ?? PACKS[0];

/** One drawing from a pack. The size comes from where it sits (the bar and the tiles set it in planner.css). */
export function PackIcon({ pack, place, className = '' }: { pack: PackId; place: Place; className?: string }) {
  const p = packOf(pack);
  if (!p.art) { const Line = LINE[place]; return <Line aria-hidden className={className || undefined} />; }
  return <svg viewBox="0 0 24 24" {...p.hand} className={`pi pi--${p.id} ${className}`.trim()} aria-hidden>{p.art[place]}</svg>;
}
