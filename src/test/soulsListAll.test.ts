// Guard tests for `keeperApi.souls.listAll` (NIM-448).
//
// `GET /v1/souls` serves at most 1000 rows per request — a larger `limit` is a
// 400, not a clamp — and pages by offset with an exact `total`. Callers that
// resolve a run target client-side therefore cannot ask once: the hosts past row
// 1000 would drop out of the run with nothing on screen to say so.
//
// What these pin:
//
//  1. IT KEEPS READING until the set runs out, at the page size the server
//     actually serves, walking the offset itself.
//  2. IT STOPS on the first short page and on `offset >= total` — one wasted
//     round-trip per resolution is not free when the preview is live.
//  3. IT DEDUPES by SID: the list is ordered `registered_at DESC, sid ASC`, so a
//     host registered mid-loop prepends and shifts a row into the next page too.
//  4. IT ADMITS TRUNCATION rather than looping forever — past the cap the reply
//     says so, and the caller has something honest to render.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keeperApi } from '../api/keeper';
import { tokenStore } from '../api/tokenStore';

const PAGE = 1000;

function soul(sid: string) {
  return { sid, transport: 'agent', status: 'connected', covens: [], registered_at: '' };
}

// A registry of `size` hosts served the way the backend serves it: honours
// offset/limit, caps the page at PAGE rows, reports the exact total.
function stubRegistry(
  size: number,
  opts: { overlapFrom?: number; overstateTotalAs?: number } = {},
) {
  const calls: Array<{ offset: number; limit: number }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const offset = Number(params.get('offset') ?? 0);
      const limit = Number(params.get('limit') ?? 50);
      calls.push({ offset, limit });
      // Over the wire this is a 400 (`invalid limit N: must be <= 1000`), never a
      // clamp — a walk that asked for more would fail outright, not read wide.
      if (limit > PAGE) {
        return new Response(JSON.stringify({ detail: `invalid limit ${limit}: must be <= ${PAGE}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // overlapFrom: every page after the first re-serves a row of the previous
      // one, the shape a mid-loop registration produces.
      const shift = opts.overlapFrom !== undefined && offset >= opts.overlapFrom ? 1 : 0;
      const start = Math.max(0, offset - shift);
      const items = [];
      for (let i = start; i < Math.min(size, start + limit); i += 1) {
        items.push(soul(`host-${i}`));
      }
      return new Response(
        JSON.stringify({ items, offset, limit, total: opts.overstateTotalAs ?? size }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  return calls;
}

describe('souls.listAll', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('a set smaller than one page is one request, not truncated', async () => {
    const calls = stubRegistry(12);
    const reply = await keeperApi.souls.listAll();

    expect(calls).toEqual([{ offset: 0, limit: PAGE }]);
    expect(reply.items).toHaveLength(12);
    expect(reply.total).toBe(12);
    expect(reply.truncated).toBe(false);
  });

  it('reads every page of a set larger than one page, walking the offset', async () => {
    const calls = stubRegistry(2300);
    const reply = await keeperApi.souls.listAll();

    expect(calls.map((c) => c.offset)).toEqual([0, PAGE, 2 * PAGE]);
    expect(calls.every((c) => c.limit === PAGE)).toBe(true);
    expect(reply.items).toHaveLength(2300);
    // The tail is there — the row the single-page read used to drop.
    expect(reply.items[reply.items.length - 1].sid).toBe('host-2299');
    expect(reply.truncated).toBe(false);
  });

  // The short page is a stop condition in its own right, not a spelling of
  // `offset >= total`: `total` is what the server counted for THAT request, and a
  // walk that trusted it alone would keep asking past the end of a set that shrank.
  it('stops on a short page even when total says there is more', async () => {
    const calls = stubRegistry(1500, { overstateTotalAs: 9000 });
    const reply = await keeperApi.souls.listAll();

    expect(calls.map((c) => c.offset)).toEqual([0, PAGE]);
    expect(reply.items).toHaveLength(1500);
    expect(reply.truncated).toBe(false);
  });

  it('stops on an exact multiple of the page size instead of asking for an empty page', async () => {
    const calls = stubRegistry(2 * PAGE);
    const reply = await keeperApi.souls.listAll();

    expect(calls).toHaveLength(2);
    expect(reply.items).toHaveLength(2 * PAGE);
    expect(reply.truncated).toBe(false);
  });

  // Three pages, with the duplicate landing on the MIDDLE one: the offset the walk
  // uses next is only observable while there is a page after it.
  it('dedupes a row two pages both carry, without re-reading the window it came from', async () => {
    const calls = stubRegistry(2600, { overlapFrom: PAGE });
    const reply = await keeperApi.souls.listAll();

    const sids = reply.items.map((s) => s.sid);
    expect(new Set(sids).size).toBe(sids.length);
    // The offset walks by the PAGE SIZE, not by what survived dedup — stepping by
    // the accumulator re-reads the window the duplicate came from, and on a
    // registry that keeps churning the walk crawls backwards page after page.
    expect(calls.map((c) => c.offset)).toEqual([0, PAGE, 2 * PAGE]);
    expect(sids).toContain('host-2599');
    expect(sids).toHaveLength(2600);
  });

  // Every page, not just the first: a filter dropped on page two would widen the
  // set past what the caller asked for, which is the same class of wrongness as
  // dropping hosts — just in the other direction.
  it('carries the caller filters onto every page it reads', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const offset = Number(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('offset') ?? 0);
        const items = Array.from({ length: offset === 0 ? PAGE : 200 }, (_, i) => soul(`host-${offset + i}`));
        return new Response(JSON.stringify({ items, offset, limit: PAGE, total: PAGE + 200 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const reply = await keeperApi.souls.listAll({ coven: ['prod', 'stage'], status: 'connected' });

    expect(reply.items).toHaveLength(PAGE + 200);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain('coven=prod');
      expect(url).toContain('coven=stage');
      expect(url).toContain('status=connected');
    }
  });

  // The souls list had a keyset mode once; NIM-128 removed it and left the two
  // fields on the wire, always dropped by omitempty. The walk below is offset-only,
  // so if either field ever comes back it is reading a set it cannot page — an
  // approximate `total` would end the loop early, and the offsets may mean nothing.
  // Saying `truncated` turns that into a warning the operator sees instead of a
  // prefix labelled complete.
  it('will not call a read complete when the reply carries a keyset cursor', async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const offset = Number(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('offset') ?? 0);
        calls.push(offset);
        const items = Array.from({ length: PAGE }, (_, i) => soul(`host-${offset + i}`));
        return new Response(
          JSON.stringify({ items, offset, limit: PAGE, total: 5000, next_cursor: 'opaque' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const reply = await keeperApi.souls.listAll();

    expect(reply.truncated).toBe(true);
    expect(reply.items).toHaveLength(PAGE);
    // Stopped on the first page rather than walking offsets that mean nothing in
    // a keyset reply — noticing the field and carrying on regardless would leave
    // the answer just as wrong, only slower.
    expect(calls).toEqual([0]);
  });

  it('will not call a read complete when the total is only approximate', async () => {
    const calls: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(Number(new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('offset') ?? 0));
        // An estimate BELOW the real size is what makes `offset >= total` lie.
        return new Response(
          JSON.stringify({
            items: Array.from({ length: PAGE }, (_, i) => soul(`host-${i}`)),
            offset: 0,
            limit: PAGE,
            total: 400,
            total_approximate: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const reply = await keeperApi.souls.listAll();

    expect(reply.truncated).toBe(true);
    // And it stopped rather than walking offsets that mean nothing in that mode.
    expect(calls).toEqual([0]);
  });

  it('past the page cap it stops and says the answer is a prefix', async () => {
    const calls = stubRegistry(10 * PAGE);
    const reply = await keeperApi.souls.listAll({}, 3);

    expect(calls).toHaveLength(3);
    expect(reply.items).toHaveLength(3 * PAGE);
    expect(reply.total).toBe(10 * PAGE);
    expect(reply.truncated).toBe(true);
  });

  // The cap callers actually get. Everything above passes it explicitly, so the
  // shipped default — the number the truncation warning is calibrated against —
  // would otherwise never be exercised.
  it('defaults to a 20-page cap', async () => {
    const calls = stubRegistry(50 * PAGE);
    const reply = await keeperApi.souls.listAll();

    expect(calls).toHaveLength(20);
    expect(reply.items).toHaveLength(20 * PAGE);
    expect(reply.truncated).toBe(true);
  });
});
