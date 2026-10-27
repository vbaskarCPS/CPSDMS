// src/lib/memory/themes.ts — the Match card game dresses up for whichever big holiday is coming
// next (by the date in Toronto): Halloween until Oct 31, then Christmas, New Year, Valentine's,
// St. Patrick's, Easter, Canada Day and Thanksgiving. Each theme has 18 card pictures (a board uses
// up to 15), its colours, a card back and a few things floating in the background.

export type ThemeId = 'halloween' | 'christmas' | 'newyear' | 'valentines' | 'stpatricks' | 'easter' | 'canada' | 'thanksgiving';
export type Theme = {
  id: ThemeId; name: string; title: string; icon: string;
  bg: string; accent: string; back: string; backIcon: string; floaters: string[];
  pics: string[];   // exactly 18
};

export const THEMES: Record<ThemeId, Theme> = {
  halloween: {
    id: 'halloween', name: 'Halloween', title: 'Spooky Match', icon: '🎃',
    bg: 'radial-gradient(120% 80% at 50% 0%, #4c1d95 0%, #2e1065 45%, #0b0418 100%)', accent: '#fb923c',
    back: 'linear-gradient(145deg, #f97316, #9a3412)', backIcon: '🎃', floaters: ['🦇', '🦇', '👻', '🕸️'],
    pics: ['🎃', '👻', '🦇', '🕷️', '💀', '🧙', '🍬', '🕸️', '🧛', '🌕', '🐈‍⬛', '🔮', '🧟', '🍭', '⚰️', '🦉', '🧹', '🍫'],
  },
  christmas: {
    id: 'christmas', name: 'Christmas', title: 'Jingle Match', icon: '🎄',
    bg: 'radial-gradient(120% 80% at 50% 0%, #166534 0%, #14532d 45%, #052e16 100%)', accent: '#fca5a5',
    back: 'linear-gradient(145deg, #dc2626, #7f1d1d)', backIcon: '🎁', floaters: ['❄️', '❄️', '✨'],
    pics: ['🎅', '🎄', '⛄', '🎁', '🦌', '🔔', '🍪', '⭐', '🕯️', '🧦', '🤶', '❄️', '🛷', '🍬', '🥛', '🧤', '🎀', '🎶'],
  },
  newyear: {
    id: 'newyear', name: 'New Year', title: 'Countdown Match', icon: '🎆',
    bg: 'radial-gradient(120% 80% at 50% 0%, #1e3a8a 0%, #172554 45%, #020617 100%)', accent: '#fde047',
    back: 'linear-gradient(145deg, #eab308, #854d0e)', backIcon: '🎉', floaters: ['✨', '🎆', '🎇'],
    pics: ['🎆', '🥂', '🎉', '⏰', '🎇', '🍾', '🎊', '🎈', '🕛', '✨', '🌃', '🥳', '🎩', '🍇', '🗓️', '🎺', '🌠', '🍰'],
  },
  valentines: {
    id: 'valentines', name: "Valentine's", title: 'Sweetheart Match', icon: '💘',
    bg: 'radial-gradient(120% 80% at 50% 0%, #be185d 0%, #831843 45%, #2a0716 100%)', accent: '#fbcfe8',
    back: 'linear-gradient(145deg, #f472b6, #9d174d)', backIcon: '💖', floaters: ['💗', '💕', '💖'],
    pics: ['💘', '🌹', '🍫', '💌', '💝', '🧸', '💐', '🍓', '💍', '🦢', '🕊️', '🎀', '💋', '🧁', '🌷', '🍒', '🐞', '🦋'],
  },
  stpatricks: {
    id: 'stpatricks', name: "St. Patrick's", title: 'Lucky Match', icon: '☘️',
    bg: 'radial-gradient(120% 80% at 50% 0%, #15803d 0%, #14532d 45%, #03200f 100%)', accent: '#fde047',
    back: 'linear-gradient(145deg, #22c55e, #166534)', backIcon: '🍀', floaters: ['☘️', '🍀', '✨'],
    pics: ['☘️', '🍀', '🌈', '🪙', '🎩', '💚', '🥔', '🐍', '🌧️', '🏰', '🦄', '🎻', '🧚', '🐑', '🥧', '🍞', '⛰️', '🐸'],
  },
  easter: {
    id: 'easter', name: 'Easter', title: 'Egg Hunt Match', icon: '🐣',
    bg: 'radial-gradient(120% 80% at 50% 0%, #7c3aed 0%, #5b21b6 45%, #1e0b3d 100%)', accent: '#fef08a',
    back: 'linear-gradient(145deg, #a5f3fc, #6366f1)', backIcon: '🥚', floaters: ['🌸', '🌼', '🦋'],
    pics: ['🐣', '🥚', '🐰', '🌷', '🐞', '🧺', '🌸', '🐇', '🍫', '🥕', '🌼', '🐑', '🦋', '🌈', '🐝', '🍬', '🌱', '☀️'],
  },
  canada: {
    id: 'canada', name: 'Canada Day', title: 'True North Match', icon: '🍁',
    bg: 'radial-gradient(120% 80% at 50% 0%, #b91c1c 0%, #7f1d1d 45%, #250606 100%)', accent: '#fecaca',
    back: 'linear-gradient(145deg, #ffffff, #fecaca)', backIcon: '🍁', floaters: ['🍁', '🎆', '✨'],
    pics: ['🍁', '🦫', '🏒', '🥞', '🛶', '🏔️', '🐻', '🦆', '🎆', '🚂', '🌲', '🥌', '🐟', '⛺', '🦢', '🧇', '🏞️', '🐿️'],
  },
  thanksgiving: {
    id: 'thanksgiving', name: 'Thanksgiving', title: 'Harvest Match', icon: '🦃',
    bg: 'radial-gradient(120% 80% at 50% 0%, #b45309 0%, #78350f 45%, #1f0d02 100%)', accent: '#fde68a',
    back: 'linear-gradient(145deg, #f59e0b, #92400e)', backIcon: '🍂', floaters: ['🍂', '🍁', '🍂'],
    pics: ['🦃', '🥧', '🍂', '🌽', '🍁', '🍎', '🎃', '🥔', '🍗', '🌻', '🍇', '🥖', '🧺', '🍐', '🫐', '🌾', '🥕', '🍄'],
  },
};

