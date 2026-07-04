// Синтетические apply_runs.sid, не адресующие Soul (NIM-36): keeper-side задача
// (on: keeper, backend KeeperTargetSID) и run-sentinel аборта до dispatch
// (RunSentinelSID). Ссылка /souls/<sid> для них ведёт на несуществующий soul.
export const KEEPER_TARGET_SID = 'keeper';
export const RUN_SENTINEL_SID = '__run__';

// isKeeperSid — sid синтетический, а не реальный Soul. Матч ТОЧНЫЙ: реальный soul
// может зваться soul-keeper-1 / keeper.example.com — их НЕ трогаем.
export function isKeeperSid(sid: string): boolean {
  return sid === KEEPER_TARGET_SID || sid === RUN_SENTINEL_SID;
}
