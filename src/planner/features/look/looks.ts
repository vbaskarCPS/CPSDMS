// src/planner/features/look/looks.ts — the looks: 26 ways the whole planner can be dressed, and the working-out of
// what a choice means on a given screen. A look is its own colours (one set: a look is itself whatever the phone's
// light or dark setting), its own type, the shape of its cards and buttons, and a background drawn from art.ts.
// A person picks one for the whole planner and, if they like, a different one for any section; shapes and type can
// also be chosen by hand, and those hand choices work on the planner's own look too.
// No React and nothing from the browser here: apply.ts puts the result on the page. Tested in looks.test.ts.
import { barEdge, corner, cssUrl, grain, topEdge, wallpaper, type BarEdge, type TopEdge, type Wallpaper } from './art';

// ───────────────────────── the pieces a look is made of ─────────────────────────

/** Every colour the planner draws with (planner.css), by its variable name without the dashes. */
export interface Palette {
  scheme: 'light' | 'dark';
  bg: string; bg2: string; ink: string; ink2: string; line: string;
  accent: string; accentInk: string; amber: string; amber2: string;
}

/** A typeface from Google Fonts: the weights asked for, and what to read in if it can't be fetched. */
export interface Face {
  family: string; weights: number[]; stack: string; kind: 'display' | 'text' | 'hand';
  /** Its numbers are old-style (some dip below the line, a 0 like an o) or drawn for fun: fine in a heading, hard to
   *  read as a big figure on its own, so those are set in the text face (lookVars: --look-num-font). */
  oddFigures?: boolean;
  /** It joins some pairs of letters into one fancy shape ("oo") that is hard to read: the pairs are left apart. */
  joined?: boolean;
}
const SERIF = "Georgia, 'Times New Roman', serif", SANS = 'system-ui, -apple-system, sans-serif';
const ROUND = "ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif", HAND = "'Segoe Print', 'Bradley Hand', cursive";
const SCRIPT = "'Snell Roundhand', 'Apple Chancery', cursive";
export const FACES = {
  // headings
  fondamento: { family: 'Fondamento', weights: [400], stack: SERIF, kind: 'display', oddFigures: true },
  playfair: { family: 'Playfair Display', weights: [600, 700], stack: SERIF, kind: 'display', oddFigures: true },
  quicksand: { family: 'Quicksand', weights: [400, 500, 600, 700], stack: ROUND, kind: 'text' },
  christmas: { family: 'Mountains of Christmas', weights: [400, 700], stack: SERIF, kind: 'display', oddFigures: true },
  dmserif: { family: 'DM Serif Display', weights: [400], stack: SERIF, kind: 'display' },
  cormorant: { family: 'Cormorant Garamond', weights: [600, 700], stack: SERIF, kind: 'display', oddFigures: true },
  cinzel: { family: 'Cinzel', weights: [600, 700], stack: SERIF, kind: 'display' },
  josefin: { family: 'Josefin Sans', weights: [400, 600], stack: SANS, kind: 'display', oddFigures: true },
  bodoni: { family: 'Bodoni Moda', weights: [500, 700], stack: SERIF, kind: 'display' },
  marcellus: { family: 'Marcellus', weights: [400], stack: SERIF, kind: 'display', oddFigures: true },
  vollkorn: { family: 'Vollkorn', weights: [600, 700], stack: SERIF, kind: 'display', oddFigures: true },
  caslon: { family: 'Libre Caslon Display', weights: [400], stack: SERIF, kind: 'display', oddFigures: true },
  baskerville: { family: 'Libre Baskerville', weights: [400, 700], stack: SERIF, kind: 'display' },
  patrick: { family: 'Patrick Hand', weights: [400], stack: HAND, kind: 'display' },
  henny: { family: 'Henny Penny', weights: [400], stack: SERIF, kind: 'display', oddFigures: true, joined: true },
  almendra: { family: 'Almendra', weights: [400, 700], stack: SERIF, kind: 'display', oddFigures: true },
  raleway: { family: 'Raleway', weights: [500, 700], stack: SANS, kind: 'display', oddFigures: true },
  berkshire: { family: 'Berkshire Swash', weights: [400], stack: SERIF, kind: 'display', oddFigures: true },
  shrikhand: { family: 'Shrikhand', weights: [400], stack: SERIF, kind: 'display' },
  yeseva: { family: 'Yeseva One', weights: [400], stack: SERIF, kind: 'display' },
  fraunces: { family: 'Fraunces', weights: [500, 700], stack: SERIF, kind: 'display' },
  zilla: { family: 'Zilla Slab', weights: [600, 700], stack: SERIF, kind: 'display' },
  oswald: { family: 'Oswald', weights: [500, 600], stack: SANS, kind: 'display' },
  abril: { family: 'Abril Fatface', weights: [400], stack: SERIF, kind: 'display' },
  rajdhani: { family: 'Rajdhani', weights: [600, 700], stack: SANS, kind: 'display' },
  bitter: { family: 'Bitter', weights: [600, 700], stack: SERIF, kind: 'display' },
  // text: all easy to read at 14 to 16 px
  nunito: { family: 'Nunito', weights: [400, 500, 600, 700], stack: ROUND, kind: 'text' },
  lora: { family: 'Lora', weights: [400, 500, 600, 700], stack: SERIF, kind: 'text' },
  inter: { family: 'Inter', weights: [400, 500, 600, 700], stack: SANS, kind: 'text' },
  zenmaru: { family: 'Zen Maru Gothic', weights: [400, 500, 700], stack: ROUND, kind: 'text' },
  caslontext: { family: 'Libre Caslon Text', weights: [400, 700], stack: SERIF, kind: 'text' },
  // handwriting, for the small labels
  caveat: { family: 'Caveat', weights: [600, 700], stack: HAND, kind: 'hand' },
  dancing: { family: 'Dancing Script', weights: [600, 700], stack: SCRIPT, kind: 'hand' },
  parisienne: { family: 'Parisienne', weights: [400], stack: SCRIPT, kind: 'hand' },
  courgette: { family: 'Courgette', weights: [400], stack: SCRIPT, kind: 'hand' },
  kalam: { family: 'Kalam', weights: [400, 700], stack: HAND, kind: 'hand' },
  klee: { family: 'Klee One', weights: [400, 600], stack: HAND, kind: 'hand' },
} as const satisfies Record<string, Face>;
export type FaceId = keyof typeof FACES;
export const fontStack = (id: FaceId): string => `'${FACES[id].family}', ${FACES[id].stack}`;

/** How a look sets its type. */
export interface LookType {
  display: FaceId;            // headings (--serif)
  body: FaceId;               // everything else (--sans)
  hand?: FaceId;              // the small labels above headings, written by hand in some looks
  headWeight: number;         // a face with one weight is used as it is, never thickened by the browser
  headScale?: number;         // some faces run small or large at the same size
  headSpacing?: string;       // letter-spacing for headings
  headCaps?: boolean;         // headings in capitals
  labelSize?: number;         // the size of the hand-written labels, px
  labelInk?: boolean;         // a fine-lined hand needs the full ink colour to be read (the labels are otherwise greyer)
}

export const EDGES = ['hairline', 'bold', 'dashed', 'double', 'stitch', 'frame', 'none'] as const;
export type Edge = (typeof EDGES)[number];
export const SHADOWS = ['none', 'soft', 'lifted', 'pop', 'glow'] as const;
export type Shadow = (typeof SHADOWS)[number];
export interface LookShapes { card: number; button: number; edge: Edge; shadow: Shadow }

