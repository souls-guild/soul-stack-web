import { ApiError } from '../../api/client';

/** 404 на /v1/plugins/sigils означает, что Sigil-подсистема не включена в Keeper-е. */
export function isSigilDisabled(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
