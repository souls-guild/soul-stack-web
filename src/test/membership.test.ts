import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import {
  MAX_BIND_SIDS,
  bindOutcome,
  bindSummary,
  prettyBindError,
  prettyUnbindError,
  validateBindSids,
} from '../pages/incarnations/membership';

// Guard tests for the membership contract (NIM-232). Each one pins a property of
// the wire that a straightforward implementation gets wrong.

describe('bindOutcome', () => {
  // `bound` and `already_member` are declared `array | null`. Reading .length off
  // the raw reply takes the page down on a perfectly valid response.
  it('survives null lists', () => {
    expect(bindOutcome({ incarnation: 'redis-prod', bound: null, already_member: null })).toEqual({
      bound: [],
      alreadyMember: [],
    });
  });

  it('survives a missing reply', () => {
    expect(bindOutcome(undefined)).toEqual({ bound: [], alreadyMember: [] });
  });

  it('keeps the two lists apart', () => {
    expect(
      bindOutcome({ incarnation: 'redis-prod', bound: ['a.local'], already_member: ['b.local'] }),
    ).toEqual({ bound: ['a.local'], alreadyMember: ['b.local'] });
  });
});

describe('bindSummary', () => {
  // The bind is idempotent: reporting "bound 2" when one of them was already a
  // member is the exact misreport the split reply exists to prevent.
  it('reports both halves separately, never a single total', () => {
    const text = bindSummary({ bound: ['a.local'], alreadyMember: ['b.local', 'c.local'] });
    expect(text).toMatch(/bound: 1/);
    expect(text).toMatch(/already members: 2/);
    expect(text).not.toMatch(/3/);
  });

  it('omits the half that is empty', () => {
    expect(bindSummary({ bound: ['a.local'], alreadyMember: [] })).not.toMatch(/already/);
    expect(bindSummary({ bound: [], alreadyMember: ['a.local'] })).not.toMatch(/bound:/);
  });

  it('says nothing changed when both halves are empty', () => {
    expect(bindSummary({ bound: [], alreadyMember: [] })).toMatch(/no changes/i);
  });
});

describe('validateBindSids', () => {
  it('rejects an empty selection', () => {
    expect(validateBindSids([])).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects more than the wire cap', () => {
    const many = Array.from({ length: MAX_BIND_SIDS + 1 }, (_, i) => `host-${i}.local`);
    expect(validateBindSids(many)).toEqual({ ok: false, reason: 'tooMany', count: MAX_BIND_SIDS + 1 });
  });

  it('accepts exactly the wire cap', () => {
    const many = Array.from({ length: MAX_BIND_SIDS }, (_, i) => `host-${i}.local`);
    expect(validateBindSids(many)).toEqual({ ok: true });
  });

  it('rejects a SID outside the pattern', () => {
    expect(validateBindSids(['HOST-A.local'])).toEqual({ ok: false, reason: 'badSid', sid: 'HOST-A.local' });
    expect(validateBindSids(['-leading-dash.local'])).toEqual({
      ok: false,
      reason: 'badSid',
      sid: '-leading-dash.local',
    });
  });

  it('accepts a plain FQDN', () => {
    expect(validateBindSids(['host-a.local', '10-1-2-3.internal'])).toEqual({ ok: true });
  });
});

function problem(status: number, detail: string): ApiError {
  return new ApiError(status, 'about:blank', 'error', detail);
}

describe('prettyBindError', () => {
  // The per-host gate is ALL-OR-NOTHING: a plain "access denied" would let the
  // operator believe the other hosts went through.
  it('403 on soul scope says the whole request was rejected', () => {
    const msg = prettyBindError(
      problem(403, "SID(s) outside the operator's soul scope: b.local"),
    );
    expect(msg).toMatch(/none of the selected hosts were bound/i);
    expect(msg).toMatch(/b\.local/);
  });

  it('403 without a scope detail is the plain missing-permission message', () => {
    const msg = prettyBindError(problem(403, 'permission incarnation.bind-member required'));
    expect(msg).toMatch(/incarnation\.bind-member/);
    expect(msg).not.toMatch(/none of the selected hosts/i);
  });

  // 422 carries two distinct causes. Which one it is comes from the server's
  // detail, never from a guess.
  it('422 tells not-connected apart from unknown-SID', () => {
    const notConnected = prettyBindError(
      problem(422, 'SID(s) not connected — only an onboarded, connected host can be bound: a.local'),
    );
    const unknown = prettyBindError(
      problem(422, 'unknown SID(s) (not in the soul registry): ghost.local'),
    );
    expect(notConnected).toMatch(/not connected/i);
    expect(notConnected).not.toMatch(/registry/i);
    expect(unknown).toMatch(/registry/i);
    expect(unknown).not.toMatch(/^Some hosts are not connected/);
  });

  it('an unrecognised 422 detail degrades to the generic error, keeping the detail', () => {
    const msg = prettyBindError(problem(422, "field 'sids' must contain at least one SID"));
    expect(msg).toMatch(/sids/);
  });

  it('404 is the incarnation, not the host', () => {
    expect(prettyBindError(problem(404, 'incarnation redis-prod not found'))).toMatch(
      /[Ii]ncarnation/,
    );
  });
});

describe('prettyUnbindError', () => {
  it('403 on soul scope names the host boundary, not the permission', () => {
    const msg = prettyUnbindError(problem(403, "SID a.local is outside the operator's soul scope"));
    expect(msg).toMatch(/soul scope/i);
    expect(msg).not.toMatch(/incarnation\.unbind-member/);
  });

  it('403 without a scope detail is the missing-permission message', () => {
    expect(prettyUnbindError(problem(403, 'forbidden'))).toMatch(/incarnation\.unbind-member/);
  });
});