/** A look's background: wallpaper (one or two layers from art.ts), and what goes round it. */
export interface LookBg {
  paper: Wallpaper[];
  sky?: string[];                 // a soft wash of colour down the page, under the wallpaper
  grain?: number;                 // paper grain, 0 to 1
  strength: number;               // how visible the wallpaper is, 0 to 100, as the look has it
  overlay?: number;               // a veil of the page colour over it, 0 to 100
  top?: { kind: TopEdge; motif?: string; colors?: string[] };
  corner?: string[];              // the motifs of the little scene in the corner ("lemon@1": art.ts motifName)
  ground?: string;                // what the scene stands on, when not a tint of the look's first colour (snow)
  bar?: BarEdge;                  // the bottom bar's upper edge
}

export const LOOK_IDS = ['woodland', 'cottagecore', 'pastels', 'christmas', 'autumn', 'academia', 'celestial', 'minimal',
  'french', 'botanical', 'countryside', 'regency', 'coastal', 'spring', 'fairy', 'halloween', 'winter', 'mediterranean', 'retro70s', 'stationery', 'coquette',
  'lodge', 'harbour', 'whisky', 'graphite', 'expedition'] as const;
export type LookId = (typeof LOOK_IDS)[number];
/** The planner's own look: navy and gold for Vijay, plum and pink for Rosh, light or dark with the phone. */
export const OWN = 'own' as const;
export type Choice = LookId | typeof OWN;

export interface Look {
  id: LookId;
  name: string;            // as Rosh named it
  short: string;           // for a small tile
  blurb: string;           // a line of what it is, under the name on its tile
  group: 'main' | 'more';
  palette: Palette;
  art: string[];           // the colours of the drawings
  type: LookType;
  shapes: LookShapes;
  bg: LookBg;
}

// ───────────────────────── the 26 looks ─────────────────────────

const L = (bg: string, bg2: string, ink: string, ink2: string, line: string, accent: string, accentInk: string, amber: string, amber2: string): Palette => ({ scheme: 'light', bg, bg2, ink, ink2, line, accent, accentInk, amber, amber2 });
const D = (bg: string, bg2: string, ink: string, ink2: string, line: string, accent: string, accentInk: string, amber: string, amber2: string): Palette => ({ scheme: 'dark', bg, bg2, ink, ink2, line, accent, accentInk, amber, amber2 });

