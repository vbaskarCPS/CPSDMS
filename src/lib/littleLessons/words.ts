// src/lib/littleLessons/words.ts — the sight words Little Lessons teaches, easiest first: the Dolch
// pre-primer, primer and first-grade lists (the standard early-reading lists), five new words a level.

export const PRE_PRIMER = [
  'I', 'a', 'the', 'see', 'go', 'me', 'my', 'up', 'we', 'is',
  'it', 'in', 'to', 'can', 'you', 'and', 'big', 'red', 'run', 'one',
  'two', 'not', 'for', 'look', 'come', 'down', 'help', 'here', 'jump', 'play',
  'said', 'blue', 'find', 'make', 'three', 'little', 'yellow', 'funny', 'where', 'away',
];
export const PRIMER = [
  'am', 'at', 'be', 'do', 'he', 'no', 'on', 'so', 'all', 'are',
  'ate', 'but', 'did', 'eat', 'get', 'new', 'now', 'our', 'out', 'ran',
  'saw', 'say', 'she', 'too', 'was', 'who', 'yes', 'came', 'four', 'good',
  'have', 'into', 'like', 'must', 'ride', 'soon', 'that', 'they', 'this', 'want',
  'well', 'went', 'what', 'will', 'with', 'black', 'brown', 'there', 'under', 'white',
  'please', 'pretty',
];
export const FIRST_GRADE = [
  'an', 'as', 'by', 'of', 'any', 'ask', 'fly', 'had', 'has', 'her',
  'him', 'his', 'how', 'let', 'may', 'old', 'put', 'after', 'again', 'could',
  'every', 'from', 'give', 'going', 'just', 'know', 'live', 'once', 'open', 'over',
  'round', 'some', 'stop', 'take', 'thank', 'them', 'then', 'think', 'walk', 'were',
  'when',
];

export const ALL_WORDS = [...PRE_PRIMER, ...PRIMER, ...FIRST_GRADE];
export const WORDS_PER_LEVEL = 5;
/** The words, five to a level. */
export const WORD_GROUPS: string[][] = Array.from({ length: Math.ceil(ALL_WORDS.length / WORDS_PER_LEVEL) },
  (_, i) => ALL_WORDS.slice(i * WORDS_PER_LEVEL, i * WORDS_PER_LEVEL + WORDS_PER_LEVEL));

/** Words that look alike (the hard wrong answers, once he's ready for them). */
const LOOK_ALIKE: string[][] = [
  ['the', 'then', 'them', 'they', 'there', 'this', 'that'], ['me', 'my', 'we'], ['to', 'go', 'so', 'too', 'two', 'no', 'do'],
  ['in', 'is', 'it', 'on', 'an', 'at', 'as'], ['up', 'us'], ['see', 'saw', 'she', 'say', 'said'], ['can', 'came', 'come'],
  ['and', 'an', 'any'], ['big', 'did', 'dig'], ['red', 'ran', 'run', 'ride'], ['look', 'like', 'live'], ['here', 'her', 'where', 'there'],
  ['was', 'saw', 'want', 'went', 'what', 'who'], ['he', 'her', 'his', 'him', 'has', 'had'], ['for', 'four', 'from', 'of'],
  ['will', 'well', 'walk', 'were', 'when'], ['now', 'not', 'no', 'new', 'know'], ['out', 'our', 'over'], ['play', 'please', 'pretty'],
  ['get', 'give', 'going', 'good'], ['take', 'think', 'thank'], ['open', 'once', 'one'],
];
export function lookAlikes(word: string): string[] {
  const out = new Set<string>();
  for (const g of LOOK_ALIKE) if (g.includes(word)) g.forEach(w => { if (w !== word && ALL_WORDS.includes(w)) out.add(w); });
  return [...out];
}
