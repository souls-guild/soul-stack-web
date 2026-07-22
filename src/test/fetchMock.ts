import { vi } from 'vitest';

export interface FetchRoute {
  method?: string;
  url: string | RegExp;
  status?: number;
  body?: unknown;
}

export function installFetchMock(routes: FetchRoute[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // String routes match by prefix (startsWith).
      // More specific paths (e.g. /v1/voyages/{id}/targets) must come BEFORE
      // the general prefix (/v1/voyages/{id}), otherwise the first match would be wrong.
      const route = routes.find((r) => {
        if (r.method && r.method.toUpperCase() !== method) return false;
        if (r.url instanceof RegExp) return r.url.test(urlStr);
        return urlStr.startsWith(r.url);
      });
      if (!route) {
        // Graceful fallback for audit — don't break tests of components that
        // added a notifications section (VoyageDetail, HeraldDetail).
        if (method === 'GET' && urlStr.startsWith('/v1/audit')) {
          return new Response(
            JSON.stringify({ items: [], offset: 0, limit: 50, total: 0 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
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
    }),
  );
}
