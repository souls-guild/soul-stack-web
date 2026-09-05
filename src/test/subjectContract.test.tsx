/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { parse } from 'yaml';
import { renderWithProviders } from './renderWithProviders';
import { VigilNewForm } from '../pages/beacons/VigilNewForm';
import { DecreeNewForm } from '../pages/beacons/DecreeNewForm';
import { useSubjectDraft } from '../pages/beacons/useSubjectDraft';
import { tokenStore } from '../api/tokenStore';
import {
  SERVICE_PATTERN,
  INCARNATION_PATTERN,
  TRAIT_KEY_PATTERN,
} from '../pages/beacons/subject';

// What the Vigil / Decree forms actually PUT ON THE WIRE, held against the
// vendored request schema.
//
// Every other test here mocks fetch, and a mock accepts any body it is handed —
// so a form can keep a green suite while keeper answers 400 to every submit.
// That is how these two forms went on sending the flat `sid` / `coven` pair for
// as long as they did: the fields had been replaced by a nested `subject` (one
// of four dimensions, NIM-280), `additionalProperties: false` rejected the
// leftovers with "Malformed request / unknown field in request body" before
// `required` was ever consulted, and nothing on this side disagreed (NIM-475).
//
// So this test does not assert a payload shape it was told to expect. It reads
// the contract — `properties`, `required` and `additionalProperties` — and
// replays the rejection keeper would perform:
//
//   - a key absent from `properties` is the 400 above;
//   - a missing `required` key is a 422;
//   - a subject with zero or two dimensions is a 422 from subject.Validate.
//
// It fails on a payload the running keeper would reject, whatever the reason,
// rather than on one particular field name — a new drift of the same class is
// caught without editing this file.
//
// Its one limit is the vendored copy itself: `vendor/openapi/keeper.yaml` is
// synced by hand, so a spec that has fallen behind the backend keeps this green
// through exactly the drift it is named after. Re-syncing it is still a manual
// step before trusting the verdict (a freshness check in CI is NIM-441).

const SPEC = parse(readFileSync(path.resolve('vendor/openapi/keeper.yaml'), 'utf-8'));

interface SchemaShape {
  properties?: Record<string, { $ref?: string; pattern?: string }>;
  required?: string[];
  additionalProperties?: boolean;
}

function schema(name: string): SchemaShape {
  const s = SPEC?.components?.schemas?.[name];
  expect(s, `${name} missing from the vendored spec`).toBeTruthy();
  return s as SchemaShape;
}

// assertMatchesSchema replays what the server does to a request body, in the
// order the server does it — the unknown-field check first, because that is the
// one that answers 400 with no field named. It follows `$ref`s down, so a
// half-written `subject.incarnation` is caught by the schema that declares both
// halves required rather than by a rule restated here.
function assertMatchesSchema(name: string, payload: Record<string, unknown>, at = name) {
  const s = schema(name);
  const props = s.properties ?? {};
  const declared = Object.keys(props);
  expect(
    s.additionalProperties,
    `${at} no longer rejects unknown fields — this test replays a rejection ` +
      'the server would not perform.',
  ).toBe(false);

  const undeclared = Object.keys(payload).filter((k) => !declared.includes(k));
  expect(
    undeclared,
    `These keys are not in ${at}.properties. The server answers 400 ` +
      '"Malformed request / unknown field in request body" — before `required` ' +
      'is consulted, so the operator is told neither which field nor what is ' +
      `missing. Declared: ${declared.join(', ')}.`,
  ).toEqual([]);

  const missing = (s.required ?? []).filter((k) => !(k in payload));
  expect(
    missing,
    `These keys are required by ${at} and the form does not send them.`,
  ).toEqual([]);

  for (const [key, prop] of Object.entries(props)) {
    const value = payload[key];
    if (value === undefined) continue;
    if (prop.pattern !== undefined && typeof value === 'string') {
      expect(
        new RegExp(prop.pattern).test(value),
        `${at}.${key} = ${JSON.stringify(value)} does not match the pattern ` +
          `the spec declares (${prop.pattern}); the server answers 422.`,
      ).toBe(true);
    }
    const ref = prop.$ref?.replace('#/components/schemas/', '');
    if (ref && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assertMatchesSchema(ref, value as Record<string, unknown>, `${at}.${key}`);
    }
  }
}

