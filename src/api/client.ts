// HTTP client for the Keeper Operator API.
//
// Soul Stack auth model:
//   - Authorization: Bearer <JWT> (ADR-013/014).
//   - The Bearer is either pasted into the /login form (a token from
//     `keeper init` or issue-token) or comes from a cookie session: a password
//     login sets an HttpOnly cookie, POST /auth/token exchanges it for a short
//     Bearer (NIM-1051).
//   - 401 with a pasted token → token-store clears + redirect to /login (see
//     AuthProvider), unless another token was stored meanwhile. 401 with a
//     session Bearer → if a newer Bearer is stored already (another request
//     exchanged meanwhile) the request is sent again with it; otherwise the
//     session cookie is exchanged once (one exchange shared by every request
//     refused meanwhile) and the request is sent again. At most two more
//     attempts, never a loop, and none once the session the request was sent
//     under is no longer the stored one — it would go out as someone else. The
//     session ends when Keeper refuses the exchange or a fresh Bearer, or the
//     exchange names another AID than the session's (AuthProvider). None of
//     this applies to the anonymous /auth/* calls, whose 401 is not about the
//     stored token.
//   - A raw channel (WebSocket, SSE) has no 401 retry of its own, so it takes
//     its Bearer from freshBearer(), which exchanges a session cookie first
//     unless the stored Bearer is young (tokenStore.sessionBearerFresh), and
//     reports a refusal through rawChannelRefused().
//
// Server error envelope — application/problem+json (RFC 7807).

import { tokenStore } from './tokenStore';

// SessionHooks — what AuthProvider lends the client for a cookie session.
// refresh exchanges the cookie and stores the new Bearer, resolving true when
// it did (so the request is worth sending again) and false when it did not; it
// ends the session itself when Keeper refuses the exchange. end ends it when
// even a fresh Bearer is refused.
export interface SessionHooks {
  refresh: () => Promise<boolean>;
  end: () => void;
}

let sessionHooks: SessionHooks | null = null;
let refreshing: Promise<boolean> | null = null;

export function setSessionHooks(hooks: SessionHooks | null): void {
  sessionHooks = hooks;
}

// freshBearer — the Bearer for a raw channel (the console WebSocket, a run's
// SSE stream): with a cookie session the cookie is exchanged first, through the
// same shared exchange, since such a channel cannot answer a 401 by retrying.
// A Bearer stored less than half its lifetime ago is handed out as it is:
// every console mount and run page exchanging would drain the login rate
// limit with a dozen tabs open. A pasted token is returned as stored.
export async function freshBearer(): Promise<string | null> {
  if (tokenStore.isSession() && !tokenStore.sessionBearerFresh()) await refreshSession();
  return tokenStore.get();
}

// rawChannelRefused — a raw channel opened with the stored session Bearer
// failed (a console socket reports any failure to open, a refusal among them;
// the browser shows it no status). A Bearer can die before half its lifetime
// (a password reset or a revocation ends its session), so it stops counting as
// fresh, and one exchange runs: it stores a live one for the next open, ends
// the session when Keeper refuses it as a refused request would, or fails and
// leaves the stale mark for the next open to exchange.
export function rawChannelRefused(): void {
  if (!tokenStore.isSession()) return;
  tokenStore.markSessionBearerStale();
  void refreshSession();
}

function refreshSession(): Promise<boolean> {
  if (!sessionHooks) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = sessionHooks.refresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

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
  // A public endpoint outside /v1 (/auth/*): no Bearer is sent, and its 401 is
  // about the credentials or the session cookie in the request, not the stored
  // token, which another tab may be using.
  anonymous?: boolean;
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

async function rawRequest(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };

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

// Sent — the answer, and the credential of the attempt it answers.
interface Sent {
  res: Response;
  token: string | null;
  // The session the request went out under; null for a pasted token or none.
  sid: string | null;
}

// sendRequest — rawRequest, and for a session Bearer refused with 401 while
// that session is still the stored one: the newer Bearer another request
// already stored, else one exchange of the session cookie, and the request
// sent again.
async function sendRequest(path: string, opts: RequestOptions): Promise<Sent> {
  const sid = opts.anonymous ? null : tokenStore.sessionId();
  const sent = opts.anonymous ? null : tokenStore.get();
  const res = await rawRequest(path, opts, sent);
  const first = { res, token: sent, sid };
  if (res.status !== 401 || sid === null || tokenStore.sessionId() !== sid) return first;
  const stored = tokenStore.get();
  if (stored && stored !== sent) {
    const retried = await rawRequest(path, opts, stored);
    if (retried.status !== 401) return { res: retried, token: stored, sid };
  }
  if (!(await refreshSession()) || tokenStore.sessionId() !== sid) return first;
  const token = tokenStore.get();
  const again = await rawRequest(path, opts, token);
  if (again.status === 401 && tokenStore.sessionId() === sid) sessionHooks?.end();
  return { res: again, token, sid };
}

async function throwIfNotOk({ res, token, sid }: Sent, anonymous = false): Promise<void> {
  if (res.ok) return;
  let problem: ProblemJson = {};
  try {
    problem = (await res.json()) as ProblemJson;
  } catch {
    // Empty body or non-JSON — keep defaults.
  }
  // Global 401 handler for a pasted token: clear it, if it is still the one
  // stored — another tab may have pasted or signed in meanwhile. Redirect is
  // handled by AuthProvider/router. A session's Bearer is the session's to
  // keep or end (sendRequest), and an outage of the exchange must not drop it.
  if (res.status === 401 && !anonymous && sid === null && token !== null && tokenStore.get() === token) {
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
  const sent = await sendRequest(path, opts);
  await throwIfNotOk(sent, opts.anonymous);
  return (await sent.res.json()) as T;
}

// apiSendWithStatus — apiSend for a route whose success status carries meaning
// (200 sync vs 202 accepted), with the same session handling.
export async function apiSendWithStatus<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  opts: RequestOptions = {},
): Promise<{ status: number; body: T }> {
  const sent = await sendRequest(path, { ...opts, method });
  await throwIfNotOk(sent, opts.anonymous);
  return { status: sent.res.status, body: (await sent.res.json()) as T };
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  opts: RequestOptions = {},
): Promise<T> {
  const sent = await sendRequest(path, { ...opts, method });
  await throwIfNotOk(sent, opts.anonymous);
  const res = sent.res;
  // Empty body — success without a payload (204 No Content, but also
  // 201 Created without a serialized object — the role.create contract).
  // A direct res.json() would fail on an empty stream ("Unexpected end of JSON
  // input"), so we read the text first and only parse it if non-empty.
  const text = await res.text();
  if (text === '') return undefined as T;
  return JSON.parse(text) as T;
}
