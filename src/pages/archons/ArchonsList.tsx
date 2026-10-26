import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  keeperApi,
  type OperatorCreateReply,
  type OperatorAuthMethod,
  type OperatorCreatedVia,
  type Operator,
  type RoleView,
} from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Badge, Button, Input, Pager } from '../../components/primitives';
import { IssueJwtModal } from '../profile/IssueJwtModal';
import { RevokeArchonModal } from './RevokeArchonModal';
import { OwnerPicker } from './OwnerPicker';
import { isMachineOperator, ownerBody, type OwnerKind } from './owner';
import { AID_PATTERN } from './schemas';
import styles from '../common.module.css';

const AUTH_METHODS: OperatorAuthMethod[] = ['jwt', 'mtls', 'combined', 'ldap', 'oidc', 'local'];

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

// JWT is given out once — we show it in a modal block with a copy button.
function JwtReveal({ jwt, onClose }: { jwt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="dialog"
      aria-label={t('admin:archonNewJwtAria')}
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

// Multi-select of roles: select-to-add + chips for already-selected. The role
// catalog is loaded from /v1/roles; if the endpoint is unavailable — disabled+hint.
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
        aria-label={t('admin:archonSelectedRolesAria')}
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
              aria-label={`remove role ${rn}`}
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
          aria-label={t('forms:addRole')}
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

function OwnerCell({ op }: { op: Operator }) {
  const { t } = useTranslation();
  if (op.owner_aid) {
    return (
      <Link to={`/archons/${encodeURIComponent(op.owner_aid)}`} className="mono">
        {op.owner_aid}
      </Link>
    );
  }
  if (op.owner_synod) {
    return (
      <>
        <Link to={`/synods/${encodeURIComponent(op.owner_synod)}`} className="mono">
          {op.owner_synod}
        </Link>
        <Badge tone="info">{t('pages:archonOwnerKindSynod')}</Badge>
      </>
    );
  }
  if (isMachineOperator(op)) return <Badge tone="muted">{t('pages:archonNoOwner')}</Badge>;
  return <span style={{ color: 'var(--text-faint)' }}>—</span>;
}

function ArchonsTable({ items, onIssue, onRevoke }: {
  items: Operator[];
  onIssue: (op: Operator) => void;
  onRevoke: (aid: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('common:colAid')}</th>
          <th>{t('pages:archonDisplayName')}</th>
          <th>{t('colAuth')}</th>
          <th>{t('admin:archonCreatedVia')}</th>
          <th>{t('pages:archonColOwner')}</th>
          <th>{t('colCreated')}</th>
          <th>{t('colCreatedBy')}</th>
          <th>{t('colRevoked')}</th>
          <th>{t('common:colBootstrap')}</th>
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
              <td>
                <span data-testid={`owner-${op.aid}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <OwnerCell op={op} />
                </span>
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
                    onClick={() => onIssue(op)}
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
  // Hint: backend rejected roles[] (404/501) — the Archon was still created without roles.
  const [rolesUnsupported, setRolesUnsupported] = useState(false);
  const [revealed, setRevealed] = useState<{ jwt: string } | null>(null);
  // How the new Archon logs in. `local` is offered only when this Keeper has
  // auth.local (GET /auth/methods): it gets a password and no token.
  const [newMethod, setNewMethod] = useState<'jwt' | 'local'>('jwt');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('');
  const [createdLocal, setCreatedLocal] = useState<string | null>(null);
  // Optional owner of a new token-only Archon; '' kind = no owner.
  const [newOwnerKind, setNewOwnerKind] = useState<OwnerKind | ''>('');
  const [newOwner, setNewOwner] = useState('');
  const methodsQ = useQuery({
    queryKey: ['auth.methods'],
    queryFn: () => keeperApi.auth.methods(),
    staleTime: 60_000,
    retry: false,
  });
  const localOffered = Boolean(methodsQ.data?.local);
  const creatingLocal = localOffered && newMethod === 'local';

  // Cluster role catalog — for the multi-select. If the endpoint is unavailable,
  // we show a hint that role selection is currently not working.
  const rolesQ = useQuery({
    queryKey: ['rbac.roles'],
    queryFn: () => keeperApi.roles.list(),
    staleTime: 30_000,
  });
  // Guard against a malformed response (no items / item without a name) — the UI
  // doesn't crash, it just gets an empty catalog.
  const availableRoles: RoleView[] = (rolesQ.data?.items ?? []).filter(
    (r): r is RoleView => typeof r?.name === 'string' && r.name.length > 0,
  );

  const [authMethod, setAuthMethod] = useState<OperatorAuthMethod | ''>('');
  // Client-side search string: filters by aid and display_name within the loaded page.
  const [searchQuery, setSearchQuery] = useState('');
  // Default ON: revoked Archons don't clutter the list. Uncheck the box — show everyone
  // (including revoked, with a red chip and disabled action buttons).
  const [hideRevoked, setHideRevoked] = useState(true);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [revokingAid, setRevokingAid] = useState<string | null>(null);
  const [issueFor, setIssueFor] = useState<Operator | null>(null);
  // Owner filter: server-side (owner_aid / owner_synod), typed value debounced.
  const [ownerKind, setOwnerKind] = useState<OwnerKind | ''>('');
  const [ownerInput, setOwnerInput] = useState('');
  const [owner, setOwner] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setOwner(ownerInput.trim()), 300);
    return () => clearTimeout(id);
  }, [ownerInput]);
  const ownerFilter = ownerKind && owner ? owner : '';

  const list = useQuery({
    queryKey: ['operators.list', { authMethod, hideRevoked, limit, offset, ownerKind, ownerFilter }],
    queryFn: () =>
      keeperApi.operators.list({
        auth_method: authMethod || undefined,
        // hideRevoked=true → don't request revoked (API default = active only).
        // hideRevoked=false → revoked=true, so the backend also returns revoked ones.
        revoked: hideRevoked ? undefined : true,
        owner_aid: ownerKind === 'archon' && ownerFilter ? ownerFilter : undefined,
        owner_synod: ownerKind === 'synod' && ownerFilter ? ownerFilter : undefined,
        limit,
        offset,
      }),
  });

  const createMut = useMutation({
    mutationFn: async (): Promise<OperatorCreateReply> => {
      const base = creatingLocal
        ? { aid: aidNew, display_name: displayName, auth_method: 'local' as const, password: newPassword }
        : {
            aid: aidNew,
            display_name: displayName,
            ...(newOwnerKind && newOwner ? ownerBody(newOwnerKind, newOwner) : {}),
          };
      // If the operator selected roles — try with an extended payload. A backend
      // without create-with-roles support may respond 404/501 to the extended form:
      // in that case we create without roles and set the unsupported flag.
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
      if (reply.jwt) {
        setRevealed({ jwt: reply.jwt });
        setCreatedLocal(null);
      } else {
        setRevealed(null);
        setCreatedLocal(reply.aid);
      }
      setNewPassword('');
      setNewPasswordRepeat('');
      setAidNew('');
      setDisplayName('');
      setSelectedRoles([]);
      setNewOwnerKind('');
      setNewOwner('');
      qc.invalidateQueries({ queryKey: ['operators.list'] });
    },
  });

  const aidNewValid = AID_PATTERN.test(aidNew);
  const displayNameTrimmed = displayName.trim();
  const displayNameValid = displayNameTrimmed.length >= 1 && displayNameTrimmed.length <= 128;
  // Only that the two match and are not empty: the Keeper owns the policy and
  // its 422 says what it wants.
  const passwordMismatch = creatingLocal && newPasswordRepeat !== '' && newPassword !== newPasswordRepeat;
  const passwordValid = !creatingLocal || (newPassword !== '' && newPassword === newPasswordRepeat);
  const ownerValid = creatingLocal || newOwnerKind === '' || newOwner !== '';

  const rawItems = list.data?.items ?? [];
  // Belt-and-suspenders: even if the backend returns revoked in the response, we
  // don't show them when the filter is on. Y in the counter = total from the API
  // (including what's filtered client-side), X = actually visible after the client-side filter.
  const afterRevoke = hideRevoked ? rawItems.filter((op) => !op.revoked_at) : rawItems;
  // Client-side search by aid and display_name (case-insensitive).
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
          <h1 className={styles.title}>{t('common:navArchons')}</h1>
          <div className={styles.crumbs}>{t('pages:archonsCrumbs')}</div>
        </div>
      </div>

      {revealed ? (
        <JwtReveal jwt={revealed.jwt} onClose={() => setRevealed(null)} />
      ) : null}
      {createdLocal ? (
        <div className={styles.section} role="status" data-testid="archon-created-local">
          <span>{t('pages:archonCreatedLocal', { aid: createdLocal })}</span>
          <div>
            <Button variant="ghost" onClick={() => setCreatedLocal(null)}>{t('close')}</Button>
          </div>
        </div>
      ) : null}

      <section className={styles.section} aria-label={t('pages:archonCreateSection')}>
        <h2 className={styles.sectionTitle}>{t('pages:archonCreateSection')}</h2>
        <div className={styles.filters}>
          <Input
            label={t('common:colAid')}
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
          {localOffered ? (
            <div>
              <div className={styles.metaKey}>{t('pages:archonLoginWith')}</div>
              <div className={styles.tabs} role="tablist" aria-label={t('pages:archonLoginWith')}>
                {(['jwt', 'local'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={newMethod === m}
                    className={`${styles.tab} ${newMethod === m ? styles.tabActive : ''}`}
                    data-testid={`archon-create-method-${m}`}
                    onClick={() => setNewMethod(m)}
                  >
                    {t(m === 'jwt' ? 'pages:archonLoginToken' : 'pages:archonLoginPassword')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {creatingLocal ? (
            <>
              <Input
                label={t('pages:archonInitialPassword')}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="archon-create-password"
              />
              <Input
                label={t('pages:archonPasswordRepeat')}
                type="password"
                autoComplete="new-password"
                value={newPasswordRepeat}
                onChange={(e) => setNewPasswordRepeat(e.target.value)}
                error={passwordMismatch ? t('pages:archonPasswordMismatch') : undefined}
                data-testid="archon-create-password-repeat"
              />
            </>
          ) : (
            <div data-testid="archon-create-owner">
              <div className={styles.metaKey}>{t('pages:archonOwnerOptional')}</div>
              <OwnerPicker
                kind={newOwnerKind}
                value={newOwner}
                onKindChange={setNewOwnerKind}
                onValueChange={setNewOwner}
                allowNone
                testidPrefix="archon-create-owner"
              />
            </div>
          )}
          <div style={{ alignSelf: 'flex-end' }}>
            <Button
              variant="primary"
              disabled={!aidNewValid || !displayNameValid || !passwordValid || !ownerValid || createMut.isPending}
              onClick={() => { setRolesUnsupported(false); setCreatedLocal(null); createMut.mutate(); }}
            >
              {createMut.isPending ? t('creating') : t('create')}
            </Button>
          </div>
        </div>
        {createMut.error ? (
          <div className={styles.errorBox} role="alert">
            {createMut.error instanceof ApiError
              ? `Error ${createMut.error.status}: ${createMut.error.message}`
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
          <label>
            <div className={styles.metaKey}>{t('pages:archonColOwner')}</div>
            <select
              value={ownerKind}
              data-testid="archon-filter-owner-kind"
              onChange={(e) => { setOwnerKind(e.target.value as OwnerKind | ''); setOffset(0); }}
              style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' }}
            >
              <option value="">{t('pages:archonAllOption')}</option>
              <option value="archon">{t('pages:archonOwnerKindArchon')}</option>
              <option value="synod">{t('pages:archonOwnerKindSynod')}</option>
            </select>
          </label>
          {ownerKind ? (
            <label>
              <div className={styles.metaKey}>
                {ownerKind === 'archon' ? t('pages:archonOwnerFilterAid') : t('pages:archonOwnerFilterSynod')}
              </div>
              <input
                type="text"
                value={ownerInput}
                data-testid="archon-filter-owner"
                onChange={(e) => { setOwnerInput(e.target.value); setOffset(0); }}
                placeholder={ownerKind === 'archon' ? t('pages:archonAidPlaceholder') : t('synods:namePlaceholder')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  minWidth: 180,
                }}
              />
            </label>
          ) : null}
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
            aria-label={t('admin:archonsCounterAria')}
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
            {list.error instanceof ApiError ? `Error ${list.error.status}: ${list.error.message}` : String(list.error)}
          </div>
        ) : null}

        {list.data && items.length === 0 ? (
          <div className={styles.empty}>{t('errors:archonsNotFound')}</div>
        ) : null}

        {items.length > 0 ? (
          <>
            <ArchonsTable
              items={items}
              onIssue={setIssueFor}
              onRevoke={(aid) => setRevokingAid(aid)}
            />
            <Pager offset={offset} limit={limit} total={total} shown={items.length} onChange={setOffset} />
          </>
        ) : null}
      </section>

      {issueFor ? (
        <IssueJwtModal
          open
          aid={issueFor.aid}
          issue={(body) => keeperApi.operators.issueToken(issueFor.aid, body)}
          defaultPreset={isMachineOperator(issueFor) ? '90d' : undefined}
          invalidateKeys={[['operator.jwts', issueFor.aid]]}
          onClose={() => setIssueFor(null)}
        />
      ) : null}

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
