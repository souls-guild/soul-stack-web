import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { keeperApi } from '../../api/keeper';
import { ApiError } from '../../api/client';
import { Modal, Button } from '../../components/primitives';
import styles from '../common.module.css';

interface Props {
  aid: string;
  open: boolean;
  onClose: () => void;
  // Опциональный hook на успешный revoke — нужен detail-странице, чтобы
  // переключить локальный UI на «revoked».
  onSuccess?: () => void;
}

// Расшифровка серверной 409 «last cluster-admin» в человеческое сообщение.
// Бэкенд возвращает problem+json с type/title/detail (ADR-013, self-lockout).
function prettyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return (
        'Нельзя отозвать последнего Архонта с *-permission ' +
        '(self-lockout-защита, ADR-013). Создайте другого cluster-admin сначала.'
      );
    }
    if (err.status === 404) return 'Архонт не найден.';
    if (err.status === 403) return 'Недостаточно прав (operator.revoke).';
    return `Ошибка ${err.status}: ${err.detail || err.message}`;
  }
  return String(err);
}

export function RevokeArchonModal({ aid, open, onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const mut = useMutation({
    mutationFn: () => keeperApi.operators.revoke(aid, { reason: reason || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operators.list'] });
      qc.invalidateQueries({ queryKey: ['operator', aid] });
      setReason('');
      onSuccess?.();
      onClose();
    },
  });

  function handleClose() {
    if (mut.isPending) return;
    mut.reset();
    setReason('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`Отозвать ${aid}?`}
      onClose={handleClose}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={mut.isPending}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? 'Отзываем…' : 'Отозвать'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 'var(--s-4)' }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
          Архонт <code className="mono">{aid}</code> будет помечен как отозванный
          (<code className="mono">operators.revoked_at = now()</code>). Активные JWT-токены
          продолжат работать до своего <code className="mono">exp</code>; новые токены
          выпустить нельзя.
        </p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className={styles.metaKey}>Reason (optional, для audit)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="например: уход сотрудника / ключ скомпрометирован"
            style={{
              fontFamily: 'inherit',
              fontSize: 13,
              padding: 8,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              resize: 'vertical',
            }}
          />
        </label>
        {mut.error ? (
          <div className={styles.errorBox} role="alert">
            {prettyError(mut.error)}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
