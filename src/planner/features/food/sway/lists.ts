// src/planner/features/food/sway/lists.ts — the "girl sway" food lists, transcribed from the chart Vijay
// shared (crossed-out items left out). GO = low sodium/potassium, higher calcium/magnesium foods; EASE =
// foods the sway diet asks to cut back on. A preference guide, not medical advice.
export type SwayTag = 'go' | 'ease' | 'neutral';

export const GO: string[] = [
  'chicken (no skin)', 'tofu', 'cheese', 'Greek yogurt', 'white bread', 'basmati rice', 'white rice', 'jasmine rice', 'white pasta',
  'cauliflower', 'cabbage', 'romaine lettuce', 'iceberg lettuce', 'cucumbers (no skin)', 'eggplant (no skin)', 'zucchini (no skin)',
  'green beans', 'low-fat cream cheese', 'tortilla shells (low sodium)', 'Mrs. Dash seasoning', 'unsalted butter', 'starfruit',
  'dragon fruit', 'pears (no skin)', 'strawberries', 'apples (no skin)', 'blueberries', 'water', 'Crystal Light', 'black coffee',
];

export const EASE: string[] = [
  'fresh tuna', 'beef/steak', 'salmon', 'whole eggs', 'ham', 'bacon', 'turkey', 'deli meat', 'sausage', 'peanut butter', 'avocados',
  'spinach', 'kale', 'collard greens', 'broccoli', 'asparagus', 'tomatoes', 'bell peppers', 'potatoes', 'sweet potatoes', 'carrots',
  'peas', 'beets', 'salt', 'garlic', 'EVOO', 'garlic powder', 'onion powder', 'turmeric', 'chili powder', 'Italian seasoning',
  'black pepper', 'hummus', 'pecans', 'potato chips', 'pretzels', 'chocolate', 'wheat pasta', 'chia seeds', 'buckwheat', 'brown rice',
  'millet', 'raisins', 'beef jerky', 'olives', 'bananas', 'watermelon', 'oranges', 'grapes', 'mangoes', 'cherries', 'pineapple',
  'banana peppers', 'dairy milk', 'oat milk', 'coconut milk', 'soda/pop', 'candy', 'ice cream', 'Gatorade', 'Body Armor', 'lemonade',
  'lemon water', 'lime water',
];

/** Easy swaps from an EASE item to a GO item (keyword → suggestion). */
export const SWAPS: { match: RegExp; swap: string }[] = [
  { match: /brown rice/i, swap: 'white or basmati rice' },
  { match: /wheat pasta|whole[- ]wheat/i, swap: 'white pasta' },
  { match: /\bsalt\b|salted/i, swap: 'Mrs. Dash' },
  { match: /spinach|kale|collard/i, swap: 'romaine or iceberg' },
  { match: /banana|orange/i, swap: 'strawberries, blueberries or pears' },
  { match: /\begg/i, swap: 'tofu or chicken' },
  { match: /dairy milk|\bmilk\b/i, swap: 'Greek yogurt' },
  { match: /evoo|olive oil/i, swap: 'unsalted butter' },
  { match: /soda|pop\b|cola|gatorade|body armor|lemonade/i, swap: 'water or Crystal Light' },
];

export function swapFor(name: string): string | null {
  const s = SWAPS.find(x => x.match.test(name));
  return s ? s.swap : null;
}

export const SWAY_NOTE = "Based on the popular 'sway diet' (low sodium/potassium, higher calcium/magnesium). Evidence is thin and mixed; treat it as a preference, keep eating balanced, and check with your doctor while trying.";
