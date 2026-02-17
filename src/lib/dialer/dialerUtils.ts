// src/lib/dialer/dialerUtils.ts
//
// Pure utility functions for the AutoSniper dialer.
// Ported from Utilities.gs — no side effects, no API calls.
//

/**
 * Normalize a raw phone value to a 10-digit string.
 * Strips non-digits, removes country code prefix, returns '' if not exactly 10 digits.
 */
export function normalizePhone(raw: string | number | null | undefined): string {
  let s = String(raw ?? '').trim();
  // Remove trailing ".0" from numeric values
  if (s.length > 2 && s.endsWith('.0')) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  // If longer than 10, take last 10 (strips country code)
  const trimmed = d.length > 10 ? d.slice(-10) : d;
  return trimmed.length === 10 ? trimmed : '';
}

/**
 * Format a 10-digit phone string as (XXX) XXX-XXXX.
 */
export function formatPhoneDisplay(phone: string): string {
  if (phone.length !== 10) return phone;
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}

/**
 * Normalize a street name for grouping purposes.
 * Strips common suffixes (St, Rd, Ave, Dr, etc.), lowercases, removes non-alphanum.
 */
export function normalizeStreet(street: string | null | undefined): string {
  let t = String(street ?? '').toLowerCase().trim();
  t = t.replace(
    /\b(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|highway|hwy|circle|cir|way|wy|terrace|ter|square|sq|parkway|pkwy)\b/g,
    ''
  );
  t = t.replace(/[^a-z0-9]/g, '');
  return t;
}

/**
 * Normalize a full address (house number + street name) for union-find grouping.
 * Ported from Utilities.gs normalizeAddr_().
 * Combines house and street, strips suffixes and directions, removes non-alphanum.
 * Example: "123", "Main Street" → "123main"
 */
export function normalizeAddr(
  house: string | number | null | undefined,
  street: string | null | undefined
): string {
  // Clean house number — strip trailing ".0" from numeric values
  let h = String(house ?? '').trim();
  if (h.length > 2 && h.endsWith('.0')) h = h.slice(0, -2);
  h = h.trim();

  // Combine house + street, lowercase
  let t = (h + ' ' + String(street ?? '')).toLowerCase();

  // Strip street suffixes
  t = t.replace(
    /\b(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|highway|hwy|circle|cir|way|wy|terrace|ter|square|sq|parkway|pkwy)\b/g,
    ''
  );

  // Abbreviate cardinal directions (matches Utilities.gs behavior)
  t = t.replace(/\bnorth\b/g, 'n');
  t = t.replace(/\bsouth\b/g, 's');
  t = t.replace(/\beast\b/g, 'e');
  t = t.replace(/\bwest\b/g, 'w');

  // Strip everything except letters and digits
  t = t.replace(/[^a-z0-9]/g, '');
  return t;
}

/**
 * Parse a compressed hidden rows string from Sniper into a Set of hidden row numbers.
 * Format: "2,5-10,15" → rows 2, 5,6,7,8,9,10, 15 are hidden.
 */
export function parseHiddenRows(compressed: string | null | undefined): Set<number> {
  const hidden = new Set<number>();
  if (!compressed) return hidden;

  const parts = compressed.split(',');
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf('-');
    if (dash === -1) {
      hidden.add(parseInt(trimmed, 10));
    } else {
      const start = parseInt(trimmed.slice(0, dash), 10);
      const end = parseInt(trimmed.slice(dash + 1), 10);
      for (let r = start; r <= end; r++) hidden.add(r);
    }
  }
  return hidden;
}

/**
 * Parse a year value (could be Date object string, number, etc.) into a 4-digit year.
 * Returns 0 if invalid.
 */
export function parseYear(val: any): number {
  if (val instanceof Date) return val.getFullYear();
  const n = parseInt(String(val), 10);
  return !isNaN(n) && n >= 2000 && n <= 2100 ? n : 0;
}

/**
 * Extract the alphabetic prefix from a route code.
 * "ACE01" → "ACE", "HM12" → "HM"
 */
export function getRoutePrefix(routeCode: string): string {
  const m = routeCode.match(/^([a-zA-Z]+)/);
  return m ? m[1].toUpperCase() : '';
}

/**
 * Build a street key for AER/Link Shot lookups: ROUTE_PREFIX|NORMALIZED_STREET.
 * This is scoped by route area so AER on Main St in one area
 * doesn't affect Main St in a different area.
 */
export function buildStreetKey(routeCode: string, street: string): string {
  return (getRoutePrefix(routeCode) + '|' + normalizeStreet(street)).toUpperCase();
}

/**
 * Check if a PMT TYPE value represents prepaid.
 * Matches: "prepaid", "pp", "pre-paid", "pre paid" (case-insensitive).
 */
export function isPrepaid(pmtType: any): boolean {
  const v = String(pmtType ?? '').toLowerCase().trim();
  return v === 'prepaid' || v === 'pp' || v === 'pre-paid' || v === 'pre paid';
}

/**
 * Check if an AER cell value indicates an active AER booking.
 * Matches: "x", "aer", "yes", "y" (case-insensitive).
 */
export function hasAER(aerValue: any): boolean {
  const v = String(aerValue ?? '').trim().toUpperCase();
  return v === 'X' || v === 'AER' || v === 'YES' || v === 'Y';
}

/**
 * Check if an NA cell value indicates a CTS (Closer To Spring) disposition.
 */
export function isCTS(naValue: any): boolean {
  const v = String(naValue ?? '').trim().toUpperCase();
  return v === 'CTS';
}