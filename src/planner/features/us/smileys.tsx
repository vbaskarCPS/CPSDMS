// src/planner/features/us/smileys.tsx — the faces in the chat's emoji packs (emoji.tsx): five or six for each occasion
// (occasions.ts), all built from one face (Face below): a skin colour, a pair of eyes, a mouth, and what the occasion
// puts on top (a Santa hat, bunny ears, a tilak, a party blower). Same 64 × 64 box, colours and movement (us.css st-…)
// as the drawings of things in stickers.tsx. The drawings are ours; each stands for an ordinary look-alike emoji
// (`emoji`), which is what a notification shows.
import type { ReactNode } from 'react';
import { HEART, STAR, dots, rays, type StickerDef } from './stickers';
import type { OccasionId } from './occasions';

const INK = '#2b2540', MOUTH = '#6b2737', TONGUE = '#ff7a90', HAND = '#ffc21f', HAND_EDGE = '#e5a312';
type Skin = [fill: string, edge: string];
const YELLOW: Skin = ['#ffd23f', '#eeb01e'];
type Eyes = 'dot' | 'wide' | 'happy' | 'shut' | 'wink' | 'heart' | 'star' | 'none';
type Mouth = 'smile' | 'grin' | 'open' | 'o' | 'yum' | 'kiss' | 'yawn' | 'fangs' | 'none';

// small shapes, placed by their middle (cx, cy) and how wide they are
const heart = (cx: number, cy: number, w: number, fill = '#e8324f') => <path d={HEART} fill={fill} transform={`translate(${cx} ${cy}) scale(${w / 42}) translate(-32 -34.5)`} />;
const star = (cx: number, cy: number, w: number, fill = '#ffd166', edge?: string) => <path d={STAR} fill={fill} stroke={edge} strokeWidth={edge ? 2.2 : 0} strokeLinejoin="round" transform={`translate(${cx} ${cy}) scale(${w / 22}) translate(-32 -14.5)`} />;
const spark = (cx: number, cy: number, s: number, fill = '#ffd166') => <path className="st-twinkle" d={`M${cx} ${cy - s} Q${cx} ${cy} ${cx + s} ${cy} Q${cx} ${cy} ${cx} ${cy + s} Q${cx} ${cy} ${cx - s} ${cy} Q${cx} ${cy} ${cx} ${cy - s} Z`} fill={fill} />;
const flower = (cx: number, cy: number, r: number, petal: string, mid = '#ffd166') => <g>
  {[0, 72, 144, 216, 288].map(a => <circle key={a} cx={cx + Math.sin((a * Math.PI) / 180) * r * 0.62} cy={cy - Math.cos((a * Math.PI) / 180) * r * 0.62} r={r * 0.55} fill={petal} stroke="#00000014" strokeWidth=".6" />)}
  <circle cx={cx} cy={cy} r={r * 0.4} fill={mid} /></g>;
const hand = (cx: number, cy: number, r = 4.6) => <circle cx={cx} cy={cy} r={r} fill={HAND} stroke={HAND_EDGE} strokeWidth="1.4" />;

