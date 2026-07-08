/**
 * NIM-74 guard: normalizeRedisUsers нормализует ОБЕ формы state.redis_users
 * (typed-массив v14 и legacy-map) и никогда не падает на мусоре. Пустые/не-строковые
 * имена отсеиваются в обеих ветках (иначе в таблице появилась бы строка-призрак).
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
      { perms: 'x' },            // нет name → отсев
      { name: '', perms: 'y' },  // пустое имя → отсев
      { name: 42 },              // не-строка → отсев
      { name: {}, perms: 'q' },  // не-строка (объект) → отсев (не «[object Object]»)
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
