// supabase/functions/ms-site-quote/quote.ts — checking a website quote request, and writing it as an email.

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

export interface Quote { name: string; business: string; email: string; phone: string; city: string; spend: string; message: string }

/** Read and check a request. Returns the quote, or what's wrong with it. */
export function readQuote(b: Record<string, unknown>): { quote: Quote } | { error: string; quiet?: boolean } {
  if (clean(b.website, 200)) return { error: 'spam', quiet: true };               // the hidden field
  if (Number(b.ms) < 2500) return { error: 'spam', quiet: true };                 // filled faster than a person can
  const q: Quote = {
    name: clean(b.name, 120), business: clean(b.business, 160), email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40), city: clean(b.city, 80), spend: clean(b.spend, 60), message: clean(b.message, 3000),
  };
  if (!q.name || !q.business) return { error: 'Add your name and your business name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q.email)) return { error: 'Add an email address we can send your quote to.' };
  if (q.phone && !/^[0-9+().\-\s ext]{7,40}$/i.test(q.phone)) return { error: 'That phone number doesn’t look right.' };
  return { quote: q };
}

/** The request as an email to the MainstreetAI inbox. */
export function asEmail(q: Quote): { subject: string; text: string; html: string } {
  const rows: [string, string][] = [
    ['Name', q.name], ['Business', q.business], ['Email', q.email], ['Phone', q.phone || '—'], ['City', q.city || '—'],
    ['Spends on bookkeeping now', q.spend || '—'],
  ];
  const text = `Savings quote request from the Main Street AI website (Taxifi.ai bookkeeping)\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${q.message ? `\n\nTheir note:\n${q.message}` : ''}\n\nReply to this conversation to answer ${q.name.split(' ')[0]} directly.`;
  const html = `<p><strong>Savings quote request</strong> from the Main Street AI website (Taxifi.ai bookkeeping)</p>`
    + `<ul>${rows.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('')}</ul>`
    + (q.message ? `<p><strong>Their note:</strong><br>${esc(q.message).replace(/\n/g, '<br>')}</p>` : '')
    + `<p>Reply to this conversation to answer ${esc(q.name.split(' ')[0])} directly.</p>`;
  return { subject: `Savings quote request: ${q.business}`, text, html };
}
