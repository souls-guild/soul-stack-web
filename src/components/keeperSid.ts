// Synthetic apply_runs.sid values that don't address a Soul (NIM-36): a keeper-side task
// (on: keeper, backend KeeperTargetSID) and a run-sentinel abort before dispatch
// (RunSentinelSID). The /souls/<sid> link for these leads to a nonexistent soul.
export const KEEPER_TARGET_SID = 'keeper';
export const RUN_SENTINEL_SID = '__run__';

// isKeeperSid — the sid is synthetic, not a real Soul. Match is EXACT: a real soul
// could be named soul-keeper-1 / keeper.example.com — those are NOT touched.
export function isKeeperSid(sid: string): boolean {
  return sid === KEEPER_TARGET_SID || sid === RUN_SENTINEL_SID;
}
