// src/v2/lib/rateCard.ts
//
// The numbers that drive pay for one season at one center. Services stay in code;
// their values live here so a pay change never needs a release. Defaults are taken
// from today's code so nothing changes until someone edits a card:
//   SEASON_CONFIGS (types/index.ts)       — $/EQ, weights, product cost, office flats
//   getTaxRateForRegion (commandCenterService) — 13% East, 5% elsewhere
//   ASPHALT_SPLIT (commandCenterService)  — asphalt 30% cart / 70% RC, upsold 100% RC
//   PayoutToday thresholds                — Green Jacket / Gold Jersey / Silver Hat
//   Workerbook formulas                   — Alumni and Silver steps
import type { Service } from './permissions';

export interface HatThresholds { green: number; gold: number; silver: number }
export interface Step { at: number; amount: number }

export interface RateCardData {
  perEqSolo: number;            // $ per EQ, worker alone
  perEqTeam: number;            // $ per EQ, teams of 2+
  eqDivisor: number;            // payable $ per EQ
  productCostPercent: number;   // taken off production after tax
  officeFlats: { code: string; value: number }[];
  prepaidWeight: number;
  billedWeight: number;
  taxName: string;
  taxRate: number;              // percent
  noTaxOnCashDefault: boolean;  // pre-sets the Start-session switch
  upgradeSplit: { upsell: number; production: number };
  asphaltSplit: { asphaltCart: number; asphaltRc: number; upsoldRc: number } | null; // sealing only
  alumni: { fromYear: number; steps: Step[] };   // at = lifetime days
  silver: { steps: Step[] };                     // at = lifetime Silver Hats in THIS service
  hats: {
    individual: HatThresholds;
    teamOf1: HatThresholds;
    teamOf2: HatThresholds;
    teamOf3Plus: { green: number; gold: number; silverPerMember: number };
  };
  bonusRules: { label: string; kind: 'day_gross_at_least' | 'top_seller' | 'team_battle_win'; threshold: number | null; amount: number }[];
  driverFlat: number;           // $ per driving day
}

const ALUMNI = { fromYear: 2, steps: [{ at: 50, amount: 0.25 }, { at: 200, amount: 0.5 }] };
const SILVER = { steps: [{ at: 2, amount: 0.25 }, { at: 4, amount: 0.5 }, { at: 6, amount: 0.75 }, { at: 8, amount: 1 }] };
const INDIVIDUAL_HATS: HatThresholds = { green: 30, gold: 40, silver: 50 };
const REJUV_TEAM_HATS = { teamOf1: { green: 30, gold: 40, silver: 60 }, teamOf2: { green: 40, gold: 60, silver: 100 }, teamOf3Plus: { green: 60, gold: 100, silverPerMember: 50 } };
const SEALING_TEAM_HATS = { teamOf1: { green: 40, gold: 60, silver: 80 }, teamOf2: { green: 60, gold: 80, silver: 120 }, teamOf3Plus: { green: 80, gold: 120, silverPerMember: 60 } };

export function defaultRateCard(service: Service, tax: { name: string; rate: number }): RateCardData {
  const base = {
    eqDivisor: 25, billedWeight: 0.5, taxName: tax.name, taxRate: tax.rate,
    upgradeSplit: { upsell: 0.8, production: 0.2 }, alumni: ALUMNI, silver: SILVER,
    bonusRules: [], driverFlat: 0,
  };
  switch (service) {
    case 'aeration':
      return { ...base, perEqSolo: 8, perEqTeam: 8, productCostPercent: 0, prepaidWeight: 0.5, noTaxOnCashDefault: false,
        officeFlats: [{ code: 'SP', value: 52.5 }, { code: 'RJ', value: 52.5 }], asphaltSplit: null,
        hats: { individual: INDIVIDUAL_HATS, ...REJUV_TEAM_HATS } };
    case 'lawn_rejuv':
      return { ...base, perEqSolo: 7, perEqTeam: 9, productCostPercent: 25, prepaidWeight: 0.6, noTaxOnCashDefault: true,
        officeFlats: [{ code: 'FSL', value: 157.5 }], asphaltSplit: null,
        hats: { individual: INDIVIDUAL_HATS, ...REJUV_TEAM_HATS } };
    case 'sealing':
      return { ...base, perEqSolo: 6, perEqTeam: 8, productCostPercent: 20, prepaidWeight: 0.5, noTaxOnCashDefault: false,
        officeFlats: [], asphaltSplit: { asphaltCart: 0.3, asphaltRc: 0.7, upsoldRc: 1 },
        hats: { individual: INDIVIDUAL_HATS, ...SEALING_TEAM_HATS } };
    case 'cleaning':
      return { ...base, perEqSolo: 7, perEqTeam: 9, productCostPercent: 0, prepaidWeight: 0.5, noTaxOnCashDefault: true,
        officeFlats: [], asphaltSplit: null,
        hats: { individual: INDIVIDUAL_HATS, ...REJUV_TEAM_HATS } };
  }
}

