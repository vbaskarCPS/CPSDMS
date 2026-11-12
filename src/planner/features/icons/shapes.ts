// src/planner/features/icons/shapes.ts — a few shapes the packs' drawings (packs.tsx) share: a heart, a four-point
// sparkle, a five-point star, a crescent moon, a leaf and a bow, each as the outline of an SVG path placed where it is
// wanted on the 24 × 24 grid. No React here.

const n = (v: number) => String(Math.round(v * 100) / 100);
const pt = (x: number, y: number) => `${n(x)} ${n(y)}`;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** A heart centred near (cx, cy): `r` is half its width; its tip is `r` below the centre. */
export function heart(cx: number, cy: number, r: number): string {
  const p = (x: number, y: number) => pt(cx + x * r, cy + y * r);
  return `M${p(0, 1)}C${p(-0.72, 0.47)} ${p(-1.06, 0.1)} ${p(-1.06, -0.3)}C${p(-1.06, -0.64)} ${p(-0.8, -0.9)} ${p(-0.5, -0.9)}C${p(-0.29, -0.9)} ${p(-0.11, -0.78)} ${p(0, -0.6)}`
    + `C${p(0.11, -0.78)} ${p(0.29, -0.9)} ${p(0.5, -0.9)}C${p(0.8, -0.9)} ${p(1.06, -0.64)} ${p(1.06, -0.3)}C${p(1.06, 0.1)} ${p(0.72, 0.47)} ${p(0, 1)}Z`;
}

/** A four-point sparkle, `r` from its centre to each tip. */
export function spark(cx: number, cy: number, r: number): string {
  const c = pt(cx, cy);
  return `M${pt(cx, cy - r)}Q${c} ${pt(cx + r, cy)}Q${c} ${pt(cx, cy + r)}Q${c} ${pt(cx - r, cy)}Q${c} ${pt(cx, cy - r)}Z`;
}

/** A five-point star: `R` to its tips, `r` to the notches between them. */
export function star(cx: number, cy: number, R: number, r = R * 0.42): string {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = rad(-90 + i * 36), d = i % 2 ? r : R; return pt(cx + d * Math.cos(a), cy + d * Math.sin(a)); });
  return `M${pts.join('L')}Z`;
}

/** A crescent moon: a disc of radius `R` with a bite out of it towards `open` (degrees: 0 = right, -90 = up).
 *  `bite` = the bite's radius and `off` = how far its centre sits from the moon's, both as a share of R. */
export function moon(cx: number, cy: number, R: number, open = -30, bite = 0.85, off = 0.62): string {
  const q = bite * R, d = off * R;
  const a = (R * R - q * q + d * d) / (2 * d), h = Math.sqrt(Math.max(0, R * R - a * a));
  const u = { x: Math.cos(rad(open)), y: Math.sin(rad(open)) }, v = { x: -u.y, y: u.x };
  const p1 = pt(cx + a * u.x + h * v.x, cy + a * u.y + h * v.y), p2 = pt(cx + a * u.x - h * v.x, cy + a * u.y - h * v.y);
  return `M${p1}A${n(R)} ${n(R)} 0 1 1 ${p2}A${n(q)} ${n(q)} 0 0 0 ${p1}Z`;
}

/** A point on a circle (degrees: 0 = right, 90 = down). */
export const at = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
/** The same point as "x y", for a path. */
export const on = (cx: number, cy: number, r: number, deg: number): string => pt(...at(cx, cy, r, deg));

/** A leaf growing from (x, y) towards `deg`, `len` long; `wide` is how far its sides bow out. */
export function leaf(x: number, y: number, deg: number, len: number, wide: number): string {
  const [tx, ty] = at(x, y, len, deg), [mx, my] = at(x, y, len / 2, deg), [sx, sy] = at(0, 0, wide, deg + 90);
  return `M${pt(x, y)}Q${pt(mx + sx, my + sy)} ${pt(tx, ty)}Q${pt(mx - sx, my - sy)} ${pt(x, y)}Z`;
}

/** A ribbon bow: two loops out from a knot at (x, y); `s` scales it (1 = loops about 5 wide each). */
export function bow(x: number, y: number, s = 1): string {
  const p = (dx: number, dy: number) => pt(x + dx * s, y + dy * s);
  return `M${p(0, 0)}C${p(-1.7, -3)} ${p(-5, -3.6)} ${p(-5.2, -1.6)}C${p(-5.4, 0.4)} ${p(-2.2, 0.8)} ${p(0, 0)}ZM${p(0, 0)}C${p(1.7, -3)} ${p(5, -3.6)} ${p(5.2, -1.6)}C${p(5.4, 0.4)} ${p(2.2, 0.8)} ${p(0, 0)}Z`;
}
