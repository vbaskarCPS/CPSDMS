// src/v2/lib/bennyWalkLoad.ts — what the start-the-day walk-through reads when it starts, and the roll call's save
// (the same as ticking on the Day page).
import { getCenterType } from './crew';
import { availableManagers, getSession } from './startSession';
import { centerAreas } from './territory';
import { getDay, listRoster, fullName, updateRoster } from './workerbook';
import { listRateCards, listSeasons, regionTax } from './data';
import { cardFor, defaultRateCard } from './rateCard';
import { centerService, type Service } from './permissions';
import { firstStep, lastSettings, type WalkState } from './bennyWalk';

export interface WalkCenter { id: string; region?: string | null; services?: readonly string[] | null }
const pretty = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

/** Everything the walk needs, read once when it starts. A problem (nobody booked, already started) is said instead. */
export async function loadWalk(center: WalkCenter, date: string): Promise<WalkState | string> {
  const day = await getDay(center.id, date);
  if (!day) return `Nobody is booked on ${pretty(date)} yet. Book the crew on the Day page first.`;
  if (await getSession(day.id)) return `${pretty(date)} has already started.`;
  const [type, managers, areas, roster, seasons] = await Promise.all([
    getCenterType(center.id), availableManagers(center.id, date), centerAreas(center.id), listRoster(day.id), listSeasons(center.id)]);
  const season = seasons.find(s => s.starts_on <= date && date <= s.ends_on) || null;
  const service = (season?.service || centerService(center.services)) as Service;
  const card = cardFor(season ? await listRateCards(season.id) : [], date)?.data || defaultRateCard(service, regionTax(center.region || 'East'));
  const last = await lastSettings(center.id, service);
  const roadTrip = type === 'road_trip';
  return {
    step: firstStep(roadTrip), date, roadTrip,
    managers: managers.map(m => ({ id: m.id, name: m.full_name })), groups: [], maps: {},
    areas: areas.map(a => a.name), recent: last?.maps || [],
    crew: roster.map(r => ({ rowId: r.id, hireId: r.hire_id, name: fullName(r.hire.person), here: roadTrip ? !!r.confirmed_at : (r.attendance ?? 'showed') === 'showed' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    money: {
      productCostPercent: last ? last.settings.productCostPercent : card.productCostPercent,
      noTaxOnCash: last ? !!last.settings.noTaxOnCash : card.noTaxOnCashDefault,
      taxName: card.taxName, taxRate: card.taxRate, from: last?.day || null,
    },
  };
}


export async function saveRollCall(rows: { rowId: string; here: boolean }[]): Promise<void> {
  for (const r of rows) await updateRoster(r.rowId, { confirmed: r.here });
}
