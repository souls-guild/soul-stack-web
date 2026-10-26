import type { Operator, OperatorAuthMethod } from '../../api/keeper';
import { ApiError } from '../../api/client';
import i18n from '../../i18n';

// Only a machine operator — a token-only Archon created through the Operator API —
// can have an owner; for every other Archon the Keeper refuses one (422).
export function isMachineOperator(op: Pick<Operator, 'auth_method' | 'created_via'>): boolean {
  return op.auth_method === 'jwt' && op.created_via === 'user';
}

// A person who can own one: an Archon that signs in itself.
export const OWNER_AUTH_METHODS: readonly OperatorAuthMethod[] = ['local', 'ldap', 'oidc'];

export type OwnerKind = 'archon' | 'synod';

export function ownerBody(kind: OwnerKind, value: string): { owner_aid: string } | { owner_synod: string } {
  return kind === 'archon' ? { owner_aid: value } : { owner_synod: value };
}

// The Keeper's detail says what is wrong with an owner (unknown, revoked, does
// not sign in itself, the operator itself), so it is shown as it is.
export function ownerErrorText(err: unknown): string {
  if (err instanceof ApiError) return i18n.t('errors:generic', { status: err.status, detail: err.detail || err.message });
  return String(err);
}
