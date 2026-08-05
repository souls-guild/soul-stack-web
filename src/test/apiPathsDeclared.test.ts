/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// Every /v1 path the client calls must exist in the vendored OpenAPI spec.
//
// Nothing else in the suite can catch a route that the backend deleted. Every
// test mocks fetch, and a mock answers 200 to any URL it is handed — so a page
// keeps passing its tests long after the endpoint behind it started answering
// 404. `PATCH /v1/incarnations/{name}/hosts` was removed in NIM-330 and the UI
// went on offering an Add-host button and firing the request for five weeks,
// with a green test asserting the PATCH went out (NIM-435). The declared-vs-used
// comparison is the only check that reads the contract instead of a fixture.
//
// Three limits, so nobody reads this as more coverage than it is:
//   - It compares the client against the VENDORED spec, and nothing checks that
//     copy against a running keeper. A stale vendor/openapi/keeper.yaml keeps
//     this green through exactly the drift it is named after; the `cp` from
//     ../soul-stack/docs/keeper/openapi.yaml is still what makes a backend
//     removal visible at all (a CI freshness check is NIM-441).
//   - It compares paths, not methods. Had the backend dropped only PATCH and
//     kept a GET on the same path, this would stay green — it would have slept
//     through its own founding case, had that removal spared the path (NIM-465).
//   - It reads whole string literals. A path assembled from a prefix variable
//     is invisible to it, and nothing goes red when one appears (NIM-465).

const SPEC = path.resolve('vendor/openapi/keeper.yaml');
const SRC = path.resolve('src');

// Paths that are legitimately absent from the spec, each with the reason it is
// absent. An entry that stops being needed fails the second test: a stale
// exemption is how a fixed path quietly loses its guard.
const EXEMPT: Record<string, string> = {
  '/v1/console':
    'WebSocket endpoint — OpenAPI describes no WS upgrade; the wire contract lives in docs/console-ws-contract.md.',
  '/v1/errand-runs':
    'Removed by the Voyage cutover (Wave 5, ADR-043); the client still calls it — NIM-436.',
  '/v1/errand-runs/{p}':
    'Removed by the Voyage cutover (Wave 5, ADR-043); the client still calls it — NIM-436.',
  '/v1/errand-runs/{p}/events':
    'Removed by the Voyage cutover (Wave 5, ADR-043); the client still calls it — NIM-436.',
};

// `${encodeURIComponent(name)}` and `:id` both stand for one path segment, as
// does `{name}` in the spec — collapse all three so the shapes are comparable.
const normalize = (p: string) =>
  p
    .replace(/\$\{[^}]*\}/g, '{p}')
    .replace(/\{[^}]*\}/g, '{p}')
    .replace(/:[a-zA-Z_]\w*/g, '{p}')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');

function declaredPaths(): Set<string> {
  return new Set(
    readFileSync(SPEC, 'utf-8')
      .split('\n')
      .filter((l) => /^ {2}\/v1\//.test(l))
      .map((l) => normalize(l.trim().replace(/:$/, ''))),
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // src/test mocks paths on purpose; types.gen.ts IS the spec, transcribed.
      if (entry.name !== 'test') out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(entry.name) && entry.name !== 'types.gen.ts') {
      out.push(p);
    }
  }
  return out;
}

function usedPaths(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const body = readFileSync(file, 'utf-8');
    for (const m of body.matchAll(/['"`](\/v1\/[^'"`\s]*)['"`]/g)) {
      const p = normalize(m[1]);
      const where = used.get(p) ?? [];
      if (!where.includes(file)) where.push(file);
      used.set(p, where);
    }
  }
  return used;
}

describe('client API paths exist in the vendored spec', () => {
  it('no call targets a path the backend does not declare', () => {
    const declared = declaredPaths();
    const undeclared = [...usedPaths()]
      .filter(([p]) => !declared.has(p) && !(p in EXEMPT))
      .map(([p, files]) => `${p} <- ${files.map((f) => path.relative(SRC, f)).join(', ')}`)
      .sort();

    expect(
      undeclared,
      'These paths are called by the client and declared nowhere in ' +
        'vendor/openapi/keeper.yaml. Either the backend removed the endpoint ' +
        '(drop the call) or the vendored spec is stale (re-copy it from ' +
        '../soul-stack/docs/keeper/openapi.yaml and run npm run gen:api).',
    ).toEqual([]);
  });

  it('no exemption outlives its reason', () => {
    const declared = declaredPaths();
    const used = usedPaths();
    const stale = Object.keys(EXEMPT)
      .filter((p) => !used.has(p) || declared.has(p))
      .sort();

    expect(
      stale,
      'These paths no longer need an exemption — the call is gone, or the ' +
        'spec now declares the path. Drop them from EXEMPT so the guard covers ' +
        'them again.',
    ).toEqual([]);
  });
});
