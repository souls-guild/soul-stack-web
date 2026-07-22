import { ApiError } from '../../api/client';

/** 404 on /v1/plugins/sigils means the Sigil subsystem is not enabled in Keeper. */
export function isSigilDisabled(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
