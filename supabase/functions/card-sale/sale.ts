// supabase/functions/card-sale/sale.ts — Card Processing: what can be sold, the tax inside a price, checking a
// sale before it is charged, and the receipt email. No Deno or network here, so the app uses it too (the form, the
// receipt preview) and its tests run it (src/v2/lib/cardSale.test.ts).

// ───────────── what can be sold ─────────────
export const CARD_SERVICES = [
  { key: 'aeration', label: 'Aeration' },
  { key: 'lawn_rejuv', label: 'Lawn Rejuvenation' },
  { key: 'star_plan', label: 'Star Plan' },
  { key: 'star_plan_pro', label: 'Star Plan Pro' },
  { key: 'star_plan_protection_plus', label: 'Star Plan Protection Plus' },
  { key: 'golf_course', label: 'Golf Course Package' },
  { key: 'dethatch', label: 'Dethatching' },
  { key: 'grub', label: 'Grub Control' },
  { key: 'chafer', label: 'Chafer Beetle' },
  { key: 'after_care', label: 'Rejuvenation After Care' },
  { key: 'other', label: 'Other' },
] as const;
export type CardServiceKey = typeof CARD_SERVICES[number]['key'];
export type Season = 'spring' | 'fall';
export const SEASON_LABEL: Record<Season, string> = { spring: 'Spring', fall: 'Fall' };

// ───────────── tax ─────────────
// The price a manager types already has the tax in it. The receipt shows how much of it is tax, by province.
export const PROVINCES = [
  { code: 'BC', name: 'British Columbia', tax: 'GST', rate: 0.05 },
  { code: 'AB', name: 'Alberta', tax: 'GST', rate: 0.05 },
  { code: 'ON', name: 'Ontario', tax: 'HST', rate: 0.13 },
] as const;
export type ProvinceCode = typeof PROVINCES[number]['code'];
export const provinceOf = (code: string) => PROVINCES.find(p => p.code === String(code || '').toUpperCase()) || null;