// the eyes and the mouth, drawn around the middle of a face 44 wide (Face moves and sizes them)
const line = { fill: 'none', stroke: INK, strokeWidth: 2.6, strokeLinecap: 'round' as const };
const arcUp = (x: number) => <path d={`M${x - 4.6} -2.4 Q${x} -8.6 ${x + 4.6} -2.4`} {...line} />;
const arcDown = (x: number) => <path d={`M${x - 4.6} -5.4 Q${x} 0 ${x + 4.6} -5.4`} {...line} />;
const dot = (x: number) => <ellipse cx={x} cy={-4} rx={2.8} ry={3.7} fill={INK} />;
function eyesOf(kind: Eyes): ReactNode {
  switch (kind) {
    case 'dot': return <>{dot(-8)}{dot(8)}</>;
    case 'wide': return <><circle cx={-8} cy={-4.5} r={5.4} fill="#fff" /><circle cx={8} cy={-4.5} r={5.4} fill="#fff" /><circle cx={-8} cy={-4} r={2.8} fill={INK} /><circle cx={8} cy={-4} r={2.8} fill={INK} /></>;
    case 'happy': return <>{arcUp(-8)}{arcUp(8)}</>;
    case 'shut': return <>{arcDown(-8)}{arcDown(8)}</>;
    case 'wink': return <>{dot(-8)}{arcUp(8)}</>;
    case 'heart': return <>{heart(-8.5, -4, 12)}{heart(8.5, -4, 12)}</>;
    case 'star': return <>{star(-8.5, -4.5, 12.5, '#ff7a1a', '#c2500a')}{star(8.5, -4.5, 12.5, '#ff7a1a', '#c2500a')}</>;
    default: return null;
  }
}
function mouthOf(kind: Mouth): ReactNode {
  const smile = <path d="M-9 6 Q0 15.5 9 6" {...line} />;
  switch (kind) {
    case 'smile': return smile;
    case 'grin': return <><path d="M-11.5 4.5 H11.5 C11.5 13 6.5 18 0 18 C-6.5 18 -11.5 13 -11.5 4.5 Z" fill={MOUTH} /><path d="M-10.4 4.5 H10.4 C10.4 6.4 10.1 7.8 9.6 9 H-9.6 C-10.1 7.8 -10.4 6.4 -10.4 4.5 Z" fill="#fff" /><ellipse cx={0} cy={15} rx={4.4} ry={2.2} fill={TONGUE} /></>;
    case 'open': return <><ellipse cx={0} cy={10} rx={6.6} ry={7.4} fill={MOUTH} /><ellipse cx={0} cy={14.2} rx={3.9} ry={2.5} fill={TONGUE} /></>;
    case 'o': return <ellipse cx={0} cy={10} rx={3.8} ry={4.8} fill={MOUTH} />;
    case 'yum': return <>{smile}<path d="M1 10.8 C1.4 17.4 10.2 16.6 8.4 8.7 Z" fill={TONGUE} stroke="#e85a78" strokeWidth=".8" /></>;
    case 'kiss': return <path d="M-1.5 4.8 C3.6 5.4 3.6 9.2 -0.5 10 C3.6 10.8 3.6 14.6 -1.5 15.2" {...line} strokeWidth={2.4} />;
    case 'yawn': return <><ellipse cx={0} cy={9.5} rx={7.4} ry={8.8} fill={MOUTH} /><ellipse cx={0} cy={14.8} rx={4.6} ry={2.8} fill={TONGUE} /></>;
    case 'fangs': return <><path d="M-10 5 Q0 16 10 5 Z" fill={MOUTH} /><path d="M-6.4 6.4 L-4.2 12.4 L-2 7.6 Z M6.4 6.4 L4.2 12.4 L2 7.6 Z" fill="#fff" /></>;
    default: return null;
  }
}
interface FaceOpt {
  skin?: Skin; eyes?: Eyes; mouth?: Mouth; blush?: boolean;
  /** where its middle is and how big (the box is 64 × 64): lower and smaller when something sits on its head */ x?: number; y?: number; r?: number;
  /** no round head: only the eyes and the mouth, for a face on something else (an egg, a lamb) */ bare?: boolean;
  edge?: number; /** drawn on the face, in its own measure (a tilak, stitches, a beak) */ more?: ReactNode;
}
function Face({ skin = YELLOW, eyes = 'dot', mouth = 'smile', blush, x = 32, y = 33, r = 24, bare, edge = 1.6, more }: FaceOpt) {
  return (
    <g transform={`translate(${x} ${y}) scale(${r / 22})`}>
      {!bare && <circle r="22" fill={skin[0]} stroke={skin[1]} strokeWidth={edge} />}
      {blush && <><circle cx="-13.5" cy="5" r="3.7" fill="#ff7a90" opacity=".5" /><circle cx="13.5" cy="5" r="3.7" fill="#ff7a90" opacity=".5" /></>}
      {eyesOf(eyes)}{mouthOf(mouth)}{more}
    </g>
  );
}

const S = (id: string, emoji: string, name: string, occasion: OccasionId, art: ReactNode): StickerDef => ({ id, emoji, name, occasion, art, smiley: true });
const CONFETTI: [number, number, string][] = [[9, 11, '#ff5d8f'], [21, 5, '#5fd0ff'], [35, 7, '#ffd166'], [48, 5, '#7be495'], [57, 15, '#ff9d2e'], [6, 25, '#9b7bff']];

