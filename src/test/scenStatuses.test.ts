import { describe, it, expect } from 'vitest';
import type { RunStatus, RunsStatsReply } from '../api/keeper';
import { SCEN_STATUSES, scenStatusesServed } from '../pages/runs/scenStatuses';

// `satisfies` on SCEN_STATUSES rejects a value the enum lacks; this rejects an enum
// value missing from it. Re-vendoring a spec whose run status gains a value breaks
// `tsc` here, before the stat boxes and the filter can skip it silently.
type MissingScenStatus = Exclude<RunStatus, (typeof SCEN_STATUSES)[number]>;
type ScenStatusesComplete = [MissingScenStatus] extends [never] ? true : never;
const scenStatusesComplete: ScenStatusesComplete = true;

const bucket = { total: 0, applying: 0, success: 0, failed: 0, cancelled: 0 };

describe('scenario run statuses', () => {
  it('[CONTRACT] every run status of the spec is listed', () => {
    expect(scenStatusesComplete).toBe(true);
  });

  it('offers partial_failed only when the stats carry its bucket', () => {
    const withPartial = { all: { ...bucket, partial_failed: 0 }, last_24h: { ...bucket, partial_failed: 0 } };
    expect(scenStatusesServed(withPartial as RunsStatsReply)).toEqual(SCEN_STATUSES);
    // An older keeper: no such bucket, and ?status=partial_failed is a 422 there.
    const without = scenStatusesServed({ all: bucket, last_24h: bucket } as unknown as RunsStatsReply);
    expect(without).not.toContain('partial_failed');
    expect(without).toEqual(SCEN_STATUSES.filter((s) => s !== 'partial_failed'));
  });

  // Stats still loading, or failed: which keeper this is cannot be told, so the
  // value it may not know is not offered.
  it('does not offer partial_failed while the stats are unknown', () => {
    expect(scenStatusesServed(undefined)).not.toContain('partial_failed');
  });
});
