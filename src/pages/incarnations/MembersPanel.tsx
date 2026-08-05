import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Link2, Play, Unlink } from 'lucide-react';
import { Badge, Button, Dot } from '../../components/primitives';
import { KeeperSidCell } from '../../components/KeeperSidCell';
import { UtilTrend } from '../../components/UtilTrend';
import { soulDot, soulTone } from '../../components/status';
import {
  keeperApi,
  type HostTelemetry,
  type IncarnationMember,
  type SoulListEntry,
  type SoulStatus,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { useNow } from '../../hooks/useNow';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { BindMembersModal } from './BindMembersModal';
import { UnbindMemberModal } from './UnbindMemberModal';
import { bindSummary, prettyUnbindError, type BindOutcome } from './membership';
import common from '../common.module.css';
import styles from './MembersPanel.module.css';
import {
  ageSeconds,
  busiestDisk,
  busiestInode,
  formatBps,
  formatBpsShort,
  formatLoad,
  formatMb,
  formatPct,
  formatUptime,
  minMaxLast,
  ratioPct,
  skewMinutes,
  sortHostRows,
  spanSeconds,
  utilTone,
  type HostSortKey,
  type SortDir,
  type VitalsTone,
} from './hostVitals';

// The incarnation's roster and its vitals — ONE list (NIM-444).
//
// This used to be two tables stacked on the Hosts tab showing the same set of
// hosts: GET .../members reads `incarnation_membership`, and GET .../telemetry
// resolves its hosts through that same relation (NIM-124). They were separate
// back when the sets really differed — declared hosts, roster, souls labelled
// coven=<name>, scenario state — and NIM-330/NIM-435 removed the last of those.
// What was left was an operator doing by eye a join the system had already done.
//
// What each part of a row means, and where it comes from:
//   - the ROW exists because the host is on the roster — the membership relation,
//     the thing a run resolves its targets from, edited by bind/unbind here;
//   - the STATUS dot is the Soul's own connection, read from the souls registry
//     because only that endpoint resolves presence live; a fact orthogonal to
//     membership, since a bound host that is down is still a member;
//   - the UTILIZATION columns come from telemetry and read "—" wherever there is
//     none, instead of the row disappearing.
//
// That last point is the behavioural fix, not just less markup. Whenever the
// aggregate came back short, the old "Connected souls" section went empty under
// a non-empty roster — the screen said "there are hosts" and "there are no
// hosts" at once. Two ways that happens, both still live:
//   - the aggregate is unavailable at all (older Keeper / host-vitals off → 404,
//     501), which says nothing about whether the incarnation has hosts;
//   - the aggregate's 2000-host cap is applied BEFORE the scope filter
//     (handlers/telemetry.go), so a scoped caller can get metrics for only part
//     of their roster, or for none of it.
// There is NO separate telemetry permission to lose: the aggregate is gated by
// `RequireAction(incarnation, get)` and the roster by the same action WITH a
// scope selector, so the aggregate's gate is strictly the weaker of the two.
//
// Sparklines are a per-soul on-demand request (the window lives only on the soul
// endpoint), mounted only while a row is expanded → no N-polling. Freshness comes
// from the backend `stale` flag and counts up live via useNow between refetches.
const REFETCH_MS = 15000;
const MEMBERS_KEY = 'incarnation-members';
const TELEMETRY_KEY = 'incarnation-telemetry';
// One page of the souls registry, used ONLY to resolve presence. A member beyond
// it keeps the roster's own status column — see buildRow.
const SOULS_PAGE = 500;

const meterTone: Record<VitalsTone, string> = {
  ok: styles.meter_ok,
  warn: styles.meter_warn,
  danger: styles.meter_danger,
};

const NATURAL_DIR: Record<HostSortKey, SortDir> = {
  host: 'asc',
  status: 'asc',
  cpu: 'desc',
  mem: 'desc',
  disk: 'desc',
  net: 'desc',
  load: 'desc',
  uptime: 'desc',
  fresh: 'asc',
};

interface HostRow {
  sid: string;
  // The Soul's status; '' when neither source knows the host. See buildRow for
  // which of the two sources wins and why.
  status: string;
  boundAt: string | null;
  boundByAid: string | null;
  tele: HostTelemetry | null;
  cpu: number | null;
  memPct: number | null;
  diskPct: number | null;
  net: number | null;
  load1: number | null;
  uptime: number | null;
  ageSec: number | null;
}

function buildRow(
  sid: string,
  member: IncarnationMember | null,
  soul: SoulListEntry | null,
  tele: HostTelemetry | null,
  now: number,
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
    ageSec: tele ? ageSeconds(tele.collected_at, now) : null,
  };
}

