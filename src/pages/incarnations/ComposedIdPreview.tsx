import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { keeperApi, type IncarnationResolveIDReply } from '../../api/keeper';

/**
 * Live preview of the incarnation id a create scenario composes from its input
 * components. Stands where the Name field stands for a scenario that does NOT
 * compose — the operator does not type this id, so the form owes them a look at
 * it before the create makes it permanent (the id is the immutable primary key;
 * a wrong one costs a destroy and a re-create).
 *
 * The id is NOT composed here. The keeper resolves it through the same code the
 * create runs, because the template blocks are CEL and a second evaluator in the
 * browser would spell a number or a bool differently and show one identity while
 * the create made another. This component sends the input and renders the answer.
 *
 * What IS local is the character count, which is not composition, and it counts
 * against the ceiling the reply carries rather than a copy of 63 kept here.
 */

/** How close to the ceiling counts as "about to overflow" and turns the counter. */
const NEAR_LIMIT_MARGIN = 8;

/** Milliseconds of quiet before asking the keeper — one call per pause, not per key. */
const DEBOUNCE_MS = 300;

export interface ComposedIdPreviewProps {
  service: string;
  scenario: string;
  /** The create input as filled so far. Partial is the normal case. */
  input: Record<string, unknown>;
  /** Declared covens — sent for permission parity with the create, not composition. */
  covens: string[];
}

export function ComposedIdPreview({ service, scenario, input, covens }: ComposedIdPreviewProps) {
  const { t } = useTranslation();

  // Serialize the request into the query key. Sorting the input keys keeps the key
  // stable when the same values arrive in a different order, so re-renders do not
  // masquerade as new inputs.
  const requestKey = useMemo(
    () => JSON.stringify({ service, scenario, input: sortedEntries(input), covens: [...covens].sort() }),
    [service, scenario, input, covens],
  );

  // Debounce the KEY, not the fetch: react-query then sees one key per pause and
  // caches each distinct input on its own, so stepping back to a previous value
  // answers from cache instead of re-asking.
  const [settledKey, setSettledKey] = useState(requestKey);
  useEffect(() => {
    const id = setTimeout(() => setSettledKey(requestKey), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [requestKey]);

  const q = useQuery({
    queryKey: ['incarnations.resolveId', settledKey],
    queryFn: () =>
      keeperApi.incarnations.resolveId({
        service,
        create_scenario: scenario,
        input,
        covens,
      }),
    enabled: Boolean(service && scenario),
    retry: false,
  });

  const reply = q.data as IncarnationResolveIDReply | undefined;
  const stale = settledKey !== requestKey;

  return (
    <div
      data-testid="composed-id-preview"
      style={{
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:composedIdLabel')}
      </span>

      <ComposedIdValue reply={reply} error={q.error} loading={q.isLoading || stale} />

      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        {t('incarnations:composedIdHint')}
      </span>
    </div>
  );
}

/**
 * The answer line: the id plus whatever the operator has to know about it.
 *
 * Every state renders the SAME three rows — id, counter, status — because this
 * panel sits above the rest of the form and updates on every keystroke. A row that
 * appears and disappears (a reason line, an availability line) shoves the fields
 * below it up and down while the operator is typing into them. So the rows are
 * always present and reserve their height; only their text changes. Emptiness is
 * spelled with a non-breaking space rather than nothing, so a row keeps its line
 * box even with no content.
 *
 * The status row reserves TWO lines: the ceiling refusal names the offending value
 * and wraps, and letting the panel grow by a line when it appears would be the same
 * jump in a smaller form.
 */
function ComposedIdValue({
  reply,
  error,
  loading,
}: {
  reply: IncarnationResolveIDReply | undefined;
  error: unknown;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const view = describe(reply, error, loading, t);

  return (
    <>
      <span
        data-testid={view.valueTestId}
        className="mono"
        style={{ fontSize: 15, minHeight: 20, color: view.valueTone, wordBreak: 'break-all' }}
      >
        {view.value || '\u00a0'}
      </span>

      <span
        data-testid="composed-id-counter"
        style={{ fontSize: 12, minHeight: 16, color: view.counterTone }}
      >
        {view.counter || '\u00a0'}
      </span>

      <span
        data-testid={view.statusTestId}
        style={{ fontSize: 13, minHeight: 36, color: view.statusTone }}
      >
        {view.status || '\u00a0'}
      </span>
    </>
  );
}

/** What the three rows say for the current reply. One place, so no state leaves a row stale. */
function describe(
  reply: IncarnationResolveIDReply | undefined,
  error: unknown,
  loading: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const base = {
    value: '',
    valueTone: 'var(--text)',
    valueTestId: 'composed-id-value',
    counter: '',
    counterTone: 'var(--text-faint)',
    status: '',
    statusTone: 'var(--text-muted)',
    statusTestId: 'composed-id-status',
  };

  // A refused or unreachable preview must say so rather than look like "no id
  // yet": the operator would otherwise keep typing at a form that has stopped
  // answering. A 403 is the create's own refusal arriving early — the composed id
  // or a declared coven is outside their scope — so its detail is the useful text.
  if (error) {
    return {
      ...base,
      status: error instanceof ApiError && error.detail ? error.detail : t('incarnations:composedIdFailed'),
      statusTone: 'var(--danger)',
      statusTestId: 'composed-id-error',
    };
  }

  if (loading || !reply) {
    return {
      ...base,
      value: t('incarnations:composedIdPending'),
      valueTone: 'var(--text-faint)',
      valueTestId: 'composed-id-pending',
    };
  }

  const { composed_id: id, length, max_length: max, valid, invalid_reason: reason } = reply;

  // Nothing composed yet — the operator has not filled the components the id is
  // built from. Say which, in the keeper's words: an unexplained blank is exactly
  // what this preview exists to remove.
  if (!valid && !id) {
    return {
      ...base,
      value: t('incarnations:composedIdPending'),
      valueTone: 'var(--text-faint)',
      valueTestId: 'composed-id-pending',
      status: reason,
      statusTestId: 'composed-id-incomplete',
    };
  }

  const nearLimit = valid && max > 0 && length > max - NEAR_LIMIT_MARGIN;
  const view = {
    ...base,
    value: id,
    valueTone: valid ? 'var(--text)' : 'var(--danger)',
    counter:
      t('incarnations:composedIdCounter', { length, max }) +
      (nearLimit ? ` — ${t('incarnations:composedIdNearLimit')}` : ''),
    counterTone: !valid || nearLimit ? 'var(--warning, #f59e0b)' : 'var(--text-faint)',
  };

  if (!valid) {
    return { ...view, status: reason, statusTone: 'var(--danger)', statusTestId: 'composed-id-invalid' };
  }
  if (reply.available) {
    return { ...view, status: t('incarnations:composedIdFree'), statusTone: 'var(--ok)', statusTestId: 'composed-id-free' };
  }
  // The occupying service is named only when the keeper sends it — it omits the
  // field for a caller who may not see that incarnation, and the form must not
  // invent a placeholder that suggests otherwise.
  return {
    ...view,
    status: reply.taken_by_service
      ? t('incarnations:composedIdTakenBy', { service: reply.taken_by_service })
      : t('incarnations:composedIdTaken'),
    statusTone: 'var(--danger)',
    statusTestId: 'composed-id-taken',
  };
}

/** Key/value pairs in a stable order, so an unordered object yields one query key. */
function sortedEntries(input: Record<string, unknown>): [string, unknown][] {
  return Object.entries(input).sort(([a], [b]) => a.localeCompare(b));
}
