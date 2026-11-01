// supabase/functions/_shared/etfMatch.ts — the plain rules for matching an e-transfer receipt to a sale.
// No Deno or network here, so the app's tests run it too (src/v2/lib/etfMatch.test.ts).
//
// A receipt (who sent it, how much, when, their message) is matched against the e-transfer sales that could
// fit (etf_candidates: same amount, a close amount, or a word of the sender's name in the client's name, sold
// up to 3 weeks before). The rules:
//   - one sale has the same amount AND the name (or the message) points at it → matched, no one needs to look
//   - otherwise, if there's a likely sale → suggested, for a person to confirm (Claude picks when there are several)
//   - nothing fits → the receipt stays unmatched
// The e-transfer is often not the recorded amount: tax added or left off, rounded up, a tip, part of it now and
// the rest later. A close amount (within $30 or 15%) with the name is a suggestion that says how far off it is.

export interface Receipt { sender_name?: string | null; sender_email?: string | null; amount?: number | null; sent_on?: string | null; memo?: string | null }
export interface Candidate { key: string; day: string; center?: string | null; client?: string | null; address?: string | null; route_code?: string | null; amount: number; cart?: string | null; same_amount: boolean; close_amount?: boolean; suggested?: boolean }
export interface Decision { key: string | null; confirmed: boolean; how: 'auto' | 'claude'; confidence: 'high' | 'medium' | 'low'; reason: string; ask?: Candidate[] }

const words = (s?: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split(/[^a-z]+/).filter(w => w.length >= 2 && !['mr', 'mrs', 'ms', 'dr', 'the', 'and', 'inc', 'ltd'].includes(w));

/** 0–1: how much the sender's name matches the client's name (1 = every word of the shorter name is in the other). */
export function nameScore(sender?: string | null, client?: string | null): number {
  const a = words(sender), b = words(client);
  if (!a.length || !b.length) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const hit = short.filter(w => long.some(x => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length;
  return hit / short.length;
}

/** Does the e-transfer's message mention this sale (the house number with the street, or the client's last name)? */
export function memoHit(memo?: string | null, c?: Pick<Candidate, 'client' | 'address'>): boolean {
  const m = (memo || '').toLowerCase();
  if (!m.trim() || !c) return false;
  const addr = (c.address || '').toLowerCase();
  const num = /^\s*(\d+)/.exec(addr)?.[1];
  const street = words(addr.replace(/^\s*\d+\s*/, ''))[0];
  if (num && m.includes(num) && (!street || m.includes(street))) return true;
  const last = words(c.client).slice(-1)[0];
  return !!last && last.length >= 3 && new RegExp(`\\b${last}\\b`).test(m);
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;
/** How far the e-transfer is from the sale: "$12.00 short" / "$5.00 over" / "" when equal. */
export function amountGap(sent: number | null | undefined, sold: number): string {
  const d = Math.round((Number(sent || 0) - sold) * 100) / 100;
  return Math.abs(d) < 0.005 ? '' : d < 0 ? `${money(-d)} short` : `${money(d)} over`;
}
/** Within $30 or 15% of the sale — the usual tax / rounding / tip / part-payment gap. */
export const isClose = (sent: number | null | undefined, sold: number) => sent != null && Math.abs(Number(sent) - sold) <= Math.max(30, sold * 0.15);

export function decide(r: Receipt, all: Candidate[]): Decision {
  const fresh = all.filter(c => !c.suggested);
  const pool = fresh.length ? fresh : all;
  const named = (c: Candidate) => nameScore(r.sender_name, c.client) >= 0.5 || memoHit(r.memo, c);
  const same = pool.filter(c => c.same_amount);
  const strong = same.filter(named);
  const who = r.sender_name || r.sender_email || 'the sender';

  if (strong.length === 1) {
    const c = strong[0];
    return { key: c.key, confirmed: true, how: 'auto', confidence: 'high', reason: `Same amount (${money(c.amount)}) and ${who} matches ${c.client || 'the client'}` };
  }
  if (strong.length > 1) return { key: null, confirmed: false, how: 'claude', confidence: 'medium', reason: 'Several sales fit', ask: strong };
  if (same.length === 1) {
    const c = same[0];
    return { key: c.key, confirmed: false, how: 'auto', confidence: 'medium',
      reason: `Only sale for ${money(c.amount)} then, but the name differs (sent by ${who}, client ${c.client || 'unknown'})` };
  }
  if (same.length > 1) return { key: null, confirmed: false, how: 'claude', confidence: 'low', reason: 'Several sales for that amount', ask: same };
  // not the recorded amount, but near it: tax, rounding, a tip, or part of it
  const close = pool.filter(c => !c.same_amount && (c.close_amount ?? isClose(r.amount, c.amount)));
  const closeNamed = close.filter(named);
  if (closeNamed.length === 1) {
    const c = closeNamed[0];
    return { key: c.key, confirmed: false, how: 'auto', confidence: 'medium',
      reason: `${who} matches ${c.client || 'the client'}; ${money(Number(r.amount || 0))} sent for ${money(c.amount)} sold (${amountGap(r.amount, c.amount)})` };
  }
  if (closeNamed.length > 1) return { key: null, confirmed: false, how: 'claude', confidence: 'low', reason: 'Name fits several sales, amounts close', ask: closeNamed };
  const byName = pool.filter(named);
  if (byName.length === 1) {
    const c = byName[0];
    return { key: c.key, confirmed: false, how: 'auto', confidence: 'low',
      reason: `Name matches ${c.client || 'the client'} but the amount differs (${money(Number(r.amount || 0))} sent, ${money(c.amount)} sold)` };
  }
  if (byName.length > 1) return { key: null, confirmed: false, how: 'claude', confidence: 'low', reason: 'Name fits several sales, amount differs', ask: byName };
  if (close.length === 1) {
    const c = close[0];
    return { key: c.key, confirmed: false, how: 'auto', confidence: 'low',
      reason: `Only sale near ${money(Number(r.amount || 0))} then: ${c.client || 'unknown'}, ${money(c.amount)} sold (${amountGap(r.amount, c.amount)}); sent by ${who}` };
  }
  if (close.length > 1) return { key: null, confirmed: false, how: 'claude', confidence: 'low', reason: 'Several sales near that amount', ask: close };
  return { key: null, confirmed: false, how: 'auto', confidence: 'low', reason: 'No e-transfer sale fits' };
}

/** Is this email a forward (only forwards are processed)? */
export function isForward(subject?: string | null, body?: string | null): boolean {
  if (/^\s*(fwd?|fw|tr)\s*:/i.test(subject || '')) return true;
  return /(-{3,}\s*forwarded message\s*-{3,}|begin forwarded message|-{3,}\s*original message\s*-{3,}|^\s*from:.*\n.*(sent|date):)/im.test(body || '');
}

/** Plain text of an email for Claude (no tags, no styles, short). */
export function plainText(html?: string | null, text?: string | null, max = 12000): string {
  const t = (text && text.trim()) ? text : String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#36;|&dollar;/g, '$').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim().slice(0, max);
}
