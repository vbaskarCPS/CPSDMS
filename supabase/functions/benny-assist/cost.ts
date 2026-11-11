// supabase/functions/benny-assist/cost.ts — roughly what a question to the Benny cost, in US dollars.
// Anthropic's API prices per million tokens (platform.claude.com/docs/en/about-claude/pricing, November 2026):
//   input (in full) · input written to the prompt cache (5-minute) · input read from the cache · output.
// The Benny's prompts stay far under Haiku 5.5's 100,000-token step, so its lower prices apply.
// Pure (no Deno): the app's tests import it (src/v2/lib/bennyCost.test.ts).

/** What one go at a question was billed for, on one model (index.ts tallies it per step). */
export interface Tally { steps: number; input: number; cache_write: number; cache_read: number; output: number }
export interface Price { input: number; write: number; read: number; output: number }

const OPUS: Price = { input: 4, write: 5, read: 0.2, output: 20 };
const SONNET: Price = { input: 2, write: 2.5, read: 0.1, output: 10 };
const SONNET_5: Price = { input: 2, write: 2.5, read: 0.2, output: 10 };   // Sonnet 5 (not 5.5): cache reads cost more
const HAIKU: Price = { input: 0.1, write: 0.125, read: 0.01, output: 0.5 };

/** The prices of a model, by its family (an unknown name is priced as a Sonnet-class model). */
export function priceOf(model: string): Price {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return OPUS;
  if (m.includes('haiku')) return HAIKU;
  if (/sonnet-5(?![-.]?\d)/.test(m)) return SONNET_5;
  return SONNET;
}

/** US dollars for what one model was billed for. */
export function costUsd(model: string, t: Tally | null | undefined): number {
  if (!t) return 0;
  const p = priceOf(model);
  return (t.input * p.input + t.cache_write * p.write + t.cache_read * p.read + t.output * p.output) / 1e6;
}