// A subject is EXACTLY ONE of the four dimensions.
//
// Counting KEYS is not the same test the server runs: `{ sid: [] }` is one key
// on the wire and zero dimensions to subject.Validate, which then answers 422
// for a subject that carries none. So count what the server counts — a
// non-empty list, or a pair with anything in it (either half claims the
// dimension there, so a half-written pair is one dimension and a failure of the
// nested `required` above, not "no dimension at all").
function assertExactlyOneDimension(subject: unknown) {
  const declared = Object.keys(schema('Subject').properties ?? {});
  expect(declared.sort()).toEqual(['coven', 'incarnation', 'sid', 'trait']);
  expect(subject, 'no subject on the payload').toBeTruthy();
  const s = subject as Record<string, unknown>;
  expect(
    Object.keys(s).filter((k) => !declared.includes(k)),
    'undeclared key inside subject',
  ).toEqual([]);

  const filled = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.length > 0;
    if (v !== null && typeof v === 'object') return Object.values(v).some((x) => x !== '' && x != null);
    return false;
  };
  const populated = declared.filter((k) => filled(s[k]));
  expect(
    populated,
    `subject carries ${populated.length} populated dimensions; keeper requires ` +
      'exactly one (subject.Validate). An empty array or an empty pair is a ' +
      `key on the wire but NOT a dimension. Subject: ${JSON.stringify(s)}.`,
  ).toHaveLength(1);
}

