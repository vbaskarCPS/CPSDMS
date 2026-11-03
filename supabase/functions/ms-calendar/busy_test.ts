// deno test supabase/functions/ms-calendar/busy_test.ts
const assertEquals = (a: unknown, b: unknown) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error('not equal:\n' + x + '\n' + y); };
import { busyFrom, feedUrl } from './busy.ts';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VTIMEZONE
TZID:America/Toronto
X-LIC-LOCATION:America/Toronto
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:one@x
DTSTART;TZID=America/Toronto:20261103T100000
DTEND;TZID=America/Toronto:20261103T110000
SUMMARY:Dentist
END:VEVENT
BEGIN:VEVENT
UID:standup@x
DTSTART;TZID=America/Toronto:20261102T090000
DTEND;TZID=America/Toronto:20261102T091500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
EXDATE;TZID=America/Toronto:20261104T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:standup@x
RECURRENCE-ID;TZID=America/Toronto:20261106T090000
DTSTART;TZID=America/Toronto:20261106T140000
DTEND;TZID=America/Toronto:20261106T143000
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:holiday@x
DTSTART;VALUE=DATE:20261105
DTEND;VALUE=DATE:20261106
TRANSP:TRANSPARENT
SUMMARY:Birthday
END:VEVENT
BEGIN:VEVENT
UID:offsite@x
DTSTART;VALUE=DATE:20261109
DTEND;VALUE=DATE:20261110
SUMMARY:Offsite (busy all day)
END:VEVENT
BEGIN:VEVENT
UID:ms-meeting-abc@propertystars.app
DTSTART:20261104T150000Z
DTEND:20261104T153000Z
SUMMARY:Taxifi onboarding call
END:VEVENT
BEGIN:VEVENT
UID:gone@x
DTSTART:20261103T200000Z
DTEND:20261103T210000Z
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

Deno.test('busy times: one-offs, a weekly series with an exception and a moved one, free and cancelled skipped', () => {
  const b = busyFrom(ICS, new Date('2026-11-02T00:00:00Z'), new Date('2026-11-10T05:00:00Z'), 'America/Toronto');
  assertEquals(b.map(x => `${x.start}/${x.end}`), [
    '2026-11-02T14:00:00.000Z/2026-11-02T14:15:00.000Z',   // Mon standup 9:00 EST
    '2026-11-03T15:00:00.000Z/2026-11-03T16:00:00.000Z',   // dentist 10:00 EST
    // Wed Nov 4 skipped (EXDATE); birthday is free
    '2026-11-06T19:00:00.000Z/2026-11-06T19:30:00.000Z',   // Fri standup moved to 2 PM
    '2026-11-09T05:00:00.000Z/2026-11-10T05:00:00.000Z',   // all-day busy, in the host's zone (the Mon standup is inside it)
  ]);
});
Deno.test('all-day events follow the host’s time zone', () => {
  const b = busyFrom(ICS, new Date('2026-11-09T00:00:00Z'), new Date('2026-11-11T00:00:00Z'), 'America/Vancouver');
  assertEquals(b[0], { start: '2026-11-09T08:00:00.000Z', end: '2026-11-10T08:00:00.000Z' });
});
Deno.test('feed links', () => {
  assertEquals(feedUrl('webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics'), 'https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
  assertEquals(feedUrl('http://example.com/a.ics'), null);
  assertEquals(feedUrl('https://localhost/a.ics'), null);
  assertEquals(feedUrl('nonsense'), null);
});
