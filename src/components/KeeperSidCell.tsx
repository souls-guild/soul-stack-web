import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge } from './primitives';
import { RUN_SENTINEL_SID, isKeeperSid } from './keeperSid';

// KeeperSidCell — единая sid-ячейка рендереров прогона: реальный Soul → ссылка
// /souls, синтетический → бейдж без ссылки (NIM-36). className/style пробрасываются
// в <Link> для сохранения исходной вёрстки конкретного рендерера.
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