function capturePost(urlPrefix: string, spy: (body: Record<string, unknown>) => void) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url.startsWith(urlPrefix)) {
      spy(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      // 599 keeps the form mounted, so one render can submit several times.
      return new Response('{}', { status: 599, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(
      JSON.stringify({ items: [], offset: 0, limit: 200, total: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }));
}

async function typeChips(testId: string, token: string) {
  const container = await screen.findByTestId(testId);
  await userEvent.setup().type(container.querySelector('input') as HTMLInputElement, `${token} `);
}

describe('Vigil / Decree request contract', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('the Vigil form sends a body VigilCreateRequest declares', async () => {
    const posts: Record<string, unknown>[] = [];
    capturePost('/v1/vigils', (b) => posts.push(b));

    renderWithProviders(
      <Routes><Route path="/vigils/new" element={<VigilNewForm />} /></Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    await typeChips('subject-sid', 'host01.example.com');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    assertMatchesSchema('VigilCreateRequest', posts[0]);
    assertExactlyOneDimension(posts[0].subject);
  });

  it('the Decree form sends a body DecreeCreateRequest declares', async () => {
    const posts: Record<string, unknown>[] = [];
    capturePost('/v1/decrees', (b) => posts.push(b));

    renderWithProviders(<DecreeNewForm />, '/decrees/new');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'restart-on-config');
    await user.type(screen.getByLabelText(/on_beacon/i), 'redis-config-changed');
    await user.type(screen.getByLabelText(/^Incarnation$/i), 'redis-prod');
    await user.type(screen.getByLabelText(/action_scenario/i), 'restart');
    await typeChips('subject-sid', 'host01.example.com');
    await user.click(screen.getByRole('button', { name: /Create Decree/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    assertMatchesSchema('DecreeCreateRequest', posts[0]);
    assertExactlyOneDimension(posts[0].subject);
    // incarnation_name is the TARGET of the reaction and travels top-level;
    // reading it as the subject would silently widen the rule's reach.
    expect(posts[0].incarnation_name).toBe('redis-prod');
  });

  it('every dimension the picker offers builds a body the spec declares', async () => {
    const posts: Record<string, unknown>[] = [];
    capturePost('/v1/vigils', (b) => posts.push(b));

    renderWithProviders(
      <Routes><Route path="/vigils/new" element={<VigilNewForm />} /></Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    const picker = screen.getByLabelText('dimension');
    const offered = [...picker.querySelectorAll('option')].map((o) => o.getAttribute('value'));

    await typeChips('subject-sid', 'host01.example.com');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await user.selectOptions(picker, 'incarnation');
    await user.type(screen.getByLabelText('service'), 'redis');
    await user.type(screen.getByLabelText('name'), 'redis-prod');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await user.selectOptions(picker, 'coven');
    await typeChips('subject-coven', 'prod');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await user.selectOptions(picker, 'trait');
    await user.type(screen.getByLabelText('key'), 'owner');
    await user.type(screen.getByLabelText('value'), 'dba');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => expect(posts).toHaveLength(offered.length));
    for (const body of posts) {
      assertMatchesSchema('VigilCreateRequest', body);
      assertExactlyOneDimension(body.subject);
    }
    expect(posts.map((b) => Object.keys(b.subject as object)[0])).toEqual(offered);
  });

  it('useSubjectDraft reads the last change, not the last render', async () => {
    // ChipsInput commits a half-typed token on blur, so the last change to the
    // subject can land in the same gesture as the submit that reads it. The
    // forms therefore read through `read()` instead of the state variable.
    //
    // A rendered test cannot show the difference — testing-library flushes the
    // re-render between blur and click, so a stale closure never forms there.
    // What it can pin down is the property the forms rely on: a read issued in
    // the same tick as the change returns the new value. Swap `read()` back for
    // the state variable and this goes red.
    const seen: (string[] | undefined)[] = [];
    function Probe() {
      const subject = useSubjectDraft();
      return (
        <button
          type="button"
          onClick={() => {
            subject.set({ ...subject.draft, sids: ['host01.example.com'] });
            seen.push(subject.read().sids);
          }}
        >
          commit-then-read
        </button>
      );
    }

    renderWithProviders(<Probe />, '/');
    await userEvent.setup().click(screen.getByRole('button', { name: 'commit-then-read' }));
    expect(seen).toEqual([['host01.example.com']]);
  });

  it('a subject the spec would reject never leaves the form', async () => {
    // The schema checks above only see values that reached a payload, so they
    // cannot tell a form that blocks a bad subject from one that ships it and
    // waits for the 422. This is the half that says the form stops it.
    const posts: Record<string, unknown>[] = [];
    capturePost('/v1/vigils', (b) => posts.push(b));

    renderWithProviders(
      <Routes><Route path="/vigils/new" element={<VigilNewForm />} /></Routes>,
      '/vigils/new',
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^ID/), 'config-changed');
    await user.type(screen.getByLabelText(/^path$/i), '/etc/redis.conf');
    await user.selectOptions(screen.getByLabelText('dimension'), 'incarnation');
    // Upper case: legal in the field, rejected by SubjectIncarnation.service.
    await user.type(screen.getByLabelText('service'), 'REDIS');
    await user.type(screen.getByLabelText('name'), 'redis-prod');
    await user.click(screen.getByRole('button', { name: /Create Vigil/i }));

    await waitFor(() => {
      expect(screen.getByText(/service: kebab-case/i)).toBeInTheDocument();
    });
    expect(posts).toEqual([]);
  });

  it('the form validators use the patterns the spec declares', () => {
    const inc = schema('SubjectIncarnation').properties as Record<string, { pattern?: string }>;
    const trait = schema('SubjectTrait').properties as Record<string, { pattern?: string }>;
    // A validator looser than the spec lets through a subject keeper rejects;
    // a stricter one blocks a legal subject in the form, with no server round
    // trip to correct it.
    expect(SERVICE_PATTERN.source).toBe(inc.service.pattern);
    expect(INCARNATION_PATTERN.source).toBe(inc.name.pattern);
    expect(TRAIT_KEY_PATTERN.source).toBe(trait.key.pattern);
  });
});
