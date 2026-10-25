// Archon JWT token storage.
//
// localStorage is chosen deliberately: the Keeper Operator API is mounted on
// a separate listener and consumed only from the operator's trusted browser
// environment (internal network). XSS mitigation is handled on the keeper's
// CSP side (post-MVP) and via minimal trust in third-party UI code (lock-deps,
// dependency review). A cookie-based session was rejected: openapi.yaml
// requires Bearer-auth. A password login (NIM-1051) does get an HttpOnly cookie,
// but only /auth/token reads it: the SPA exchanges it for a short Bearer kept
// here, and /v1 still sees nothing but the Bearer.
//
// A pasted token's TTL is checked by parsing JWT.exp (without verifying the
// signature). This is NOT validation — it is an auto-clear so the UI doesn't
// send a token that's obviously expired. A session Bearer is never dropped by
// this browser's clock: Keeper decides, and its 401 is answered by exchanging
// the session cookie again (client.ts).

const KEY = 'soul-stack.jwt';
// Present while the stored Bearer belongs to a cookie session (a password
// login). The value is a random id of that session: an exchange stores its
// Bearer only if the id is still the one it started with, so an answer that
// arrives after a logout, a pasted token or another login is dropped.
const SESSION_KEY = 'soul-stack.session';
// The AID the session was started for. An exchange whose Bearer names another
// AID means another login replaced the cookie in this browser.
const SESSION_AID_KEY = 'soul-stack.session-aid';
// How the session was signed in to ('local' — a password Keeper checks). Lets
// the Profile offer a password change when the operator record is not
// readable by its own Archon.
const SESSION_METHOD_KEY = 'soul-stack.session-method';
// When this browser stored the session's current Bearer, in ms of this
// browser's clock. Set by every tab that exchanges, so a tab that did not still
// knows how old the shared Bearer is.
const SESSION_GOT_KEY = 'soul-stack.session-got';

interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  iss?: string;
  jti?: string;
}

function decodePayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const payload = decodePayload(token);
  if (!payload?.exp) return false; // no exp — trust the server
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSec;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface OperatorIdentity {
  aid: string;
  expiresAt: Date | null;
  // The token's jti = its operator_jwts row; null for a token minted before
  // per-token accounting (or outside Keeper, like `make dev-jwt`).
  jwtId: string | null;
}

export const tokenStore = {
  get(): string | null {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return null;
    if (!tokenStore.isSession() && isExpired(raw)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return raw;
  },

  set(token: string): void {
    localStorage.setItem(KEY, token);
  },

  // Clears the Bearer only.
  clear(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  },

  // Starts a new cookie session: its Bearer, a fresh session id and the AID
  // the Bearer names, together.
  startSession(token: string, method: string): string {
    const id = newSessionId();
    // Gone first: another tab reading between these writes must not take the
    // previous session's Bearer for a fresh one of this session.
    localStorage.removeItem(SESSION_GOT_KEY);
    localStorage.setItem(SESSION_KEY, id);
    localStorage.setItem(SESSION_METHOD_KEY, method);
    localStorage.setItem(SESSION_AID_KEY, decodePayload(token)?.sub ?? '');
    tokenStore.setSessionBearer(token);
    return id;
  },

  // Stores a Bearer the session cookie was exchanged for. The Bearer goes
  // first: a tab reading between the writes sees the new Bearer with the old
  // timestamp — at worst one exchange too many — never a new timestamp on the
  // old Bearer.
  setSessionBearer(token: string): void {
    localStorage.setItem(KEY, token);
    localStorage.setItem(SESSION_GOT_KEY, String(Date.now()));
  },

  // Whether the session Bearer can go to a raw channel without an exchange:
  // less than half of its own lifetime (exp − iat, both from Keeper's clock)
  // has passed since this browser stored it. Only elapsed time on this
  // browser's clock is compared, never this clock with Keeper's. A Bearer
  // revoked early, or one a backward clock step makes look young, is caught by
  // the refusal of the channel it opens (client.ts rawChannelRefused).
  sessionBearerFresh(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(KEY);
    const got = Number(localStorage.getItem(SESSION_GOT_KEY));
    const payload = raw ? decodePayload(raw) : null;
    if (!payload?.exp || !payload.iat || !got) return false;
    const age = Date.now() - got;
    return age >= 0 && age < ((payload.exp - payload.iat) * 1000) / 2;
  },

  // The session Bearer stops counting as fresh; the next raw channel exchanges.
  markSessionBearerStale(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SESSION_GOT_KEY);
  },

  // How the current cookie session was signed in to; null without one.
  sessionMethod(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return tokenStore.isSession() ? localStorage.getItem(SESSION_METHOD_KEY) : null;
  },

  // The AID the current cookie session was started for; null without one.
  sessionAID(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SESSION_AID_KEY);
  },

  // The AID a token names, without storing it.
  subjectOf(token: string): string | null {
    return decodePayload(token)?.sub ?? null;
  },

  // The id of the current cookie session; null when the Bearer (if any) is a
  // pasted one.
  sessionId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SESSION_KEY);
  },

  isSession(): boolean {
    return tokenStore.sessionId() !== null;
  },

  // Whether a `storage` event about key concerns this store.
  ownsKey(key: string | null): boolean {
    return key === null || key === KEY || key === SESSION_KEY || key === SESSION_AID_KEY || key === SESSION_METHOD_KEY || key === SESSION_GOT_KEY;
  },

  clearSession(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_AID_KEY);
    localStorage.removeItem(SESSION_METHOD_KEY);
    localStorage.removeItem(SESSION_GOT_KEY);
  },

  identity(): OperatorIdentity | null {
    const token = tokenStore.get();
    if (!token) return null;
    const payload = decodePayload(token);
    if (!payload?.sub) return null;
    return {
      aid: payload.sub,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      jwtId: payload.jti ?? null,
    };
  },
};
