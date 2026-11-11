// src/planner/features/look/apply.ts — puts a look on the page. looks.ts works out what a choice means; this file
// does the touching: the planner's colour variables on <html> (so every screen follows without knowing), the look's
// fonts from Google Fonts (only the ones on screen), and the background, which is a real element fixed behind
// everything (phones handle a fixed background-image badly) with its layers inside: wallpaper or the person's own
// picture, paper grain, a veil of the page colour, the corner scene, the strip along the top.
// Two things here are promises to the rest of the planner: <html data-look="woodland"> says which look is on (absent
// = the planner's own), and a "planner-look" event on window says the look on screen has just changed. The planner's
// own look with nothing chosen by hand leaves no trace: no inline variable, no attribute, no element.
import { FACES, LOOKS, OWN, bgPlan, facesFor, fontStack, fontUrl, lookVars, wearing, type BgLayer, type Choice, type FaceId, type LookPrefs, type PicSlot } from './looks';

const root = () => document.documentElement;
/** The variables this file has put on <html>, so taking a look off removes exactly those. */
const mine = new Set<string>();
/** What is on screen, as one line of text (null: nothing put on yet): the page is only touched, and the event only
 *  sent, when this changes. */
let onScreen: string | null = null;
let themeColorWas: string | null | undefined;   // the phone's status-bar colour before a look changed it (undefined: not touched)

/** planner.html puts a remembered look's page colour on <html> before anything is drawn (so there is no flash of the
 *  old colours while the app loads). Those settings become this file's to manage, and to take off again. */
export function adoptFirstPaint(): void {
  if (typeof document === 'undefined') return;
  for (const k of ['--bg', 'background-color', 'color-scheme']) if (root().style.getPropertyValue(k)) mine.add(k);
}

/** Which look the screen is wearing right now ('own' = the planner's own). */
export const lookOnScreen = (): Choice => (root().dataset.look as Choice | undefined) ?? OWN;

function setVars(vars: Record<string, string>): void {
  const style = root().style;
  for (const k of [...mine]) if (!(k in vars)) { style.removeProperty(k); mine.delete(k); }
  for (const [k, v] of Object.entries(vars)) { if (style.getPropertyValue(k) !== v) style.setProperty(k, v); mine.add(k); }
}
function flag(name: string, on: boolean, value = ''): void {
  if (on) { if (root().getAttribute(name) !== value) root().setAttribute(name, value); } else root().removeAttribute(name);
}