/** Easter Sunday (month 1-12, day) — the Gregorian computus. */
export function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Canadian Thanksgiving: the second Monday of October. */
export function thanksgiving(y: number): number {
  const first = new Date(Date.UTC(y, 9, 1)).getUTCDay();   // 0 = Sunday
  const firstMonday = 1 + ((8 - first) % 7);
  return firstMonday + 7;
}

/** Today's date in Toronto: [year, month 1-12, day]. */
export function torontoDate(now = new Date()): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return [get('year'), get('month'), get('day')];
}

/** The theme for the next big holiday on or after this date. */
export function themeFor(y: number, mo: number, d: number): Theme {
  const md = mo * 100 + d;   // e.g. Oct 31 → 1031
  const [em, ed] = easter(y);
  const easterMonday = new Date(Date.UTC(y, em - 1, ed + 1));
  const eMon = (easterMonday.getUTCMonth() + 1) * 100 + easterMonday.getUTCDate();
  const thanks = 1000 + thanksgiving(y);
  const order: [number, ThemeId][] = [
    [106, 'newyear'], [214, 'valentines'], [317, 'stpatricks'], [eMon, 'easter'], [701, 'canada'],
    [thanks, 'thanksgiving'], [1031, 'halloween'], [1226, 'christmas'], [1231, 'newyear'],
  ];
  for (const [until, id] of order) if (md <= until) return THEMES[id];
  return THEMES.newyear;
}

export const currentTheme = (now = new Date()) => themeFor(...torontoDate(now));
