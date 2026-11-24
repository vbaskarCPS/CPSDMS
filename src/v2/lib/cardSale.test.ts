// Card Processing: the sale check, the tax inside a price and the receipt (supabase/functions/card-sale/sale.ts),
// and the form and history helpers (src/v2/lib/cardSales.ts).
import { describe, expect, it } from 'vitest';
import { checkSale, DEFAULT_TEMPLATE, renderReceipt, sampleReceipt, taxInside, type SaleInput } from '../../../supabase/functions/card-sale/sale';
import { itemsToInput, salesCsv, searchSales, seasonOptions, type CardSale } from './cardSales';

const input = (over: Partial<SaleInput> = {}): SaleInput => ({
  first_name: ' Ann ', last_name: 'Lee', phone: '(604) 555-0100', email: 'Ann@Example.com', address: '12 Oak St', city: 'Surrey', province: 'BC', postal_code: 'v3s 1a1',
  items: [{ service: 'aeration', season: 'spring', year: 2027, price: '105' }], ...over,
});

describe('taxInside', () => {
  it('finds the tax in a tax-included price', () => {
    expect(taxInside(262.5, 0.05)).toEqual({ subtotal: 250, tax: 12.5 });
    expect(taxInside(113, 0.13)).toEqual({ subtotal: 100, tax: 13 });
  });
  it('always adds back up to what was charged', () => {
    for (const total of [99.99, 105, 199, 0.01, 1234.56]) for (const rate of [0.05, 0.13]) {
      const { subtotal, tax } = taxInside(total, rate);
      expect(Math.round((subtotal + tax) * 100)).toBe(Math.round(total * 100));
    }
  });
});

describe('checkSale', () => {
  it('tidies a good sale and works out the tax by province', () => {
    const { sale, errors } = checkSale(input(), 2026);
    expect(errors).toBeNull();
    expect(sale).toMatchObject({ first_name: 'Ann', email: 'ann@example.com', postal_code: 'V3S 1A1', province: 'BC', total: 105, subtotal: 100, tax_amount: 5, tax_name: 'GST', tax_rate: 0.05 });
    expect(sale!.items).toEqual([{ service: 'aeration', label: 'Aeration', season: 'spring', year: 2027, price: 105 }]);
  });
  it('uses 13% HST in Ontario and 5% GST in Alberta', () => {
    expect(checkSale(input({ province: 'ON', items: [{ service: 'star_plan', season: 'fall', year: 2027, price: 226 }] }), 2026).sale).toMatchObject({ tax_name: 'HST', tax_rate: 0.13, subtotal: 200, tax_amount: 26, total: 226 });
    expect(checkSale(input({ province: 'ab' }), 2026).sale).toMatchObject({ province: 'AB', tax_name: 'GST', tax_amount: 5 });
  });
  it('adds several services into one charge', () => {
    const { sale } = checkSale(input({ items: [{ service: 'aeration', season: 'spring', year: 2027, price: 105 }, { service: 'dethatch', season: 'spring', year: 2027, price: '157.50' },
      { service: 'other', description: 'Moss control', season: 'fall', year: 2027, price: 52.5 }] }), 2026);
    expect(sale!.total).toBe(315);
    expect(sale!.items.map(i => i.label)).toEqual(['Aeration', 'Dethatching', 'Moss control']);
  });
  it('says what is missing', () => {
    const { sale, errors } = checkSale({ first_name: '', last_name: '', address: '', city: '', province: 'QC', items: [] }, 2026);
    expect(sale).toBeNull();
    expect(errors).toEqual(['Enter the customer’s first and last name.', 'Enter a phone number or an email address.', 'Enter the service address.', 'Enter the city.', 'Pick the province.', 'Add at least one service.']);
  });
  it('refuses a bad email, a short phone, a missing price, an unnamed Other and a past season', () => {
    expect(checkSale(input({ email: 'ann@' }), 2026).errors).toEqual(['That email address doesn’t look right.']);
    expect(checkSale(input({ phone: '555-0100', email: '' }), 2026).errors).toEqual(['The phone number needs 10 digits.']);
    expect(checkSale(input({ items: [{ service: 'aeration', season: 'spring', year: 2027, price: '' }] }), 2026).errors).toEqual(['enter the price.']);
    expect(checkSale(input({ items: [{ service: 'aeration', season: 'spring', year: 2027, price: 100 }, { service: 'other', season: 'spring', year: 2027, price: 50 }] }), 2026).errors).toEqual(['Service 2: say what “Other” is.']);
    expect(checkSale(input({ items: [{ service: 'aeration', season: 'spring', year: 2024, price: 100 }] }), 2026).errors).toEqual(['pick the season and year.']);
    expect(checkSale(input({ items: [{ service: 'aeration', season: 'spring', year: 2027, price: 20000 }] }), 2026).errors).toEqual(['One charge can’t be more than $10,000.00.']);
  });
});

