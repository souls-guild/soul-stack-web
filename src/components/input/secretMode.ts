// Dual-mode secret intake (ADR-064): the operator sets the secret as a VALUE (plaintext)
// XOR as a PATH (vault-ref). UI invariant — exactly one of the two is active, so
// only the active mode's field is sent.

import { ApiError } from '../../api/client';
import i18n from '../../i18n';

export type SecretMode = 'value' | 'ref';

export interface PickedSecret {
  kind: SecretMode;
  value: string;
}

/**
 * Returns the single field to send for the active mode. XOR by
 * construction: mode=value → plaintext value; mode=ref → vault-ref. An empty
 * (after trim) active input → null (field not sent). Never returns both.
 */
export function pickSecretField(mode: SecretMode, value: string, ref: string): PickedSecret | null {
  const raw = mode === 'value' ? value : ref;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return { kind: mode, value: trimmed };
}

/**
 * Recognizes 422 "plaintext intake disabled" (ADR-064 mitigation a: keeper behind
 * a TLS front + secret_ingest.accept_plaintext). Returns a friendly hint
 * or null — in which case the caller uses its generic error mapping.
 */
export function plaintextDisabledMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 422) {
    const d = (err.detail || err.message || '').toLowerCase();
    if (d.includes('plaintext') && (d.includes('disabled') || d.includes('accept'))) {
      return i18n.t('errors:secretPlaintextDisabled');
    }
  }
  return null;
}
