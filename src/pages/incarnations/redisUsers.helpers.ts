export interface RedisUser {
  name: string;
  perms?: unknown;
  state?: unknown;
}

// state.redis_users: v14 - typed array [{name,perms,state}] (ADR-062 AclUser);
// legacy (before 005_to_006) - map name->{perms,state}. Normalize both, don't crash on garbage.
export function normalizeRedisUsers(raw: unknown): RedisUser[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((u): u is Record<string, unknown> => Boolean(u) && typeof u === 'object')
      .map((u) => ({
        name: typeof u.name === 'string' ? u.name : '',
        perms: u.perms ?? u.acl,
        state: u.state,
      }))
      .filter((u) => u.name.length > 0);
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([name, v]) => {
        const rec = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
        return { name, perms: rec.perms ?? rec.acl, state: rec.state };
      })
      .filter((u) => typeof u.name === 'string' && u.name.length > 0);
  }
  return [];
}
