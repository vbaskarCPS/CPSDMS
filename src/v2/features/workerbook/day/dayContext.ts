// The season, rate card and service behind a day (for adding a late arrival to the live map).
import { listRateCards, listSeasons, regionTax } from '../../../lib/data';
import { cardFor, defaultRateCard, type RateCardData } from '../../../lib/rateCard';
import type { Service } from '../../../lib/permissions';

export interface DayContext { card: RateCardData; seasonYear: number; service: Service }

export async function dayContext(centerId: string, date: string, region: string): Promise<DayContext> {
  const seasons = await listSeasons(centerId);
  const s = seasons.find(x => x.starts_on <= date && date <= x.ends_on) || null;
  const cards = s ? await listRateCards(s.id) : [];
  const service = (s?.service || 'sealing') as Service;
  return { card: cardFor(cards, date)?.data || defaultRateCard(service, regionTax(region)), seasonYear: s?.year || Number(date.slice(0, 4)), service };
}
