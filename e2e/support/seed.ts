import { type SmokeApi } from './api';
import { pollIncarnationStatus, uniqueName } from './fixtures';

export const READY_STATES = new Set(['ready', 'drift']);

// Регистрирует `count` pending-душ в coven (transport чередуется agent/ssh); connected-проекция — NIM-26.
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

// redis create_from_souls в пустой coven → render-assert 422 (size(soulprint.hosts)==1+replicas) ДЕТЕРМИНИРОВАННО ВСЕГДА до NIM-26 → null → спека скипается.
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

// Bare-инкарнация hello-world с covens+traits (client-side coven/traits-фильтр, ADR-042); null если сервис недоступен.
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

// Bare-ready hello-world для destroy-теста (нет create:true → ready без прогона); null если сервис недоступен.
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
