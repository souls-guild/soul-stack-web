import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  keeperApi,
  type OperatorCreateReply,
  type IssueTokenReply,
  type OperatorAuthMethod,
  type OperatorCreatedVia,
  type Operator,
  type RoleView,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Input, Pager } from '../../components/primitives';
import { RevokeArchonModal } from './RevokeArchonModal';
import { AID_PATTERN } from './schemas';
import styles from '../common.module.css';

const AUTH_METHODS: OperatorAuthMethod[] = ['jwt', 'mtls', 'combined'];

function authMethodTone(m: OperatorAuthMethod | string | undefined):
  'ok' | 'warn' | 'info' | 'muted' {
  switch (m) {
    case 'mtls':
      return 'ok';
    case 'combined':
      return 'info';
    case 'jwt':
      return 'warn';
    default:
      return 'muted';
  }
}

function createdViaTone(v: OperatorCreatedVia | string | undefined):
  'ok' | 'warn' | 'info' | 'muted' {
  switch (v) {
    case 'ldap':
    case 'oidc':
      return 'info';
    case 'bootstrap':
      return 'warn';
    case 'system':
      return 'muted';
    case 'user':
    default:
      return 'ok';
  }
}

// JWT отдаётся один раз — показываем в modal-блоке с кнопкой copy.
function JwtReveal({ jwt, expiresAt, onClose }: { jwt: string; expiresAt?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="dialog"
      aria-label="Новый JWT"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--warn, #b07f00)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--s-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <strong>{t('pages:jwtIssued')}</strong>
      <textarea
        readOnly
        value={jwt}
        rows={4}
        style={{
          width: '100%',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          resize: 'vertical',
        }}
      />
      {expiresAt ? (
        <div className={styles.metaKey}>expires_at: <span className="mono">{expiresAt}</span></div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(jwt);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
      </div>
    </div>
  );
}

// Multi-select ролей: select-добавление + chips для уже выбранных. Каталог
// ролей подгружается из /v1/roles; если ручка недоступна — disabled+hint.
function RolesPicker({
  roles,
  selected,
  onChange,
  disabled,
  error,
}: {
  roles: RoleView[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const remaining = roles.filter((r) => !selected.includes(r.name));
  return (
    <label className={styles.rolesPickerField}>
      <span className={styles.metaKey}>{t('pages:archonRolesOptional')}</span>
      <div
        aria-label="выбранные роли"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: 6,
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          minHeight: 38,
          alignItems: 'center',
        }}
      >
        {selected.map((rn) => (
          <span
            key={`chip-${rn}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px 2px 8px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-pill)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            {rn}
            <button
              type="button"
              aria-label={`убрать роль ${rn}`}
              onClick={() => onChange(selected.filter((x) => x !== rn))}
              style={{
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 0,
                display: 'inline-flex',
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <select
          aria-label="добавить роль"
          value=""
          disabled={disabled || remaining.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onChange([...selected, v]);
          }}
          style={{
            flex: 1,
            minWidth: 140,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 13,
            padding: '4px 6px',
          }}
        >
          <option value="" key="__placeholder">
            {disabled
              ? t('pages:archonRolesUnavailable')
              : remaining.length === 0
                ? t('pages:archonRolesAllSelected')
                : t('pages:archonRolesAdd')}
          </option>
          {remaining.map((r) => (
            <option key={`role-${r.name}`} value={r.name}>
              {r.name}{r.builtin ? ' (builtin)' : ''}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>
      ) : null}
    </label>
  );
}

function ArchonsTable({ items, onIssue, onRevoke }: {
  items: Operator[];
  onIssue: (aid: string) => void;
  onRevoke: (aid: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>AID</th>
          <th>{t('pages:archonDisplayName')}</th>
          <th>Auth</th>
          <th>{t('admin:archonCreatedVia')}</th>
          <th>Created</th>
          <th>Created by</th>
          <th>Revoked</th>
          <th>Bootstrap</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((op) => {
          const revoked = Boolean(op.revoked_at);
          return (
            <tr key={op.aid}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Link to={`/archons/${encodeURIComponent(op.aid)}`}>{op.aid}</Link>
                  {revoked ? <Badge tone="danger">revoked</Badge> : null}
                </span>
              </td>
              <td>{op.display_name}</td>
              <td><Badge tone={authMethodTone(op.auth_method)}>{op.auth_method}</Badge></td>
              <td>
                {op.created_via ? (
                  <span data-testid={`created-via-${op.aid}`}>
                    <Badge tone={createdViaTone(op.created_via)}>
                      {op.created_via}
                    </Badge>
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>—</span>
                )}
              </td>
              <td className="mono">{op.created_at}</td>
              <td className="mono">{op.created_by_aid ?? '—'}</td>
              <td className="mono">{op.revoked_at ?? '—'}</td>
              <td>{op.bootstrap_initial ? <Badge tone="info">initial</Badge> : '—'}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    data-testid={`issue-token-${op.aid}`}
                    disabled={revoked}
                    onClick={() => onIssue(op.aid)}
                    title={revoked ? t('issueTokenDisabled') : t('issueTokenTitle')}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'transparent',
                      cursor: revoked ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {t('issueToken')}
                  </button>
                  <button
                    data-testid={`revoke-${op.aid}`}
                    disabled={revoked}
                    onClick={() => onRevoke(op.aid)}
                    title={revoked ? t('revokeDisabled') : t('revokeTitle')}
                    style={{
                      padding: '4px 8px',
                      border: '1px solid var(--danger)',
                      borderRadius: 'var(--radius)',
                      background: 'transparent',
                      color: revoked ? 'var(--text-faint)' : 'var(--danger)',
                      cursor: revoked ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {t('revoke')}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ArchonsList() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [aidNew, setAidNew] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  // Подсказка: backend отверг roles[] (404/501) — Архонт всё равно создался без ролей.
  const [rolesUnsupported, setRolesUnsupported] = useState(false);
  const [revealed, setRevealed] = useState<{ jwt: string; expiresAt?: string } | null>(null);

  // Каталог ролей кластера — для multi-select. Если ручка недоступна,
  // показываем подсказку, что выбор ролей сейчас не работает.
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    staleTime: 30_000,
  });
  // Защита от malformed-ответа (нет items / item без name) — UI не падает,
  // просто получает пустой каталог.
  const availableRoles: RoleView[] = (rolesQ.data?.items ?? []).filter(
    (r): r is RoleView => typeof r?.name === 'string' && r.name.length > 0,
  );

  const [authMethod, setAuthMethod] = useState<OperatorAuthMethod | ''>('');
  // Клиентская строка поиска: фильтрует по aid и display_name среди загруженной страницы.
  const [searchQuery, setSearchQuery] = useState('');
  // Default ON: revoked-Архонты не маячат в списке. Снять чекбокс — показать всех
  // (включая revoked, с красным chip и disabled-action-кнопками).
  const [hideRevoked, setHideRevoked] = useState(true);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [revokingAid, setRevokingAid] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['operators.list', { authMethod, hideRevoked, limit, offset }],
    queryFn: () =>
      keeperApi.operators.list({
        auth_method: authMethod || undefined,
        // hideRevoked=true → не запрашиваем revoked (API default = только активные).
        // hideRevoked=false → revoked=true, чтобы backend вернул и отозванных.
        revoked: hideRevoked ? undefined : true,
        limit,
        offset,
      }),
  });

  const createMut = useMutation({
    mutationFn: async (): Promise<OperatorCreateReply> => {
      const base = { aid: aidNew, display_name: displayName };
      // Если оператор выбрал роли — пробуем с extended payload. Backend без
      // поддержки create-with-roles может ответить 404/501 на extended-форму:
      // в этом случае создаём без ролей и выставляем флаг unsupported.
      if (selectedRoles.length > 0) {
        try {
          return await keeperApi.operators.create({ ...base, roles: selectedRoles });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
            const reply = await keeperApi.operators.create(base);
            setRolesUnsupported(true);
            return reply;
          }
          throw e;
        }
      }
      return keeperApi.operators.create(base);
    },
    onSuccess: (reply: OperatorCreateReply) => {
      setRevealed({ jwt: reply.jwt });
      setAidNew('');
      setDisplayName('');
      setSelectedRoles([]);
      qc.invalidateQueries({ queryKey: ['operators.list'] });
    },
  });

  const issueMut = useMutation({
    mutationFn: (aid: string) => keeperApi.operators.issueToken(aid),
    onSuccess: (reply: IssueTokenReply) => {
      setRevealed({ jwt: reply.jwt, expiresAt: reply.expires_at });
    },
  });

  const aidNewValid = AID_PATTERN.test(aidNew);
  const displayNameTrimmed = displayName.trim();
  const displayNameValid = displayNameTrimmed.length >= 1 && displayNameTrimmed.length <= 128;

  const rawItems = list.data?.items ?? [];
  // Belt-and-suspenders: даже если backend вернёт revoked в выдаче, при включённом
  // фильтре их не показываем. Y в счётчике = total из API (включая то, что
  // отфильтровано клиентом), X = реально видимые после client-side фильтра.
  const afterRevoke = hideRevoked ? rawItems.filter((op) => !op.revoked_at) : rawItems;
  // Client-side поиск по aid и display_name (без учёта регистра).
  const needle = searchQuery.trim().toLowerCase();
  const items = needle
    ? afterRevoke.filter(
        (op) =>
          op.aid.toLowerCase().includes(needle) ||
          (op.display_name ?? '').toLowerCase().includes(needle),
      )
    : afterRevoke;
  const total = list.data?.total ?? 0;
  const visibleCount = items.length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Archons</h1>
          <div className={styles.crumbs}>{t('pages:archonsCrumbs')}</div>
        </div>
      </div>

      {revealed ? (
        <JwtReveal jwt={revealed.jwt} expiresAt={revealed.expiresAt} onClose={() => setRevealed(null)} />
      ) : null}

      <section className={styles.section} aria-label={t('pages:archonCreateSection')}>
        <h2 className={styles.sectionTitle}>{t('pages:archonCreateSection')}</h2>
        <div className={styles.filters}>
          <Input
            label="AID"
            value={aidNew}
            onChange={(e) => setAidNew(e.target.value)}
            placeholder={t('pages:archonAidPlaceholder')}
            mono
            error={aidNew && !aidNewValid ? t('pages:archonAidError') : undefined}
          />
          <Input
            label={t('pages:archonDisplayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('pages:archonDisplayNamePlaceholder')}
            error={displayNameTrimmed.length > 128 ? t('pages:archonDisplayNameMax') : undefined}
          />
          <RolesPicker
            roles={availableRoles}
            selected={selectedRoles}
            onChange={setSelectedRoles}
            disabled={rolesQ.isLoading || Boolean(rolesQ.error)}
            error={rolesQ.error ? t('pages:archonRolesLoadError') : undefined}
          />
          <div style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="primary"
              disabled={!aidNewValid || !displayNameValid || createMut.isPending}
              onClick={() => { setRolesUnsupported(false); createMut.mutate(); }}
            >
              {createMut.isPending ? t('creating') : t('create')}
            </Button>
          </div>
        </div>
        {createMut.error ? (
          <div className={styles.errorBox} role="alert">
            {createMut.error instanceof ApiError
              ? `Ошибка ${createMut.error.status}: ${createMut.error.message}`
              : String(createMut.error)}
          </div>
        ) : null}
        {rolesUnsupported ? (
          <div
            className={styles.errorBox}
            role="status"
            style={{
              borderColor: 'var(--warn, #b07f00)',
              background: 'color-mix(in srgb, var(--warn, #b07f00) 10%, var(--surface))',
              color: 'var(--text)',
            }}
          >
            {t('errors:archonCreatedNoRoles')}
          </div>
        ) : null}
      </section>

      <section className={styles.section} aria-label={t('pages:archonListSection')}>
        <h2 className={styles.sectionTitle}>{t('pages:archonListSection')}</h2>
        <div className={styles.filters}>
          <label>
            <div className={styles.metaKey}>{t('pages:archonSearch')}</div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('pages:archonSearchPlaceholder')}
              aria-label={t('pages:archonSearch')}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                minWidth: 200,
              }}
            />
          </label>
          <label>
            <div className={styles.metaKey}>{t('pages:archonAuthMethod')}</div>
            <select
              value={authMethod}
              onChange={(e) => { setAuthMethod(e.target.value as OperatorAuthMethod | ''); setOffset(0); }}
              style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
            >
              <option value="">{t('pages:archonAllOption')}</option>
              {AUTH_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className={styles.metaKey}>{t('pages:archonHideRevoked')}</span>
            <input
              type="checkbox"
              checked={hideRevoked}
              onChange={(e) => { setHideRevoked(e.target.checked); setOffset(0); }}
              style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
            />
          </label>
          <label>
            <div className={styles.metaKey}>{t('pages:archonLimit')}</div>
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => { setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50))); setOffset(0); }}
              style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', width: 80 }}
            />
          </label>
        </div>

        {list.data ? (
          <div
            aria-label="счётчик архонтов"
            style={{ fontSize: 12.5, color: 'var(--text-muted)' }}
          >
            {needle
              ? t('pages:archonSearchResults', { shown: visibleCount, total: afterRevoke.length })
              : t('showing', { shown: visibleCount, total })}
          </div>
        ) : null}

        {list.isLoading ? <div className={styles.loading}>{t('loading')}</div> : null}
        {list.error ? (
          <div className={styles.errorBox}>
            {list.error instanceof ApiError ? `Ошибка ${list.error.status}: ${list.error.message}` : String(list.error)}
          </div>
        ) : null}

        {list.data && items.length === 0 ? (
          <div className={styles.empty}>{t('errors:archonsNotFound')}</div>
        ) : null}

        {items.length > 0 ? (
          <>
            <ArchonsTable
              items={items}
              onIssue={(aid) => issueMut.mutate(aid)}
              onRevoke={(aid) => setRevokingAid(aid)}
            />
            <Pager offset={offset} limit={limit} total={total} shown={items.length} onChange={setOffset} />
          </>
        ) : null}

        {issueMut.error ? (
          <div className={styles.errorBox}>
            {issueMut.error instanceof ApiError
              ? `Ошибка ${issueMut.error.status}: ${issueMut.error.message}`
              : String(issueMut.error)}
          </div>
        ) : null}
      </section>

      {revokingAid ? (
        <RevokeArchonModal
          aid={revokingAid}
          open={true}
          onClose={() => setRevokingAid(null)}
        />
      ) : null}
    </div>
  );
}
