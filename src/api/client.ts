// HTTP client for the Keeper Operator API.
//
// Soul Stack auth model:
//   - Authorization: Bearer <JWT> (ADR-013/014).
//   - The token is issued by bootstrap (`keeper init --archon=...`) or via
//     POST /v1/operators/{aid}/issue-token (requires an already-authenticated
//     request). In the UI the operator pastes the JWT string into the /login form.
//   - 401 → token-store clears + redirect to /login (see AuthProvider).
//
// Server error envelope — application/problem+json (RFC 7807).

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
    // Empty body or non-JSON — keep defaults.
  }
  if (res.status === 401) {
    // Global 401 handler: clear the token. Redirect is handled by AuthProvider/router.
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
  // Empty body — success without a payload (204 No Content, but also
  // 201 Created without a serialized object — the role.create contract).
  // A direct res.json() would fail on an empty stream ("Unexpected end of JSON
  // input"), so we read the text first and only parse it if non-empty.
  const text = await res.text();
  if (text === '') return undefined as T;
  return JSON.parse(text) as T;
}
