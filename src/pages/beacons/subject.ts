// The subject of a Vigil / Decree — WHO the rule applies to.
//
// A subject is EXACTLY ONE of four dimensions (NIM-280):
//
//   sid          exact SIDs — those hosts and nothing else
//   incarnation  service+name — every host on that incarnation's roster
//   coven        labels — a host carrying one, and every member of an
//                incarnation carrying one
//   trait        key/value — the same two-level reach, on the traits map
//
// The wire shape is nested (`subject: { sid: [...] }`) because two of the
// dimensions are pairs that mean nothing apart: an incarnation is
// service+name, a trait is key+value. Nesting makes a half-written subject
// unspellable rather than a 422.
//
// It replaced a flat `sid` (one string) XOR `coven` (labels), which could not
// say "the hosts of this incarnation" at all. The flat fields are gone from
// the request schema, and `additionalProperties: false` rejects a leftover one
// with 400 "unknown field in request body" — before `required` is consulted,
// so the operator is told neither which field nor that `subject` is missing
// (NIM-475).

import type { components } from '../../api/types.gen';

export type Subject = components['schemas']['Subject'];

export const SUBJECT_DIMENSIONS = ['sid', 'incarnation', 'coven', 'trait'] as const;
export type SubjectDimension = (typeof SUBJECT_DIMENSIONS)[number];

// Element forms, mirroring the backend validator so a subject keeper would
// reject never leaves the form. The two pair dimensions carry their pattern in
// the OpenAPI schema as well (SubjectIncarnation / SubjectTrait) and
// subjectContract.test.ts holds these three against it; `sid` and `coven` are
// plain `string` items in the spec, so their form is only checked backend-side
// and the patterns here are transcribed from it.
export const SID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,253}$/;
export const COVEN_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const SERVICE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const INCARNATION_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const TRAIT_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;

// One form's subject state. Every dimension keeps its own fields side by side,
// so switching the picker back and forth does not discard what was typed.
export interface SubjectDraft {
  dimension: SubjectDimension;
  sids: string[];
  service: string;
  incarnation: string;
  covens: string[];
  traitKey: string;
  traitValue: string;
}

export function emptySubjectDraft(): SubjectDraft {
  return {
    dimension: 'sid',
    sids: [],
    service: '',
    incarnation: '',
    covens: [],
    traitKey: '',
    traitValue: '',
  };
}

// buildSubject emits ONLY the picked dimension. The other three keys are left
// out entirely rather than sent empty: `{ sid: [], coven: ['prod'] }` is two
// dimensions to a reader and one to the validator, and that ambiguity is what
// the one-of-four invariant exists to remove.
export function buildSubject(draft: SubjectDraft): Subject {
  switch (draft.dimension) {
    case 'sid':
      return { sid: draft.sids };
    case 'incarnation':
      return { incarnation: { service: draft.service.trim(), name: draft.incarnation.trim() } };
    case 'coven':
      return { coven: draft.covens };
    case 'trait':
      return { trait: { key: draft.traitKey.trim(), value: draft.traitValue.trim() } };
  }
}

// validateSubjectDraft returns an i18n key for the first problem, or null when
// the draft builds a subject keeper will accept. Both halves of a pair are
// required — a half-written `incarnation` is the shape that would be stored
// and then silently never match.
export function validateSubjectDraft(draft: SubjectDraft): string | null {
  switch (draft.dimension) {
    case 'sid': {
      if (draft.sids.length === 0) return 'beacons:errSubjectSidRequired';
      if (draft.sids.some((s) => !SID_PATTERN.test(s))) return 'beacons:errSubjectSidForm';
      return null;
    }
    case 'incarnation': {
      const service = draft.service.trim();
      const name = draft.incarnation.trim();
      if (!service || !name) return 'beacons:errSubjectIncarnationPair';
      if (!SERVICE_PATTERN.test(service)) return 'beacons:errSubjectServiceForm';
      if (!INCARNATION_PATTERN.test(name)) return 'beacons:errSubjectIncarnationForm';
      return null;
    }
    case 'coven': {
      if (draft.covens.length === 0) return 'beacons:errSubjectCovenRequired';
      if (draft.covens.some((c) => !COVEN_PATTERN.test(c))) return 'beacons:errSubjectCovenForm';
      return null;
    }
    case 'trait': {
      const key = draft.traitKey.trim();
      const value = draft.traitValue.trim();
      if (!key || !value) return 'beacons:errSubjectTraitPair';
      if (!TRAIT_KEY_PATTERN.test(key)) return 'beacons:errSubjectTraitKeyForm';
      return null;
    }
  }
}

// subjectDimensionOf reports which dimension a stored subject carries, or null
// when it carries none. Null is not "every host": a subject is required on
// both registries, so a response without one is a subject the reader failed to
// understand — say so instead of rendering reach the rule does not have.
export function subjectDimensionOf(subject: Subject | undefined | null): SubjectDimension | null {
  if (!subject) return null;
  if (subject.sid && subject.sid.length > 0) return 'sid';
  if (subject.incarnation) return 'incarnation';
  if (subject.coven && subject.coven.length > 0) return 'coven';
  if (subject.trait) return 'trait';
  return null;
}

// formatSubject renders a subject in the grammar an operator writes it in —
// the same one the backend uses in audit records, logs and 422 diagnostics, so
// a selector reads identically wherever it surfaces. Returns null for a
// subject with no dimension; the caller supplies the wording for that.
export function formatSubject(subject: Subject | undefined | null): string | null {
  if (!subject) return null;
  switch (subjectDimensionOf(subject)) {
    case 'sid':
      return `sid=${(subject.sid ?? []).join(',')}`;
    case 'incarnation':
      return `incarnation=${subject.incarnation?.service ?? ''}.${subject.incarnation?.name ?? ''}`;
    case 'coven':
      return `coven=${(subject.coven ?? []).join(',')}`;
    case 'trait':
      return `trait.${subject.trait?.key ?? ''}=${subject.trait?.value ?? ''}`;
    default:
      return null;
  }
}
