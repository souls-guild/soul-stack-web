import { useTranslation } from 'react-i18next';
import { Input } from '../../components/primitives';
import { ChipsInput } from '../incarnations/ChipsInput';
import {
  SUBJECT_DIMENSIONS,
  SID_PATTERN,
  COVEN_PATTERN,
  type SubjectDimension,
  type SubjectDraft,
} from './subject';
import styles from '../common.module.css';

// The subject picker shared by the Vigil and Decree forms — one dimension at a
// time, the same four everywhere a subject is written. Both forms mounting the
// same component is what keeps them from drifting into two spellings of one
// concept, which is how the flat `sid`/`coven` pair survived in two places at
// once (NIM-475).

const DIMENSION_HINT: Record<SubjectDimension, string> = {
  sid: 'beacons:subjectHintSid',
  incarnation: 'beacons:subjectHintIncarnation',
  coven: 'beacons:subjectHintCoven',
  trait: 'beacons:subjectHintTrait',
};

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
} as const;

export function SubjectPicker({
  value,
  onChange,
  hintKey,
  error,
}: {
  value: SubjectDraft;
  // A PATCH, not a whole draft — see useSubjectDraft: merging onto the last
  // rendered value would drop a change made earlier in the same tick.
  onChange: (patch: Partial<SubjectDraft>) => void;
  // Which registry the subject is being written for — it decides what the
  // selector means (which hosts run the check / may fire the rule).
  hintKey: string;
  error?: string;
}) {
  const { t } = useTranslation();
  const set = onChange;

  return (
    <section className={styles.section} aria-label={t('beacons:subjectLegend')}>
      <h2 className={styles.sectionTitle}>{t('colSubject')}</h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(hintKey)}</div>

      <div className={styles.formFields}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className={styles.metaKey}>{t('beacons:subjectDimensionLabel')}</span>
          <select
            aria-label={t('beacons:subjectDimensionLabel')}
            value={value.dimension}
            onChange={(e) => set({ dimension: e.target.value as SubjectDimension })}
            style={selectStyle}
          >
            {SUBJECT_DIMENSIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>

        {value.dimension === 'sid' ? (
          <label
            data-testid="subject-sid"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 260 }}
          >
            <span className={styles.metaKey}>sid</span>
            <ChipsInput
              value={value.sids}
              onChange={(next) => set({ sids: next })}
              placeholder={t('beacons:subjectSidPlaceholder')}
              ariaLabel="sid"
              validate={(v) => (SID_PATTERN.test(v) ? null : t('beacons:errSubjectSidForm'))}
            />
          </label>
        ) : null}

        {value.dimension === 'incarnation' ? (
          <>
            <Input
              label="service"
              mono
              value={value.service}
              onChange={(e) => set({ service: e.target.value })}
              placeholder="redis"
            />
            <Input
              label="name"
              mono
              value={value.incarnation}
              onChange={(e) => set({ incarnation: e.target.value })}
              placeholder="redis-prod"
            />
          </>
        ) : null}

        {value.dimension === 'coven' ? (
          <label
            data-testid="subject-coven"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 260 }}
          >
            <span className={styles.metaKey}>coven</span>
            <ChipsInput
              value={value.covens}
              onChange={(next) => set({ covens: next })}
              placeholder={t('beacons:covenPlaceholder')}
              ariaLabel="coven"
              validate={(v) => (COVEN_PATTERN.test(v) ? null : t('beacons:errSubjectCovenForm'))}
            />
          </label>
        ) : null}

        {value.dimension === 'trait' ? (
          <>
            <Input
              label="key"
              mono
              value={value.traitKey}
              onChange={(e) => set({ traitKey: e.target.value })}
              placeholder="owner"
            />
            <Input
              label="value"
              mono
              value={value.traitValue}
              onChange={(e) => set({ traitValue: e.target.value })}
              placeholder="dba"
            />
          </>
        ) : null}
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(DIMENSION_HINT[value.dimension])}</div>
      {error ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{t(error)}</span> : null}
    </section>
  );
}
