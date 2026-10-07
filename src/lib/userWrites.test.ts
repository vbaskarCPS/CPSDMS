import { describe, expect, it } from 'vitest';
import { splitPasswords } from './userWrites';

describe('splitPasswords', () => {
  it('drops password from the upsert rows and groups ids by password', () => {
    const { rest, byPassword } = splitPasswords([
      { user_id: 'a', name: 'Ann', password: 'Ann' },
      { user_id: 'b', name: 'Bo', password: 'x' },
      { user_id: 'c', name: 'Cy', password: 'x' },
      { user_id: 'd', name: 'Di', password: '' },
      { user_id: 'e', name: 'Ed' },
    ]);
    expect(rest.every(r => !('password' in r))).toBe(true);
    expect(rest.map(r => r.user_id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect([...byPassword]).toEqual([['Ann', ['a']], ['x', ['b', 'c']]]);
  });
});
