// src/planner/features/food/sway/tag.ts — keyword tagging of a food name against the sway lists. Pure.
import { EASE, GO, type SwayTag } from './lists';

/** "Cucumbers (no skin)" → ['cucumber'] ; "beef/steak" → ['beef', 'steak'] ; "Mrs. Dash seasoning" → ['mrs dash'] */
function keywords(entry: string): string[] {
  const base = entry.toLowerCase().replace(/\(.*?\)/g, '').replace(/[.]/g, '').trim();
  const parts = base.split('/').map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // drop generic trailing words so "Mrs Dash seasoning" matches "mrs dash" and "tortilla shells" matches "tortilla"
    const trimmed = p.replace(/\s+(seasoning|shells?|powder|water)$/i, m => (/powder|water/i.test(m) ? m : '')).trim();
    out.push(singular(trimmed));
  }
  return out;
}
const singular = (s: string) => s.replace(/ies$/, 'y').replace(/(ch|sh|x|s)es$/, '$1').replace(/([^s])s$/, '$1');

// more specific entries first, so "sweet potatoes" beats "potatoes" and "white rice" beats nothing
const EASE_KEYS = EASE.flatMap(keywords).sort((a, b) => b.length - a.length);
const GO_KEYS = GO.flatMap(keywords).sort((a, b) => b.length - a.length);

// things that look like a list item but mean the opposite
const GO_OVERRIDES: RegExp[] = [/\bblack coffee\b/, /\bwhite (rice|bread|pasta)\b/, /\bbasmati\b/, /\bjasmine rice\b/, /\bunsalted\b/, /\blow[- ]sodium\b/, /\bgreek yogurt\b/, /\bmrs\.? dash\b/, /\bcrystal light\b/];
const EASE_OVERRIDES: RegExp[] = [/\bbrown rice\b/, /\bwheat (pasta|bread)\b/, /\bwhole[- ]wheat\b/, /\bsweet potato/, /\bolive oil\b/, /\bevoo\b/, /\begg\b|\beggs\b/, /\bsoda\b|\bpop\b|\bcola\b/];

export function swayTag(name: string): SwayTag {
  const n = ' ' + singular(name.toLowerCase().replace(/[^a-z\s/-]/g, ' ').replace(/\s+/g, ' ').trim()) + ' ';
  if (GO_OVERRIDES.some(r => r.test(n))) return 'go';
  if (EASE_OVERRIDES.some(r => r.test(n))) return 'ease';
  const hit = (keys: string[]) => keys.some(k => k.length >= 3 && new RegExp(`(^|[\\s/-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s/-]|$)`).test(n));
  // longest wins: check which list has the longest matching key
  const best = (keys: string[]) => keys.find(k => k.length >= 3 && new RegExp(`(^|[\\s/-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s/-]|$)`).test(n)) || '';
  const g = best(GO_KEYS), e = best(EASE_KEYS);
  if (!g && !e) return 'neutral';
  if (g && e) return g.length >= e.length ? 'go' : 'ease';
  return hit(GO_KEYS) ? 'go' : 'ease';
}

/** Counts for a list of items. */
export function swayCounts(items: { sway?: SwayTag }[]): { go: number; ease: number; neutral: number } {
  const c = { go: 0, ease: 0, neutral: 0 };
  for (const i of items) c[i.sway || 'neutral']++;
  return c;
}
