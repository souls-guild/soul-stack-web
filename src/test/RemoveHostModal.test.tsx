import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { RemoveHostModal } from '../pages/incarnations/RemoveHostModal';

describe('RemoveHostModal', () => {
  it('is closed when sid=null', () => {
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

  it('shows warning with sid + incarnation name, button disabled until confirmed', async () => {
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
    await user.click(screen.getByLabelText('Confirm host removal'));
    expect(btn).not.toBeDisabled();
  });

  it('onConfirm is called with sid after confirmation', async () => {
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
    await user.click(screen.getByLabelText('Confirm host removal'));
    await user.click(screen.getByTestId('remove-host-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('host-a.local');
  });

  it('onConfirm is not called without confirmation (button disabled)', async () => {
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

  it('error is displayed inside the modal', () => {
    renderWithProviders(
      <RemoveHostModal
        sid="host-a.local"
        incarnationName="redis-prod"
        pending={false}
        error="Incarnation is in destroying state — editing spec.hosts is not possible."
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/destroying state/)).toBeInTheDocument();
  });
});
