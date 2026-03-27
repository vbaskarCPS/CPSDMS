// src/lib/workerbookNaService.ts
import { supabase } from './supabase';

export type PhoneType = 'cell' | 'alt';

/**
 * Loads all NA counts for every contractor on a given date tab.
 * Returns a Map keyed by "contractorId:phoneType" → count
 */
export async function getNaCountsForTab(
  commandCenterId: string,
  dateTab: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('workerbook_na_counts')
    .select('contractor_id, phone_type, count')
    .eq('command_center_id', commandCenterId)
    .eq('date_tab', dateTab);

  if (error) throw error;

  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(`${row.contractor_id}:${row.phone_type}`, row.count);
  }
  return map;
}

/**
 * Increments the NA count for one contractor + phone type.
 * Inserts a new row if none exists, otherwise increments the existing one.
 * Returns the new count.
 */
export async function incrementNaCount(
  commandCenterId: string,
  contractorId: string,
  dateTab: string,
  phoneType: PhoneType,
): Promise<number> {
  const { data: existing } = await supabase
    .from('workerbook_na_counts')
    .select('id, count')
    .eq('command_center_id', commandCenterId)
    .eq('contractor_id', contractorId)
    .eq('date_tab', dateTab)
    .eq('phone_type', phoneType)
    .maybeSingle();

  if (existing) {
    const newCount = existing.count + 1;
    await supabase
      .from('workerbook_na_counts')
      .update({ count: newCount, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return newCount;
  }

  await supabase
    .from('workerbook_na_counts')
    .insert({
      command_center_id: commandCenterId,
      contractor_id: contractorId,
      date_tab: dateTab,
      phone_type: phoneType,
      count: 1,
    });

  return 1;
}

/**
 * Resets both cell and alt NA counts to 0 for a contractor when they confirm.
 */
export async function clearNaCountsForContractor(
  commandCenterId: string,
  contractorId: string,
  dateTab: string,
): Promise<void> {
  await supabase
    .from('workerbook_na_counts')
    .update({ count: 0, updated_at: new Date().toISOString() })
    .eq('command_center_id', commandCenterId)
    .eq('contractor_id', contractorId)
    .eq('date_tab', dateTab);
}