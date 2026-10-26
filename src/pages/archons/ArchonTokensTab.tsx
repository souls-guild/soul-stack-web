// Operator card → Tokens: every token of the Archon, sign-ins included
// (GET /v1/operators/{aid}/jwts, operator.list), with revoke for an administrator
// holding operator.jwt-revoke and a new token for one holding
// operator.issue-token. Revoking one token leaves the Archon and its other
// tokens working.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { keeperApi, type OperatorJWTKind } from '../../api/keeper';
import { JwtList } from '../../components/JwtList';
import { Button } from '../../components/primitives';
import { useAuth } from '../../hooks/useAuth';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { IssueJwtModal } from '../profile/IssueJwtModal';

const KINDS: OperatorJWTKind[] = ['personal', 'issued', 'session', 'bootstrap'];

interface Props {
  aid: string;
  machine?: boolean;
  revoked?: boolean;
}

export function ArchonTokensTab({ aid, machine = false, revoked = false }: Props) {
  const { t } = useTranslation();
  const { identity, logout } = useAuth();
  const { hasPermission } = useMyPermissions();
  const navigate = useNavigate();
  const [issueOpen, setIssueOpen] = useState(false);
  const currentJwtId = identity?.aid === aid ? identity.jwtId : null;
  const listKey = ['operator.jwts', aid] as const;
  return (
    <div>
      {!revoked && hasPermission('operator.issue-token') ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <Button type="button" variant="primary" data-testid="archon-issue-token-btn" onClick={() => setIssueOpen(true)}>
            {t('issueToken')}
          </Button>
        </div>
      ) : null}
      <JwtList
        queryKey={listKey}
        fetchPage={(q) => keeperApi.operators.jwts.list(aid, q)}
        kinds={KINDS}
        showCreatedBy
        currentJwtId={currentJwtId}
        canRevoke={hasPermission('operator.jwt-revoke')}
        revoke={(id) => keeperApi.operators.jwts.revoke(aid, id)}
        onRevoked={(row) => {
          if (currentJwtId && row.jwt_id === currentJwtId) {
            void logout().then(() => navigate('/login', { replace: true }));
          }
        }}
      />
      {issueOpen ? (
        <IssueJwtModal
          open
          aid={aid}
          issue={(body) => keeperApi.operators.issueToken(aid, body)}
          defaultPreset={machine ? '90d' : undefined}
          invalidateKeys={[listKey]}
          onClose={() => setIssueOpen(false)}
        />
      ) : null}
    </div>
  );
}
