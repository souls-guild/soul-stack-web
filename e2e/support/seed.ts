import { type SmokeApi } from './api';
import { pollIncarnationStatus, uniqueName } from './fixtures';

export const READY_STATES = new Set(['ready', 'drift']);

// Registers `count` pending souls in a coven (transport alternates agent/ssh); connected projection — NIM-26.
export async function seedPendingSouls(
  api: SmokeApi,
  coven: string,
  count = 2,
): Promise<string[]> {
  const transports = ['agent', 'ssh'] as const;
  const sids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const sid = `${uniqueName('soul')}-${i}.local`;
    const res = await api.registerSoul(sid, transports[i % transports.length], [coven]);
    if (res.status() >= 300) throw new Error(`registerSoul ${sid} → ${res.status()}`);
    sids.push(sid);
  }
  return sids;
}

// redis create_from_souls into an empty coven → render-assert 422 (size(soulprint.hosts)==1+replicas) DETERMINISTICALLY ALWAYS until NIM-26 → null → spec skips.
export async function seedErrorLocked(
  api: SmokeApi,
  track: (name: string) => void,
): Promise<string | null> {
  if (!(await api.serviceAvailable('redis'))) return null;
  const name = uniqueName('lock');
  const { status } = await api.createIncarnation({
    name,
    service: 'redis',
    create_scenario: 'create_from_souls',
    input: { version: '7.4.1', replicas_per_master: 0, redis_type: 'sentinel' },
    covens: [uniqueName('empty')],
  });
  if (status >= 300) return null;
  track(name);
  const st = await pollIncarnationStatus(api, name, (s) => s === 'error_locked', { tries: 30 });
  return st === 'error_locked' ? name : null;
}

// Bare hello-world incarnation with covens+traits (client-side coven/traits filter, ADR-042); null if the service is unavailable.
export async function seedIncarnationWithCovenTraits(
  api: SmokeApi,
  track: (name: string) => void,
  covens: string[],
  traits: Record<string, unknown>,
): Promise<string | null> {
  if (!(await api.serviceAvailable('hello-world'))) return null;
  const name = uniqueName('ct');
  const { status } = await api.createIncarnation({ name, service: 'hello-world', covens, traits });
  if (status >= 300) return null;
  track(name);
  const st = await pollIncarnationStatus(api, name, (s) => READY_STATES.has(s));
  return READY_STATES.has(st) ? name : null;
}

// Bare-ready hello-world for the destroy test (no create:true → ready without a run); null if the service is unavailable.
export async function seedBareReady(
  api: SmokeApi,
  track: (name: string) => void,
): Promise<string | null> {
  if (!(await api.serviceAvailable('hello-world'))) return null;
  const name = uniqueName('bare');
  const { status } = await api.createIncarnation({ name, service: 'hello-world' });
  if (status >= 300) return null;
  track(name);
  const st = await pollIncarnationStatus(api, name, (s) => READY_STATES.has(s));
  return READY_STATES.has(st) ? name : null;
}
