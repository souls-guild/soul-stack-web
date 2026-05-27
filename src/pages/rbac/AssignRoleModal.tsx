import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal } from '../../components/primitives';
import { keeperApi, type RoleView } from '../../api/keeper';
import { prettyRbacError } from './errors';
import styles from '../common.module.css';

interface Props {
  open: boolean;
  aid: string;
  // Все роли в кластере — для select. Мембершип конкретного оператора
  // выводится отсюда через role.operators.includes(aid).
  roles: readonly RoleView[];
  onClose: () => void;
}

// Назначить роль оператору: POST /v1/roles/{name}/operators с {aid}.
// Сервер 204 на success, идемпотентно. Не показываем роли, в которых
// оператор уже состоит (фильтр по operators[]).
export function AssignRoleModal({ open, aid, roles, onClose }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>('');
  const [serverError, setServerError] = useState<string | null>(null);

  const candidates = roles.filter((r) => !r.operators.includes(aid));

  const mu = useMutation({
    mutationFn: (roleName: string) => keeperApi.roles.grantOperator(roleName, { aid }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rbac.roles'] });
      setSelected('');
      onClose();
    },
    onError: (err) => setServerError(prettyRbacError(err)),
  });

  function close() {
    if (mu.isPending) return;
    setServerError(null);
    setSelected('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`Назначить роль: ${aid}`}
      onClose={close}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close} disabled={mu.isPending}>
            Отмена
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mu.isPending || !selected}
            onClick={() => { setServerError(null); mu.mutate(selected); }}
          >
            {mu.isPending ? 'Назначаем…' : 'Назначить'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 'var(--s-4)' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Оператор получит все permissions выбранной роли. Операция идемпотентна.
        </p>
        {candidates.length === 0 ? (
          <div className={styles.empty} style={{ padding: 'var(--s-4)' }}>
            Оператор уже состоит во всех ролях кластера.
          </div>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className={styles.metaKey}>Role</span>
            <select
              aria-label="role"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
            >
              <option value="">— выберите роль —</option>
              {candidates.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}{r.builtin ? ' (builtin)' : ''}{r.description ? ` — ${r.description}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {serverError ? <div className={styles.errorBox} role="alert">{serverError}</div> : null}
      </div>
    </Modal>
  );
}
