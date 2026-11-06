import { describe, expect, it } from 'vitest';
import { locationSteps } from './rep';

describe('locationSteps', () => {
  it('gives the iPhone steps (Safari Websites, aA)', () => {
    const h = locationSteps('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    expect(h.phone).toBe('iPhone');
    expect(h.steps.join(' ')).toMatch(/Safari Websites/);
    expect(h.steps.join(' ')).toMatch(/aA/);
  });
  it('gives the Android steps', () => {
    expect(locationSteps('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile').phone).toBe('Android');
  });
  it('falls back for anything else', () => {
    expect(locationSteps('Mozilla/5.0 (Windows NT 10.0)').steps).toHaveLength(1);
  });
});
