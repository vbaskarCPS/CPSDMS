// supabase/functions/_shared/svix.ts — checking that a webhook post really comes from Resend (Svix signatures).

export function b64decode(s: string): Uint8Array { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function b64encode(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function same(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** Svix signature: HMAC-SHA256 over "<id>.<timestamp>.<raw body>", key = base64 part of "whsec_…", within 5 minutes. */
export async function verify(secret: string, id: string, ts: string, body: string, sigHeader: string, now = Date.now()): Promise<boolean> {
  if (!secret || !id || !ts || !sigHeader) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', b64decode(secret.replace(/^whsec_/, '')) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = b64encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))));
  return sigHeader.split(' ').some(part => { const [v, sig] = part.split(','); return v === 'v1' && !!sig && same(sig, mac); });
}


// ── Resend delivery events (used by clever-worker, and by ms-mail-inbound if its webhook is sent them) ──
export const DELIVERY_EVENTS = ['email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained'];

/** The reason Resend gives for a bounce / delay, if any. */
export function reasonOf(data: Record<string, unknown> | undefined): string | null {
  const b = (data?.bounce ?? data?.delivery_delayed ?? data?.failed) as { message?: string; subType?: string; type?: string } | undefined;
  return b?.message || [b?.type, b?.subType].filter(Boolean).join(' · ') || null;
}
