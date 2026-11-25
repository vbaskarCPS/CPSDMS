// Card Processing: the sale check, the tax inside a price and the receipt (supabase/functions/card-sale/sale.ts),
// and the form and history helpers (src/v2/lib/cardSales.ts).
import { describe, expect, it } from 'vitest';
import { asksTiming, checkSale, DEFAULT_TEMPLATE, itemLine, propertyFlags, renderReceipt, sampleReceipt, taxInside, type SaleInput } from '../../../supabase/functions/card-sale/sale';
import { blankItem, itemsToInput, salesCsv, searchSales, type CardSale } from './cardSales';

const input = (over: Partial<SaleInput> = {}): SaleInput => ({
  first_name: ' Ann ', last_name: 'Lee', phone: '(604) 555-0100', email: 'Ann@Example.com', address: '12 Oak St', city: 'Surrey', province: 'BC', postal_code: 'v3s 1a1',
  items: [{ service: 'aeration', price: '105' }], ...over,
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
    const { sale, errors } = checkSale(input());
    expect(errors).toBeNull();
    expect(sale).toMatchObject({ first_name: 'Ann', email: 'ann@example.com', postal_code: 'V3S 1A1', province: 'BC', total: 105, subtotal: 100, tax_amount: 5, tax_name: 'GST', tax_rate: 0.05, locked_gate: false, sprinklers: false });
    expect(sale!.items).toEqual([{ service: 'aeration', label: 'Aeration', property_type: 'FP', timing: null, price: 105 }]);
  });
  it('uses 13% HST in Ontario and 5% GST in Alberta', () => {
    expect(checkSale(input({ province: 'ON', items: [{ service: 'star_plan', price: 226 }] })).sale).toMatchObject({ tax_name: 'HST', tax_rate: 0.13, subtotal: 200, tax_amount: 26, total: 226 });
    expect(checkSale(input({ province: 'ab' })).sale).toMatchObject({ province: 'AB', tax_name: 'GST', tax_amount: 5 });
  });
  it('holds several services, each with its own price and asked what its recipe asks, and adds them up', () => {
    const { sale } = checkSale(input({ locked_gate: true, sprinklers: true, notes: '  gate code 1234  ', items: [
      { service: 'aeration', property_type: 'FO', price: 105 }, { service: 'grub', property_type: 'bo', timing: 'both', price: ' $1,050.00 ' },
      { service: 'dethatch', timing: 'spring', price: '157.50' }, { service: 'other', description: 'Moss control', price: 2.5 }] }));
    expect(sale!.total).toBe(1315);
    expect(sale!.items).toEqual([
      { service: 'aeration', label: 'Aeration', property_type: 'FO', timing: null, price: 105 },
      { service: 'grub', label: 'Grub Control', property_type: 'BO', timing: 'both', price: 1050 },
      { service: 'dethatch', label: 'Dethatching', property_type: 'FP', timing: null, price: 157.5 },     // dethatching has no timing question
      { service: 'other', label: 'Moss control', property_type: 'FP', timing: null, price: 2.5 }]);
    expect(sale).toMatchObject({ locked_gate: true, sprinklers: true, notes: 'gate code 1234', subtotal: 1252.38, tax_amount: 62.62 });
  });
  it('asks when for grub, chafer beetle and Star Plan Protection Plus only', () => {
    expect(['grub', 'chafer', 'star_plan_protection_plus', 'aeration', 'lawn_rejuv', 'star_plan', 'dethatch'].map(asksTiming)).toEqual([true, true, true, false, false, false, false]);
    expect(checkSale(input({ items: [{ service: 'grub', price: 100 }] })).errors).toEqual(['pick spring only, fall only or both.']);
    expect(checkSale(input({ items: [{ service: 'aeration', price: 100 }, { service: 'chafer', timing: 'winter', price: 100 }] })).errors).toEqual(['Service 2: pick spring only, fall only or both.']);
  });
  it('says what is missing', () => {
    const { sale, errors } = checkSale({ first_name: '', last_name: '', address: '', city: '', province: 'QC', items: [] });
    expect(sale).toBeNull();
    expect(errors).toEqual(['Enter the customer’s first and last name.', 'Enter a phone number or an email address.', 'Enter the service address.', 'Enter the city.', 'Pick the province.', 'Add at least one service.']);
  });
  it('refuses a bad email, a short phone, a missing price or a huge total, an unnamed Other and a wrong property part', () => {
    expect(checkSale(input({ email: 'ann@' })).errors).toEqual(['That email address doesn’t look right.']);
    expect(checkSale(input({ phone: '555-0100', email: '' })).errors).toEqual(['The phone number needs 10 digits.']);
    expect(checkSale(input({ items: [{ service: 'aeration', price: '' }] })).errors).toEqual(['enter the price.']);
    expect(checkSale(input({ items: [{ service: 'aeration', price: 100 }, { service: 'grub', timing: 'fall', price: 'abc' }] })).errors).toEqual(['Service 2: enter the price.']);
    expect(checkSale(input({ items: [{ service: 'aeration', price: 6000 }, { service: 'lawn_rejuv', price: 6000 }] })).errors).toEqual(['One charge can’t be more than $10,000.00.']);
    expect(checkSale(input({ items: [{ service: 'aeration', price: 100 }, { service: 'other', price: 50 }] })).errors).toEqual(['Service 2: say what “Other” is.']);
    expect(checkSale(input({ items: [{ service: 'aeration', property_type: 'XX', price: 100 }] })).errors).toEqual(['pick full property, front only or back only.']);
  });
});