export const SMILEYS: StickerDef[] = [
  // ── Halloween ──
  S('vamp', '🧛', 'Vampire', 'halloween', <g className="st-bob">
    <path d="M2 63 L9 36 L29 60 Z M62 63 L55 36 L35 60 Z" fill="#2b2540" /><path d="M7 62 L11 44 L26 60 Z M57 62 L53 44 L38 60 Z" fill="#b3203a" />
    <Face skin={['#ece7f7', '#c9c2e0']} y={34} r={21} mouth="fangs" more={<>
      <path d="M-21.8 -3 A22 22 0 0 1 21.8 -3 C18 -10 11 -13.4 4.6 -12.8 L0 -6 L-4.6 -12.8 C-11 -13.4 -18 -10 -21.8 -3 Z" fill="#2b2540" />
      <path d="M-12.5 -10.5 L-5 -8.4 M12.5 -10.5 L5 -8.4" stroke={INK} strokeWidth="2" strokeLinecap="round" /></>} /></g>),
  S('witch', '🧙', 'Witch', 'halloween', <g className="st-wobble">
    <Face y={41} r={19} eyes="wink" blush />
    <ellipse cx="32" cy="23" rx="26" ry="5.6" fill="#4a3b78" /><path d="M19 23 C22 12 28 6 42 2 C37 9 42 16 45 23 Z" fill="#5b4a94" />
    <path d="M20.2 18.6 H43.4 L45 23 H19 Z" fill="#ff9d2e" /><rect x="28.8" y="17.6" width="6.4" height="5.6" rx="1" fill="none" stroke="#ffe27a" strokeWidth="1.7" /></g>),
  S('boo', '😱', 'Spooked', 'halloween', <g className="st-wobble">
    <Face y={32} r={23} eyes="wide" mouth="yawn" more={<path d="M-13 -13.5 Q-8.5 -17 -4 -13 M13 -13.5 Q8.5 -17 4 -13" {...line} strokeWidth={2} />} />
    <ellipse cx="12" cy="47" rx="5" ry="7.4" fill={HAND} stroke={HAND_EDGE} strokeWidth="1.4" transform="rotate(-20 12 47)" /><ellipse cx="52" cy="47" rx="5" ry="7.4" fill={HAND} stroke={HAND_EDGE} strokeWidth="1.4" transform="rotate(20 52 47)" /></g>),
  S('zombie', '🧟', 'Zombie', 'halloween', <g className="st-wobble">
    <Face skin={['#a8d67f', '#73ad55']} eyes="none" mouth="none" more={<>
      <ellipse cx="-12" cy="11" rx="4" ry="2.8" fill="#8cc267" /><ellipse cx="13" cy="-13" rx="3.4" ry="2.4" fill="#8cc267" />
      <circle cx="-8" cy="-4" r="5.8" fill="#fff" /><circle cx="-8" cy="-3.4" r="2.7" fill={INK} /><circle cx="8.5" cy="-3" r="3.5" fill="#fff" /><circle cx="8.5" cy="-3" r="1.7" fill={INK} />
      <path d="M-9 9.5 Q-4.5 6.5 0 9.5 T9 9.5" {...line} strokeWidth={2.4} /><rect x="-5.4" y="9" width="3.6" height="4.2" rx=".8" fill="#fff" stroke={INK} strokeWidth=".8" />
      <path d="M-15 -14 L-5 -16.5 M-13 -16.6 L-12.2 -11.8 M-9.6 -17.6 L-8.8 -12.8 M-6.2 -18.4 L-5.4 -13.6" stroke="#4e7d3a" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>} /></g>),
  S('mummy', '🤕', 'Mummy', 'halloween', <g className="st-bob">
    <path d="M51 45 C57 47 59 53 56 59" fill="none" stroke="#cfc4a8" strokeWidth="5.4" strokeLinecap="round" /><path d="M51 45 C57 47 59 53 56 59" fill="none" stroke="#f4eedf" strokeWidth="3.4" strokeLinecap="round" />
    <Face skin={['#f4eedf', '#cfc4a8']} eyes="none" mouth="none" more={<>
      <path d="M-18.5 -12.5 L14 -18 M-21.5 4 L21.8 1.5 M-20.5 9.5 L20.5 8 M-16 15.5 L17.5 14 M-12 -18.5 L18.5 -12.5" stroke="#cfc4a8" strokeWidth="1.5" fill="none" />
      <rect x="-17.5" y="-10.5" width="35" height="10.5" rx="5.2" fill="#3a3350" />
      <circle cx="-8" cy="-5.2" r="3.7" fill="#ffd166" /><circle cx="8" cy="-5.2" r="3.7" fill="#ffd166" /><circle cx="-8" cy="-5.2" r="1.6" fill={INK} /><circle cx="8" cy="-5.2" r="1.6" fill={INK} />
      <path d="M-5.5 9.5 Q0 13.5 5.5 9.5" {...line} strokeWidth={2.2} /></>} /></g>),
  S('cat', '🐱', 'Black cat', 'halloween', <g className="st-bob">
    <path d="M10 27 L12 6 L29 17 Z M54 27 L52 6 L35 17 Z" fill="#3a3350" stroke="#2b2540" strokeWidth="1.4" strokeLinejoin="round" /><path d="M14.5 20 L15.5 11.5 L22.5 16 Z M49.5 20 L48.5 11.5 L41.5 16 Z" fill="#ff8fb1" />
    <Face skin={['#3a3350', '#2b2540']} y={37} r={21} eyes="none" mouth="none" more={<>
      <ellipse cx="-8" cy="-3" rx="5.2" ry="5.8" fill="#ffd23f" /><ellipse cx="8" cy="-3" rx="5.2" ry="5.8" fill="#ffd23f" /><ellipse cx="-8" cy="-3" rx="1.6" ry="4.6" fill="#1d1830" /><ellipse cx="8" cy="-3" rx="1.6" ry="4.6" fill="#1d1830" />
      <path d="M-2.6 5.4 H2.6 L0 8.6 Z" fill="#ff8fb1" /><path d="M0 8.6 C-1 12.4 -5 12.6 -6.2 10.4 M0 8.6 C1 12.4 5 12.6 6.2 10.4" fill="none" stroke="#d9d7ea" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M-11.5 7 L-20.5 5 M-11.5 10 L-20.5 12 M11.5 7 L20.5 5 M11.5 10 L20.5 12" stroke="#d9d7ea" strokeWidth="1.1" strokeLinecap="round" /></>} /></g>),

  // ── Diwali ──
  S('glow', '😊', 'Festive glow', 'diwali', <>
    <circle className="st-twinkle" cx="32" cy="33" r="30" fill="#ffd166" opacity=".4" />
    <g className="st-bob"><Face y={33} r={21} eyes="happy" blush /></g>
    {spark(8, 11, 6)}{spark(56, 13, 5, '#ff9d2e')}{spark(55, 55, 4.4)}{spark(8, 53, 3.8, '#ff9d2e')}</>),
  S('tilak', '😁', 'Tilak grin', 'diwali', <g className="st-bob">
    <Face x={30} y={34} r={22} eyes="happy" mouth="grin" blush more={<path d="M0 -18.6 C2.6 -15 3 -12.4 0 -10.2 C-3 -12.4 -2.6 -15 0 -18.6 Z" fill="#d7263d" />} />
    {flower(53, 14, 8, '#ff9d2e', '#d9480f')}{flower(57, 27, 5.4, '#ffc21f', '#f08c00')}</g>),
  S('sparkly', '🤩', 'Sparkler fun', 'diwali', <>
    <g className="st-bob"><Face x={26} y={39} r={19} eyes="star" mouth="open" /></g>
    <line x1="47" y1="61" x2="53" y2="25" stroke="#9aa0ad" strokeWidth="2.6" strokeLinecap="round" />{hand(46.5, 55)}
    <g className="st-pop">{rays(53.5, 19, 4, 12, ['#ffd166', '#fff1a8', '#ff9d2e'], 12, 2.4)}</g><circle className="st-twinkle" cx="53.5" cy="19" r="3.6" fill="#fff6c9" /></>),
  S('namaste', '🙏', 'Namaste', 'diwali', <g className="st-bob">
    <Face y={26} r={20} eyes="shut" blush more={<circle cx="0" cy="-13.5" r="2.2" fill="#d7263d" />} />
    <path d="M32 40.5 C28 44 25.5 50 25.5 58 H32 Z" fill={HAND} stroke={HAND_EDGE} strokeWidth="1.5" strokeLinejoin="round" /><path d="M32 40.5 C36 44 38.5 50 38.5 58 H32 Z" fill={HAND} stroke={HAND_EDGE} strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M22.5 57 H32 V64 H21 Z" fill="#ff9d2e" /><path d="M41.5 57 H32 V64 H43 Z" fill="#e8741c" /></g>),
  S('mithai', '😋', 'Sweet treat', 'diwali', <g className="st-bob">
    <Face x={28} y={31} r={22} eyes="happy" mouth="yum" blush />
    <circle cx="50" cy="50" r="10" fill="#f59a23" stroke="#d97c0c" strokeWidth="1.4" /><circle cx="46" cy="47" r="1.5" fill="#ffe27a" /><circle cx="52.5" cy="45" r="1.5" fill="#fff1a8" /><circle cx="54.5" cy="52" r="1.5" fill="#ffe27a" /><circle cx="48" cy="54.5" r="1.5" fill="#fff1a8" /></g>),
  S('wow', '😮', 'Fireworks wow', 'diwali', <>
    <g className="st-pop">{rays(12, 13, 3, 10, ['#ff5d8f', '#ffd166', '#5fd0ff'], 10, 2.4)}</g>
    <g className="st-pop" style={{ animationDelay: '.6s' }}>{rays(52, 11, 3, 9, ['#9b7bff', '#7be495', '#ffd166'], 10, 2.4)}</g>
    <g className="st-bob"><Face y={40} r={20} eyes="wide" mouth="o" /></g></>),

  // ── Christmas ──
  S('santa', '🎅', 'Santa hat', 'christmas', <g className="st-wobble">
    <Face y={41} r={19} eyes="happy" mouth="grin" blush />
    <path d="M12 27 C12 12 24 4 35 5 C46 6 54 15 57 28 C53 22 48 21 46 27 Z" fill="#e23d4b" />
    <rect x="9" y="22" width="43" height="9" rx="4.5" fill="#fff" stroke="#e3dfe8" strokeWidth="1.2" /><circle cx="57" cy="31" r="5" fill="#fff" stroke="#e3dfe8" strokeWidth="1.2" /></g>),
  S('elf', '🧝', 'Elf', 'christmas', <g className="st-wobble">
    <path d="M14.5 38 L5.5 32.5 L13 46 Z M49.5 38 L58.5 32.5 L51 46 Z" fill={HAND} stroke={HAND_EDGE} strokeWidth="1.4" strokeLinejoin="round" />
    <Face y={42} r={19} eyes="wink" blush />
    <path d="M13 27 C17 14 27 8 46 4 C41 12 46 20 51 27 Z" fill="#2f9e5b" /><rect x="10" y="22" width="44" height="8" rx="4" fill="#e23d4b" /><circle cx="47" cy="5" r="3.7" fill="#ffd166" stroke="#e9b53a" strokeWidth="1" /></g>),
  S('deer', '🦌', 'Reindeer', 'christmas', <g className="st-bob">
    <path d="M23 25 C21 18 17 12 12 6 M19.4 15.8 L10.5 15 M16.4 10.6 L21 4 M41 25 C43 18 47 12 52 6 M44.6 15.8 L53.5 15 M47.6 10.6 L43 4" fill="none" stroke="#7a4a22" strokeWidth="3" strokeLinecap="round" />
    <ellipse cx="11" cy="31" rx="7" ry="4.4" fill="#b9773f" stroke="#8f5529" strokeWidth="1.4" transform="rotate(-25 11 31)" /><ellipse cx="53" cy="31" rx="7" ry="4.4" fill="#b9773f" stroke="#8f5529" strokeWidth="1.4" transform="rotate(25 53 31)" />
    <Face skin={['#b9773f', '#8f5529']} y={42} r={19} mouth="none" blush more={<>
      <ellipse cx="0" cy="10.5" rx="11" ry="8.4" fill="#ecd2b0" /><ellipse cx="0" cy="6" rx="4.4" ry="3.2" fill="#4a2b17" />
      <path d="M0 9.2 C-1 13.4 -5 13.8 -6.4 11.6 M0 9.2 C1 13.4 5 13.8 6.4 11.6" fill="none" stroke="#4a2b17" strokeWidth="1.8" strokeLinecap="round" /></>} /></g>),
  S('snowman', '⛄', 'Snowman', 'christmas', <g className="st-wobble">
    <Face skin={['#ffffff', '#cfe3f2']} y={41} r={20} mouth="none" blush more={<>
      <path d="M-1 1.5 L11.5 5 L-1 7.6 Z" fill="#ff9d2e" stroke="#e07a0c" strokeWidth=".8" strokeLinejoin="round" />
      {[[-9, 10.5], [-5, 13], [0, 14], [5, 13], [9, 10.5]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.5" fill={INK} />)}</>} />
    <rect x="14" y="18" width="36" height="5.4" rx="2.7" fill="#33285a" /><rect x="21" y="3" width="22" height="17" rx="2" fill="#33285a" /><rect x="21" y="13.4" width="22" height="4.6" fill="#e23d4b" /></g>),
  S('brr', '🥶', 'Brr', 'christmas', <g className="st-wobble">
    <path d="M12 33 C12 3 52 3 52 33" fill="none" stroke="#e23d4b" strokeWidth="4" strokeLinecap="round" />
    <Face skin={['#cfeaff', '#93c9ee']} y={32} r={20} mouth="none" more={<>
      <path d="M-12.5 -11 L-5 -12.6 M12.5 -11 L5 -12.6" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <rect x="-7.5" y="6" width="15" height="7.4" rx="2.2" fill="#fff" stroke={INK} strokeWidth="1.6" /><path d="M-2.5 6 V13.4 M2.5 6 V13.4 M-7.5 9.7 H7.5" stroke={INK} strokeWidth="1.1" /></>} />
    <circle cx="11.5" cy="34" r="7.6" fill="#f0525f" stroke="#c4263f" strokeWidth="1.4" /><circle cx="52.5" cy="34" r="7.6" fill="#f0525f" stroke="#c4263f" strokeWidth="1.4" />
    <path d="M14 47 C23 55 41 55 50 47 L53 54.5 C42 62.5 22 62.5 11 54.5 Z" fill="#2f9e5b" /><path d="M38 57 L47.5 54.5 L50 63 L41 64 Z" fill="#27894e" /><path d="M21 52 L19.5 59 M29 54.5 L28.5 61 M36 54.5 L36.5 61" stroke="#ffd166" strokeWidth="2" />
    {spark(7, 9, 4.4, '#9fd6ff')}{spark(58, 12, 3.4, '#9fd6ff')}</g>),
  S('angel', '😇', 'Angel', 'christmas', <g className="st-bob">
    <ellipse cx="9" cy="41" rx="8" ry="13.5" fill="#eef4ff" stroke="#bfd0ea" strokeWidth="1.4" transform="rotate(18 9 41)" /><ellipse cx="55" cy="41" rx="8" ry="13.5" fill="#eef4ff" stroke="#bfd0ea" strokeWidth="1.4" transform="rotate(-18 55 41)" />
    <Face y={39} r={20} eyes="happy" blush />
    <ellipse className="st-twinkle" cx="32" cy="10" rx="13" ry="4" fill="none" stroke="#ffc93a" strokeWidth="3.4" /></g>),

  // ── New Year ──
  S('party', '🥳', 'Party time', 'newyear', <g className="st-wobble">
    <Face x={29} y={41} r={19} eyes="happy" mouth="none" blush />
    <path d="M16 25 L30 1 L42 23 Z" fill="#9b7bff" /><path d="M21.6 17 L38 14.8 M25.8 9.8 L34 8.6" stroke="#ffd166" strokeWidth="3" strokeLinecap="round" /><ellipse cx="29" cy="24.4" rx="14.5" ry="3" fill="#ff5d8f" /><circle cx="30" cy="2.6" r="3.4" fill="#ff5d8f" />
    <path d="M31 47 L52 41.5 L53.4 47 L32.4 52 Z" fill="#5fd0ff" /><path d="M38 45.3 L39.3 50.3 M45 43.5 L46.3 48.6" stroke="#fff" strokeWidth="2" /><circle cx="57" cy="42.4" r="4.4" fill="none" stroke="#ff5d8f" strokeWidth="3" /><circle cx="31" cy="49.5" r="3" fill="#e9a820" />
    <circle cx="52" cy="14" r="2.4" fill="#ffd166" /><circle cx="58" cy="27" r="2" fill="#7be495" /><circle cx="8" cy="18" r="2.2" fill="#5fd0ff" /></g>),
  S('starry', '😎', 'Star glasses', 'newyear', <g className="st-bob">
    <Face y={33} r={23} eyes="none" mouth="grin" more={<><path d="M-3.5 -5.5 H3.5" stroke={INK} strokeWidth="2.2" />{star(-10, -5.5, 17, '#ff5d8f', INK)}{star(10, -5.5, 17, '#ff5d8f', INK)}</>} />
    {spark(8, 8, 4.6)}{spark(57, 9, 3.8, '#5fd0ff')}</g>),
  S('confetti', '🎊', 'Confetti', 'newyear', <>
    <g className="st-bob"><Face y={39} r={20} eyes="happy" mouth="open" blush /></g>
    {dots(CONFETTI, 2.5)}
    <path className="st-twinkle" d="M13 17 C16 14 14 11 17 9 M43 15 C46 13 45 10 48 9 M53 27 C56 26 56 23 59 22" stroke="#ff5d8f" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <rect x="27" y="11" width="5" height="3" rx="1" fill="#9b7bff" transform="rotate(25 29 12)" /><rect x="3" y="36" width="5" height="3" rx="1" fill="#7be495" transform="rotate(-20 5 37)" /></>),
  S('kiss', '😚', 'Midnight kiss', 'newyear', <g className="st-bob">
    <Face x={29} y={35} r={22} eyes="shut" mouth="kiss" blush />
    <path className="st-twinkle" d="M55 4 A9.5 9.5 0 1 0 61 19.5 A8 8 0 0 1 55 4 Z" fill="#ffd166" />{spark(47, 9, 3.2, '#fff1a8')}{spark(57, 50, 3.6)}</g>),
  S('yawn', '🥱', 'Midnight yawn', 'newyear', <g className="st-bob">
    <Face x={28} y={36} r={21} eyes="shut" mouth="yawn" />
    <path className="st-twinkle" d="M45 6 H54 L45 16 H54 M54 21 H60 L54 28 H60" fill="none" stroke="#7d6bd0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  S('midnite', '🕛', 'Almost midnight', 'newyear', <g className="st-wobble">
    <Face skin={['#ffffff', '#5b4a94']} edge={3.2} y={34} r={22} more={<>
      <path d="M0 -19 V-15.6 M19 0 H15.6 M0 19 V15.6 M-19 0 H-15.6" stroke="#5b4a94" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M0 1 V-14.5" stroke="#e23d4b" strokeWidth="2.2" strokeLinecap="round" /><path d="M0 1 L-2.8 -10" stroke={INK} strokeWidth="2.8" strokeLinecap="round" /><circle cx="0" cy="1" r="1.9" fill={INK} /></>} />
    {spark(7, 9, 5)}{spark(57, 10, 4, '#ff5d8f')}{spark(56, 56, 3.6, '#5fd0ff')}</g>),

  // ── Valentine's Day ──
  S('hearteye', '😍', 'Heart eyes', 'valentine', <g className="st-beat"><Face eyes="heart" mouth="grin" /></g>),
  S('blowkiss', '😘', 'Blowing a kiss', 'valentine', <>
    <g className="st-bob"><Face x={28} y={34} r={22} eyes="wink" mouth="kiss" blush /></g>
    <g className="st-beat">{heart(53, 43, 15)}</g></>),
  S('blush', '☺', 'Blushing', 'valentine', <g className="st-bob"><Face eyes="shut" more={<>
    <ellipse cx="-13" cy="5.5" rx="5.2" ry="3.7" fill="#ff7a90" opacity=".75" /><ellipse cx="13" cy="5.5" rx="5.2" ry="3.7" fill="#ff7a90" opacity=".75" />
    <path d="M-15 4 L-13.8 7 M-12.2 4 L-11 7 M11 4 L12.2 7 M13.8 4 L15 7" stroke="#e8324f" strokeWidth="1" strokeLinecap="round" /></>} /></g>),
  S('hug', '🤗', 'Heart hug', 'valentine', <g className="st-bob">
    <Face y={26} r={20} eyes="happy" blush />
    <g className="st-beat">{heart(32, 52, 25)}</g>{hand(19.5, 50)}{hand(44.5, 50)}</g>),
  S('hearts', '🥰', 'Hearts all round', 'valentine', <>
    <g className="st-bob"><Face y={37} r={21} eyes="happy" blush /></g>
    <g className="st-beat">{heart(10, 13, 13)}</g><g className="st-beat" style={{ animationDelay: '.3s' }}>{heart(54, 11, 11, '#ff6fa8')}</g><g className="st-beat" style={{ animationDelay: '.6s' }}>{heart(56, 52, 10)}</g></>),
  S('cupid', '💘', 'Cupid', 'valentine', <g className="st-bob">
    <path d="M7 59 L54 10" stroke="#b9773f" strokeWidth="2.6" strokeLinecap="round" /><path d="M7 59 L4.5 50.5 M7 59 L15.5 61 M11.5 54.5 L9 46.5 M11.5 54.5 L19.5 56.5" stroke="#ff6fa8" strokeWidth="2.2" strokeLinecap="round" />{heart(55, 9, 12)}
    <ellipse cx="10" cy="33" rx="7.6" ry="12" fill="#ffe6ee" stroke="#f3a3b8" strokeWidth="1.4" transform="rotate(20 10 33)" /><ellipse cx="54" cy="36" rx="7.6" ry="12" fill="#ffe6ee" stroke="#f3a3b8" strokeWidth="1.4" transform="rotate(-20 54 36)" />
    <Face y={37} r={19} eyes="wink" blush /></g>),

  // ── Easter ──
  S('ears', '🐇', 'Bunny ears', 'easter', <g className="st-hop">
    <ellipse cx="23" cy="15" rx="6" ry="14" fill="#fff" stroke="#e3dfe8" strokeWidth="1.6" transform="rotate(-9 23 15)" /><ellipse cx="41" cy="15" rx="6" ry="14" fill="#fff" stroke="#e3dfe8" strokeWidth="1.6" transform="rotate(9 41 15)" />
    <ellipse cx="23" cy="16" rx="2.6" ry="9.4" fill="#ffc2d4" transform="rotate(-9 23 16)" /><ellipse cx="41" cy="16" rx="2.6" ry="9.4" fill="#ffc2d4" transform="rotate(9 41 16)" />
    <Face y={44} r={18} blush more={<><rect x="-3.2" y="10.4" width="6.4" height="5.4" rx="1" fill="#fff" stroke={INK} strokeWidth="1" /><path d="M0 10.4 V15.8" stroke={INK} strokeWidth=".9" /></>} /></g>),
  S('chick', '🐣', 'Chick', 'easter', <g className="st-hop">
    <path d="M32 10 C30 6 31 3 33 1.5 M32 10 C35 7 38 7 39.5 5 M32 10 C28.5 8 25.5 8 24.5 6" fill="none" stroke="#f2b830" strokeWidth="2.4" strokeLinecap="round" />
    <Face skin={['#ffe066', '#f2b830']} y={31} r={21} mouth="none" blush more={<path d="M-4.6 5 L0 1.4 L4.6 5 L0 9.2 Z" fill="#ff9d2e" stroke="#e07a0c" strokeWidth=".8" strokeLinejoin="round" />} />
    <path d="M9 46 L15 40 L21 46 L26.5 40 L32 46 L37.5 40 L43 46 L49 40 L55 46 C55 55.5 45 62 32 62 C19 62 9 55.5 9 46 Z" fill="#fff" stroke="#e3dfe8" strokeWidth="1.6" strokeLinejoin="round" /></g>),
  S('flowers', '🌼', 'Flower crown', 'easter', <g className="st-bob">
    <Face y={40} r={20} eyes="happy" blush />
    <path d="M12 31 C16 16 48 16 52 31" fill="none" stroke="#4fb56c" strokeWidth="3.4" strokeLinecap="round" />
    {flower(13, 29, 6, '#ff8fb1')}{flower(21.5, 21, 6.4, '#ffffff')}{flower(32, 17.5, 7, '#b79bff')}{flower(42.5, 21, 6.4, '#ffffff')}{flower(51, 29, 6, '#ff8fb1')}</g>),
  S('eggface', '🥚', 'Painted egg', 'easter', <g className="st-wobble">
    <path d="M32 6 C44 6 52 24 52 38 C52 50 43 58 32 58 C21 58 12 50 12 38 C12 24 20 6 32 6 Z" fill="#d9c8ff" stroke="#b79bff" strokeWidth="1.4" />
    <path d="M17.5 23 L22.3 18 L27.1 23 L32 18 L36.9 23 L41.7 18 L46.5 23" fill="none" stroke="#ffd166" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" />
    <path d="M17.5 50 C25 55 39 55 46.5 50" fill="none" stroke="#ff8fb1" strokeWidth="3.4" strokeLinecap="round" /><circle cx="29" cy="12" r="1.8" fill="#fff" /><circle cx="36" cy="12.6" r="1.8" fill="#fff" />
    <Face bare y={37} r={15} blush /></g>),
  S('lamb', '🐑', 'Lamb', 'easter', <g className="st-hop">
    {[0, 40, 80, 120, 160, 200, 240, 280, 320].map(a => <circle key={a} cx={32 + Math.sin((a * Math.PI) / 180) * 17.5} cy={35 - Math.cos((a * Math.PI) / 180) * 17.5} r="9" fill="#fff" stroke="#e3dfe8" strokeWidth="1.4" />)}
    <ellipse cx="13" cy="36" rx="7" ry="4" fill="#f3d2c2" stroke="#e0b7a4" strokeWidth="1.2" transform="rotate(-24 13 36)" /><ellipse cx="51" cy="36" rx="7" ry="4" fill="#f3d2c2" stroke="#e0b7a4" strokeWidth="1.2" transform="rotate(24 51 36)" />
    <ellipse cx="32" cy="39" rx="14.5" ry="16" fill="#fbe9d7" stroke="#e8cdb5" strokeWidth="1.4" />
    <circle cx="25.5" cy="24" r="6.4" fill="#fff" stroke="#e3dfe8" strokeWidth="1.2" /><circle cx="38.5" cy="24" r="6.4" fill="#fff" stroke="#e3dfe8" strokeWidth="1.2" /><circle cx="32" cy="21.5" r="6.8" fill="#fff" stroke="#e3dfe8" strokeWidth="1.2" />
    <Face bare y={40} r={16} mouth="none" blush more={<><path d="M-3 5 H3 L0 8.6 Z" fill="#ff8fb1" /><path d="M0 8.6 C-1 12.2 -4.6 12.6 -6 10.6 M0 8.6 C1 12.2 4.6 12.6 6 10.6" {...line} strokeWidth={1.8} /></>} /></g>),

  // ── birthdays ──
  S('bday', '🥳', 'Party hat', 'birthday', <g className="st-wobble">
    <Face y={42} r={19} eyes="happy" mouth="grin" blush />
    <path d="M20 25 L32 2 L44 25 Z" fill="#5fd0ff" /><circle cx="29" cy="18" r="2" fill="#ff5d8f" /><circle cx="35.5" cy="20" r="2" fill="#ffd166" /><circle cx="32" cy="11" r="1.8" fill="#fff" />
    <ellipse cx="32" cy="25" rx="13.5" ry="3" fill="#ff5d8f" /><circle cx="32" cy="3" r="3.4" fill="#ffd166" />
    <circle cx="8" cy="20" r="2.2" fill="#ffd166" /><circle cx="56" cy="17" r="2.2" fill="#7be495" /><circle cx="53" cy="7" r="1.8" fill="#ff5d8f" /></g>),
  S('wish', '🕯', 'Make a wish', 'birthday', <>
    <g className="st-bob"><Face x={25} y={33} r={20} eyes="shut" mouth="none" blush more={<ellipse cx="9" cy="9.5" rx="3.3" ry="4.1" fill={MOUTH} />} /></g>
    <path className="st-twinkle" d="M39 40.5 H46 M40.5 45.5 H46" stroke="#9aa0ad" strokeWidth="1.9" strokeLinecap="round" />
    <rect x="47" y="57" width="16" height="5" rx="2.5" fill="#ffc2d4" /><rect x="52" y="39" width="6" height="19" rx="1.5" fill="#5fd0ff" /><path d="M52 46.5 L58 43.5 M52 53 L58 50" stroke="#fff" strokeWidth="1.8" />
    <g className="st-flick"><path d="M55.5 25 C60.5 29.5 60.5 35 57 38 C52.6 36 52 30 55.5 25 Z" fill="#ff9d2e" /><path d="M56.3 31 C58.3 33 58 35.8 56.8 37 C55 36 54.8 33.4 56.3 31 Z" fill="#fff1a8" /></g></>),
  S('crown', '👑', 'Birthday crown', 'birthday', <g className="st-wobble">
    <Face y={42} r={19} eyes="wink" blush />
    <path d="M14 27 L12 8 L22 17 L32 4 L42 17 L52 8 L50 27 Z" fill="#ffc93a" stroke="#e9a820" strokeWidth="1.4" strokeLinejoin="round" /><rect x="13.6" y="22.6" width="36.8" height="5.4" rx="2" fill="#f2b01c" />
    <circle cx="32" cy="16.4" r="2.7" fill="#e8324f" /><circle cx="21.5" cy="19.4" r="2" fill="#5fd0ff" /><circle cx="42.5" cy="19.4" r="2" fill="#5fd0ff" /></g>),
  S('yay', '🙌', 'Hooray', 'birthday', <>
    <g className="st-bob"><Face y={39} r={20} eyes="star" mouth="open" />{hand(8.5, 29, 5)}{hand(55.5, 29, 5)}</g>
    {dots([[14, 8, '#ff5d8f'], [27, 4, '#ffd166'], [40, 6, '#5fd0ff'], [51, 9, '#9b7bff'], [59, 20, '#7be495'], [4, 18, '#ff9d2e']], 2.4)}
    <path className="st-twinkle" d="M19 15 C22 13 21 10 24 9 M45 14 C48 13 48 10 51 9.5" stroke="#7be495" strokeWidth="2.2" fill="none" strokeLinecap="round" /></>),
  S('yum', '😋', 'Cake time', 'birthday', <g className="st-bob">
    <Face x={27} y={30} r={21} eyes="happy" mouth="yum" blush />
    <path d="M39 61 V49 L61 44.5 V61 Z" fill="#f7c58a" /><path d="M39 49 L61 44.5 V49.4 L39 53.6 Z" fill="#ffc2d4" /><path d="M39 57.4 L61 53.6" stroke="#fff6c9" strokeWidth="2.2" /><circle cx="50" cy="43.4" r="3.2" fill="#e8324f" /><path d="M50 40.4 C50.6 37.6 52.6 36.6 54 36.6" stroke="#3f9d5a" strokeWidth="1.6" fill="none" strokeLinecap="round" /></g>),
];
