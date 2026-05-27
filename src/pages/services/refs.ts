import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { keeperApi, type ServiceRefInfo } from '../../api/keeper';

// Хук-обёртка: тянет /v1/services/{name}/refs. Endpoint может отсутствовать —
// возвращаем `unavailable: true`, caller рисует text input fallback.
export interface RefsQueryResult {
  loading: boolean;
  unavailable: boolean;
  tags: ServiceRefInfo[];
  branches: ServiceRefInfo[];
  defaultRef: string | null;
  error: string | null;
}

export function useServiceRefs(serviceName: string | undefined, enabled = true): RefsQueryResult {
  const q = useQuery({
    queryKey: ['services.refs', serviceName],
    queryFn: () => keeperApi.services.listRefs(serviceName!),
    enabled: Boolean(serviceName) && enabled,
    retry: false,
  });

  return useMemo(() => {
    if (!serviceName) {
      return {
        loading: false,
        unavailable: false,
        tags: [],
        branches: [],
        defaultRef: null,
        error: null,
      };
    }
    if (q.isLoading) {
      return {
        loading: true,
        unavailable: false,
        tags: [],
        branches: [],
        defaultRef: null,
        error: null,
      };
    }
    if (q.error) {
      const status = q.error instanceof ApiError ? q.error.status : 0;
      const unavailable = status === 404 || status === 501 || status === 0 || status >= 500;
      return {
        loading: false,
        unavailable,
        tags: [],
        branches: [],
        defaultRef: null,
        error: unavailable
          ? null
          : q.error instanceof ApiError
            ? `Ошибка ${q.error.status}: ${q.error.message}`
            : String(q.error),
      };
    }
    const items = q.data?.items ?? [];
    const tags = items.filter((r) => r.type === 'tag').slice().sort(semverDesc);
    const branches = items.filter((r) => r.type === 'branch').slice().sort(defaultBranchFirst);
    const defaultRef = items.find((r) => r.is_default)?.name ?? null;
    return { loading: false, unavailable: false, tags, branches, defaultRef, error: null };
  }, [serviceName, q.isLoading, q.error, q.data]);
}

// Стабильная sort-логика: semver desc, не-semver падает в конец.
function semverDesc(a: ServiceRefInfo, b: ServiceRefInfo): number {
  const av = parseSemver(a.name);
  const bv = parseSemver(b.name);
  if (av && bv) {
    for (let i = 0; i < 3; i += 1) {
      if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return a.name.localeCompare(b.name);
  }
  if (av) return -1;
  if (bv) return 1;
  return a.name.localeCompare(b.name);
}

function parseSemver(name: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(name);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function defaultBranchFirst(a: ServiceRefInfo, b: ServiceRefInfo): number {
  const aWeight = branchWeight(a);
  const bWeight = branchWeight(b);
  if (aWeight !== bWeight) return aWeight - bWeight;
  return a.name.localeCompare(b.name);
}

function branchWeight(r: ServiceRefInfo): number {
  if (r.is_default) return 0;
  if (r.name === 'main' || r.name === 'master') return 1;
  return 2;
}