describe('renderReceipt', () => {
  const data = sampleReceipt('2026-11-24T23:30:00Z');
  it('shows each service, the tax for the province and the total', () => {
    const { subject, text, html } = renderReceipt(DEFAULT_TEMPLATE, data);
    expect(subject).toBe('Your Property Stars receipt');
    expect(text).toContain('Hi Jordan,');
    expect(text).toContain('Aeration · Full property: $169.50');
    expect(text).toContain('Grub Control · Front only · Spring and fall: $226.00');
    expect(text).not.toContain('gate');
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
  it('starts a service on full property and sends timing only where it is asked', () => {
    expect(blankItem(1)).toEqual({ id: 1, service: '', description: '', property_type: 'FP', timing: '', price: '' });
    expect(itemsToInput([{ id: 1, service: 'grub', description: '', property_type: 'BO', timing: 'fall', price: ' $1,050.00 ' }, { id: 2, service: 'aeration', description: '', property_type: 'FP', timing: 'fall', price: '105' }]))
      .toEqual([{ service: 'grub', description: '', property_type: 'BO', timing: 'fall', price: '1050.00' }, { service: 'aeration', description: '', property_type: 'FP', timing: null, price: '105' }]);
  });
  it('describes a service and the property in words', () => {
    expect(itemLine({ label: 'Chafer Beetle', property_type: 'FP', timing: 'spring' })).toBe('Chafer Beetle · Full property · Spring only');
    expect(propertyFlags({ locked_gate: true, sprinklers: true })).toBe('Locked gate · Sprinklers');
    expect(propertyFlags({ locked_gate: false, sprinklers: false })).toBe('');
  });
  const sale = (over: Partial<CardSale> = {}): CardSale => ({
    id: '1', created_at: '2026-11-24T23:30:00Z', processed_by_name: 'Sam Roy', first_name: 'Ann', last_name: 'Lee', phone: '(604) 555-0100', email: 'ann@example.com',
    address: '12 Oak St', city: 'Surrey', province: 'BC', postal_code: 'V3S 1A1', items: [{ service: 'aeration', label: 'Aeration', property_type: 'FP', timing: null, price: 105 }],
    locked_gate: false, sprinklers: false, total: 105, subtotal: 100, tax_amount: 5, tax_name: 'GST', tax_rate: 0.05, notes: null, status: 'approved', transaction_id: '10000123', auth_code: 'TEST',
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
    const csv = salesCsv([sale({ address: '12 Oak St, Unit 4', notes: 'said "call first"', locked_gate: true })]).split('\n');
    expect(csv[0].startsWith('Date,Time (ET),Status,First name')).toBe(true);
    expect(csv[1]).toContain('2026-11-24,18:30,Approved,Ann,Lee');
    expect(csv[1]).toContain('"12 Oak St, Unit 4"');
    expect(csv[1]).toContain('Aeration · Full property $105.00,Locked gate,105.00,100.00,GST 5%,5.00,Sam Roy,Visa ••4242,TEST,10000123');
    expect(csv[1]).toContain('"said ""call first"""');
  });
});
