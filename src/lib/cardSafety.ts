// src/lib/cardSafety.ts
// Card numbers and CVCs are never stored — not in the database and not in
// Google Sheets. Bambora live payments are kept as their safe reference
// ("BAMBORA-<transaction id>", auth code, last 4). Any other card entry is
// reduced to its last 4 digits before it is saved or exported.

const BAMBORA_PREFIX = 'BAMBORA-';

export const isBamboraRef = (value?: string | null): boolean =>
  (value || '').startsWith(BAMBORA_PREFIX);

/** "4111 1111 1111 1234" → "CARD-••••1234". Already-masked or empty values pass through. */
export function maskCardNumber(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (isBamboraRef(value) || value.startsWith('CARD-')) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return `CARD-••••${digits.slice(-4)}`;
}

/**
 * The three card fields as they may be saved. For Bambora the fields hold
 * (reference, auth code, last 4) and are kept; for anything else only the
 * masked number survives — expiry and CVC are dropped.
 */
export function safeCardFields(number?: string | null, expiry?: string | null, cvc?: string | null): {
  number: string | null; expiry: string | null; cvc: string | null;
} {
  if (isBamboraRef(number)) return { number: number!, expiry: expiry || null, cvc: cvc || null };
  return { number: maskCardNumber(number) ?? null, expiry: null, cvc: null };
}

/**
 * Database columns for a transaction save. A field that wasn't sent stays
 * untouched (so editing a job never blanks a stored Bambora reference).
 */
export function cardColumnsForSave(number?: string | null, expiry?: string | null, cvc?: string | null): {
  cc_full_number?: string | null; cc_expiry?: string | null; cc_cvc?: string | null;
} {
  const c = safeCardFields(number, expiry, cvc);
  const out: { cc_full_number?: string | null; cc_expiry?: string | null; cc_cvc?: string | null } = {};
  if (number !== undefined) out.cc_full_number = c.number;
  if (expiry !== undefined) out.cc_expiry = c.expiry;
  if (cvc !== undefined) out.cc_cvc = c.cvc;
  return out;
}
