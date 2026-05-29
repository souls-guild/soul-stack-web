import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RemoveHostModal } from '../pages/incarnations/RemoveHostModal';

describe('RemoveHostModal', () => {
  it('закрыта при sid=null', () => {
    renderWithProviders(
      <RemoveHostModal
        sid={null}
        incarnationName="redis-prod"
        pending={false}
        error={null}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId('remove-host-warning')).not.toBeInTheDocument();
  });

  it('показывает warning с sid + именем incarnation, кнопка disabled до подтверждения', async () => {
    renderWithProviders(
      <RemoveHostModal
        sid="host-a.local"
        incarnationName="redis-prod"
        pending={false}
        error={null}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    const warn = screen.getByTestId('remove-host-warning');
    expect(warn).toBeInTheDocument();
    expect(warn.textContent).toMatch(/host-a.local/);
    expect(warn.textContent).toMatch(/redis-prod/);

    const btn = screen.getByTestId('remove-host-confirm');
    expect(btn).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Подтвердить удаление хоста'));
    expect(btn).not.toBeDisabled();
  });

  it('onConfirm зовётся с sid после подтверждения', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <RemoveHostModal
        sid="host-a.local"
        incarnationName="redis-prod"
        pending={false}
        error={null}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Подтвердить удаление хоста'));
    await user.click(screen.getByTestId('remove-host-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('host-a.local');
  });

  it('без подтверждения onConfirm не зовётся (кнопка disabled)', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <RemoveHostModal
        sid="host-a.local"
        incarnationName="redis-prod"
        pending={false}
        error={null}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('remove-host-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('error отображается внутри модалки', () => {
    renderWithProviders(
      <RemoveHostModal
        sid="host-a.local"
        incarnationName="redis-prod"
        pending={false}
        error="Incarnation в состоянии destroying — правка spec.hosts невозможна."
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/состоянии destroying/)).toBeInTheDocument();
  });
});
