// supabase/functions/ms-calendar/busy.ts — a host's calendar feed (.ics) → the times they're busy.
// Recurring events are expanded (with their exceptions and moved occurrences), times are read in the event's own
// time zone, and only "busy" events count: free ones (TRANSP:TRANSPARENT, Google's default for all-day events)
// and cancelled ones are skipped, and so are our own onboarding calls (the booking invite) since they're counted already. Nothing but the times is kept: no titles, places or people.
import ICAL from 'npm:ical.js@2.1.0';

export interface Busy { start: string; end: string }   // ISO, UTC

/** webcal:// links are https:// links. Only https feeds are read. */
export function feedUrl(raw: string): string | null {
  const s = (raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname) || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

/** Milliseconds at a wall-clock time in a time zone (for all-day events and times with no zone). */
function wallInZone(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** Busy times between `from` and `to` (Date), merged where they overlap. All-day events and times without a zone
 *  are read in `tz` (the host's time zone). Throws if the text isn't a calendar. */
export function busyFrom(icsText: string, from: Date, to: Date, tz = 'America/Toronto', maxPerEvent = 400): Busy[] {
  const root = new ICAL.Component(ICAL.parse(icsText));
  if (root.name !== 'vcalendar') throw new Error('That link isn’t a calendar');
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* a broken zone: its events fall back to floating time */ }
  }
  const vevents = root.getAllSubcomponents('vevent');
  // moved/changed occurrences (RECURRENCE-ID) attach to their series
  const series = new Map<string, InstanceType<typeof ICAL.Event>>();
  const loose: InstanceType<typeof ICAL.Event>[] = [];
  for (const ve of vevents) {
    if (!ve.hasProperty('recurrence-id')) { const e = new ICAL.Event(ve); series.set(e.uid || Math.random().toString(), e); }
  }
  for (const ve of vevents) {
    if (!ve.hasProperty('recurrence-id')) continue;
    const ex = new ICAL.Event(ve);
    const base = ex.uid ? series.get(ex.uid) : undefined;
    if (base) base.relateException(ex); else loose.push(ex);
  }
  const toMs = to.getTime(), fromMs = from.getTime();
  const out: Busy[] = [];
  const isBusy = (comp: InstanceType<typeof ICAL.Component>) => {
    const transp = String(comp.getFirstPropertyValue('transp') || 'OPAQUE').toUpperCase();
    const status = String(comp.getFirstPropertyValue('status') || '').toUpperCase();
    return transp !== 'TRANSPARENT' && status !== 'CANCELLED';
  };
  const ms = (t: InstanceType<typeof ICAL.Time>) => {
    const floating = t.isDate || !t.zone || t.zone === ICAL.Timezone.localTimezone || t.zone.tzid === 'floating';
    return floating ? wallInZone(t.year, t.month, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second, tz) : t.toUnixTime() * 1000;
  };
  const push = (s: InstanceType<typeof ICAL.Time>, e: InstanceType<typeof ICAL.Time>) => {
    const a = ms(s), b = ms(e);
    if (!(b > a) || b <= fromMs || a >= toMs) return;
    out.push({ start: new Date(Math.max(a, fromMs)).toISOString(), end: new Date(Math.min(b, toMs)).toISOString() });
  };
  for (const ev of [...series.values(), ...loose]) {
    if (!ev.startDate) continue;
    if (/^ms-meeting-/i.test(ev.uid || '')) continue;   // our own calls (from the booking invite): already counted
    if (!ev.isRecurring()) {
      if (!isBusy(ev.component)) continue;
      push(ev.startDate, ev.endDate || ev.startDate);
      continue;
    }
    const it = ev.iterator();
    let next: InstanceType<typeof ICAL.Time> | null, n = 0, steps = 0;
    while ((next = it.next()) && n < maxPerEvent && steps++ < 20000) {   // a long-running daily series from years back
      if (ms(next) >= toMs) break;
      const d = ev.getOccurrenceDetails(next);
      if (ms(d.endDate) <= fromMs) continue;
      n++;
      if (!isBusy(d.item.component)) continue;
      push(d.startDate, d.endDate);
    }
  }
  // merge overlaps
  out.sort((x, y) => x.start.localeCompare(y.start));
  const merged: Busy[] = [];
  for (const b of out) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) { if (b.end > last.end) last.end = b.end; } else merged.push({ ...b });
  }
  return merged;
}
