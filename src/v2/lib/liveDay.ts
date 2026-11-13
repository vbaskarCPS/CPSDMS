// src/v2/lib/liveDay.ts — the oldest day still live at a center (the top bar's day chip). null when none, or on a failure.
import { db } from './client';

export async function liveDay(centerId: string): Promise<string | null> {
  try {
    const { data } = await db.from('days').select('day').eq('center_id', centerId).eq('state', 'live').order('day', { ascending: true }).limit(1);
    return (data as { day: string }[] | null)?.[0]?.day || null;
  } catch { return null; }
}