// ── fonts: one <link> per set of faces, added the first time a look needs it ──
const FONT_ATTR = 'data-look-fonts';
function loadFonts(ids: FaceId[]): void {
  const href = fontUrl(ids);
  if (!href || document.head.querySelector(`link[${FONT_ATTR}][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href; link.setAttribute(FONT_ATTR, '');
  document.head.appendChild(link);
}
function dropFonts(): void { document.head.querySelectorAll(`link[${FONT_ATTR}]`).forEach(l => l.remove()); }

/** The name a face goes by on the Studio's tiles. */
export const tileFace = (id: FaceId): string => `'Tile ${FACES[id].family}', ${fontStack(id)}`;
let tileFonts: Promise<void> | null = null;
/** The Studio's tiles each show a look's name in that look's own heading face. Only the letters needed are fetched
 *  (a few kilobytes for all of them), and they are filed under names of their own ("Tile Fondamento"), so a handful
 *  of letters never stands in for the whole face when that look is put on. If they can't be fetched the tiles read
 *  in a fallback face, and nothing else is affected. */
export function loadTileFonts(ids: FaceId[], text: string): Promise<void> {
  tileFonts ??= (async () => {
    try {
      const res = await fetch(fontUrl(ids, text));
      if (!res.ok) throw new Error(String(res.status));
      const css = (await res.text()).replace(/font-family:\s*(['"])([^'"]+)\1/g, (_m, q: string, name: string) => `font-family: ${q}Tile ${name}${q}`);
      const style = document.createElement('style');
      style.setAttribute('data-look-tile-fonts', '');
      style.textContent = css;
      document.head.appendChild(style);
    } catch { tileFonts = null; /* offline: try again the next time the Studio opens */ }
  })();
  return tileFonts;
}

// ── the background element ──
const BG = 'look-bg';
const PARTS = ['paper', 'grain', 'veil', 'corner', 'top'] as const;
function bgEl(make: boolean): HTMLElement | null {
  let el = document.querySelector<HTMLElement>(`body > .${BG}`);
  if (!el && make && document.body) {
    el = document.createElement('div');
    el.className = BG; el.setAttribute('aria-hidden', 'true');
    for (const p of PARTS) { const d = document.createElement('div'); d.className = `${BG}__${p}`; el.appendChild(d); }
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}
const part = (el: HTMLElement, p: (typeof PARTS)[number]) => el.querySelector<HTMLElement>(`.${BG}__${p}`)!;
function paint(el: HTMLElement, layers: BgLayer[]): void {
  el.style.backgroundImage = layers.map(l => l.image).join(', ');
  el.style.backgroundSize = layers.map(l => l.size).join(', ');
  el.style.backgroundRepeat = layers.map(l => l.repeat).join(', ');
  el.style.backgroundPosition = layers.map(l => l.position ?? '0 0').join(', ');
  el.hidden = !layers.length;
}

/** A picture of the person's own, for the slot the screen shows: its address once it is loaded. */
export type PictureOf = (slot: PicSlot) => string | null;

/**
 * Put on the page what `prefs` means for the screen at `pathname` (inside the app: '/food/add').
 * Safe to call as often as you like; it only touches what differs, and says "planner-look" when the look changed.
 */
export function applyLook(prefs: LookPrefs, pathname: string, picture: PictureOf = () => null): void {
  if (typeof document === 'undefined') return;
  const w = wearing(prefs, pathname);
  const look = w.id === OWN ? null : LOOKS[w.id];
  const vars = lookVars(look, prefs);
  const pic = w.pic ? { slot: w.pic, url: picture(w.pic), fit: prefs.pic.fit } : null;
  const plan = look ? bgPlan(look, prefs, !!pic) : null;

  // the background's own measures, for the rules in look.css (room for the strip above the first heading, room for
  // the corner scene under the last card, the bar's cut edge)
  if (plan?.top) vars['--look-top-h'] = `${plan.top.height}px`;
  if (plan?.corner) vars['--look-corner-h'] = `${plan.corner.height}px`;
  if (plan?.bar) Object.assign(vars, { '--look-bar-edge': plan.bar.image, '--look-bar-edge-h': `${plan.bar.height}px`, '--look-bar-edge-size': plan.bar.size });

  // nothing different from what is already on the page (most changes of screen): nothing to do
  const now = JSON.stringify([w.id, vars, pic && [pic.slot, pic.url, pic.fit], prefs.pic, prefs.bg]);
  if (now === onScreen && (!!document.querySelector(`body > .${BG}`) === (!!look || !!pic))) return;
  setVars(vars);
  if (look) root().dataset.look = look.id; else delete root().dataset.look;
  flag('data-look-hand', !look && Object.keys(vars).length > 0);   // shapes or type chosen by hand on the planner's own look
  flag('data-look-dark', look?.palette.scheme === 'dark');
  flag('data-look-bar', !!plan?.bar);
  flag('data-look-bg', !!look || !!pic);

  const faces = facesFor(look, prefs);
  if (faces.length) loadFonts(faces);
  else if (!look) dropFonts();

  // the background
  if (!look && !pic) bgEl(false)?.remove();
  else {
    const el = bgEl(true);
    if (el) {
      el.style.background = plan ? plan.base : 'var(--bg)';
      const paper = part(el, 'paper'), g = part(el, 'grain'), veil = part(el, 'veil'), corner = part(el, 'corner'), top = part(el, 'top');
      if (pic) {
        // their own picture: filling the screen, or repeated like a wallpaper
        paint(paper, pic.url ? [{ image: `url("${pic.url}")`, size: pic.fit === 'repeat' ? '180px auto' : 'cover', repeat: pic.fit === 'repeat' ? 'repeat' : 'no-repeat', position: pic.fit === 'repeat' ? '0 0' : 'center' }] : []);
      } else paint(paper, plan ? plan.paper : []);
      const strength = plan ? plan.paperOpacity : prefs.pic.strength / 100, bright = plan ? plan.brightness : prefs.pic.brightness / 100, over = plan ? plan.veil : prefs.pic.overlay / 100;
      paper.style.opacity = String(strength);
      paper.style.filter = bright === 1 ? '' : `brightness(${bright})`;
      paint(g, plan?.grain ? [plan.grain] : []);
      veil.style.opacity = String(over);
      veil.hidden = over <= 0;
      // the corner scene stands in a small clearing of the page colour, so the wallpaper doesn't show through it
      paint(corner, plan?.corner ? [{ ...plan.corner, position: 'right bottom' }, { image: 'radial-gradient(ellipse 52% 46% at 54% 64%, color-mix(in srgb, var(--bg) 78%, transparent) 0, color-mix(in srgb, var(--bg) 78%, transparent) 40%, transparent 100%)', size: '100% 100%', repeat: 'no-repeat' }] : []);
      if (plan?.top) {
        // the strip hangs from the top of the screen; on a phone its band of colour is stretched up behind the clock
        const t = plan.top;
        top.hidden = false;
        top.style.height = `calc(env(safe-area-inset-top, 0px) + ${t.height}px)`;
        top.style.background = `${t.image} left bottom / ${t.size} repeat-x${t.band ? `, linear-gradient(${t.color}, ${t.color}) left top / 100% calc(100% - ${t.height - t.band}px) no-repeat` : ''}`;
      } else { top.hidden = true; top.style.background = ''; }
    }
  }

  // the phone's status bar takes the page colour of the look (and goes back to the planner's own)
  const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    if (look) { if (themeColorWas === undefined) themeColorWas = meta.getAttribute('content'); meta.setAttribute('content', look.palette.bg); }
    else if (themeColorWas !== undefined) { if (themeColorWas === null) meta.removeAttribute('content'); else meta.setAttribute('content', themeColorWas); themeColorWas = undefined; }
  }

  const first = onScreen === null;
  onScreen = now;
  // the planner opening in its own look is not a change of look; everything else is
  if (!first || look || pic || Object.keys(vars).length) window.dispatchEvent(new Event('planner-look'));
}
