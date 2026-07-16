// Archon JWT token storage.
//
// localStorage is chosen deliberately: the Keeper Operator API is mounted on
// a separate listener and consumed only from the operator's trusted browser
// environment (internal network). XSS mitigation is handled on the keeper's
// CSP side (post-MVP) and via minimal trust in third-party UI code (lock-deps,
// dependency review). A cookie-based session was rejected: openapi.yaml
// requires Bearer-auth; moving to cookies is a separate backend slice.
//
// TTL is checked by parsing JWT.exp (without verifying the signature). This is NOT
// validation — it is an auto-clear so the UI doesn't send a token that's obviously
// expired. Server-side verification remains the Keeper's responsibility.

const KEY = 'soul-stack.jwt';

interface JwtPayload {
  exp?: number;
  sub?: string;
  iss?: string;
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

export interface OperatorIdentity {
  aid: string;
  expiresAt: Date | null;
}

export const tokenStore = {
  get(): string | null {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return null;
    if (isExpired(raw)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return raw;
  },

  set(token: string): void {
    localStorage.setItem(KEY, token);
  },

  clear(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  },

  identity(): OperatorIdentity | null {
    const token = tokenStore.get();
    if (!token) return null;
    const payload = decodePayload(token);
    if (!payload?.sub) return null;
    return {
      aid: payload.sub,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
    };
  },
};
