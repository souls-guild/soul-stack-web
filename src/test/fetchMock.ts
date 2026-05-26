import { vi } from 'vitest';

export interface FetchRoute {
  method?: string;
  url: string | RegExp;
  status?: number;
  body?: unknown;
}

export function installFetchMock(routes: FetchRoute[]): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const route = routes.find((r) => {
      if (r.method && r.method.toUpperCase() !== method) return false;
      if (r.url instanceof RegExp) return r.url.test(urlStr);
      return urlStr.startsWith(r.url);
    });
    if (!route) {
      return new Response(JSON.stringify({ title: 'not mocked', detail: urlStr }), {
        status: 599,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const status = route.status ?? 200;
    const body = route.body === undefined ? '' : JSON.stringify(route.body);
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}
