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
   * Build a street key for grouping: ROUTE_PREFIX|NORMALIZED_STREET
   */
  export function buildStreetKey(routeCode: string, street: string): string {
    return (getRoutePrefix(routeCode) + '|' + normalizeStreet(street)).toUpperCase();
  }