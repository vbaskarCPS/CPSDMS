// src/lib/serviceGuide.ts — the price guide the crews show at the door (map logsheet › Gallery).
// BC lawn rejuvenation: copied from the BC Service Guide and the BC Lawn Care Agreement. Prices are
// before GST; the guide prints each one with 5% GST added (shown the same way here).

/** A lot size column, as the guide names and describes it. */
export interface LotSize { key: string; label: string; detail: string }
/** One priced line: one price per lot size (null = ask for a quote). */
export interface PriceRow { name: string; note?: string; prices: (number | null)[]; highlight?: boolean }
export interface PriceTable { title: string; blurb?: string; rows: PriceRow[] }
export interface ServiceGuide {
  title: string; region: string; gstRate: number; lots: LotSize[];
  /** packages first (what most people buy), then the single services */
  tables: PriceTable[];
  /** what's in each package */
  packages: { name: string; includes: string[]; note?: string }[];
  surcharges: string[];
  notes: string[];
}

export const BC_LOTS: LotSize[] = [
  { key: 'FO', label: 'FO', detail: 'Front only, under 50 ft wide' },
  { key: '1', label: 'Lot 1', detail: 'Under 40 ft wide, 100 ft deep or less' },
  { key: '2', label: 'Lot 2', detail: '40–49 ft wide, 100 ft deep or less' },
  { key: '3', label: 'Lot 3', detail: '50–59 ft wide, 100 ft deep or less' },
  { key: '4', label: 'Lot 4', detail: '60–69 ft wide, 100 ft deep or less' },
  { key: '5', label: 'Lot 5', detail: 'Over 70 ft wide or over 100 ft deep' },
];

export const BC_LAWN_REJUV: ServiceGuide = {
  title: 'Service guide', region: 'BC', gstRate: 0.05, lots: BC_LOTS,
  tables: [
    {
      title: 'Packages',
      rows: [
        { name: 'Lawn Rejuvenation+', note: '15% discount', prices: [340, 425, 495, 595, 695, null], highlight: true },
        { name: 'Golf Course Package', note: 'No power raking', prices: [240, 275, 295, 345, 395, null] },
        { name: 'Star Plan Pro', note: 'Spring, summer & fall', prices: [450, 550, 650, 750, 850, null] },
      ],
    },
    {
      title: 'Single services',
      rows: [
        { name: 'De-thatching / Power raking', note: 'Raking & bagging, not bag removal', prices: [150, 200, 250, 300, 350, null] },
        { name: 'Spring core aeration', prices: [60, 70, 80, 100, 120, null] },
        { name: 'Spring over-seeding', prices: [80, 90, 100, 125, 150, null] },
        { name: 'Spring fertilization', prices: [50, 60, 70, 80, 90, null] },
        { name: 'Spring lime treatment', prices: [50, 60, 70, 80, 90, null] },
      ],
    },
  ],
  packages: [
    { name: 'Lawn Rejuvenation+', includes: ['Core aeration', 'De-thatching (raking & bagging)', 'Fertilization', 'Over-seeding', 'Lime treatment'], note: 'Our premiere program: 15% off the services on their own.' },
    { name: 'Golf Course Package', includes: ['Core aeration', 'Fertilization', 'Over-seeding', 'Lime treatment'] },
    { name: 'Star Plan Pro', includes: ['Spring: core aeration, fertilization, over-seeding, lime', 'Summer: fertilization', 'Fall: core aeration, fertilization, over-seeding, lime'], note: '9 applications through the year.' },
  ],
  surcharges: ['Extra moss', 'Additional product application (seed, fertilizer, lime)', 'Chafer beetle repair'],
  notes: [
    'Lot 5 (over 70 ft wide or over 100 ft deep): we quote it at the door.',
    'Prices are before GST; the smaller number adds 5% GST.',
    'CPS confirms the lot size before starting.',
  ],
};

/** A price with GST, as the guide prints it ("$446.25"). */
export const withGst = (price: number, rate: number) => Math.round(price * (1 + rate) * 100) / 100;
export const money = (n: number) => `$${n % 1 ? n.toFixed(2) : n.toLocaleString('en-CA')}`;

/** The guide for this logsheet, if there is one: BC (West) lawn rejuvenation. */
export function serviceGuideFor(seasonType: string | null | undefined, region: string | null | undefined): ServiceGuide | null {
  return seasonType === 'lawn_rejuv' && region === 'West' ? BC_LAWN_REJUV : null;
}
