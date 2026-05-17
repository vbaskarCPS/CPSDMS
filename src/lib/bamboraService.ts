// src/lib/bamboraService.ts
import { supabase } from './supabase';

export interface BamboraTransaction {
  idempotency_key: string;
  status: 'processing' | 'approved' | 'declined' | 'error';
  amount: string | null;
  client_name: string | null;
  response_data: Record<string, any>;
  created_at: string;
}

/**
 * Fetch all bambora_idempotency rows for a given session date.
 * sessionDate format: 'YYYY-MM-DD'
 * Uses browser-local timezone to determine day boundaries.
 * Returns transactions sorted newest first.
 */
export async function getTransactionsForDate(
  sessionDate: string
): Promise<BamboraTransaction[]> {
  if (!sessionDate) return [];

  // Parse YYYY-MM-DD and build local-time start/end boundaries
  const [yearStr, monthStr, dayStr] = sessionDate.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1; // JS months are 0-indexed
  const day = parseInt(dayStr, 10);

  const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
  const endOfDay = new Date(year, month, day + 1, 0, 0, 0, 0);

  const { data, error } = await supabase
    .from('bambora_idempotency')
    .select('*')
    .gte('created_at', startOfDay.toISOString())
    .lt('created_at', endOfDay.toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch bambora transactions:', error);
    throw error;
  }

  return (data || []) as BamboraTransaction[];
}