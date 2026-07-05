// Dual-mode приём секрета (ADR-064): оператор задаёт секрет ЗНАЧЕНИЕМ (plaintext)
// XOR ПУТЁМ (vault-ref). UI-инвариант — ровно один из двух активен, поэтому
// отправляем только поле активного режима.

import { ApiError } from '../../api/client';
import i18n from '../../i18n';

export type SecretMode = 'value' | 'ref';

export interface PickedSecret {
  kind: SecretMode;
  value: string;
}

/**
 * Возвращает единственное поле для отправки по активному режиму. XOR by
 * construction: mode=value → plaintext-значение; mode=ref → vault-ref. Пустой
 * (после trim) активный ввод → null (поле не отправляется). Никогда не вернёт оба.
 */
export function pickSecretField(mode: SecretMode, value: string, ref: string): PickedSecret | null {
  const raw = mode === 'value' ? value : ref;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return { kind: mode, value: trimmed };
}

/**
 * Распознаёт 422 «приём plaintext выключен» (ADR-064 митигация a: keeper за
 * TLS-фронтом + secret_ingest.accept_plaintext). Возвращает дружелюбную подсказку
 * или null — тогда вызывающий использует свой generic-маппинг ошибки.
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
