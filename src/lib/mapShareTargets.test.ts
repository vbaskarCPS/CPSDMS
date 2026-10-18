import { describe, expect, it } from 'vitest';
import { managerIdFromName, sharedWithMe, shareTargets } from './mapShareTargets';

describe('who a manager can share their map with', () => {
  const seats = [{ userId: 'rm_afeezlawal', name: 'Afeez Lawal', role: 'RouteManager' }];
  const accounts = [{ full_name: 'Afeez Lawal' }, { full_name: 'Chad Stevens' }, { full_name: 'Jovan Chung' }];

  it('includes the center\'s managers with no workers or routes today', () => {
    expect(shareTargets(seats, accounts, 'rm_afeezlawal')).toEqual([
      { id: 'rm_chadstevens', name: 'Chad Stevens' }, { id: 'rm_jovanchung', name: 'Jovan Chung' },
    ]);
    expect(shareTargets(seats, accounts, 'floater_stebe').map(t => t.name)).toEqual(['Afeez Lawal', 'Chad Stevens', 'Jovan Chung']);
  });
  it('still lists today\'s managers when the accounts can\'t be read (old sign-in)', () => {
    expect(shareTargets([...seats, { userId: 'rm_chadstevens', name: 'Chad Stevens', role: 'RouteManager' }], [], 'rm_afeezlawal'))
      .toEqual([{ id: 'rm_chadstevens', name: 'Chad Stevens' }]);
  });
  it('makes the same id Start Session gives a manager', () => {
    expect(managerIdFromName("Kyle O'Neil-Smith 2")).toBe('rm_kyleoneilsmith2');
  });
});

describe('who has shared with me', () => {
  it('splits full access from position only, ignoring my own row', () => {
    const seats = [
      { userId: 'rm_afeezlawal', mapSharing: { access: ['rm_chadstevens'], position: [] } },
      { userId: 'rm_jovanchung', mapSharing: { access: [], position: ['rm_chadstevens'] } },
      { userId: 'rm_chadstevens', mapSharing: { access: ['rm_chadstevens'], position: [] } },
      { userId: 'rm_other' },
    ];
    expect(sharedWithMe(seats, 'rm_chadstevens')).toEqual({ access: ['rm_afeezlawal'], position: ['rm_jovanchung'] });
  });
});
