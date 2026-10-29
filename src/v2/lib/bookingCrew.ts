// src/v2/lib/bookingCrew.ts — the small, dependency-free part of Master Bookings that the old app's
// crew screens use (job screen, house sheet): what an "mb:" booking carries for the crew.
export interface Attempt { day: string; kind: 'next_time' | 'cancelled'; by?: string; reason?: string; note?: string; at: string }
export interface VisitLine { label: string; done: boolean; detail?: string }

/** What the crew card shows for an "mb:" booking (the session row's data.mb). */
export interface CrewInfo {
  id: string; list?: string; jobCode?: string; prepaid?: boolean; plan?: string; fieldNotes?: string | null;
  attempts?: Attempt[]; thisYear?: VisitLine[]; history?: { year?: string; service?: string; line?: string; price?: string; contractor?: string; product?: string }[];
}
export const isAppBooking = (id: string | null | undefined) => !!id && id.startsWith('mb:');
/** Gate, dog and sprinkler marks in a note (the old app writes LG and SS into Call 1st). */
export function accessFlags(text: string | null | undefined): { gate: boolean; dog: boolean; sprinkler: boolean } {
  const t = ` ${(text || '').toLowerCase()} `;
  return {
    gate: /\blg\b|\[lg\]|lock(ed)?\s*gate|gate\s*(is\s*)?lock|padlock/.test(t),
    dog: /\bdogs?\b|\bpupp(y|ies)\b|beware of dog/.test(t),
    sprinkler: /\bss\b|sprinkler|irrigation/.test(t),
  };
}
export const NEXT_TIME_REASONS = ['Not home', 'Locked gate', 'Dog in yard', 'Rain', 'Ran out of time', 'Other'] as const;
export const CANCEL_REASONS = ['Customer cancelled', 'Already done', 'Wrong address', 'Other'] as const;
/** "Oct 30 · Locked gate · “side gate padlocked”" */
export function attemptLine(a: Attempt): string {
  const d = new Date(`${a.day}T12:00:00`);
  const day = Number.isNaN(d.getTime()) ? a.day : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return [day, a.kind === 'cancelled' ? 'Cancelled' : null, a.reason, a.note ? `“${a.note}”` : null].filter(Boolean).join(' · ');
}
export const lastAttempt = (list: Attempt[] | null | undefined): Attempt | null =>
  [...(list || [])].sort((a, b) => String(b.at || b.day).localeCompare(String(a.at || a.day)))[0] || null;

