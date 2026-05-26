// Хранилище JWT-токена Архонта.
//
// localStorage выбрано осознанно: Keeper Operator API монтируется на
// отдельном listener-е и потребляется только из доверенного browser-окружения
// оператора (внутренняя сеть). XSS-mitigation — на стороне CSP keeper-а
// (post-MVP) и через минимальное доверие к стороннему коду в UI (lock-deps,
// review зависимостей). cookie-based session отвергнута: openapi.yaml
// требует Bearer-auth, переход на cookies — отдельный backend-слайс.
//
// TTL-просмотр выполняется парсингом JWT.exp (без подписи). Это НЕ
// валидация — это auto-clear, чтобы UI не слал заведомо протухший токен.
// Серверная проверка остаётся за Keeper-ом.

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
  if (!payload?.exp) return false; // нет exp — доверяем серверу
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
