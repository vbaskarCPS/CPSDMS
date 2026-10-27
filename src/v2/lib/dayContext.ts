// The season, rate card and service behind a day at a center (late arrivals, payouts).
import { listRateCards, listSeasons, regionTax } from './data';
import { cardFor, defaultRateCard, type RateCardData } from './rateCard';
import { centerService, type Service } from './permissions';
import { db } from './client';

export interface DayContext { card: RateCardData; seasonYear: number; service: Service }

export async function dayContext(centerId: string, date: string, region: string): Promise<DayContext> {
  const seasons = await listSeasons(centerId);
  const s = seasons.find(x => x.starts_on <= date && date <= x.ends_on) || null;
  const cards = s ? await listRateCards(s.id) : [];
  // no season covers the day: the centre's own service (not always sealing)
  const service = (s?.service || centerService(s ? null : await centerServices(centerId))) as Service;
  return { card: cardFor(cards, date)?.data || defaultRateCard(service, regionTax(region)), seasonYear: s?.year || Number(date.slice(0, 4)), service };
}

async function centerServices(centerId: string): Promise<string[]> {
  const { data } = await db.from('command_centers').select('services').eq('id', centerId).maybeSingle();
  return ((data as { services?: string[] } | null)?.services) || [];
}