const cents = (v: number) => Math.round(v * 100);
/** The tax inside a tax-included amount: $262.50 at 5% is $250.00 + $12.50. */
export function taxInside(total: number, rate: number): { subtotal: number; tax: number } {
  const t = cents(total);
  const sub = Math.round(t / (1 + rate));
  return { subtotal: sub / 100, tax: (t - sub) / 100 };
}
export const pct = (rate: number) => `${Math.round(rate * 10000) / 100}%`;
export function money(v: unknown): string {
  const x = Number(v);
  const n = Number.isFinite(x) ? x : 0;
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ───────────── a sale ─────────────
export interface SaleItemInput { service: string; description?: string | null; season: string; year: number | string; price: number | string }
export interface SaleInput {
  first_name: string; last_name: string; phone?: string | null; email?: string | null;
  address: string; city: string; province: string; postal_code?: string | null;
  items: SaleItemInput[]; notes?: string | null;
}
export interface SaleItem { service: CardServiceKey; label: string; season: Season; year: number; price: number }
export interface Sale {
  first_name: string; last_name: string; phone: string | null; email: string | null;
  address: string; city: string; province: ProvinceCode; postal_code: string | null;
  items: SaleItem[]; notes: string | null;
  total: number; subtotal: number; tax_amount: number; tax_name: string; tax_rate: number;
}

const clean = (s: unknown, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** "Lawn Rejuvenation · Spring 2027" */
export const itemLine = (i: Pick<SaleItem, 'label' | 'season' | 'year'>) => `${i.label} · ${SEASON_LABEL[i.season]} ${i.year}`;
export const MAX_CHARGE = 10000;

/** A sale ready to charge, or what is wrong with it (in the words the form shows). */
export function checkSale(input: SaleInput, thisYear = new Date().getFullYear()): { sale: Sale; errors: null } | { sale: null; errors: string[] } {
  const errors: string[] = [];
  const first_name = clean(input?.first_name, 60), last_name = clean(input?.last_name, 60);
  if (!first_name || !last_name) errors.push('Enter the customer’s first and last name.');
  const phone = clean(input?.phone, 30) || null;
  if (phone && digits(phone).length < 10) errors.push('The phone number needs 10 digits.');
  const email = clean(input?.email, 120).toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) errors.push('That email address doesn’t look right.');
  if (!phone && !email) errors.push('Enter a phone number or an email address.');
  const address = clean(input?.address, 160), city = clean(input?.city, 80);
  if (!address) errors.push('Enter the service address.');
  if (!city) errors.push('Enter the city.');
  const prov = provinceOf(input?.province);
  if (!prov) errors.push('Pick the province.');
  const postal_code = clean(input?.postal_code, 10).toUpperCase() || null;

  const items: SaleItem[] = [];
  const rows = Array.isArray(input?.items) ? input.items : [];
  if (!rows.length) errors.push('Add at least one service.');
  rows.forEach((r, i) => {
    const n = rows.length > 1 ? `Service ${i + 1}: ` : '';
    const svc = CARD_SERVICES.find(s => s.key === r?.service);
    if (!svc) { errors.push(`${n}pick the service.`); return; }
    const desc = clean(r.description, 80);
    if (svc.key === 'other' && !desc) { errors.push(`${n}say what “Other” is.`); return; }
    const season = r.season === 'spring' || r.season === 'fall' ? r.season : null;
    const year = Math.round(Number(r.year));
    if (!season || !(year >= thisYear && year <= thisYear + 2)) { errors.push(`${n}pick the season and year.`); return; }
    const price = Math.round(Number(r.price) * 100) / 100;
    if (!(price > 0)) { errors.push(`${n}enter the price.`); return; }
    items.push({ service: svc.key, label: svc.key === 'other' ? desc : svc.label, season, year, price });
  });
  const total = items.reduce((s, i) => s + cents(i.price), 0) / 100;
  if (items.length === rows.length && total > MAX_CHARGE) errors.push(`One charge can’t be more than ${money(MAX_CHARGE)}.`);
  if (errors.length || !prov) return { sale: null, errors };
  const { subtotal, tax } = taxInside(total, prov.rate);
  return { errors: null, sale: { first_name, last_name, phone, email, address, city, province: prov.code, postal_code, items,
    notes: clean(input.notes, 500) || null, total, subtotal, tax_amount: tax, tax_name: prov.tax, tax_rate: prov.rate } };
}

// ───────────── the receipt ─────────────
export interface ReceiptTemplate { subject: string; greeting: string; closing: string; footer: string }
export const DEFAULT_TEMPLATE: ReceiptTemplate = {
  subject: 'Your Property Stars receipt',
  greeting: 'Hi {first_name},\n\nThank you for booking with Property Stars. Here is your receipt.',
  closing: 'We’ll be in touch before your service to confirm your date.\n\nQuestions? Reply to this email.',
  footer: 'Property Stars',
};
export interface ReceiptData {
  sale: Pick<Sale, 'first_name' | 'last_name' | 'address' | 'city' | 'province' | 'postal_code' | 'items' | 'total' | 'subtotal' | 'tax_amount' | 'tax_name' | 'tax_rate'>;
  card_type: string | null; last4: string | null; transaction_id: string | null; charged_at: string;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fill = (text: string, d: ReceiptData) => String(text || '')
  .replace(/\{first_name\}/g, d.sale.first_name).replace(/\{last_name\}/g, d.sale.last_name).replace(/\{name\}/g, `${d.sale.first_name} ${d.sale.last_name}`.trim());
/** "November 24, 2026" in Toronto time. */
export const receiptDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Toronto' });
export const cardLine = (d: Pick<ReceiptData, 'card_type' | 'last4'>) => d.last4 ? `${cardName(d.card_type)} ending ${d.last4}` : 'Card';
const CARD_NAMES: Record<string, string> = { VI: 'Visa', MC: 'Mastercard', AM: 'American Express', NN: 'Discover', DI: 'Diners', JB: 'JCB', IO: 'Interac' };
export const cardName = (t: string | null | undefined) => (t && (CARD_NAMES[t.toUpperCase()] || t)) || 'Card';
export const addressLine = (s: { address: string; city: string; province: string; postal_code: string | null }) => [s.address, s.city, [s.province, s.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export function renderReceipt(tpl: ReceiptTemplate, d: ReceiptData): { subject: string; html: string; text: string } {
  const t = { ...DEFAULT_TEMPLATE, ...Object.fromEntries(Object.entries(tpl || {}).filter(([, v]) => typeof v === 'string')) } as ReceiptTemplate;
  const s = d.sale;
  const H = 'font-family:Helvetica,Arial,sans-serif;';
  const para = (text: string) => fill(text, d).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="${H}font-size:15px;line-height:1.55;color:#111827;margin:0 0 14px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const row = (l: string, r: string, bold = false, top = false) => `<tr><td style="${H}padding:7px 0;font-size:14px;color:#111827;${bold ? 'font-weight:700;' : ''}${top ? 'border-top:2px solid #e5e7eb;' : 'border-top:1px solid #f1f5f9;'}">${l}</td><td style="${H}padding:7px 0 7px 12px;font-size:14px;color:#111827;text-align:right;white-space:nowrap;${bold ? 'font-weight:700;' : ''}${top ? 'border-top:2px solid #e5e7eb;' : 'border-top:1px solid #f1f5f9;'}">${r}</td></tr>`;
  const taxLabel = `${s.tax_name} (${pct(s.tax_rate)})`;
  const facts = [
    ['Paid with', cardLine(d)], ['Date', receiptDate(d.charged_at)],
    ...(d.transaction_id ? [['Reference', d.transaction_id]] : []), ['Service address', addressLine(s)],
  ];
  const html = `<div style="${H}max-width:560px;margin:0 auto;padding:24px 20px;color:#111827;">
  <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;margin-bottom:14px;">Property Stars · Receipt</div>
  ${para(t.greeting)}
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:6px 0 16px;">
    ${s.items.map(i => row(esc(itemLine(i)), esc(money(i.price)))).join('')}
    ${row('Subtotal', esc(money(s.subtotal)), false, true)}
    ${row(esc(taxLabel), esc(money(s.tax_amount)))}
    ${row('Total charged', esc(money(s.total)), true, true)}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 18px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">
    ${facts.map(([l, r]) => `<tr><td style="${H}padding:6px 12px;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(l)}</td><td style="${H}padding:6px 12px;font-size:13px;color:#111827;">${esc(r)}</td></tr>`).join('')}
  </table>
  ${para(t.closing)}
  ${t.footer.trim() ? `<p style="${H}font-size:12px;color:#9ca3af;line-height:1.5;margin:18px 0 0;">${esc(fill(t.footer, d)).replace(/\n/g, '<br>')}</p>` : ''}
</div>`;
  const text = [
    fill(t.greeting, d).trim(), '',
    ...s.items.map(i => `${itemLine(i)}: ${money(i.price)}`),
    `Subtotal: ${money(s.subtotal)}`, `${taxLabel}: ${money(s.tax_amount)}`, `Total charged: ${money(s.total)}`, '',
    ...facts.map(([l, r]) => `${l}: ${r}`), '',
    fill(t.closing, d).trim(), ...(t.footer.trim() ? ['', fill(t.footer, d).trim()] : []),
  ].join('\n');
  return { subject: fill(t.subject, d).replace(/\s+/g, ' ').trim() || DEFAULT_TEMPLATE.subject, html, text };
}

/** A made-up sale for the receipt preview and the test email. */
export function sampleReceipt(now = new Date().toISOString()): ReceiptData {
  const total = 395.5, { subtotal, tax } = taxInside(total, 0.13);
  return { card_type: 'VI', last4: '4242', transaction_id: '10000123', charged_at: now,
    sale: { first_name: 'Jordan', last_name: 'Sample', address: '123 Maple Street', city: 'Ottawa', province: 'ON', postal_code: 'K1A 0B1',
      items: [{ service: 'aeration', label: 'Aeration', season: 'spring', year: new Date(now).getFullYear() + 1, price: 169.5 },
              { service: 'dethatch', label: 'Dethatching', season: 'spring', year: new Date(now).getFullYear() + 1, price: 226 }],
      total, subtotal, tax_amount: tax, tax_name: 'HST', tax_rate: 0.13 } };
}
