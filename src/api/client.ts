// HTTP-клиент Keeper Operator API.
//
// Auth-модель Soul Stack:
//   - Authorization: Bearer <JWT> (ADR-013/014).
//   - Токен выдаётся bootstrap-ом (`keeper init --archon=...`) или через
//     POST /v1/operators/{aid}/issue-token (требует уже-аутентифицированный
//     запрос). В UI оператор вставляет JWT-строку в форму /login.
//   - 401 → token-store clears + redirect на /login (см. AuthProvider).
//
// Error-envelope сервера — application/problem+json (RFC 7807).

import { tokenStore } from './tokenStore';

export class ApiError extends Error {
  status: number;
  type: string;
  detail: string;
  constructor(status: number, type: string, title: string, detail: string) {
    super(detail || title || `HTTP ${status}`);
    this.status = status;
    this.type = type;
    this.detail = detail || title;
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'network error');
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | string[] | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function rawRequest(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };

  const token = tokenStore.get();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body,
      signal: opts.signal,
    });
  } catch (err) {
    throw new NetworkError(err);
  }
  return res;
}

interface ProblemJson {
  type?: string;
  title?: string;
  detail?: string;
  status?: number;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let problem: ProblemJson = {};
  try {
    problem = (await res.json()) as ProblemJson;
  } catch {
    // Empty body or non-JSON — оставим defaults.
  }
  if (res.status === 401) {
    // Глобальный 401-handler: чистим токен. Redirect делает AuthProvider/router.
    tokenStore.clear();
  }
  throw new ApiError(
    res.status,
    problem.type ?? 'about:blank',
    problem.title ?? res.statusText,
    problem.detail ?? '',
  );
}

export async function apiGet<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, opts);
  await throwIfNotOk(res);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  opts: RequestOptions = {},
): Promise<T> {
  const res = await rawRequest(path, { ...opts, method });
  await throwIfNotOk(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
