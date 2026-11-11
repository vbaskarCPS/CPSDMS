import { describe, expect, it } from 'vitest';
import { mayReportPosition } from './managerPosition';

describe('mayReportPosition', () => {
  it('a manager on their own map reports where they are', () => {
    expect(mayReportPosition({ role: 'RouteManager', userId: 'rm_franklynmitchell' })).toBe(true);
    expect(mayReportPosition({ role: 'RouteManager', userId: 'floater_basvi' })).toBe(true);
  });
  it('someone looking in on a manager’s map never reports as that manager', () => {
    expect(mayReportPosition({ role: 'RouteManager', userId: 'rm_franklynmitchell', lookingIn: true })).toBe(false);
  });
  it('nobody signed in, or not a manager: nothing is reported', () => {
    expect(mayReportPosition(null)).toBe(false);
    expect(mayReportPosition({ role: 'Admin', userId: 'a1' })).toBe(false);
    expect(mayReportPosition({ role: 'RouteManager', userId: '' })).toBe(false);
  });
});
