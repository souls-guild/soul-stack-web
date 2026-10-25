import { useQuery } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { tokenStore } from '../../api/tokenStore';
import { useAuth } from '../../hooks/useAuth';

// useIsLocalArchon — whether the signed-in Archon logs in with a local
// password. The operator record says so when the caller may read it; without
// operator.list it may not, and then a session signed in by password says so.
// undefined while the record is still on its way.
export function useIsLocalArchon(): boolean | undefined {
  const { identity } = useAuth();
  const aid = identity?.aid;
  const op = useQuery({
    queryKey: ['operators.get', aid],
    queryFn: () => keeperApi.operators.get(aid!),
    enabled: Boolean(aid),
    retry: false,
    staleTime: 60_000,
  });
  if (op.data) return op.data.auth_method === 'local';
  if (tokenStore.sessionMethod() === 'local') return true;
  return aid && op.isPending ? undefined : false;
}