describe('renderReceipt', () => {
  const data = sampleReceipt('2026-11-24T23:30:00Z');
  it('shows each service, the tax for the province and the total', () => {
    const { subject, text, html } = renderReceipt(DEFAULT_TEMPLATE, data);
    expect(subject).toBe('Your Property Stars receipt');
    expect(text).toContain('Hi Jordan,');
    expect(text).toContain('Aeration · Spring 2027: $169.50');
    expect(text).toContain('Subtotal: $350.00');
    expect(text).toContain('HST (13%): $45.50');
    expect(text).toContain('Total charged: $395.50');
    expect(text).toContain('Paid with: Visa ending 4242');
    expect(text).toContain('Date: November 24, 2026');
    expect(text).toContain('Service address: 123 Maple Street, Ottawa, ON K1A 0B1');
    expect(html).toContain('Total charged');
    expect(html).toContain('HST (13%)');
  });
  it('fills in names and escapes what people type', () => {
    const { html, subject } = renderReceipt({ subject: 'Receipt for {name}', greeting: 'Hi {first_name} <b>', closing: 'Bye', footer: '' },
      { ...data, sale: { ...data.sale, first_name: 'Jo<script>' } });
    expect(subject).toBe('Receipt for Jo<script> Sample');
    expect(html).toContain('Hi Jo&lt;script&gt; &lt;b&gt;');
    expect(html).not.toContain('<script>');
  });
  it('falls back to the standard wording when a field is missing', () => {
    expect(renderReceipt({} as never, data).text).toContain('Thank you for booking with Property Stars.');
  });
});

describe('the form and the history', () => {
  it('offers the seasons still ahead', () => {
    expect(seasonOptions(new Date(2026, 10, 24)).map(s => s.label)).toEqual(['Spring 2027', 'Fall 2027']);
    expect(seasonOptions(new Date(2027, 2, 1)).map(s => s.label)).toEqual(['Spring 2027', 'Fall 2027', 'Spring 2028', 'Fall 2028']);
    expect(seasonOptions(new Date(2027, 7, 1)).map(s => s.label)).toEqual(['Fall 2027', 'Spring 2028', 'Fall 2028']);
  });
  it('turns the rows typed into the sale sent', () => {
    expect(itemsToInput([{ id: 1, service: 'grub', description: '', seasonKey: 'fall:2027', price: ' $1,050.00 ' }]))
      .toEqual([{ service: 'grub', description: '', season: 'fall', year: 2027, price: '1050.00' }]);
  });
  const sale = (over: Partial<CardSale> = {}): CardSale => ({
    id: '1', created_at: '2026-11-24T23:30:00Z', processed_by_name: 'Sam Roy', first_name: 'Ann', last_name: 'Lee', phone: '(604) 555-0100', email: 'ann@example.com',
    address: '12 Oak St', city: 'Surrey', province: 'BC', postal_code: 'V3S 1A1', items: [{ service: 'aeration', label: 'Aeration', season: 'spring', year: 2027, price: 105 }],
    total: 105, subtotal: 100, tax_amount: 5, tax_name: 'GST', tax_rate: 0.05, notes: null, status: 'approved', transaction_id: '10000123', auth_code: 'TEST',
    card_type: 'VI', last4: '4242', message: 'Approved', receipt_to: 'ann@example.com', receipt_sent_at: '2026-11-24T23:30:05Z', receipt_error: null, ...over,
  });
  it('searches by name, phone digits, city, service and card', () => {
    const list = [sale(), sale({ id: '2', first_name: 'Bo', last_name: 'Chan', phone: '416-555-0199', city: 'Toronto', last4: '1111', email: null })];
    expect(searchSales(list, 'ann surrey').map(s => s.id)).toEqual(['1']);
    expect(searchSales(list, '4165550199').map(s => s.id)).toEqual(['2']);
    expect(searchSales(list, 'aeration').length).toBe(2);
    expect(searchSales(list, '1111').map(s => s.id)).toEqual(['2']);
    expect(searchSales(list, '').length).toBe(2);
  });
  it('exports one row per attempt, quoting what needs it', () => {
    const csv = salesCsv([sale({ address: '12 Oak St, Unit 4', notes: 'said "call first"' })]).split('\n');
    expect(csv[0].startsWith('Date,Time (ET),Status,First name')).toBe(true);
    expect(csv[1]).toContain('2026-11-24,18:30,Approved,Ann,Lee');
    expect(csv[1]).toContain('"12 Oak St, Unit 4"');
    expect(csv[1]).toContain('Aeration (Spring 2027) $105.00,105.00,100.00,GST 5%,5.00,Sam Roy,Visa ••4242,TEST,10000123');
    expect(csv[1]).toContain('"said ""call first"""');
  });
});