/** The step amount reached for a value (e.g. lifetime days → Alumni $/EQ). */
export function stepAmount(steps: Step[], value: number): number {
  let amt = 0;
  for (const s of [...steps].sort((a, b) => a.at - b.at)) if (value >= s.at) amt = s.amount;
  return amt;
}

/** Alumni $/EQ: only from the configured contractor year onward. */
export function alumniRate(card: RateCardData, contractorYear: number, lifetimeDays: number): number {
  return contractorYear >= card.alumni.fromYear ? stepAmount(card.alumni.steps, lifetimeDays) : 0;
}

/** Silver $/EQ from lifetime Silver Hats earned in this card's service. */
export function silverRate(card: RateCardData, hatsInService: number): number {
  return stepAmount(card.silver.steps, hatsInService);
}

/** Which version of a season's rate card applies on a given day (ISO date). */
export function cardFor<T extends { version: number; effective_from: string }>(cards: T[], day: string): T | null {
  return [...cards].filter(c => c.effective_from <= day)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version)[0] || null;
}

export function validateRateCard(c: RateCardData): string[] {
  const errs: string[] = [];
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!num(c.perEqSolo) || c.perEqSolo < 0) errs.push('$/EQ solo must be 0 or more');
  if (!num(c.perEqTeam) || c.perEqTeam < 0) errs.push('$/EQ team must be 0 or more');
  if (!num(c.eqDivisor) || c.eqDivisor <= 0) errs.push('EQ divisor must be more than 0');
  if (!num(c.productCostPercent) || c.productCostPercent < 0 || c.productCostPercent > 100) errs.push('Product cost must be 0–100%');
  if (!num(c.taxRate) || c.taxRate < 0 || c.taxRate > 30) errs.push('Tax must be 0–30%');
  for (const [k, v] of [['Prepaid weight', c.prepaidWeight], ['Billed weight', c.billedWeight]] as const)
    if (!num(v) || v < 0 || v > 1) errs.push(`${k} must be between 0 and 1`);
  if (Math.abs(c.upgradeSplit.upsell + c.upgradeSplit.production - 1) > 1e-9) errs.push('Upgrade split must add up to 100%');
  const stepsOk = (s: Step[]) => s.every(x => num(x.at) && num(x.amount) && x.at >= 0 && x.amount >= 0);
  if (!stepsOk(c.alumni.steps)) errs.push('Alumni steps need numbers');
  if (!stepsOk(c.silver.steps)) errs.push('Silver steps need numbers');
  if (!num(c.driverFlat) || c.driverFlat < 0) errs.push('Driver amount must be 0 or more');
  for (const b of c.bonusRules) {
    if (!b.label.trim()) errs.push('Every bonus rule needs a name');
    if (!num(b.amount) || b.amount < 0) errs.push(`Bonus "${b.label}" needs an amount`);
    if (b.kind === 'day_gross_at_least' && (!num(b.threshold) || (b.threshold as number) <= 0)) errs.push(`Bonus "${b.label}" needs a gross threshold`);
  }
  return errs;
}