export const LOOKS: Record<LookId, Look> = {
  woodland: {
    id: 'woodland', name: 'Whimsical Woodland & Storybook', short: 'Woodland', group: 'main', blurb: 'Foxes, mushrooms, moss and cream',
    palette: L('#eef0e1', '#fcf9ef', '#33261a', '#5f4f3f', '#d6d8be', '#4a6741', '#fbf8ee', '#e3b1aa', '#8a4640'),
    art: ['#8fa67c', '#d79b9b', '#a67c5b', '#b0a0c6', '#6f8a5c'],
    type: { display: 'fondamento', body: 'nunito', hand: 'caveat', headWeight: 400, headScale: 1.04 },
    shapes: { card: 22, button: 16, edge: 'stitch', shadow: 'soft' },
    bg: { paper: [{ kind: 'scatter', motifs: ['mushroom', 'leaf', 'fox', 'flower', 'bunny', 'acorn', 'butterfly', 'sprig', 'bird', 'deer'] }], grain: 0.3, strength: 46, top: { kind: 'vine', motif: 'flower' }, corner: ['cottage', 'mushroom', 'bunny', 'butterfly'], bar: 'scallop' },
  },
  cottagecore: {
    id: 'cottagecore', name: 'Vintage Cottagecore', short: 'Cottagecore', group: 'main', blurb: 'Faded florals, lace and gingham',
    palette: L('#f6edda', '#fffaf0', '#47312a', '#6f574b', '#e4d4b9', '#a14a60', '#fff8f0', '#f0d98a', '#7a5f1c'),
    art: ['#d99aa5', '#a3b48a', '#e2c56f', '#94aec2', '#c08090'],
    type: { display: 'playfair', body: 'lora', hand: 'dancing', headWeight: 700, labelSize: 19 },
    shapes: { card: 12, button: 10, edge: 'frame', shadow: 'none' },
    bg: { paper: [{ kind: 'gingham', size: 26, fade: 0.36 }, { kind: 'scatter', motifs: ['rose', 'sprig', 'blossom', 'bow', 'lavender', 'teacup'] }], grain: 0.5, strength: 44, top: { kind: 'lace', colors: ['#e9c5c9', '#fffaf0'] }, corner: ['teacup', 'rose@0', 'bow', 'lavender'], bar: 'scallop' },
  },
  pastels: {
    id: 'pastels', name: 'Dreamy Pastels', short: 'Pastels', group: 'main', blurb: 'Bows, clouds and soft colour',
    palette: L('#fdf0f6', '#ffffff', '#43345c', '#6d5f88', '#f0dcea', '#7a55b0', '#ffffff', '#ffb7d0', '#a8366a'),
    art: ['#f5a9c6', '#c3aeec', '#a6cdf0', '#a8e0c8', '#ffc9a6'],
    type: { display: 'quicksand', body: 'nunito', headWeight: 700 },
    shapes: { card: 28, button: 999, edge: 'none', shadow: 'soft' },
    bg: { paper: [{ kind: 'scatter', motifs: ['bow', 'cloud', 'star', 'heart', 'flower', 'butterfly'] }], sky: ['#fdeaf3', '#f1eafb', '#e6f1fc'], strength: 50, top: { kind: 'bunting' }, corner: ['cloud', 'bow', 'heart', 'butterfly'], bar: 'scallop' },
  },
  christmas: {
    id: 'christmas', name: 'Vintage Christmas', short: 'Christmas', group: 'main', blurb: 'Cranberry, holly and red gingham',
    palette: L('#f6efe0', '#fffaf0', '#213328', '#4b5c50', '#e0d4bb', '#9a1f2e', '#fff6e4', '#dcb95c', '#775810'),
    art: ['#b12f3c', '#3d6a4e', '#cfa94e', '#2f5a40', '#c9424e'],
    type: { display: 'christmas', body: 'lora', headWeight: 700, headScale: 1.16 },
    shapes: { card: 16, button: 12, edge: 'double', shadow: 'soft' },
    bg: { paper: [{ kind: 'gingham', size: 30, fade: 0.5 }, { kind: 'scatter', motifs: ['holly', 'bauble', 'gingerbread', 'pine', 'bow', 'cane', 'mouse', 'gift'], across: 4, size: 300 }], grain: 0.4, strength: 38, top: { kind: 'garland', motif: 'holly', colors: ['#3d6a4e', '#b12f3c', '#cfa94e'] }, corner: ['cottage', 'pine', 'gift', 'gingerbread@2'], ground: '#ffffff', bar: 'scallop' },
  },
  autumn: {
    id: 'autumn', name: 'Autumn & Cozy Fall', short: 'Autumn', group: 'main', blurb: 'Pumpkins, plaid and warm paper',
    palette: L('#f4e8d3', '#fdf6e8', '#3a2212', '#684a33', '#e2cfae', '#a8481a', '#fff5e3', '#e6ab55', '#85500f'),
    art: ['#c9682a', '#8f8a45', '#d9a05b', '#9c5a3c', '#7d8446'],
    type: { display: 'dmserif', body: 'nunito', hand: 'kalam', headWeight: 400, headScale: 1.06, labelSize: 15 },
    shapes: { card: 14, button: 12, edge: 'stitch', shadow: 'soft' },
    bg: { paper: [{ kind: 'plaid', size: 84, fade: 0.5 }, { kind: 'scatter', motifs: ['maple', 'acorn', 'pumpkin', 'leaf', 'mushroom', 'candle'], across: 4, size: 300 }], grain: 0.5, strength: 42, top: { kind: 'garland', motif: 'maple' }, corner: ['pumpkin', 'candle', 'book', 'maple'] },
  },
  academia: {
    id: 'academia', name: 'Dark Academia & Vintage Library', short: 'Dark Academia', group: 'main', blurb: 'Old books, brass and candlelight',
    palette: D('#211812', '#2c2119', '#f1e4c9', '#c6b596', '#4b3a2c', '#c9a55a', '#211812', '#d8b56a', '#e2c686'),
    art: ['#8a3340', '#77733f', '#b08d4a', '#7a5a41', '#cdbb95'],
    type: { display: 'cormorant', body: 'lora', headWeight: 700, headScale: 1.18 },
    shapes: { card: 4, button: 4, edge: 'frame', shadow: 'none' },
    bg: { paper: [{ kind: 'scatter', motifs: ['book', 'quill', 'key', 'laurel', 'globe', 'fern', 'candle'] }], grain: 0.8, strength: 40, top: { kind: 'rule', motif: 'laurel', colors: ['#b08d4a', '#8a3340', '#77733f'] }, corner: ['globe@1', 'book@0', 'candle@1', 'key@2'] },
  },
  celestial: {
    id: 'celestial', name: 'Celestial & Whimsical Witchy', short: 'Celestial', group: 'main', blurb: 'Moons, moths and midnight blue',
    palette: D('#131230', '#1d1b44', '#efeaff', '#c4bce4', '#37346a', '#e2c275', '#17153a', '#e9cc86', '#f0d898'),
    art: ['#d1b267', '#8f84c4', '#6a4a8a', '#aea5dc'],
    type: { display: 'cinzel', body: 'quicksand', headWeight: 700, headScale: 0.92, headSpacing: '0.03em' },
    shapes: { card: 18, button: 999, edge: 'hairline', shadow: 'glow' },
    bg: { paper: [{ kind: 'stars' }, { kind: 'scatter', motifs: ['moon', 'planet', 'moth', 'crystal', 'sun', 'sparkle'], across: 4, size: 320, fade: 0.8 }], sky: ['#100f28', '#1a1540', '#291a49'], strength: 42, top: { kind: 'stars' }, corner: ['moon', 'crystal', 'moth@3', 'star'] },
  },
  minimal: {
    id: 'minimal', name: 'Elegant Minimalist', short: 'Minimalist', group: 'main', blurb: 'Cream, charcoal and room to breathe',
    palette: L('#f3efe8', '#fbf9f5', '#2a2927', '#68625a', '#e3ddd2', '#2f2e2b', '#f8f5ef', '#cdbda6', '#71624c'),
    art: ['#cfc5b5', '#b9ad9b', '#8f8577'],
    type: { display: 'josefin', body: 'inter', headWeight: 400, headScale: 0.82, headSpacing: '0.07em', headCaps: true },
    shapes: { card: 2, button: 2, edge: 'hairline', shadow: 'none' },
    bg: { paper: [], grain: 0.35, strength: 0 },
  },
  french: {
    id: 'french', name: 'French vintage romantic', short: 'French vintage', group: 'more', blurb: 'Ticking stripes, roses and script',
    palette: L('#f1ebe4', '#fcf8f2', '#37303d', '#675d6c', '#ded4c9', '#52668a', '#fcf8f2', '#e6bcb8', '#8a494e'),
    art: ['#8f9fb6', '#d7a9aa', '#c9b27c', '#b9b0a8'],
    type: { display: 'bodoni', body: 'lora', hand: 'parisienne', headWeight: 700, labelSize: 21, labelInk: true },
    shapes: { card: 8, button: 6, edge: 'double', shadow: 'none' },
    bg: { paper: [{ kind: 'stripes', size: 40, fade: 0.55, colors: ['#e2c0bf', '#8f9fb6'] }, { kind: 'scatter', motifs: ['rose', 'fleur', 'bow', 'key', 'lavender', 'cameo'], across: 4, size: 300 }], grain: 0.5, strength: 42, top: { kind: 'rule', motif: 'fleur', colors: ['#8f9fb6', '#c9b27c', '#d7a9aa'] }, corner: ['cameo@2', 'rose@1', 'fleur@2', 'lavender@0'] },
  },
  botanical: {
    id: 'botanical', name: 'Botanical garden', short: 'Botanical', group: 'more', blurb: 'Ferns, pots and garden green',
    palette: L('#ecf1e4', '#fcfdf8', '#1d3122', '#4a614f', '#d3dcc8', '#2d6943', '#f6fbf2', '#e3a784', '#86481f'),
    art: ['#5f8f63', '#8fb58a', '#3f7350', '#cf8a63', '#a9c48f'],
    type: { display: 'marcellus', body: 'nunito', hand: 'caveat', headWeight: 400 },
    shapes: { card: 10, button: 10, edge: 'hairline', shadow: 'soft' },
    bg: { paper: [{ kind: 'scatter', motifs: ['fern', 'leaf', 'sprig', 'olive', 'berry', 'tulip', 'pot', 'fern'], scale: 1.25, turn: 40 }], grain: 0.3, strength: 38, top: { kind: 'garland', motif: 'leaf' }, corner: ['pot@2', 'fern@0', 'tulip@3', 'butterfly@3'] },
  },
  countryside: {
    id: 'countryside', name: 'English countryside', short: 'Countryside', group: 'more', blurb: 'Wheat, sheep and village bunting',
    palette: L('#f3eedd', '#fdfaf0', '#2d3322', '#595e46', '#ddd6bd', '#566a37', '#fbf8ea', '#dcc078', '#735618'),
    art: ['#8a9a5b', '#d6bd7a', '#9db3bf', '#8b6b4a', '#a8574a'],
    type: { display: 'vollkorn', body: 'nunito', headWeight: 700 },
    shapes: { card: 10, button: 8, edge: 'hairline', shadow: 'soft' },
    bg: { paper: [{ kind: 'check', size: 48, fade: 0.6 }, { kind: 'scatter', motifs: ['wheat', 'sheep', 'daisy', 'bird', 'berry', 'cottage'], across: 4, size: 300 }], grain: 0.5, strength: 42, top: { kind: 'bunting', colors: ['#a8574a', '#d6bd7a', '#9db3bf', '#8a9a5b'] }, corner: ['sheep@1', 'cottage@4', 'wheat@1', 'bird@2'] },
  },
  regency: {
    id: 'regency', name: 'Regency-inspired elegance', short: 'Regency', group: 'more', blurb: 'Wedgwood blue, cameos and gilt',
    palette: L('#e7edf4', '#fbfcfd', '#212e48', '#535f78', '#d0d9e5', '#3c5c8c', '#ffffff', '#dac38e', '#6f571a'),
    art: ['#7f9cc0', '#f6f1e3', '#cdb67c', '#b9a9d6', '#a3b8d4'],
    type: { display: 'caslon', body: 'caslontext', headWeight: 400, headScale: 1.1 },
    shapes: { card: 8, button: 4, edge: 'frame', shadow: 'none' },
    bg: { paper: [{ kind: 'trellis', size: 52, colors: ['#7f9cc0', '#cdb67c'] }], grain: 0.3, strength: 40, top: { kind: 'swag', motif: 'bow', colors: ['#a3b8d4', '#7f9cc0', '#cdb67c'] }, corner: ['cameo@4', 'swan@1', 'rose@3', 'fan@2'] },
  },
  coastal: {
    id: 'coastal', name: 'Coastal grandmother', short: 'Coastal', group: 'more', blurb: 'Linen, shells and sea blue',
    palette: L('#f4f0e6', '#fffdf8', '#1b2d43', '#4e6076', '#ddd8c9', '#2b5983', '#ffffff', '#e6cfa4', '#785b25'),
    art: ['#6f93b5', '#dcc7a1', '#e0a08e', '#a3b59a'],
    type: { display: 'baskerville', body: 'inter', headWeight: 700, headScale: 0.94 },
    shapes: { card: 6, button: 6, edge: 'hairline', shadow: 'none' },
    bg: { paper: [{ kind: 'waves', size: 72, fade: 0.7 }, { kind: 'scatter', motifs: ['shell', 'starfish', 'anchor', 'sailboat', 'fish'], across: 4, size: 320 }], grain: 0.4, strength: 42, top: { kind: 'ripple', colors: ['#6f93b5', '#6f93b5'] }, corner: ['sailboat@1', 'shell@2', 'starfish@1', 'bird@1'], bar: 'wave' },
  },
  spring: {
    id: 'spring', name: 'Watercolour spring', short: 'Watercolour spring', group: 'more', blurb: 'Tulips and washes of colour',
    palette: L('#f3f8eb', '#ffffff', '#24402d', '#536c5c', '#dbe8d2', '#bf386a', '#ffffff', '#f6d860', '#7a5f00'),
    art: ['#f29bb8', '#a7d08c', '#f5dc7a', '#a9d3ee', '#cdb7e8'],
    type: { display: 'patrick', body: 'nunito', hand: 'caveat', headWeight: 400, headScale: 1.16 },
    shapes: { card: 24, button: 999, edge: 'none', shadow: 'soft' },
    bg: { paper: [{ kind: 'wash' }, { kind: 'scatter', motifs: ['tulip', 'daisy', 'butterfly', 'bee', 'blossom', 'bird'], across: 4, size: 320 }], strength: 50, top: { kind: 'vine', motif: 'blossom', colors: ['#a7d08c', '#f29bb8', '#f5dc7a'] }, corner: ['tulip@0', 'pot@1', 'bee@2', 'bird@3'], bar: 'wave' },
  },
  fairy: {
    id: 'fairy', name: 'Fairy garden', short: 'Fairy garden', group: 'more', blurb: 'Toadstools and lights at dusk',
    palette: D('#10241e', '#183228', '#f0f7e6', '#b3cab1', '#2d4b3e', '#f0b3e0', '#2a1230', '#f3e38a', '#f5eaa8'),
    art: ['#e9a6d8', '#8fd0a8', '#e6d57e', '#9fa8ee', '#6fae8a'],
    type: { display: 'henny', body: 'quicksand', hand: 'caveat', headWeight: 400, headScale: 1.06 },
    shapes: { card: 20, button: 16, edge: 'dashed', shadow: 'glow' },
    bg: { paper: [{ kind: 'scatter', motifs: ['mushroom', 'sparkle', 'butterfly', 'fern', 'flower', 'wand', 'star', 'bee'] }], sky: ['#0e211b', '#132a29', '#1c2340'], strength: 38, top: { kind: 'lights', colors: ['#f3e38a', '#e9a6d8', '#8fd0a8', '#6fae8a'] }, corner: ['mushroom@0', 'fern@4', 'wand@2', 'butterfly@3'], bar: 'scallop' },
  },
  halloween: {
    id: 'halloween', name: 'Halloween storybook', short: 'Halloween', group: 'more', blurb: 'Pumpkins, bats and a purple night',
    palette: D('#1b1423', '#271d32', '#f6ead8', '#c6b6c9', '#40304f', '#f39a3d', '#1b1423', '#f4e3a1', '#f7c98b'),
    art: ['#f08a2c', '#a9c95f', '#9a6fd0', '#dccfb8'],
    type: { display: 'almendra', body: 'nunito', headWeight: 700, headScale: 1.08 },
    shapes: { card: 12, button: 10, edge: 'dashed', shadow: 'none' },
    bg: { paper: [{ kind: 'scatter', motifs: ['bat', 'ghost', 'pumpkin', 'cat', 'moon', 'hat', 'web', 'candle'] }], grain: 0.6, strength: 36, top: { kind: 'drips', colors: ['#6a4496'] }, corner: ['pumpkin@0', 'hat@2', 'ghost@3', 'bat@2'], bar: 'zigzag' },
  },
  winter: {
    id: 'winter', name: 'Winter wonderland', short: 'Winter', group: 'more', blurb: 'Snowflakes, pines and ice blue',
    palette: L('#e8f1f8', '#ffffff', '#19314e', '#4d6682', '#cfdfec', '#2d6c9c', '#ffffff', '#cbd8e4', '#46627c'),
    art: ['#8fb8d8', '#d8a7b0', '#6f9cc4', '#ffffff', '#b7cfe2'],
    type: { display: 'raleway', body: 'inter', headWeight: 700, headScale: 0.96 },
    shapes: { card: 18, button: 12, edge: 'none', shadow: 'lifted' },
    bg: { paper: [{ kind: 'scatter', motifs: ['snow', 'pine', 'snow', 'snowman', 'snow', 'mitten', 'snow', 'deer', 'star'] }], sky: ['#e2edf7', '#ecf3fa', '#f5f7fb'], strength: 50, top: { kind: 'icicles', colors: ['#ffffff', '#b7cfe2'] }, corner: ['snowman@3', 'pine@2', 'mitten@1', 'snow@0'], ground: '#ffffff', bar: 'wave' },
  },
  mediterranean: {
    id: 'mediterranean', name: 'Summer Mediterranean', short: 'Mediterranean', group: 'more', blurb: 'Painted tiles, lemons and cobalt',
    palette: L('#f7f2e7', '#fffdf7', '#12305a', '#486083', '#e0dac8', '#1c5cbb', '#ffffff', '#f7d154', '#765900'),
    art: ['#3f77c9', '#f2cf4f', '#8f9a5a', '#d88560', '#9cc4e8'],
    type: { display: 'berkshire', body: 'nunito', hand: 'courgette', headWeight: 400, labelSize: 15.5 },
    shapes: { card: 14, button: 12, edge: 'bold', shadow: 'none' },
    bg: { paper: [{ kind: 'tiles', size: 64 }], strength: 30, top: { kind: 'garland', motif: 'lemon@1', colors: ['#8f9a5a', '#f2cf4f', '#8f9a5a', '#d88560'] }, corner: ['lemon@1', 'pot@2', 'sun@1', 'fish@0'], bar: 'wave' },
  },
  retro70s: {
    id: 'retro70s', name: 'Retro 1970s', short: 'Retro 70s', group: 'more', blurb: 'Rainbows, mustard and orange',
    palette: L('#f6e7c8', '#fff6e0', '#3a1e0e', '#6c492d', '#e6cf9f', '#de6824', '#2a1206', '#f0b632', '#875800'),
    art: ['#e3a72f', '#d9622b', '#8a8f3c', '#7a4526'],
    type: { display: 'shrikhand', body: 'quicksand', headWeight: 400 },
    shapes: { card: 18, button: 999, edge: 'bold', shadow: 'pop' },
    bg: { paper: [{ kind: 'arches', size: 96 }], strength: 34, top: { kind: 'bands', colors: ['#d9622b', '#e3a72f', '#8a8f3c'] }, corner: ['rainbow', 'mushroom', 'daisy', 'sun'], bar: 'wave' },
  },
  stationery: {
    id: 'stationery', name: 'Japanese stationery-inspired', short: 'Stationery', group: 'more', blurb: 'Squared paper, tape and cranes',
    palette: L('#f6f1e6', '#fffdf8', '#32302d', '#68645d', '#ddd5c5', '#c43e2c', '#fffaf5', '#f4cf7c', '#775610'),
    art: ['#c3ccd4', '#eab7b0', '#8496bd', '#a9bb8a', '#e4c373'],
    type: { display: 'zenmaru', body: 'zenmaru', hand: 'klee', headWeight: 700, headScale: 0.96, labelSize: 14 },
    shapes: { card: 6, button: 6, edge: 'dashed', shadow: 'none' },
    bg: { paper: [{ kind: 'grid', size: 22, colors: ['#9db1c7'] }, { kind: 'scatter', motifs: ['crane', 'pencil', 'blossom', 'clip', 'envelope', 'fan'], across: 4, size: 320, fade: 0.85 }], grain: 0.4, strength: 46, top: { kind: 'tape', colors: ['#eab7b0', '#a9bb8a', '#ffffff', '#8496bd'] }, corner: ['crane@1', 'pencil@4', 'envelope@2', 'clip@2'], bar: 'zigzag' },
  },
  coquette: {
    id: 'coquette', name: 'Soft feminine coquette', short: 'Coquette', group: 'more', blurb: 'Bows, pearls and cherry pink',
    palette: L('#fdeef0', '#fffafa', '#482030', '#784e5e', '#f3d4da', '#bd2d56', '#ffffff', '#f1dcc9', '#9f304c'),
    art: ['#f3a7ba', '#d9667f', '#eccdb4', '#cf4d6f'],
    type: { display: 'yeseva', body: 'lora', hand: 'dancing', headWeight: 400, headScale: 0.98, labelSize: 19 },
    shapes: { card: 22, button: 999, edge: 'stitch', shadow: 'soft' },
    bg: { paper: [{ kind: 'dots', size: 26, fade: 0.6 }, { kind: 'scatter', motifs: ['bow', 'heart', 'cherries', 'pearls', 'swan', 'rose'], across: 4, size: 300 }], strength: 42, top: { kind: 'rule', motif: 'bow', colors: ['#f3a7ba', '#d9667f', '#f3a7ba'] }, corner: ['swan', 'bow', 'cherries', 'heart'], bar: 'scallop' },
  },
  // ── five for him (13 Nov) ──
  lodge: {
    id: 'lodge', name: 'Mountain lodge', short: 'Lodge', group: 'more', blurb: 'Pine, plaid and a fire going',
    palette: D('#172019', '#202b23', '#efe7d6', '#c2b9a3', '#36443a', '#d08a43', '#172019', '#d9a55a', '#e8c27e'),
    art: ['#4f7a5a', '#9a4e2e', '#d08a43', '#7c6448', '#5a6b52'],
    type: { display: 'zilla', body: 'nunito', headWeight: 700, headScale: 1.04 },
    shapes: { card: 10, button: 10, edge: 'stitch', shadow: 'soft' },
    bg: { paper: [{ kind: 'plaid', size: 96, fade: 0.55, colors: ['#3b4d3f', '#5a2f22', '#2a362d'] }, { kind: 'scatter', motifs: ['pine', 'deer', 'fox', 'acorn', 'leaf', 'pine'], across: 4, size: 300 }], grain: 0.6, strength: 40, top: { kind: 'zigzag', colors: ['#4f7a5a', '#9a4e2e'] }, corner: ['pine@0', 'deer@3', 'pine@0', 'fox@1'] },
  },
  harbour: {
    id: 'harbour', name: 'Navy harbour', short: 'Harbour', group: 'more', blurb: 'Rope, anchors and signal flags',
    palette: L('#eef1f4', '#ffffff', '#132338', '#475a70', '#d3dbe4', '#1e3a5f', '#ffffff', '#e0b04a', '#7a5a12'),
    art: ['#7f98b3', '#c9654f', '#d9b25a', '#9fb3c8'],
    type: { display: 'oswald', body: 'inter', headWeight: 600, headScale: 0.98, headSpacing: '0.04em', headCaps: true },
    shapes: { card: 6, button: 6, edge: 'double', shadow: 'none' },
    bg: { paper: [{ kind: 'stripes', size: 64, fade: 0.6, colors: ['#dfe6ee'] }, { kind: 'scatter', motifs: ['anchor', 'sailboat', 'star', 'fish', 'anchor', 'shell'], across: 4, size: 320 }], grain: 0.3, strength: 38, top: { kind: 'bunting', colors: ['#1e3a5f', '#b8432f', '#d9b25a'] }, corner: ['sailboat@0', 'anchor@1', 'fish@3', 'star@2'], bar: 'wave' },
  },
  whisky: {
    id: 'whisky', name: 'Whisky & oak', short: 'Whisky', group: 'more', blurb: 'Leather, brass and amber light',
    palette: D('#1d140e', '#281c14', '#f2e6d2', '#c8b59a', '#45331f', '#c98a2e', '#1d140e', '#d9a24a', '#e8bf74'),
    art: ['#7a4a26', '#c98a2e', '#5c2a1e', '#a5875c', '#3c2a1a'],
    type: { display: 'abril', body: 'lora', headWeight: 400, headScale: 1.0 },
    shapes: { card: 4, button: 4, edge: 'frame', shadow: 'lifted' },
    bg: { paper: [{ kind: 'stripes', size: 40, fade: 0.75, colors: ['#241912'] }, { kind: 'scatter', motifs: ['key', 'book', 'globe', 'candle', 'laurel'], across: 4, size: 320, fade: 0.8 }], grain: 0.9, strength: 36, top: { kind: 'rule', motif: 'key', colors: ['#c98a2e', '#7a4a26'] }, corner: ['globe@1', 'book@0', 'candle@1', 'key@1'] },
  },
  graphite: {
    id: 'graphite', name: 'Graphite & steel', short: 'Graphite', group: 'more', blurb: 'Charcoal, steel blue and clean lines',
    palette: D('#16181b', '#1f2226', '#eceff2', '#aeb4bb', '#33383e', '#5b9bd5', '#0f1215', '#c9d1d9', '#e3e8ed'),
    art: ['#3a4048', '#5b9bd5', '#8a939d'],
    type: { display: 'rajdhani', body: 'inter', headWeight: 700, headScale: 1.04, headSpacing: '0.06em', headCaps: true },
    shapes: { card: 3, button: 3, edge: 'hairline', shadow: 'none' },
    bg: { paper: [{ kind: 'grid', size: 48, fade: 0.4, colors: ['#2c3238'] }], grain: 0.2, strength: 45 },
  },
  expedition: {
    id: 'expedition', name: 'Expedition & field notes', short: 'Expedition', group: 'more', blurb: 'Maps, compasses and canvas',
    palette: L('#ece5d4', '#f8f3e6', '#2a2b1f', '#5c5a45', '#d6ccb3', '#556b2f', '#ffffff', '#c9a14a', '#6e5212'),
    art: ['#556b2f', '#8a6a3a', '#b5452b', '#6d7f8c', '#c9a14a'],
    type: { display: 'bitter', body: 'inter', headWeight: 700, headScale: 0.98 },
    shapes: { card: 8, button: 8, edge: 'dashed', shadow: 'soft' },
    bg: { paper: [{ kind: 'grid', size: 56, fade: 0.65, colors: ['#d9cfb6'] }, { kind: 'scatter', motifs: ['globe', 'pine', 'sun', 'key', 'bird', 'leaf'], across: 4, size: 320 }], grain: 0.55, strength: 40, top: { kind: 'tape', colors: ['#c9b98f', '#556b2f'] }, corner: ['globe@0', 'pine@0', 'bird@2', 'sun@4'] },
  },
};
/** The planner's own colours, as planner.css has them (a test keeps the two the same): for its tile in the Studio,
 *  which has to show them even while another look is on. */
