import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from './primitives';
import { RUN_SENTINEL_SID, isKeeperSid } from './keeperSid';

// KeeperSidCell — a shared sid cell for run renderers: a real Soul → link to
// /souls, a synthetic one → badge without a link (NIM-36). className/style are passed
// through to <Link> to preserve the specific renderer's original layout.
export function KeeperSidCell({
  sid,
  className,
  style,
}: {
  sid: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  if (isKeeperSid(sid)) {
    const sentinel = sid === RUN_SENTINEL_SID;
    return (
      <span className={className} style={style}>
        <span className="mono">{sid}</span>{' '}
        <Badge
          tone="info"
          title={t(sentinel ? 'runhistory:runSentinelHint' : 'runhistory:runKeeperSideHint')}
        >
          {t(sentinel ? 'runhistory:runSentinelBadge' : 'runhistory:runKeeperSideBadge')}
        </Badge>
      </span>
    );
  }
  return (
    <Link to={`/souls/${encodeURIComponent(sid)}`} className={className} style={style}>
      {sid}
    </Link>
  );
}
