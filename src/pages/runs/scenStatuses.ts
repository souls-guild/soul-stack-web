import type { RunStatus, RunsStatsReply } from '../../api/keeper';

// Aggregate run statuses of the Scenario segment (stat boxes + status filter).
// `satisfies` rejects a value the enum lacks; src/test/scenStatuses.test.ts rejects
// an enum value missing here, so the next run status cannot skip both silently.
export const SCEN_STATUSES = [
  'applying',
  'success',
  'failed',
  'partial_failed',
  'cancelled',
] as const satisfies readonly RunStatus[];

// partial_failed is offered only by a keeper whose stats carry its bucket. This UI
// ships from main while the value arrives on a core release branch, so the same
// bundle can be served by a keeper that has no such bucket and answers
// status=partial_failed with 422. Stats never received (loading, or the first fetch
// failed) count as "no"; a failed refetch keeps the last reply, and with it the answer.
export function scenStatusesServed(stats: RunsStatsReply | undefined): readonly RunStatus[] {
  if (stats?.all && 'partial_failed' in stats.all) return SCEN_STATUSES;
  return SCEN_STATUSES.filter((s) => s !== 'partial_failed');
}
