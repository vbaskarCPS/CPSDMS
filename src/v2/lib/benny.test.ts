import { describe, expect, it } from 'vitest';
import { speakable } from './benny';

describe('speakable', () => {
  it('reads the first sentences without markdown or list marks', () => {
    expect(speakable('**9 open prebooks** in Surrey, on 7 routes.\n- NSR64: 1\n- SES07: 2\nOpen Master Bookings for the list.'))
      .toBe('9 open prebooks in Surrey, on 7 routes. NSR64: 1. SES07: 2.');
  });
  it('keeps a short answer whole', () => {
    expect(speakable("Chris Hinch's cell is 780 202 8951.")).toBe("Chris Hinch's cell is 780 202 8951.");
  });
});
