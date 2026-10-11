// src/v2/features/worker/DayBreakdown.tsx — one payslip day, worked out step by step from what
// was saved with its day line: the money collected, tax, product cost, EQ, the rate (base +
// Alumni + Silver) and the pay. Shown to the worker in their dashboard and to the office on the
// Payslips page. Totals only: no customer names or addresses are on a day line.
import React from 'react';
import { productCostTaken, type PayslipSeason } from '../../../lib/payslipExport';

export interface BreakdownLine {
  day: string; manager?: string | null; steps?: number; equiv?: number; payout_rate?: number; total_payout: number;
  stats?: Record<string, unknown> | null;
}

const n = (v: unknown) => { const x = typeof v === 'number' ? v : Number(v); return Number.isFinite(x) ? x : 0; };
const has = (v: unknown) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
const money = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fix = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString('en-CA')}%`;
const DEFAULT_WEIGHTS: Record<string, { prepaid: number; billed: number }> = {
  aeration: { prepaid: 0.5, billed: 0.5 }, sealing: { prepaid: 0.5, billed: 0.5 }, lawn_rejuv: { prepaid: 0.6, billed: 0.5 }, cleaning: { prepaid: 0.5, billed: 0.5 },
};

interface Row { label: React.ReactNode; value?: React.ReactNode; tone?: 'minus' | 'plus' | 'total' | 'note' }
const Section: React.FC<{ title: string; rows: (Row | null | false)[] }> = ({ title, rows }) => {
  const shown = rows.filter((r): r is Row => !!r);
  if (!shown.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="v2-label" style={{ margin: '0 0 4px' }}>{title}</div>
      <table className="v2-table" style={{ fontSize: 13 }}><tbody>
        {shown.map((r, i) => (
          <tr key={i} style={r.tone === 'total' ? { fontWeight: 700 } : undefined}>
            <td className={r.tone === 'note' ? 'v2-small v2-mut' : undefined} colSpan={r.value === undefined ? 2 : 1}>{r.label}</td>
            {r.value !== undefined && <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: r.tone === 'minus' ? 'var(--rose)' : r.tone === 'plus' ? 'var(--green)' : undefined }}>{r.value}</td>}
          </tr>
        ))}
      </tbody></table>
    </div>
  );
};

export const DayBreakdown: React.FC<{ line: BreakdownLine; season: PayslipSeason; centerTaxRate?: number | null }> = ({ line, season, centerTaxRate }) => {
  const s = (line.stats || {}) as Record<string, unknown>;
  const fromMoney = has(s.prodGross) || has(s.prodPayable);
  const teamSize = n(s.teamSize) || 1;
  const eq = has(s.assignedEQ) ? n(s.assignedEQ) : n(line.equiv);
  const rate = has(s.totalPayoutRate) ? n(s.totalPayoutRate) : n(line.payout_rate);
  const steps = has(s.stepCount) ? n(s.stepCount) : n(line.steps);

  // ── the day ──
  const day: Row[] = [];
  if (s.cart) day.push({ label: 'Cart', value: String(s.cart) });
  if (line.manager) day.push({ label: 'Manager', value: line.manager });
  if (teamSize > 1) day.push({ label: `Team of ${teamSize}`, value: `your EQ split ${pct(n(s.equivSplitPercent))}${has(s.upsellSplitPercent) && n(s.upsellSplitPercent) !== n(s.equivSplitPercent) ? ` · upsells ${pct(n(s.upsellSplitPercent))}` : ''}` });
  day.push({ label: teamSize > 1 ? 'Steps (your share)' : 'Steps', value: fix(steps, 1) });
  if (n(s.iosCount)) day.push({ label: 'IOS', value: fix(n(s.iosCount), teamSize > 1 ? 2 : 0) });

  if (!fromMoney) {
    return (
      <div>
        <Section title="The day" rows={day} />
        <Section title="Pay" rows={[
          { label: 'EQ', value: fix(eq) }, { label: 'Rate per EQ', value: money(rate) },
          { label: 'Day total', value: money(n(line.total_payout)), tone: 'total' },
          { label: 'This day came from the old Payout Stats sheet, which only kept these numbers.', tone: 'note' },
        ]} />
      </div>
    );
  }

  // ── money collected (the worker's share of the cart) ──
  const pay = [
    ['Cash', n(s.prodCash)], ['Cheque', n(s.prodCheque)], ['E-transfer', n(s.prodETransfer)], ['Credit card', n(s.prodCreditCard)],
    ['Billed', n(s.prodBilled)], ['Prepaid', n(s.prodPrepaid)], ['Prepaid (upgrade share)', n(s.prodPrepaidSplit)], ['Flats', n(s.prodFlats)],
  ] as [string, number][];
  const gross = n(s.prodGross);
  const collected: Row[] = pay.filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => ({ label: k, value: money(v) }));
  collected.push({ label: teamSize > 1 ? `Collected (your ${pct(n(s.equivSplitPercent))} of the cart)` : 'Collected', value: money(gross), tone: 'total' });
  if (n(s.upsellGross)) collected.push({ label: 'Upsells collected (counted separately below)', value: money(n(s.upsellGross)), tone: 'note' });

  // ── money → EQ: the same steps as the payout ──
  const taxFromLine = has(s.taxRate);
  const taxRate = taxFromLine ? n(s.taxRate) : n(centerTaxRate ?? 13);
  const w = DEFAULT_WEIGHTS[season] || DEFAULT_WEIGHTS.sealing;
  const prepaidW = has(s.prepaidWeight) ? n(s.prepaidWeight) : w.prepaid;
  const billedW = has(s.billedWeight) ? n(s.billedWeight) : w.billed;
  const noTaxOnCash = s.noTaxOnCash === true;
  const productCost = n(s.productCostPercent);
  const divisor = n(s.eqDivisor) || 25;
  const prepaidOff = (n(s.prodPrepaid)) * (1 - prepaidW);
  const billedOff = n(s.prodBilled) * (1 - billedW);
  const taxable = gross - prepaidOff - billedOff - (noTaxOnCash ? n(s.prodCash) : 0);
  const taxOff = taxable - taxable / (1 + taxRate / 100);
  const afterTax = taxable - taxOff + (noTaxOnCash ? n(s.prodCash) : 0);
  const flatsAfterTax = n(s.prodFlats) / (1 + taxRate / 100);
  // the same figure the payslip prints as Sealant: worked back from what the day paid
  const costOff = productCostTaken(s, taxRate) ?? (afterTax - flatsAfterTax) * productCost / 100;
  const payable = n(s.prodPayable);
  const adjusted = Math.abs(afterTax - costOff - payable) > 0.05;
  const eqFromMoney = payable / divisor;
  const eqSet = s.eqSetByManager === true || Math.abs(eqFromMoney - eq) > 0.01;
  const toEq: (Row | false)[] = [
    { label: 'Collected', value: money(gross) },
    prepaidOff >= 0.005 && { label: `Prepaid counts at ${pct(prepaidW * 100)}`, value: `−${money(prepaidOff)}`, tone: 'minus' },
    billedOff >= 0.005 && { label: `Billed counts at ${pct(billedW * 100)}`, value: `−${money(billedOff)}`, tone: 'minus' },
    noTaxOnCash && n(s.prodCash) > 0 && { label: 'Cash is counted with no tax taken off', tone: 'note' },
    { label: <>Tax taken off ({pct(taxRate)}){!taxFromLine && <span className="v2-mut"> · the center’s current rate</span>}</>, value: `−${money(taxOff)}`, tone: 'minus' },
    productCost > 0 && { label: `Product cost (${pct(productCost)})`, value: `−${money(costOff)}`, tone: 'minus' },
    { label: 'Payable', value: money(payable), tone: 'total' },
    adjusted && { label: 'Payable includes the asphalt job shares worked out on the day.', tone: 'note' },
    { label: `÷ ${divisor} per EQ`, value: `${fix(eqFromMoney)} EQ` },
    eqSet ? { label: 'EQ set by the manager for this day', value: `${fix(eq)} EQ`, tone: 'total' } : { label: 'Your EQ', value: `${fix(eq)} EQ`, tone: 'total' },
  ];

  // ── the rate ──
  const parts = has(s.basePayoutRate);
  const rateRows: (Row | false)[] = parts ? [
    { label: `Base (${teamSize > 1 ? 'team' : 'solo'})`, value: money(n(s.basePayoutRate)) },
    { label: <>Alumni <span className="v2-mut">· year {n(s.contractorYear) || 1}, {n(s.daysBefore)} day{n(s.daysBefore) === 1 ? '' : 's'} worked before this day</span></>, value: `+${money(n(s.alumniRate))}`, tone: n(s.alumniRate) ? 'plus' : undefined },
    { label: <>Silver <span className="v2-mut">· {n(s.silverHats)} Silver Hat{n(s.silverHats) === 1 ? '' : 's'}</span></>, value: `+${money(n(s.silverRate))}`, tone: n(s.silverRate) ? 'plus' : undefined },
    { label: 'Rate per EQ', value: money(rate), tone: 'total' },
  ] : [
    { label: 'Rate per EQ', value: money(rate), tone: 'total' },
    { label: 'Base, Alumni and Silver weren’t kept separately for this day.', tone: 'note' },
  ];

  // ── the pay ──
  const production = has(s.productionComm) ? n(s.productionComm) : eq * rate;
  const upsellPct = season === 'aeration' ? 15 : 10;
  const upsell = n(s.upsellComm), ios = n(s.iosComm), bonus = n(s.bonuses), rental = n(s.machineRental);
  // the old one-person sheet rows repeat machine rental as "deductions"
  const deductions = !s.source && n(s.deductions) === rental ? 0 : n(s.deductions);
  const total = n(line.total_payout);
  const sum = production + upsell + ios + bonus - rental - deductions;
  const payRows: (Row | false)[] = [
    { label: `${fix(eq)} EQ × ${money(rate)}`, value: money(production) },
    (upsell || n(s.upsellPayable)) ? { label: `Upsells: ${money(n(s.upsellPayable))} payable × ${upsellPct}%`, value: `+${money(upsell)}`, tone: 'plus' } : false,
    ios ? { label: `IOS: ${fix(n(s.iosCount), teamSize > 1 ? 2 : 0)} × $5`, value: `+${money(ios)}`, tone: 'plus' } : false,
    bonus ? { label: 'Bonuses', value: `+${money(bonus)}`, tone: 'plus' } : false,
    rental ? { label: 'Machine rental', value: `−${money(rental)}`, tone: 'minus' } : false,
    deductions ? { label: 'Deductions', value: `−${money(deductions)}`, tone: 'minus' } : false,
    Math.abs(total - sum) >= 0.01 && { label: 'Adjusted on the day', value: `${total - sum > 0 ? '+' : '−'}${money(Math.abs(total - sum))}`, tone: total - sum > 0 ? 'plus' : 'minus' },
    { label: 'Day total', value: money(total), tone: 'total' },
    n(s.crackfillerCost) > 0 && season === 'sealing' && { label: `Crackfill used: ${money(n(s.crackfillerCost))} (your share). The payslip takes the crackfill % off your earnings.`, tone: 'note' },
  ];

  return (
    <div>
      <Section title="The day" rows={day} />
      <Section title="Money collected" rows={collected} />
      <Section title="From money to EQ" rows={toEq} />
      <Section title="Your rate per EQ" rows={rateRows} />
      <Section title="Pay" rows={payRows} />
    </div>
  );
};
