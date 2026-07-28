import { ApiError } from '../../api/client';
import i18n from '../../i18n';

// Decodes the server's 409 "would-lock-out-cluster" / "role-builtin" and the
// derived-role refusals (ADR-078) into a human-readable message. Backend returns
// problem+json (ADR-014). Localized via the global i18n instance (helper is a pure
// function, not a hook).
export function prettyRbacError(err: unknown): string {
  const t = i18n.t.bind(i18n);
  if (err instanceof ApiError) {
    const ty = (err.type || '').toLowerCase();
    const d = (err.detail || '').toLowerCase();
    if (err.status === 409) {
      if (ty.includes('lock-out') || d.includes('lock') || d.includes('admin')) {
        return t('errors:selfLockout');
      }
      if (ty.includes('builtin') || d.includes('builtin')) {
        return t('errors:builtinRole');
      }
      // Deletion blocked by derived roles — clearing the link would turn each child's
      // delta into an absolute scope, so the operator re-parents or deletes them first.
      if (ty.includes('role-has-children') || d.includes('derived')) {
        return t('errors:roleHasChildren');
      }
      if (ty.includes('already-exists') || d.includes('already')) {
        return t('errors:roleAlreadyExists');
      }
      return t('errors:conflict', { detail: err.detail || err.message });
    }
    if (err.status === 404) {
      if (d.includes('parent role')) return t('errors:roleParentNotFound');
      return t('errors:notFoundRoleOrOperator');
    }
    if (err.status === 403) {
      if (d.includes('parent')) return t('errors:roleExceedsParent');
      if (d.includes('do not hold')) return t('errors:permissionNotHeld');
      return t('errors:forbidden');
    }
    if (err.status === 422) {
      if (d.includes('cycle')) return t('errors:roleParentCycle');
      if (d.includes('too deep')) return t('errors:roleChainTooDeep');
      return t('errors:validation', { detail: err.detail || err.message });
    }
    return t('errors:generic', { status: err.status, detail: err.detail || err.message });
  }
  return String(err);
}
