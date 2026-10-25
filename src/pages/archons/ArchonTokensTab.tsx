// Operator card → Tokens: every token of the Archon, sign-ins included
// (GET /v1/operators/{aid}/jwts, operator.list), with revoke for an administrator
// holding operator.jwt-revoke. Revoking one token leaves the Archon and its other
// tokens working.

import { useNavigate } from 'react-router-dom';
import { keeperApi, type OperatorJWTKind } from '../../api/keeper';
import { JwtList } from '../../components/JwtList';
import { useAuth } from '../../hooks/useAuth';
import { useMyPermissions } from '../../hooks/useMyPermissions';

const KINDS: OperatorJWTKind[] = ['personal', 'issued', 'session', 'bootstrap'];

export function ArchonTokensTab({ aid }: { aid: string }) {
  const { identity, logout } = useAuth();
  const { hasPermission } = useMyPermissions();
  const navigate = useNavigate();
  const currentJwtId = identity?.aid === aid ? identity.jwtId : null;
  return (
    <JwtList
      queryKey={['operator.jwts', aid]}
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
  );
}
