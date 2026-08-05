import type { HostTelemetry, IncarnationMember, SoulListEntry } from '../../api/keeper';
import { busiestDisk, epochMs, ratioPct, type HostVitalsRow } from './hostVitals';

// The rows of the Members table (NIM-444), as a pure function of the three replies
// that feed it. No React, no clock, no component state — which is the whole point:
// the freshness column ticks at 1 Hz, and while this derivation lived inside the
// panel's render it ran again on every tick. That was bounded while the aggregate
// was the row source (2000 hosts, capped); the roster that replaced it comes from
// `incarnation.ListMembers`, which has no LIMIT at all (NIM-451).

export interface HostRow extends HostVitalsRow {
  boundAt: string | null;
  boundByAid: string | null;
  tele: HostTelemetry | null;
}

export function buildRow(
  sid: string,
  member: IncarnationMember | null,
  soul: SoulListEntry | null,
  tele: HostTelemetry | null,
): HostRow {
  const l = tele?.latest ?? null;
  const disk = l ? busiestDisk(l.disks) : null;
  return {
    sid,
    // The souls registry WINS over the roster's own status column, and the
    // difference is not cosmetic: `GET /v1/souls` overlays PG with the live
    // stream lease (ADR-006(a)), while `souls.status` in PG is a last-known
    // snapshot the Reaper reconciles lazily. Reading the roster's copy showed a
    // host as `connected` for minutes after it went away — verified against a
    // running Keeper, where the two replies disagreed on the same host. The
    // roster's value is the fallback for a host the registry page did not
    // return; it is right for lifecycle statuses (pending/revoked/expired),
    // which carry no lease and which the overlay leaves alone anyway.
    status: soul?.status ?? member?.status ?? '',
    boundAt: member?.bound_at ?? null,
    boundByAid: member?.bound_by_aid ?? null,
    tele,
    cpu: l ? l.cpu_pct : null,
    memPct: l ? ratioPct(l.mem_used_mb, l.mem_total_mb) : null,
    diskPct: disk ? disk.pct : null,
    net: l ? l.net_rx_bps + l.net_tx_bps : null,
    load1: l ? l.load1 : null,
    uptime: l ? l.uptime_sec : null,
    // A timestamp, not an age: the `fresh` column orders by age, and ordering by
    // age needs no clock. See HostVitalsRow.collectedMs for why that ordering is
    // a refinement of the old one rather than the identical one.
    collectedMs: tele ? epochMs(tele.collected_at) : null,
  };
}

// ROW SOURCE is the roster; telemetry and the souls registry only fill columns of
// a row that already exists. The union at the end is the other half of that rule:
// a host the aggregate named but the roster reply did not carry is still a member
// — the two endpoints scope the same relation slightly differently, and a bind can
// land between the two fetches — so it keeps its row rather than disappearing.
export function buildRows(
  members: readonly IncarnationMember[] | null | undefined,
  hosts: readonly HostTelemetry[] | null | undefined,
  souls: readonly SoulListEntry[] | null | undefined,
): HostRow[] {
  const teleBySid = new Map<string, HostTelemetry>();
  for (const h of hosts ?? []) teleBySid.set(h.sid, h);
  const soulBySid = new Map<string, SoulListEntry>();
  for (const s of souls ?? []) soulBySid.set(s.sid, s);

  const rows = (members ?? []).map((m) =>
    buildRow(m.sid, m, soulBySid.get(m.sid) ?? null, teleBySid.get(m.sid) ?? null),
  );
  const rosterSids = new Set(rows.map((r) => r.sid));
  for (const h of hosts ?? []) {
    if (!rosterSids.has(h.sid)) rows.push(buildRow(h.sid, null, soulBySid.get(h.sid) ?? null, h));
  }
  return rows;
}
