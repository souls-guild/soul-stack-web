import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { JsonKeyFilter } from '../../components/JsonKeyFilter';
import styles from '../common.module.css';

interface Props {
  spec: Record<string, unknown> | null | undefined;
}

// Tab «Spec» — declared-параметры incarnation, заданные оператором при создании
// (и/или ADR-008 spec.hosts[] для bootstrap-create). Read-only: API сейчас не
// принимает PATCH spec (см. HostsTab BACKLOG).
export function SpecTab({ spec }: Props) {
  const { t } = useTranslation();
  const isEmpty = !spec || (typeof spec === 'object' && Object.keys(spec).length === 0);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <FileText size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Spec (declared)
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('incarnations:specSourceDesc')}
      </p>
      {isEmpty ? (
        <div className={styles.empty}>
          {t('incarnations:specEmpty')}
        </div>
      ) : (
        <JsonKeyFilter value={spec} emptyLabel={t('incarnations:specEmptyLabel')} />
      )}
    </section>
  );
}
