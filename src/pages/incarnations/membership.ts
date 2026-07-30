// Pure helpers for the incarnation membership roster (NIM-232).
//
// Kept out of the components so the two things that are easy to get wrong stay
// testable on their own:
//
//   1. The bind reply is idempotent and BOTH of its lists are nullable on the
//      wire (`array | null`). `reply.bound.length` crashes the page — every read
//      goes through [bindOutcome].
//   2. The server has three distinct refusals behind two status codes, and the
//      operator needs to be told them apart: 403 is either "no permission" or
//      "one of the SIDs is outside your soul scope, so NOTHING was bound", and
//      422 is either an unknown SID or a host that is not connected. We
//      discriminate on what the server actually returned in `detail`, never on a
//      guess about which one is more likely.

import i18n from '../../i18n';
import { ApiError } from '../../api/client';
import type { IncarnationMemberBindReply } from '../../api/keeper';

// Wire constraints of IncarnationMemberBindRequest — validated client-side so a
// typo reads as a sentence instead of coming back as a 400/422 from huma.
export const SID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,253}$/;
export const MAX_BIND_SIDS = 200;

export type BindValidation =
  | { ok: true }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'tooMany'; count: number }
  | { ok: false; reason: 'badSid'; sid: string };

/** Shape-check of the SID list before POST .../members. */
export function validateBindSids(sids: string[]): BindValidation {
  if (sids.length === 0) return { ok: false, reason: 'empty' };
  if (sids.length > MAX_BIND_SIDS) return { ok: false, reason: 'tooMany', count: sids.length };
  for (const sid of sids) {
    if (!SID_PATTERN.test(sid)) return { ok: false, reason: 'badSid', sid };
  }
  return { ok: true };
}

export interface BindOutcome {
  bound: string[];
  alreadyMember: string[];
}

/**
 * Null-safe read of the bind reply. The split is the whole point of the
 * idempotent contract: "bound 3" is a lie when two of them were members
 * already, so callers render the two counts separately.
 */
export function bindOutcome(reply: IncarnationMemberBindReply | undefined | null): BindOutcome {
  return {
    bound: reply?.bound ?? [],
    alreadyMember: reply?.already_member ?? [],
  };
}

/** Human-readable summary of one bind call — both halves, never just the total. */
export function bindSummary(outcome: BindOutcome): string {
  const t = i18n.t.bind(i18n);
  const parts: string[] = [];
  if (outcome.bound.length > 0) {
    parts.push(t('incarnations:memberBoundCount', { n: outcome.bound.length }));
  }
  if (outcome.alreadyMember.length > 0) {
    parts.push(t('incarnations:memberAlreadyCount', { n: outcome.alreadyMember.length }));
  }
  if (parts.length === 0) return t('incarnations:memberBindNothing');
  return parts.join(' · ');
}

/**
 * Maps a bind failure onto a sentence that says WHICH gate refused.
 *
 * 403 carrying a soul-scope detail is the all-or-nothing per-host gate: the
 * request was rejected WHOLE, so the message must not read as a plain "access
 * denied" — the operator has to know that the other SIDs were not bound either.
 */
export function prettyBindError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (!(err instanceof ApiError)) return String(err);
  const detail = err.detail || err.message;
  if (err.status === 403) {
    if (isOutOfScope(detail)) return t('incarnations:memberBindOutOfScope', { detail });
    return t('incarnations:memberBindForbidden');
  }
  if (err.status === 422 || err.status === 400) {
    if (isNotConnected(detail)) return t('incarnations:memberBindNotConnected', { detail });
    if (isUnknownSid(detail)) return t('incarnations:memberBindUnknownSid', { detail });
    return t('errors:generic', { status: err.status, detail });
  }
  if (err.status === 404) return t('incarnations:incarnationNotFound');
  return t('errors:generic', { status: err.status, detail });
}

/** Unbind refuses on the same per-host scope gate, but only ever for one SID. */
export function prettyUnbindError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (!(err instanceof ApiError)) return String(err);
  const detail = err.detail || err.message;
  if (err.status === 403) {
    if (isOutOfScope(detail)) return t('incarnations:memberUnbindOutOfScope', { detail });
    return t('incarnations:memberUnbindForbidden');
  }
  if (err.status === 404) return t('incarnations:incarnationNotFound');
  return t('errors:generic', { status: err.status, detail });
}

// Server wording (keeper/internal/api/handlers/incarnation_members.go,
// bindRejectionProblem). Matched loosely — a reworded detail degrades to the
// generic branch, it never mislabels one cause as the other.
function isOutOfScope(detail: string): boolean {
  return /outside the operator's soul scope/i.test(detail);
}

function isNotConnected(detail: string): boolean {
  return /not connected/i.test(detail);
}

function isUnknownSid(detail: string): boolean {
  return /unknown sid/i.test(detail);
}