export const OWN_PALETTES: Record<'navy' | 'plum', Record<'light' | 'dark', Palette>> = {
  navy: { light: L('#eef2ff', '#ffffff', '#101c3a', '#4a5578', '#d8def2', '#101c3a', '#eef2ff', '#ffd166', '#8a6200'), dark: D('#101c3a', '#182650', '#eef2ff', '#aab4d4', '#26355f', '#ffd166', '#101c3a', '#ffd166', '#ffe08a') },
  plum: { light: L('#fbf1f8', '#ffffff', '#3b1f5e', '#74598f', '#ecd9ea', '#5b2a86', '#fff0f7', '#ff6fa8', '#b8336a'), dark: D('#2a1545', '#382058', '#fdeef7', '#cdb5d9', '#4d2f6e', '#ff6fa8', '#2a1545', '#ff6fa8', '#ffa3c9') },
};
export const lookList = (group?: 'main' | 'more'): Look[] => LOOK_IDS.map(id => LOOKS[id]).filter(l => !group || l.group === group);
export const isLook = (v: unknown): v is LookId => typeof v === 'string' && (LOOK_IDS as readonly string[]).includes(v);

// ───────────────────────── colour sums ─────────────────────────

const rgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map(c => c + c).join('') : h; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)) as [number, number, number]; };
const lum = (hex: string): number => { const [r, g, b] = rgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** How well two colours stand apart, 1 to 21 (the usual contrast ratio: 4.5 is the least for small text, 7 is comfortable). */
export function contrast(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** `amount` (0 to 1) of `top` laid over `under`. */
export function mix(under: string, top: string, amount: number): string { const u = rgb(under), t = rgb(top); return `#${u.map((v, i) => Math.round(v + (t[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`; }

// ───────────────────────── what a person has chosen ─────────────────────────

/** The sections that can have a look of their own, by the first part of the path. */
export const SECTIONS = [
  { id: 'today', name: 'Today', first: '' },
  { id: 'plan', name: 'Plan', first: 'plan' },
  { id: 'calendar', name: 'Calendar', first: 'calendar' },
  { id: 'habits', name: 'Habits', first: 'habits' },
  { id: 'workout', name: 'Train', first: 'workout' },
  { id: 'food', name: 'Food', first: 'food' },
  { id: 'cycle', name: 'Cycle', first: 'cycle', morningOnly: true },   // Rosh's planner only
  { id: 'money', name: 'Money', first: 'money' },
  { id: 'shop', name: 'Shopping', first: 'shop' },
] as const;
export type Section = (typeof SECTIONS)[number]['id'];
/** The section a path belongs to (inside the app: '/food/add'); null for the menu pages and Settings, which wear the
 *  whole planner's look. */
export function sectionOf(pathname: string): Section | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return SECTIONS.find(s => s.first === first)?.id ?? null;
}

export const CARD_SHAPES = { soft: 24, rounded: 14, square: 2 } as const;
export const BUTTON_SHAPES = { pill: 999, rounded: 12, square: 2 } as const;
/** A slot a picture can be kept in: one for the whole planner, one for each section. */
export type PicSlot = 'all' | Section;

export interface LookPrefs {
  all: Choice;                                         // the whole planner
  sections: Partial<Record<Section, Choice>>;          // a section with its own (absent: same as the planner)
  bg: { strength: number | null; brightness: number | null; overlay: number | null; corner: boolean; strip: boolean };   // null: as the look has it
  pic: { strength: number; brightness: number; overlay: number; fit: 'fill' | 'repeat'; on: Partial<Record<PicSlot, string>> };   // on: slot → which picture (its id)
  shapes: { cards: 'look' | keyof typeof CARD_SHAPES; buttons: 'look' | keyof typeof BUTTON_SHAPES; edges: 'look' | Edge; shadows: 'look' | Shadow };
  type: { heading: 'look' | FaceId; text: 'look' | FaceId };
  at: string;                                          // when this was last changed: the newer of two copies wins
}
/** Nothing chosen: the planner as it always was. */
export const noPrefs = (): LookPrefs => ({
  all: OWN, sections: {},
  bg: { strength: null, brightness: null, overlay: null, corner: true, strip: true },
  pic: { strength: 100, brightness: 100, overlay: 62, fit: 'fill', on: {} },
  shapes: { cards: 'look', buttons: 'look', edges: 'look', shadows: 'look' },
  type: { heading: 'look', text: 'look' },
  at: '',
});

const pct = (v: unknown, lo: number, hi: number, or: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : or);
const pctOrNull = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
const oneOf = <T extends string>(v: unknown, all: readonly T[], or: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : or);
const choice = (v: unknown): Choice | null => (v === OWN ? OWN : isLook(v) ? v : null);
/** Whatever was saved (by an older version, another phone, or by hand), made safe to use: anything unknown falls back
 *  to "nothing chosen" for that one setting. */
export function cleanPrefs(raw: unknown): LookPrefs {
  const p = noPrefs(), r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  p.all = choice(r.all) ?? OWN;
  for (const s of SECTIONS) { const c = choice(obj(r.sections)[s.id]); if (c) p.sections[s.id] = c; }
  const bg = obj(r.bg), pic = obj(r.pic), sh = obj(r.shapes), ty = obj(r.type);
  p.bg = { strength: pctOrNull(bg.strength, 0, 100), brightness: pctOrNull(bg.brightness, 50, 150), overlay: pctOrNull(bg.overlay, 0, 90), corner: bg.corner !== false, strip: bg.strip !== false };
  p.pic = { strength: pct(pic.strength, 0, 100, 100), brightness: pct(pic.brightness, 50, 150, 100), overlay: pct(pic.overlay, 0, 90, 62), fit: pic.fit === 'repeat' ? 'repeat' : 'fill', on: {} };
  for (const slot of ['all', ...SECTIONS.map(s => s.id)] as PicSlot[]) { const v = obj(pic.on)[slot]; if (typeof v === 'string' && v) p.pic.on[slot] = v.slice(0, 40); }
  p.shapes = {
    cards: oneOf(sh.cards, ['look', 'soft', 'rounded', 'square'] as const, 'look'), buttons: oneOf(sh.buttons, ['look', 'pill', 'rounded', 'square'] as const, 'look'),
    edges: oneOf(sh.edges, ['look', ...EDGES] as const, 'look'), shadows: oneOf(sh.shadows, ['look', ...SHADOWS] as const, 'look'),
  };
  const faces = Object.keys(FACES) as FaceId[];
  p.type = { heading: oneOf(ty.heading, ['look', ...faces] as const, 'look'), text: oneOf(ty.text, ['look', ...faces] as const, 'look') };
  p.at = typeof r.at === 'string' ? r.at : '';
  return p;
}
/** Has anything at all been chosen? (No: the planner is exactly as it always was.) */
export function isPlain(p: LookPrefs): boolean {
  return p.all === OWN && !Object.keys(p.sections).length && !Object.keys(p.pic.on).length
    && p.shapes.cards === 'look' && p.shapes.buttons === 'look' && p.shapes.edges === 'look' && p.shapes.shadows === 'look' && p.type.heading === 'look' && p.type.text === 'look';
}

/** What a screen wears: the look, and the picture behind it if there is one. A section with its own look shows that
 *  look's own background, not the whole planner's picture (unless the section has a picture of its own). */
export function wearing(p: LookPrefs, pathname: string): { id: Choice; section: Section | null; pic: PicSlot | null } {
  const section = sectionOf(pathname), own = section ? p.sections[section] : undefined;
  const pic: PicSlot | null = section && p.pic.on[section] ? section : p.pic.on.all && !own ? 'all' : null;
  return { id: own ?? p.all, section, pic };
}

// ───────────────────────── from a choice to what goes on the page ─────────────────────────

/** The line a card is edged with, and the extras some edges need (in the planner's own colour variables, so the
 *  same edge works on any look and on the planner's own). */
function edgeCss(edge: Edge): { border: string; outline: string; offset: string; inset: string; insetAccent: string } {
  const strong = 'color-mix(in srgb, var(--ink) 34%, var(--line))', soft = 'var(--line)';
  const none = { outline: 'none', offset: '0px', inset: '', insetAccent: '' };
  switch (edge) {
    case 'bold': return { ...none, border: '2px solid color-mix(in srgb, var(--ink) 82%, var(--bg-2))' };
    case 'dashed': return { ...none, border: `1.5px dashed ${strong}` };
    case 'double': return { ...none, border: `4px double ${strong}` };
    // a dashed line just inside the edge, like a row of stitches
    case 'stitch': return { border: `1px solid ${soft}`, outline: `1.5px dashed color-mix(in srgb, var(--accent) 42%, var(--line))`, offset: '-6px', inset: '', insetAccent: '' };
    // a second, finer line inside the first, like a picture frame
    case 'frame': return { ...none, border: `1px solid ${strong}`, inset: 'inset 0 0 0 3px var(--bg-2), inset 0 0 0 4px color-mix(in srgb, var(--amber-2) 55%, var(--line))', insetAccent: 'inset 0 0 0 3px var(--accent), inset 0 0 0 4px color-mix(in srgb, var(--accent-ink) 50%, transparent)' };
    case 'none': return { ...none, border: '1px solid transparent' };
    default: return { ...none, border: `1px solid ${soft}` };
  }
}
function shadowCss(shadow: Shadow): { card: string; button: string } {
  switch (shadow) {
    case 'soft': return { card: '0 1px 2px color-mix(in srgb, var(--ink) 7%, transparent), 0 8px 20px color-mix(in srgb, var(--ink) 8%, transparent)', button: '' };
    case 'lifted': return { card: '0 2px 4px color-mix(in srgb, var(--ink) 9%, transparent), 0 14px 30px color-mix(in srgb, var(--ink) 15%, transparent)', button: '0 2px 6px color-mix(in srgb, var(--ink) 16%, transparent)' };
    // a hard shadow set off to one side, like a 1970s poster
    case 'pop': return { card: '4px 4px 0 color-mix(in srgb, var(--ink) 86%, var(--bg-2))', button: '3px 3px 0 color-mix(in srgb, var(--ink) 86%, var(--bg-2))' };
    case 'glow': return { card: '0 0 0 1px color-mix(in srgb, var(--amber) 20%, transparent), 0 0 24px color-mix(in srgb, var(--amber) 16%, transparent)', button: '0 0 14px color-mix(in srgb, var(--accent) 34%, transparent)' };
    default: return { card: '', button: '' };
  }
}
const join = (...parts: string[]) => parts.filter(Boolean).join(', ') || 'none';

/** Shapes and type as they end up: the look's own, with anything chosen by hand in its place. */
export function settled(look: Look | null, p: LookPrefs): { shapes: Partial<LookShapes>; display?: FaceId; body?: FaceId; hand?: FaceId } {
  const s: Partial<LookShapes> = look ? { ...look.shapes } : {};
  if (p.shapes.cards !== 'look') s.card = CARD_SHAPES[p.shapes.cards];
  if (p.shapes.buttons !== 'look') s.button = BUTTON_SHAPES[p.shapes.buttons];
  if (p.shapes.edges !== 'look') s.edge = p.shapes.edges;
  if (p.shapes.shadows !== 'look') s.shadow = p.shapes.shadows;
  return { shapes: s, display: p.type.heading !== 'look' ? p.type.heading : look?.type.display, body: p.type.text !== 'look' ? p.type.text : look?.type.body, hand: look?.type.hand };
}

const paletteVars = (c: Palette): Record<string, string> => ({ '--bg': c.bg, '--bg-2': c.bg2, '--ink': c.ink, '--ink-2': c.ink2, '--line': c.line, '--accent': c.accent, '--accent-ink': c.accentInk, '--amber': c.amber, '--amber-2': c.amber2, 'color-scheme': c.scheme });

/** Every CSS variable to set on <html> for this look and these hand choices. Empty when nothing is chosen. */
export function lookVars(look: Look | null, p: LookPrefs): Record<string, string> {
  const v: Record<string, string> = {};
  if (look) {
    const c = look.palette, dark = c.scheme === 'dark';
    Object.assign(v, paletteVars(c));
    // the planner's green and red are picked for light paper; on a dark look they need to be lighter to be read.
    // The cycle tracker's two tints go by the phone's setting in cycle.css; a look says which it needs.
    Object.assign(v, dark ? { '--good': '#5cc9b9', '--bad': '#ff9086', '--cy-pink-2': 'rgba(232, 69, 122, 0.28)', '--cy-teal-2': 'rgba(26, 163, 154, 0.28)' }
      : { '--good': '#2a9d8f', '--bad': '#c0392b', '--cy-pink-2': '#fde2ea', '--cy-teal-2': '#d9f3f1' });
  }
  const s = settled(look, p);
  if (s.display) v['--serif'] = fontStack(s.display);
  if (s.body) v['--sans'] = fontStack(s.body);
  // headings: the look's own weight and size when its own face is in use; a face picked by hand is used as it comes
  if (s.display) {
    const own = look && p.type.heading === 'look' ? look.type : null, f = FACES[s.display];
    const heaviest = Math.max(...f.weights);
    v['--look-head-weight'] = String(own ? own.headWeight : heaviest >= 700 ? 700 : heaviest);
    v['--look-head-scale'] = String(own?.headScale ?? 1);
    v['--look-head-spacing'] = own?.headSpacing ?? (f.kind === 'display' ? '0' : '-0.01em');
    v['--look-head-caps'] = own?.headCaps ? 'uppercase' : 'none';
    // big figures on their own (a streak, a timer) are set in the text face when the heading face's numbers are odd
    if ('oddFigures' in f && f.oddFigures) v['--look-num-font'] = fontStack(s.body ?? 'inter');
    if ('joined' in f && f.joined) v['--look-liga'] = 'none';
  }
  if (look?.type.hand) {
    const h = look.type.hand, script = FACES[h].stack === SCRIPT;
    Object.assign(v, { '--look-label-font': fontStack(h), '--look-label-size': `${look.type.labelSize ?? 18}px`, '--look-label-weight': String(Math.max(...FACES[h].weights)), '--look-label-spacing': script ? '0.01em' : '0.02em', '--look-label-caps': 'none' });
    if (look.type.labelInk) v['--look-label-ink'] = 'var(--ink)';
  }
  const sh = s.shapes;
  if (sh.card !== undefined) {
    v['--radius'] = `${sh.card}px`;
    v['--look-inner-radius'] = `${Math.max(2, Math.min(16, Math.round(sh.card * 0.72)))}px`;   // the smaller boxes inside a card
    v['--look-sheet-radius'] = `${Math.max(2, Math.min(26, sh.card + 4))}px`;
  }
  if (sh.button !== undefined) {
    v['--look-btn-radius'] = `${sh.button}px`;
    v['--look-btn-radius-sm'] = `${Math.min(sh.button, sh.button > 20 ? 999 : 10)}px`;
    v['--look-field-radius'] = `${Math.min(sh.button, 18)}px`;       // a tall box with pill ends looks wrong
    v['--look-chip-radius'] = sh.button <= 8 ? `${sh.button}px` : '999px';
    v['--look-seg-radius'] = `${Math.min(sh.button, 14)}px`;
  }
  if (sh.edge !== undefined || sh.shadow !== undefined) {
    const e = edgeCss(sh.edge ?? 'hairline'), d = shadowCss(sh.shadow ?? 'none');
    v['--look-card-border'] = e.border;
    v['--look-card-outline'] = e.outline;
    v['--look-card-outline-offset'] = e.offset;
    v['--look-card-shadow'] = join(e.inset, d.card);
    v['--look-card-shadow-accent'] = join(e.insetAccent, d.card);
    v['--look-btn-shadow'] = d.button || 'none';
    v['--look-btn-border'] = sh.shadow === 'pop' ? '2px' : '1px';
    if (sh.shadow === 'pop') v['--look-btn-edge'] = 'color-mix(in srgb, var(--ink) 86%, var(--bg-2))';   // a filled button gets the poster's dark outline too
  }
  return v;
}

/** Every look-only variable there is. A tile in the Studio sets all of them (the ones its look doesn't use to
 *  "initial"), so it never borrows one from the look that happens to be on the page around it. */
export const LOOK_ONLY_VARS = ['--look-head-weight', '--look-head-scale', '--look-head-spacing', '--look-head-caps', '--look-num-font', '--look-liga', '--look-label-font', '--look-label-ink', '--look-label-size', '--look-label-weight', '--look-label-spacing', '--look-label-caps',
  '--look-inner-radius', '--look-sheet-radius', '--look-btn-radius', '--look-btn-radius-sm', '--look-field-radius', '--look-chip-radius', '--look-seg-radius',
  '--look-card-border', '--look-card-outline', '--look-card-outline-offset', '--look-card-shadow', '--look-card-shadow-accent', '--look-btn-shadow', '--look-btn-border', '--look-btn-edge'] as const;
/** The variables for one tile in the Studio: that look exactly as it comes, or the planner's own colours and type. */
export function tileVars(id: Choice, own: { theme: 'navy' | 'plum'; dark: boolean }): Record<string, string> {
  const v: Record<string, string> = Object.fromEntries(LOOK_ONLY_VARS.map(k => [k, 'initial']));
  if (id === OWN) return { ...v, ...paletteVars(OWN_PALETTES[own.theme][own.dark ? 'dark' : 'light']), '--serif': fontStack('fraunces'), '--sans': fontStack('inter'), '--radius': '16px' };
  return { ...v, ...lookVars(LOOKS[id], noPrefs()) };
}

/** The Google Fonts address for a set of faces (css2, each with its weights in rising order, text shown at once in a
 *  fallback and swapped when the face arrives). `text` asks for just those letters: a much smaller download. */
export function fontUrl(ids: FaceId[], text?: string): string {
  const fams = [...new Set(ids)].map(id => { const f = FACES[id]; return `family=${f.family.replace(/ /g, '+')}:wght@${[...f.weights].sort((a, b) => a - b).join(';')}`; });
  return fams.length ? `https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ''}` : '';
}
/** The faces a look and the hand choices need loaded. The planner's own two (Inter, Fraunces) are always there. */
export function facesFor(look: Look | null, p: LookPrefs): FaceId[] {
  const s = settled(look, p);
  return [...new Set([s.display, s.body, s.hand].filter((f): f is FaceId => !!f && f !== 'inter' && f !== 'fraunces'))];
}

/** One layer of the background, ready for CSS. */
export interface BgLayer { image: string; size: string; repeat: string; position?: string }
export interface BgPlan {
  base: string;                    // the page colour (with the look's wash of colour, when it has one)
  paper: BgLayer[];                // the wallpaper
  paperOpacity: number;            // 0 to 1: the strength slider
  brightness: number;              // 1 = as drawn
  grain: BgLayer | null;
  veil: number;                    // 0 to 1: the page colour laid back over it all
  top: (BgLayer & { height: number; band: number; color: string }) | null;
  corner: (BgLayer & { width: number; height: number }) | null;
  bar: (BgLayer & { height: number }) | null;
}
/** How strong the look's wallpaper is right now (the slider's value when it hasn't been moved). */
export const strengthOf = (look: Look | null, p: LookPrefs): number => p.bg.strength ?? look?.bg.strength ?? 0;
export const overlayOf = (look: Look | null, p: LookPrefs): number => p.bg.overlay ?? look?.bg.overlay ?? 0;
export const brightnessOf = (p: LookPrefs): number => p.bg.brightness ?? 100;

/** The look's background, layer by layer. `withPicture`: a picture of the person's own takes the wallpaper's place
 *  (apply.ts lays it in), and then the picture's own sliders are used. */
export function bgPlan(look: Look, p: LookPrefs, withPicture = false): BgPlan {
  const c = look.palette, b = look.bg, art = drawings(look);
  return {
    base: b.sky && !withPicture ? `linear-gradient(170deg, ${b.sky.join(', ')})` : c.bg,
    paper: withPicture ? [] : art.paper,
    paperOpacity: (withPicture ? p.pic.strength : strengthOf(look, p)) / 100,
    brightness: (withPicture ? p.pic.brightness : brightnessOf(p)) / 100,
    grain: withPicture ? null : art.grain,
    veil: (withPicture ? p.pic.overlay : overlayOf(look, p)) / 100,
    top: p.bg.strip ? art.top : null,
    corner: p.bg.corner ? art.corner : null,
    bar: art.bar,
  };
}
/** A look's drawings as CSS layers. Worked out once for each look and kept: they are the same at every change of
 *  screen and every nudge of a slider. */
const drawn = new Map<LookId, Pick<BgPlan, 'paper' | 'grain' | 'top' | 'corner' | 'bar'>>();
function drawings(look: Look): Pick<BgPlan, 'paper' | 'grain' | 'top' | 'corner' | 'bar'> {
  let d = drawn.get(look.id);
  if (!d) {
    const c = look.palette, b = look.bg, dark = c.scheme === 'dark';
    const g = b.grain ? grain(c.ink, b.grain * (dark ? 0.6 : 0.2), dark ? '#000000' : '#ffffff') : null;   // light specks on dark paper need more to be seen at all
    const t = b.top ? topEdge(b.top.kind, b.top.colors ?? look.art, b.top.motif) : null;
    const k = b.corner ? corner(b.corner, look.art, b.ground ?? mix(c.bg, look.art[0], 0.5)) : null;
    const e = b.bar && b.bar !== 'none' ? barEdge(b.bar, c.bg2, c.line) : null;
    d = {
      paper: b.paper.filter(w => w.kind !== 'none').map(w => { const tile = wallpaper(w, w.colors ?? look.art, c.bg); return { image: cssUrl(tile.svg), size: `${tile.size}px auto`, repeat: 'repeat' }; }).reverse(),   // CSS paints the first one on top
      grain: g ? { image: cssUrl(g.svg), size: `${g.size}px`, repeat: 'repeat' } : null,
      top: t && t.svg ? { image: cssUrl(t.svg), size: `${t.w}px ${t.h}px`, repeat: 'repeat-x', height: t.h, band: t.band, color: (b.top!.colors ?? look.art)[0] } : null,
      corner: k && k.svg ? { image: cssUrl(k.svg), size: `${k.w}px ${k.h}px`, repeat: 'no-repeat', width: k.w, height: k.h } : null,
      bar: e && e.svg ? { image: cssUrl(e.svg), size: `${e.w}px ${e.h}px`, repeat: 'repeat-x', height: e.h } : null,
    };
    drawn.set(look.id, d);
  }
  return d;
}
/** How many bytes of drawing a look's background comes to (everything it puts on the page). */
export function bgBytes(look: Look): number {
  const b = bgPlan(look, noPrefs());
  return [...b.paper, b.grain, b.top, b.corner, b.bar].reduce((n, l) => n + (l ? l.image.length : 0), 0);
}

/** What planner.html needs to colour the page before the app has loaded: the page colour (and light or dark) of the
 *  whole planner's look, and of each section that has its own, by the first part of its path ('' is Today).
 *  null = the planner's own colours. */
export interface FirstPaint { all: { bg: string; scheme: string } | null; sections: Record<string, { bg: string; scheme: string } | null> }
export function firstPaint(p: LookPrefs): FirstPaint {
  const of = (c: Choice) => (c === OWN ? null : { bg: LOOKS[c].palette.bg, scheme: LOOKS[c].palette.scheme });
  const sections: FirstPaint['sections'] = {};
  for (const s of SECTIONS) { const c = p.sections[s.id]; if (c) sections[s.first] = of(c); }
  return { all: of(p.all), sections };
}

// ───────────────────────── a picture of their own ─────────────────────────

/** The size to shrink a picture to: its long side no more than `max`, never made bigger. */
export function shrinkTo(w: number, h: number, max = 1400): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!(long > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / long);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
/** Roughly how many bytes a data: address holds (three bytes for every four letters after the comma). */
export const dataUrlBytes = (url: string): number => Math.floor((url.length - url.indexOf(',') - 1) * 0.75);
