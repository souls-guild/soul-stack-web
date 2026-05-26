// Typed-обёртки над Keeper Operator API. Соответствует vendor/openapi/keeper.yaml.
//
// Типы импортируются из ./types.gen.ts (сгенерены `npm run gen:api`).
// types.gen.ts в .gitignore — сгенерится локально; до первого `npm run gen:api`
// узкая часть типов продублирована вручную (минимальный fallback).

import { apiGet, apiSend } from './client';
import type { components } from './types.gen';

// --- Re-export из generated openapi (источник правды) ---

export type IncarnationStatus = components['schemas']['IncarnationStatus'];
export type SoulTransport = components['schemas']['SoulTransport'];
export type SoulStatus = components['schemas']['SoulStatus'];

// IncarnationGetReply — единая проекция incarnation (используется и в list, и в get).
// Старое имя IncarnationSummary оставлено как alias для обратной совместимости.
export type IncarnationGetReply = components['schemas']['IncarnationGetReply'];
export type IncarnationSummary = IncarnationGetReply;
export type IncarnationListReply = components['schemas']['IncarnationListReply'];
export type StateHistoryEntry = components['schemas']['StateHistoryEntry'];
export type IncarnationHistoryReply = components['schemas']['IncarnationHistoryReply'];
export type DriftReport = components['schemas']['DriftReport'];

export type SoulListEntry = components['schemas']['SoulListEntry'];
export type SoulListReply = components['schemas']['SoulListReply'];
export type SoulprintReadReply = components['schemas']['SoulprintReadReply'];
export type SoulprintFacts = components['schemas']['SoulprintFacts'];
export type SoulprintOsFacts = components['schemas']['SoulprintOsFacts'];
export type SoulprintKernelFacts = components['schemas']['SoulprintKernelFacts'];
export type SoulprintCpuFacts = components['schemas']['SoulprintCpuFacts'];
export type SoulprintMemoryFacts = components['schemas']['SoulprintMemoryFacts'];
export type SoulprintNetworkFacts = components['schemas']['SoulprintNetworkFacts'];
export type SoulprintNetworkInterface = components['schemas']['SoulprintNetworkInterface'];

// --- Public-thrown error для случая GetSoulprint → 410 «не приходил». ---

export class SoulprintNotReceivedError extends Error {
  constructor(public sid: string) {
    super(`soulprint ещё не получен для ${sid}`);
    this.name = 'SoulprintNotReceivedError';
  }
}

// --- API ---

export interface ListIncarnationsQuery {
  service?: string;
  status?: IncarnationStatus;
  coven?: string;
  offset?: number;
  limit?: number;
}

export interface ListSoulsQuery {
  coven?: string[];
  status?: SoulStatus;
  transport?: SoulTransport;
  offset?: number;
  limit?: number;
}

export const keeperApi = {
  // health-probe, удобно использовать как «токен валиден?» (через /v1/incarnations).
  ping: () => apiGet<IncarnationListReply>('/v1/incarnations', { query: { limit: 1 } }),

  incarnations: {
    list: (q: ListIncarnationsQuery = {}) =>
      apiGet<IncarnationListReply>('/v1/incarnations', {
        query: {
          service: q.service,
          status: q.status,
          coven: q.coven,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (name: string) =>
      apiGet<IncarnationGetReply>(`/v1/incarnations/${encodeURIComponent(name)}`),
    history: (name: string, q: { offset?: number; limit?: number } = {}) =>
      apiGet<IncarnationHistoryReply>(`/v1/incarnations/${encodeURIComponent(name)}/history`, {
        query: { offset: q.offset, limit: q.limit },
      }),
    checkDrift: (name: string) =>
      apiSend<DriftReport>(`/v1/incarnations/${encodeURIComponent(name)}/check-drift`, 'POST'),
  },

  souls: {
    list: (q: ListSoulsQuery = {}) =>
      apiGet<SoulListReply>('/v1/souls', {
        query: {
          coven: q.coven,
          status: q.status,
          transport: q.transport,
          offset: q.offset,
          limit: q.limit,
        },
      }),
    get: (sid: string) => apiGet<SoulListEntry>(`/v1/souls/${encodeURIComponent(sid)}`),
    // 410 → SoulprintNotReceivedError (запись Soul есть, фактов ещё не приходило).
    // Прочие ошибки пробрасываются как ApiError.
    getSoulprint: async (sid: string): Promise<SoulprintReadReply> => {
      try {
        return await apiGet<SoulprintReadReply>(
          `/v1/souls/${encodeURIComponent(sid)}/soulprint`,
        );
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 410
        ) {
          throw new SoulprintNotReceivedError(sid);
        }
        throw err;
      }
    },
  },
};
