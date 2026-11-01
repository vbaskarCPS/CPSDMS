// src/pages/Minigame/monkey.tsx — Mr Monkey: Kiaan's own sock monkey, drawn from the real one. Caramel knit
// with a seam down the head and faint ribbing, a big tan muzzle that covers the lower face with a black
// smile and a dark felt nose on it, shiny black button eyes, small ears with tan insides, a striped
// cream-and-maroon pullover with a button on one shoulder, long skinny arms with mitten hands, long floppy legs
// with pointed sock feet, and a curly tail. He's the host of Little Lessons: he talks, waves at the others,
// points at the answers, cheers with them, and holds a hand out for a high five.
import React from 'react';
import { type Mood } from './chessCharacters';

/** What he's doing with his arms. */
export type Pose = 'idle' | 'wave' | 'highfive' | 'point' | 'cheer' | 'shrug';

const INK = '#1f2937';
const FUR = '#b8651f', FUR_DK = '#8e4a12', FUR_LT = '#cf7a2c', MUZZLE = '#ecd3ad', MUZZLE_DK = '#d9b98b';
const NOSE = '#4a2a12', BUTTON = '#111827', CHEEK = '#f2a7a7';
const RED = '#a8232c', CREAM = '#f7eadb';
const stroke = { stroke: INK, strokeWidth: 3.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
const tb = { transformBox: 'view-box' as React.CSSProperties['transformBox'] };

/** The striped knit: cream with narrow maroon stripes, clipped to a shape. */
const Striped: React.FC<{ id: string; d: string; shade?: boolean }> = ({ id, d, shade }) => (
  <g>
    <clipPath id={id}><path d={d} /></clipPath>
    <path d={d} fill={CREAM} />
    <g clipPath={`url(#${id})`}>
      {Array.from({ length: 22 }, (_, i) => <rect key={i} x={-20} y={-10 + i * 5.2} width={160} height={2.4} fill={RED} />)}
      {shade && <rect x={-20} y={-10} width={160} height={160} fill="url(#mk-shirt-shade)" />}
    </g>
    <path d={d} fill="none" {...stroke} />
  </g>
);

/** A skinny knit arm from the shoulder to the hand: open mitten (fingers + thumb) or a relaxed fist. */
const Arm: React.FC<{ sx: number; sy: number; hx: number; hy: number; open?: boolean; via?: [number, number]; thumb?: -1 | 1 }> = ({ sx, sy, hx, hy, open, via, thumb = 1 }) => {
  const [cx, cy] = via || [(sx + hx) / 2, Math.max(sy, hy) + 8];
  const d = `M${sx} ${sy} Q${cx} ${cy} ${hx} ${hy}`;
  return (
    <g>
      <path d={d} fill="none" stroke={INK} strokeWidth={12.5} strokeLinecap="round" />
      <path d={d} fill="none" stroke={FUR} strokeWidth={9} strokeLinecap="round" />
      <path d={d} fill="none" stroke={FUR_DK} strokeWidth={1.2} strokeLinecap="round" opacity={0.35} strokeDasharray="2 3" />
      {open
        ? <g>
            {/* mitten: a palm with four stitched fingers and a thumb to the side */}
            <path d={`M${hx - 7} ${hy + 3} q0 -14 7 -14 q7 0 7 14 q0 6 -7 6 q-7 0 -7 -6 Z`} fill={FUR_LT} {...stroke} strokeWidth={2.8} />
            {[-4, -1.3, 1.3, 4].map((o, i) => <path key={i} d={`M${hx + o} ${hy - 9} v-5.5`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" />)}
            <ellipse cx={hx + 8.5 * thumb} cy={hy + 1} rx={3} ry={4.2} fill={FUR_LT} {...stroke} strokeWidth={2.4} transform={`rotate(${-30 * thumb} ${hx + 8.5 * thumb} ${hy + 1})`} />
          </g>
        : <g>
            <ellipse cx={hx} cy={hy} rx={6.5} ry={5.8} fill={FUR_LT} {...stroke} strokeWidth={2.8} />
            <path d={`M${hx - 3} ${hy - 1} h6`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
          </g>}
    </g>
  );
};

function arms(pose: Pose): React.ReactNode {
  switch (pose) {
    case 'wave': return <>
      <Arm sx={33} sy={72} hx={16} hy={100} />
      <g className="mk-wave" style={{ transformOrigin: '70px 70px', ...tb }}>
        <Arm sx={70} sy={70} hx={96} hy={26} open via={[94, 56]} />
      </g>
    </>;
    case 'highfive': return <>
      <Arm sx={33} sy={72} hx={16} hy={100} />
      <g className="mk-reach" style={{ transformOrigin: '70px 70px', ...tb }}>
        <Arm sx={70} sy={70} hx={104} hy={16} open via={[98, 50]} />
      </g>
    </>;
    case 'point': return <>
      <Arm sx={33} sy={72} hx={16} hy={100} />
      <g className="mk-point" style={{ transformOrigin: '70px 70px', ...tb }}>
        <Arm sx={70} sy={70} hx={106} hy={80} via={[92, 68]} />
        <path d="M106 80 l13 -4" stroke={INK} strokeWidth={6.4} strokeLinecap="round" /><path d="M106 80 l13 -4" stroke={FUR_LT} strokeWidth={3.4} strokeLinecap="round" />
      </g>
    </>;
    case 'cheer': return <g className="mk-cheer" style={{ transformOrigin: '50px 72px', ...tb }}>
      <Arm sx={33} sy={72} hx={2} hy={24} open via={[8, 56]} thumb={-1} />
      <Arm sx={70} sy={70} hx={100} hy={24} open via={[94, 56]} />
    </g>;
    case 'shrug': return <>
      <Arm sx={33} sy={72} hx={4} hy={66} open via={[12, 88]} thumb={-1} />
      <Arm sx={70} sy={70} hx={98} hy={66} open via={[90, 88]} />
    </>;
    default: return <>
      <Arm sx={33} sy={72} hx={16} hy={100} />
      <Arm sx={70} sy={70} hx={86} hy={100} />
    </>;
  }
}

/** His face: button eyes (blinking), the muzzle's stitched smile, and the mood's mouth on top of it. */
const MonkeyFace: React.FC<{ mood: Mood }> = ({ mood }) => {
  const eyes = [38, 62], cy = 33;
  const oops = mood === 'oops';
  return (
    <g>
      {eyes.map((x, i) => (
        <g key={i} className="lc-blink" style={{ transformOrigin: `${x}px ${cy}px`, ...tb }}>
          <circle cx={x} cy={cy} r={6.2} fill={BUTTON} />
          <circle cx={x} cy={cy} r={6.2} fill="none" stroke="#000" strokeWidth={1} opacity={0.5} />
          <circle cx={x + 2.2} cy={cy - 2.4} r={2.1} fill="#fff" />
          <circle cx={x - 2.4} cy={cy + 2.4} r={0.9} fill="#fff" opacity={0.7} />
        </g>
      ))}
      {oops && eyes.map((x, i) => <path key={i} d={`M${x - 6} ${cy - 10 + (i ? -2.5 : 2.5)} L${x + 6} ${cy - 10 + (i ? 2.5 : -2.5)}`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />)}
      <ellipse cx={28} cy={44} rx={5} ry={3.2} fill={CHEEK} opacity={0.75} />
      <ellipse cx={72} cy={44} rx={5} ry={3.2} fill={CHEEK} opacity={0.75} />
      {/* the felt nose */}
      <path d="M44 44 q6 -4 12 0 q0 6 -6 7 q-6 -1 -6 -7 Z" fill={NOSE} stroke="#2d1708" strokeWidth={1.2} />
      <ellipse cx={47.5} cy={44.8} rx={1.6} ry={0.9} fill="#fff" opacity={0.35} />
      {/* his smile: one clean black line, like the real one; softened when the mood takes the mouth */}
      <g opacity={mood === 'idle' || mood === 'wow' ? 1 : 0.4}>
        <path d="M31 50 Q50 65 69 50" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      </g>
      {mood === 'happy' && <path d="M38 53 Q50 68 62 53 Z" fill="#9f1239" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />}
      {mood === 'happy' && <path d="M43 60 Q50 65 57 60" fill="#fecdd3" opacity={0.9} />}
      {mood === 'munch' && <ellipse cx={50} cy={58} rx={5} ry={6} fill="#9f1239" stroke={INK} strokeWidth={2.2} />}
      {mood === 'talk' && <ellipse className="lc-talk" cx={50} cy={58} rx={6} ry={5} fill="#9f1239" stroke={INK} strokeWidth={2.2} style={{ transformOrigin: '50px 56px', ...tb }} />}
      {mood === 'wow' && <ellipse cx={50} cy={60} rx={4} ry={5.5} fill="#9f1239" stroke={INK} strokeWidth={2.2} />}
      {oops && <path d="M42 60 q4 -4 8 0 q4 4 8 0" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />}
    </g>
  );
};

/** Mr Monkey, `size` pixels tall. `mood` is his face (same moods as everyone), `pose` his arms. */
export const MrMonkey: React.FC<{ size: number; mood?: Mood; pose?: Pose; className?: string; style?: React.CSSProperties; flip?: boolean }> =
  ({ size, mood = 'idle', pose = 'idle', className, style, flip }) => (
  <svg viewBox="-14 -6 128 136" width={size * 128 / 136} height={size} className={className} aria-hidden="true"
    style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))', display: 'inline-block', transform: flip ? 'scaleX(-1)' : undefined, ...style }}>
    <defs>
      <linearGradient id="mk-shirt-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".16" /></linearGradient>
      <radialGradient id="mk-head-shade" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#000" stopOpacity=".16" /></radialGradient>
    </defs>
    {/* tail, curling out behind */}
    <path d="M70 94 C94 92 100 72 86 64" fill="none" stroke={INK} strokeWidth={9.5} strokeLinecap="round" />
    <path d="M70 94 C94 92 100 72 86 64" fill="none" stroke={FUR} strokeWidth={6} strokeLinecap="round" />
    {/* legs: long, floppy, pointed sock feet turned out */}
    {[[38, 1], [62, -1]].map(([x, d], i) => (
      <g key={i}>
        <path d={`M${x} 98 Q${x - 8 * d} 112 ${x - 20 * d} 114`} fill="none" stroke={INK} strokeWidth={13.5} strokeLinecap="round" />
        <path d={`M${x} 98 Q${x - 8 * d} 112 ${x - 20 * d} 114`} fill="none" stroke={FUR} strokeWidth={10} strokeLinecap="round" />
        <path d={`M${x - 20 * d} 114 Q${x - 8 * d} 112 ${x} 98`} fill="none" stroke={FUR_DK} strokeWidth={1.2} opacity={0.35} strokeDasharray="2 3" />
        <path d={`M${x - 14 * d} 108 q${-8 * d} 1 ${-14 * d} 8 q4 7 12 5 q6 -3 8 -8 Z`} fill={FUR_LT} {...stroke} strokeWidth={3} />
        <path d={`M${x - 24 * d} 113 q${-2 * d} 2 ${-3 * d} 4`} stroke={INK} strokeWidth={1.4} strokeLinecap="round" opacity={0.6} />
      </g>
    ))}
    {/* the far arm goes behind the shirt; both are drawn, the shirt sits over the shoulders */}
    {arms(pose)}
    {/* the pullover: a short-sleeved striped jumper with a shoulder button on his left strap */}
    <Striped id="mk-sleeve-l" d="M24 66 q-6 2 -8 12 l12 4 q4 -8 6 -14 Z" />
    <Striped id="mk-sleeve-r" d="M76 66 q6 2 8 12 l-12 4 q-4 -8 -6 -14 Z" />
    <Striped id="mk-body" d="M30 64 Q50 58 70 64 L74 100 Q50 106 26 100 Z" shade />
    <path d="M30 64 Q50 70 70 64" fill="none" stroke={INK} strokeWidth={2.2} opacity={0.5} />
    <path d="M36 62 l-4 10" stroke={INK} strokeWidth={2.2} strokeLinecap="round" opacity={0.6} />
    <circle cx="36" cy="66" r="3.6" fill={RED} stroke={INK} strokeWidth={1.6} />
    <circle cx="34.8" cy="64.8" r="0.8" fill={INK} /><circle cx="37.2" cy="64.8" r="0.8" fill={INK} /><circle cx="34.8" cy="67.2" r="0.8" fill={INK} /><circle cx="37.2" cy="67.2" r="0.8" fill={INK} />
    {/* neck */}
    <path d="M42 56 h16 v8 h-16 Z" fill={FUR} />
    {/* ears: small knit cups with a tan inside, set a little back */}
    <circle cx="22" cy="30" r="9" fill={FUR} {...stroke} />
    <circle cx="78" cy="30" r="9" fill={FUR} {...stroke} />
    <circle cx="22" cy="30" r="4.5" fill={MUZZLE} />
    <circle cx="78" cy="30" r="4.5" fill={MUZZLE} />
    {/* head: caramel knit, with the seam down the middle and faint ribbing */}
    <ellipse cx="50" cy="34" rx="30" ry="29" fill={FUR} {...stroke} />
    <ellipse cx="50" cy="34" rx="30" ry="29" fill="url(#mk-head-shade)" />
    <path d="M50 6 Q48 14 50 20" fill="none" stroke={FUR_DK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
    {[26, 32, 68, 74].map((x, i) => <path key={i} d={`M${x} 16 Q${x + (i < 2 ? -3 : 3)} 30 ${x} 44`} fill="none" stroke={FUR_DK} strokeWidth={1.2} opacity={0.3} strokeDasharray="2 3" />)}
    {/* the muzzle: a big tan heel covering the lower face, stitched on */}
    <path d="M24 42 C24 30 36 28 50 28 C64 28 76 30 76 42 C76 56 64 64 50 64 C36 64 24 56 24 42 Z" fill={MUZZLE} stroke={INK} strokeWidth={2.8} />
    <path d="M27 48 C32 60 42 62 50 62 C58 62 68 60 73 48" fill="none" stroke={MUZZLE_DK} strokeWidth={2.4} strokeLinecap="round" opacity={0.6} />
    {[28, 36, 44, 52, 60, 68].map((x, i) => <path key={i} d={`M${x} 30 l1.5 2.5`} stroke={FUR_DK} strokeWidth={1.1} strokeLinecap="round" opacity={0.45} />)}
    <MonkeyFace mood={mood} />
    {/* eyebrows: a faint knit ridge above each eye */}
    <path d="M31 22 q7 -3 14 0" fill="none" stroke={FUR_DK} strokeWidth={1.6} strokeLinecap="round" opacity={0.55} />
    <path d="M55 22 q7 -3 14 0" fill="none" stroke={FUR_DK} strokeWidth={1.6} strokeLinecap="round" opacity={0.55} />
  </svg>
);

/** His moves; include once on the page. */
export const MONKEY_CSS = `
  @keyframes mk-wave { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-18deg) } 75% { transform: rotate(14deg) } }
  .mk-wave { animation: mk-wave .9s ease-in-out infinite; }
  @keyframes mk-reach { 0% { transform: rotate(40deg) } 70% { transform: rotate(-8deg) } 100% { transform: rotate(0) } }
  .mk-reach { animation: mk-reach .5s cubic-bezier(.3,1.4,.5,1) both; }
  @keyframes mk-point { 0%,100% { transform: rotate(0) } 50% { transform: rotate(-10deg) } }
  .mk-point { animation: mk-point 1.2s ease-in-out infinite; }
  @keyframes mk-cheer { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
  .mk-cheer { animation: mk-cheer .45s ease-in-out infinite; }
  @keyframes mk-slap { 0% { transform: scale(.4) rotate(-20deg); opacity: 0 } 40% { transform: scale(1.3) rotate(8deg); opacity: 1 } 100% { transform: scale(1) translateY(-40px); opacity: 0 } }
  .mk-slap { animation: mk-slap .8s ease-out both; }
  @keyframes mk-lean { 0%,100% { transform: rotate(0) } 50% { transform: rotate(6deg) translateX(4px) } }
  .mk-lean { animation: mk-lean 2.6s ease-in-out infinite; }
`;
