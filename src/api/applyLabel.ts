import { ApiError } from './client';
import i18n from '../i18n';
import type { LabelSetRequest } from './keeper';

/**
 * Writes a caption for an entity that has just been created.
 *
 * Every create request in the openapi declares an optional `label`, and the
 * keeper accepts the field and then DROPS it — verified live on 2026-09-05
 * against services, heralds and vigils: the row lands with a NULL label and the
 * create's own reply carries none. `PUT /v1/<registry>/{id}/label` does persist
 * it. So a create form that only put `label` in the body would lose whatever the
 * operator typed, without an error anywhere.
 *
 * Reported as an engine bug; this stays correct either way, because setting the
 * caption to the value it already has is a no-op.
 *
 * Returns null on success, or an operator-facing message when the caption could
 * not be saved. The caller must NOT treat that as a failed create: the entity
 * exists, and re-submitting the form would earn a 409 on the id.
 */
export async function applyLabelAfterCreate(
  set: (body: LabelSetRequest) => Promise<unknown>,
  label: string,
): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;
  try {
    await set({ label: trimmed });
    return null;
  } catch (err) {
    const detail = err instanceof ApiError ? err.detail || err.message : String(err);
    return i18n.t('errors:labelNotSaved', { detail });
  }
}
