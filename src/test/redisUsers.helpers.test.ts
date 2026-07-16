/**
 * NIM-74 guard: normalizeRedisUsers normalizes BOTH forms of state.redis_users
 * (typed array v14 and legacy map) and never throws on garbage. Empty/non-string
 * names are filtered out in both branches (otherwise a ghost row would appear in the table).
 */
import { describe, it, expect } from 'vitest';
import { normalizeRedisUsers } from '../pages/incarnations/redisUsers.helpers';

describe('normalizeRedisUsers', () => {
  it('typed-массив [{name,perms,state}] → как есть', () => {
    const raw = [
      { name: 'alice', perms: '~* +@all', state: 'present' },
      { name: 'bob', perms: '~app:* +@read', state: 'present' },
    ];
    expect(normalizeRedisUsers(raw)).toEqual(raw);
  });

  it('legacy-map {name→{perms,state}} → массив {name,perms,state}', () => {
    const raw = {
      alice: { perms: '~* +@all', state: 'present' },
      bob: { perms: '~app:* +@read', state: 'present' },
    };
    expect(normalizeRedisUsers(raw)).toEqual([
      { name: 'alice', perms: '~* +@all', state: 'present' },
      { name: 'bob', perms: '~app:* +@read', state: 'present' },
    ]);
  });

  it('perms берётся из acl-фолбэка в обеих ветках', () => {
    expect(normalizeRedisUsers([{ name: 'x', acl: '~k:*' }])).toEqual([
      { name: 'x', perms: '~k:*', state: undefined },
    ]);
    expect(normalizeRedisUsers({ x: { acl: '~k:*' } })).toEqual([
      { name: 'x', perms: '~k:*', state: undefined },
    ]);
  });

  it('мусор/не-объект → пустой массив', () => {
    expect(normalizeRedisUsers(null)).toEqual([]);
    expect(normalizeRedisUsers(undefined)).toEqual([]);
    expect(normalizeRedisUsers(42)).toEqual([]);
    expect(normalizeRedisUsers('redis_users')).toEqual([]);
    expect(normalizeRedisUsers(true)).toEqual([]);
  });

  it('array-ветка: пустые/не-строковые имена и не-объекты отсеиваются', () => {
    const raw = [
      null,
      'str',
      { perms: 'x' },            // no name -> filtered out
      { name: '', perms: 'y' },  // empty name -> filtered out
      { name: 42 },              // not a string -> filtered out
      { name: {}, perms: 'q' },  // not a string (object) -> filtered out (not "[object Object]")
      { name: 'ok', perms: 'z' },
    ];
    expect(normalizeRedisUsers(raw)).toEqual([
      { name: 'ok', perms: 'z', state: undefined },
    ]);
  });

  it('legacy-map-ветка: пустой ключ-имя отсеивается', () => {
    const raw = { '': { perms: 'x' }, alice: { perms: 'y', state: 'present' } };
    expect(normalizeRedisUsers(raw)).toEqual([
      { name: 'alice', perms: 'y', state: 'present' },
    ]);
  });

  it('пустой массив/пустой объект → пустой массив', () => {
    expect(normalizeRedisUsers([])).toEqual([]);
    expect(normalizeRedisUsers({})).toEqual([]);
  });
});