export function MembersPanel({ incarnationName }: { incarnationName: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { hasPermission } = useMyPermissions();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<HostSortKey>('host');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [bindOpen, setBindOpen] = useState(false);
  const [unbindSid, setUnbindSid] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [lastBind, setLastBind] = useState<BindOutcome | null>(null);
  const now = useNow(1000);

  // Buttons follow the RIGHT, not the server's answer: unbind is destructive and
  // has a permission of its own, so an operator without it must not see a
  // control that would only fail. hasPermission is optimistic while the
  // permission set loads (see the hook) — that is deliberate, it keeps the
  // buttons from flickering in on every page open.
  const canBind = hasPermission('incarnation.bind-member');
  const canUnbind = hasPermission('incarnation.unbind-member');

  // ROW SOURCE: the roster. Narrowed to the caller's soul scope, so a short list
  // is a legitimate answer rather than a bug — the empty state says so.
  //
  // It polls on the same interval as the vitals below, which the roster read did
  // NOT do while it was a table of its own. It has to now: this reply decides
  // which hosts exist on screen AND which SIDs the run button ships, so a
  // bind/unbind made anywhere else (another operator, a scenario's
  // `core.soul.registered`) would otherwise leave the page targeting a host that
  // is no longer a member until someone navigated away and back.
  const members = useQuery({
    queryKey: [MEMBERS_KEY, incarnationName],
    queryFn: () => keeperApi.incarnations.members(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  // VITALS for those rows. Resolves the same membership relation, but through a
  // different scope gate (it unions in inherited labels, ADR-080), so its host
  // set can be slightly wider — hence the union below rather than a lookup.
  const util = useQuery({
    queryKey: [TELEMETRY_KEY, incarnationName],
    queryFn: () => keeperApi.incarnations.telemetry(incarnationName),
    enabled: Boolean(incarnationName),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  // PRESENCE for those rows, and nothing else — no coven filter, it never adds or
  // removes a host. It is a separate request because only this endpoint answers
  // "is the Soul on the wire right now": it overlays the PG status column with
  // the live stream lease, which the roster read does not do (see buildRow).
  const souls = useQuery({
    queryKey: ['souls-registry', SOULS_PAGE],
    queryFn: () => keeperApi.souls.list({ limit: SOULS_PAGE }),
    refetchInterval: REFETCH_MS,
  });

  const unbindMu = useMutation({
    mutationFn: (sid: string) => keeperApi.incarnations.unbindMember(incarnationName, sid),
    onSuccess: () => {
      setUnbindError(null);
      setUnbindSid(null);
      setLastBind(null);
      qc.invalidateQueries({ queryKey: [MEMBERS_KEY, incarnationName] });
      qc.invalidateQueries({ queryKey: [TELEMETRY_KEY, incarnationName] });
    },
    onError: (err) => setUnbindError(prettyUnbindError(err)),
  });

  const membersStatus = members.error instanceof ApiError ? members.error.status : null;
  // 403 on the roster itself — the caller may not read this incarnation. Soft
  // degrade with an explanation instead of a red box: nothing is broken.
  const rosterForbidden = membersStatus === 403;
  const utilStatus = util.error instanceof ApiError ? util.error.status : null;
  // 404/501 → old Keeper / subsystem off. Neither removes a row any more: the
  // roster is what puts hosts on the screen.
  //
  // A 403 here can only happen together with a 403 on the roster — the aggregate
  // is gated by the weaker of the two rights (see the header comment) — so it is
  // reported only if the roster somehow came back fine, which would mean the two
  // gates diverged backend-side. Without that guard the operator gets two boxes
  // for one missing permission.
  const utilForbidden = utilStatus === 403;
  const utilUnavailable = utilStatus === 404 || utilStatus === 501;

  const memberItems = members.data?.items ?? [];
  const hosts = util.data?.hosts ?? [];
  const teleBySid = new Map<string, HostTelemetry>();
  for (const h of hosts) teleBySid.set(h.sid, h);
  const soulBySid = new Map<string, SoulListEntry>();
  for (const s of souls.data?.items ?? []) soulBySid.set(s.sid, s);

  const rows: HostRow[] = memberItems.map((m) =>
    buildRow(m.sid, m, soulBySid.get(m.sid) ?? null, teleBySid.get(m.sid) ?? null, now),
  );
  // A telemetry host the roster reply did not carry is still a member — the two
  // endpoints scope the same relation slightly differently, and a bind can land
  // between the two fetches. Dropping it would hide a host the previous UI showed.
  const rosterSids = new Set(rows.map((r) => r.sid));
  for (const h of hosts) {
    if (!rosterSids.has(h.sid)) rows.push(buildRow(h.sid, null, soulBySid.get(h.sid) ?? null, h, now));
  }
  const sorted = sortHostRows(rows, sortKey, sortDir);
  const memberSids = rows.map((r) => r.sid);

  // "Run command on these hosts" targets THESE hosts: the SIDs this table lists,
  // which are the membership roster (NIM-443). It used to pass
  // `target_coven=<incarnation name>`, and since NIM-124 a Coven is a label while
  // membership is the relation — so the run reached a different set in both
  // directions. A host carrying the label without being a member was added. And
  // a member without the label was DROPPED, because the wizard's Command
  // workload resolves covens client-side against the raw `souls.coven` column
  // (see run/hostSelector.ts) — the backend's own coven resolution would have
  // found it, since it unions in the labels a host inherits from the
  // incarnations it belongs to, this one's name included. Neither direction is a
  // discrepancy anyone should have to notice on an arbitrary-command workload.
  // Built from `rows`, not `sorted`, so clicking a column header does not
  // rewrite the link. No rows → no honest target, so the button is disabled
  // rather than pointing at everything that happens to carry the label.
  const runHref =
    memberSids.length > 0
      ? `/run?workload=command&target_sids=${encodeURIComponent(memberSids.join(','))}`
      : null;

  const loading = (members.isLoading || util.isLoading) && rows.length === 0;
  // The roster came back readable and empty — say so, rather than blaming telemetry.
  const rosterEmpty = !loading && rows.length === 0 && Boolean(members.data) && !members.error;
  // Rows exist but the aggregate reported no host at all: every metric is a dash,
  // and this says why.
  const noVitals = rows.length > 0 && Boolean(util.data) && hosts.length === 0;
  const colCount = 10 + (canUnbind ? 1 : 0);

  function onSort(key: HostSortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(NATURAL_DIR[key]);
    }
  }
  const ariaSort = (key: HostSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 className={common.sectionTitle} style={{ margin: 0 }}>
          {t('incarnations:membersTitle')}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canBind ? (
            <Button type="button" variant="secondary" onClick={() => setBindOpen(true)} data-testid="bind-members-open">
              <Link2 size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('incarnations:memberBind')}
            </Button>
          ) : null}
          {runHref ? (
            <Link to={runHref} aria-label={t('incarnations:runCommandOnHosts')} data-testid="run-on-hosts">
              <Button type="button" variant="primary">
                <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {t('incarnations:runCommandOnHosts')}
              </Button>
            </Link>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled
              // Only the empty roster is a claim we can make. While the fetch is
              // in flight, or when the roster was refused, "there are no hosts"
              // would be a guess — the note below the button says what happened.
              title={rosterEmpty ? t('incarnations:runCommandNoHosts') : undefined}
              data-testid="run-on-hosts-disabled"
            >
              <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {t('incarnations:runCommandOnHosts')}
            </Button>
          )}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:membersDesc')} {t('incarnations:membersVitalsHint')}
      </p>

      {lastBind ? (
        <div
          style={{
            padding: 'var(--s-3) var(--s-4)',
            background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--success) 30%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}
          data-testid="bind-members-summary"
        >
          {bindSummary(lastBind)}
        </div>
      ) : null}

      {unbindError ? (
        <div className={common.errorBox} data-testid="members-unbind-error">{unbindError}</div>
      ) : null}

      {loading ? <div className={common.loading}>{t('loading')}</div> : null}

      {rosterForbidden ? (
        <div className={common.empty} data-testid="members-forbidden">
          {t('incarnations:membersForbidden')}
        </div>
      ) : null}
      {members.error && !rosterForbidden ? (
        <div className={common.errorBox}>
          {members.error instanceof ApiError
            ? t('errors:generic', { status: members.error.status, detail: members.error.message })
            : String(members.error)}
        </div>
      ) : null}

      {utilForbidden && !rosterForbidden ? (
        <div className={common.empty} data-testid="util-forbidden">
          {t('incarnations:utilForbidden')}
        </div>
      ) : null}
      {utilUnavailable ? (
        <div className={common.empty} data-testid="util-unavailable">
          {t('incarnations:utilUnavailable')}
        </div>
      ) : null}
      {util.error && !utilForbidden && !utilUnavailable ? (
        <div className={common.errorBox}>{t('incarnations:utilLoadFailed', { detail: String(util.error) })}</div>
      ) : null}
      {noVitals ? (
        <div className={common.empty} data-testid="util-empty">
          {t('incarnations:utilEmpty')}
        </div>
      ) : null}

      {rosterEmpty ? (
        <div className={common.empty} data-testid="members-empty">
          {t('incarnations:membersEmpty')}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <table className={common.table} data-testid="members-table">
          <thead>
            <tr>
              <SortHeader label={t('incarnations:utilHost')} col="host" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('host')} />
              <SortHeader label={t('incarnations:utilStatus')} col="status" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('status')} />
              <SortHeader label={t('incarnations:utilCpu')} col="cpu" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('cpu')} />
              <SortHeader label={t('incarnations:utilMem')} col="mem" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('mem')} />
              <SortHeader label={t('incarnations:utilDisk')} col="disk" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('disk')} />
              <SortHeader label={t('incarnations:utilNet')} col="net" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('net')} />
              <SortHeader label={t('incarnations:utilLoad')} col="load" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('load')} />
              <SortHeader label={t('incarnations:utilUptime')} col="uptime" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('uptime')} />
              <SortHeader label={t('incarnations:utilFresh')} col="fresh" active={sortKey} dir={sortDir} onSort={onSort} ariaSort={ariaSort('fresh')} />
              <th style={{ width: 1 }} />
              {canUnbind ? <th style={{ width: 1 }} /> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const l = r.tele?.latest ?? null;
              const open = expanded === r.sid;
              const disk = l ? busiestDisk(l.disks) : null;
              return (
                <Fragment key={r.sid}>
                  <tr>
                    <td className="mono">
                      <KeeperSidCell sid={r.sid} />
                    </td>
                    <td>
                      {r.status ? (
                        <span className={common.statusCell}>
                          <Dot kind={soulDot(r.status as SoulStatus)} />
                          <Badge tone={soulTone(r.status as SoulStatus)}>{r.status}</Badge>
                        </span>
                      ) : (
                        <span className="mono">—</span>
                      )}
                    </td>
                    {l ? (
                      <>
                        <td>
                          <MetricCell value={formatPct(l.cpu_pct)} pct={l.cpu_pct} tone={utilTone(l.cpu_pct)} />
                        </td>
                        <td>
                          <MetricCell
                            value={`${formatMb(l.mem_used_mb)} / ${formatMb(l.mem_total_mb)}`}
                            pct={r.memPct}
                            tone={utilTone(r.memPct)}
                          />
                        </td>
                        <td title={disk?.mount}>
                          {disk ? (
                            <MetricCell value={formatPct(disk.pct)} pct={disk.pct} tone={utilTone(disk.pct)} />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono" title={`↓ ${formatBps(l.net_rx_bps)}  ↑ ${formatBps(l.net_tx_bps)}`}>
                          <NetPair rx={l.net_rx_bps} tx={l.net_tx_bps} />
                        </td>
                        <td
                          className="mono"
                          title={`1m ${formatLoad(l.load1)} · 5m ${formatLoad(l.load5)} · 15m ${formatLoad(l.load15)}`}
                        >
                          {formatLoad(l.load1)}
                        </td>
                        <td className="mono">{formatUptime(l.uptime_sec)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className={styles.mutedCell} data-testid="util-nojoin">
                        {t('incarnations:utilNoData')}
                      </td>
                    )}
                    <td>
                      <Freshness
                        stale={r.tele?.stale ?? true}
                        collectedAt={r.tele?.collected_at}
                        hasData={Boolean(l)}
                        now={now}
                      />
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label={t(open ? 'incarnations:memberCollapseAria' : 'incarnations:memberExpandAria', {
                          sid: r.sid,
                        })}
                        onClick={() => setExpanded(open ? null : r.sid)}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </Button>
                    </td>
                    {canUnbind ? (
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setUnbindError(null);
                            setUnbindSid(r.sid);
                          }}
                          aria-label={t('incarnations:memberUnbindAria', { sid: r.sid })}
                          title={t('incarnations:memberUnbind')}
                          data-testid={`unbind-member-${r.sid}`}
                        >
                          <Unlink size={14} />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                  {open ? (
                    <tr className={styles.sparkRow}>
                      <td colSpan={colCount}>
                        <MemberFacts boundAt={r.boundAt} boundByAid={r.boundByAid} />
                        {l ? <HostTrends sid={r.sid} now={now} /> : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {util.data?.truncated ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{t('incarnations:utilTruncated')}</p>
      ) : null}

      <BindMembersModal
        open={bindOpen}
        incarnationName={incarnationName}
        memberSids={memberSids}
        onClose={() => setBindOpen(false)}
        onBound={(outcome) => setLastBind(outcome)}
      />

      <UnbindMemberModal
        sid={unbindSid}
        incarnationName={incarnationName}
        pending={unbindMu.isPending}
        error={unbindError}
        onClose={() => {
          setUnbindSid(null);
          setUnbindError(null);
        }}
        onConfirm={(sid) => unbindMu.mutate(sid)}
      />
    </>
  );
}

// Membership provenance of one row: who put the host on the roster, and when. It
// lives in the expansion rather than in a column because it answers a question
// about one host, and the table is already nine columns of vitals wide. A host
// bound by a scenario has no operator behind it — that renders as "—", never as
// "bound by undefined".
function MemberFacts({ boundAt, boundByAid }: { boundAt: string | null; boundByAid: string | null }) {
  const { t } = useTranslation();
  return (
    <div className={styles.memberFacts} data-testid="member-facts">
      <span className={styles.memberFact}>
        <span className={styles.factLabel}>{t('incarnations:colBoundAt')}</span>
        <span className={styles.factValue}>{boundAt ? formatBoundAt(boundAt) : '—'}</span>
      </span>
      <span className={styles.memberFact}>
        <span className={styles.factLabel}>{t('incarnations:colBoundBy')}</span>
        <span className={styles.factValue}>{boundByAid ?? '—'}</span>
      </span>
    </div>
  );
}

// bound_at is RFC 3339 from the wire; an unparsable value is shown as-is rather
// than as "Invalid Date".
function formatBoundAt(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleString();
}

function SortHeader({
  label,
  col,
  active,
  dir,
  onSort,
  ariaSort,
}: {
  label: string;
  col: HostSortKey;
  active: HostSortKey;
  dir: SortDir;
  onSort: (k: HostSortKey) => void;
  ariaSort: 'ascending' | 'descending' | 'none';
}) {
  const isActive = active === col;
  return (
    <th
      scope="col"
      className={styles.sortTh}
      aria-sort={ariaSort}
      onClick={() => onSort(col)}
      data-testid={`host-th-${col}`}
    >
      {label}
      {isActive ? <span className={styles.caret}>{dir === 'asc' ? '▲' : '▼'}</span> : null}
    </th>
  );
}

function Freshness({
  stale,
  collectedAt,
  hasData,
  now,
}: {
  stale: boolean;
  collectedAt?: string;
  hasData: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  if (!hasData) {
    return (
      <span className={styles.freshness} data-testid="freshness-nodata">
        <Dot kind="off" /> {t('incarnations:utilNoData')}
      </span>
    );
  }
  if (stale) {
    return (
      <span className={styles.freshness} data-testid="freshness-stale">
        <Dot kind="warn" /> {t('incarnations:utilStale')}
      </span>
    );
  }
  const age = ageSeconds(collectedAt, now);
  let ageText = '—';
  if (age != null) {
    const [key, n] = ageBucket(age);
    ageText = t(key, { n });
  }
  return (
    <span className={styles.freshness} data-testid="freshness-fresh">
      <Dot kind="ok" title={collectedAt} /> {ageText}
    </span>
  );
}

function ageBucket(sec: number): [key: string, n: number] {
  if (sec < 60) return ['souls:timeAgoSeconds', sec];
  const m = Math.floor(sec / 60);
  if (m < 60) return ['souls:timeAgoMinutes', m];
  const h = Math.floor(m / 60);
  if (h < 24) return ['souls:timeAgoHours', h];
  return ['souls:timeAgoDays', Math.floor(h / 24)];
}

function MetricCell({ value, pct, tone }: { value: string; pct?: number | null; tone?: VitalsTone }) {
  return (
    <div className={styles.metricCell}>
      <span className={styles.metricValue}>{value}</span>
      {pct != null ? (
        <div className={styles.meterOuter}>
          <div
            className={`${styles.meterInner} ${meterTone[tone ?? 'ok']}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

// Rx/Tx throughput pair (NIM-127): ↓ receive, ↑ transmit. Reused by the curated Net column.
function NetPair({ rx, tx }: { rx: number; tx: number }) {
  return (
    <span className={styles.netPair}>
      <ArrowDown size={11} aria-hidden />
      <span>{formatBps(rx)}</span>
      <ArrowUp size={11} aria-hidden />
      <span>{formatBps(tx)}</span>
    </span>
  );
}

// A specific host's trend charts + inode + skew — a separate per-soul request (a window exists
// only in the soul endpoint). Mounted only when the row is expanded → no N-polling. Uses the same
// shared UtilTrend charts as the soul page (CPU/Mem/Load1/Net↓/Net↑), one row across full width.
function HostTrends({ sid, now }: { sid: string; now: number }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['soul-telemetry', sid],
    queryFn: () => keeperApi.souls.telemetry(sid),
    enabled: Boolean(sid),
    retry: false,
    refetchInterval: REFETCH_MS,
  });

  if (q.isLoading) return <div className={styles.sparkLoading}>{t('loading')}</div>;
  if (q.error) {
    const soft = q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404);
    return (
      <div className={soft ? styles.sparkMuted : styles.sparkError}>
        {t('incarnations:utilWindowFailed', { detail: String(q.error) })}
      </div>
    );
  }

  const data = q.data;
  const win = [...(data?.window ?? [])].reverse(); // API newest-first → chronological
  const skew = skewMinutes(data?.collected_at, data?.received_at);
  if (win.length === 0) {
    return (
      <div className={styles.sparkMuted} data-testid="spark-empty">
        {t('incarnations:utilWindowEmpty')}
      </div>
    );
  }

  const cpu = win.map((p) => p.cpu_pct);
  const mem = win.map((p) => ratioPct(p.mem_used_mb, p.mem_total_mb) ?? 0);
  const load1 = win.map((p) => p.load1);
  const rx = win.map((p) => p.net_rx_bps);
  const tx = win.map((p) => p.net_tx_bps);
  const times = win.map((p) => p.collected_at);

  const spanSec = spanSeconds(win[0].collected_at, win[win.length - 1].collected_at);
  const spanText = spanSec != null && spanSec > 0 ? `~${formatUptime(spanSec)}` : null;

  const disks = data?.latest?.disks ?? [];
  const inode = busiestInode(disks);

  return (
    <div className={styles.trends} data-testid="host-trends">
      <div className={styles.trendsHead}>
        <span className={styles.trendsTitle}>Trends</span>
        <span className={styles.trendsSpan}>
          {win.length} samples{spanText ? ` · ${spanText}` : ''}
        </span>
      </div>
      <div className={styles.trendGrid}>
        <UtilTrend label={t('incarnations:utilCpu')} values={cpu} format={formatPct} times={times} now={now} min={0} max={100} tone={utilTone(minMaxLast(cpu)?.last)} testId="host-trend-cpu" />
        <UtilTrend label={t('incarnations:utilMem')} values={mem} format={formatPct} times={times} now={now} min={0} max={100} tone={utilTone(minMaxLast(mem)?.last)} testId="host-trend-mem" />
        <UtilTrend label={t('incarnations:utilLoadShort')} values={load1} format={formatLoad} times={times} now={now} tone="accent" testId="host-trend-load" />
        <UtilTrend label={t('incarnations:utilNetRx')} values={rx} format={formatBps} axisFormat={formatBpsShort} times={times} now={now} min={0} tone="accent" testId="host-trend-rx" />
        <UtilTrend label={t('incarnations:utilNetTx')} values={tx} format={formatBps} axisFormat={formatBpsShort} times={times} now={now} min={0} tone="accent" testId="host-trend-tx" />
      </div>
      {disks.length > 0 ? (
        <div className={styles.inodeBlock} data-testid="spark-inodes">
          <span className={styles.sparkLabel}>Inodes</span>
          <span className={styles.inodeValue}>{inode ? `${formatPct(inode.pct)} (${inode.mount})` : 'n/a'}</span>
        </div>
      ) : null}
      {skew != null ? <div className={styles.skew}>{t('souls:skewWarning', { minutes: skew })}</div> : null}
    </div>
  );
}
