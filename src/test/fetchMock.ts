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
      // Строковые роуты матчатся по префиксу (startsWith).
      // Более специфичные пути (напр. /v1/voyages/{id}/targets) должны идти РАНЬШЕ
      // общего префикса (/v1/voyages/{id}), иначе первый матч будет неверным.
      const route = routes.find((r) => {
        if (r.method && r.method.toUpperCase() !== method) return false;
        if (r.url instanceof RegExp) return r.url.test(urlStr);
        return urlStr.startsWith(r.url);
      });
      if (!route) {
        // Graceful fallback для audit — не роняем тесты компонентов, которые
        // добавили секцию уведомлений (VoyageDetail, HeraldDetail).
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
