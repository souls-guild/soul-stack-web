import { useCallback, useRef, useState } from 'react';
import { emptySubjectDraft, type SubjectDraft } from './subject';

// useSubjectDraft holds the subject draft in state (to render) AND in a ref (to
// read at submit time). They are not interchangeable.
//
// ChipsInput keeps a half-typed token inside itself and commits it on Enter,
// space, comma or blur. The blur arm is the one that fires when an operator
// types a SID and goes straight for Create — so the last change to the subject
// can land in the same gesture as the submit that reads it. `read()` returns the
// value as of the last change rather than the last render, which keeps the
// submitted body independent of whether React re-rendered between the two
// events.
//
// Without it the failure is silent in the worst way: the SID sits in the field
// and the form answers "at least one SID is required".
//
// `set` takes a PATCH rather than a whole draft for the same reason: merging
// onto the ref keeps two changes in one tick from overwriting each other, which
// merging onto the last rendered value would not.
export function useSubjectDraft() {
  const [draft, setDraft] = useState<SubjectDraft>(emptySubjectDraft);
  const latest = useRef(draft);
  const set = useCallback((patch: Partial<SubjectDraft>) => {
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
  }, []);
  const read = useCallback(() => latest.current, []);
  return { draft, set, read };
}
