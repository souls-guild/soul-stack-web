// Tests for TraitsAssignModal: merge/replace/remove modes, success-state, validation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { TraitsAssignModal } from '../pages/souls/TraitsAssignModal';
import { tokenStore } from '../api/tokenStore';

function renderModal(
  open: boolean,
  variant: { kind: 'single'; sid: string } | { kind: 'bulk'; sids: string[] },
  onClose = vi.fn(),
) {
  return renderWithProviders(
    <TraitsAssignModal open={open} onClose={onClose} variant={variant} />,
  );
}

const SUCCESS_REPLY = {
  mode: 'merge',
  matched: 2,
  changed: 2,
  status: 'completed',
  dry_run: false,
  keys: ['namespace'],
};

describe('TraitsAssignModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит форму в режиме single с тремя режимами', () => {
    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    expect(screen.getByText('Trait assignment: host01.example.com')).toBeInTheDocument();
    // Three mode radio buttons by data-testid
    expect(screen.getByTestId('trait-mode-merge')).toBeInTheDocument();
    expect(screen.getByTestId('trait-mode-replace')).toBeInTheDocument();
    expect(screen.getByTestId('trait-mode-remove')).toBeInTheDocument();
  });

  it('отправляет merge-запрос и показывает success-state', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify(SUCCESS_REPLY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    const user = userEvent.setup();

    // Fill in the first pair
    const keyInput = screen.getByTestId('trait-key-0');
    const valInput = screen.getByTestId('trait-val-0');
    await user.clear(keyInput);
    await user.type(keyInput, 'namespace');
    await user.clear(valInput);
    await user.type(valInput, 'dba');

    await user.click(screen.getByRole('button', { name: /Применить/i }));

    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
    expect(screen.getByText('merge')).toBeInTheDocument();
    // matched = 2, changed = 2 -- both numbers in the meta block
    const allTwos = screen.getAllByText('2');
    expect(allTwos.length).toBeGreaterThanOrEqual(2);
  });

  it('переключается в режим remove и показывает поле ключей', async () => {
    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('trait-mode-remove'));

    expect(screen.getByTestId('trait-remove-keys')).toBeInTheDocument();
  });

  it('remove — валидация: ошибка при пустых ключах', async () => {
    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('trait-mode-remove'));
    // Do not fill in keys -- apply right away
    await user.click(screen.getByRole('button', { name: /Применить/i }));

    await waitFor(() => {
      expect(screen.getByText(/хотя бы один ключ/i)).toBeInTheDocument();
    });
  });

  it('bulk-вариант — заголовок с числом Souls', () => {
    renderModal(true, { kind: 'bulk', sids: ['host01', 'host02', 'host03'] });
    expect(screen.getByText(/Bulk trait-assign: 3 Souls/)).toBeInTheDocument();
  });

  it('partial-status показывает предупреждение', async () => {
    const partialReply = { ...SUCCESS_REPLY, status: 'partial' };
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(partialReply), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    const user = userEvent.setup();

    const keyInput = screen.getByTestId('trait-key-0');
    await user.type(keyInput, 'namespace');
    await user.click(screen.getByRole('button', { name: /Применить/i }));

    await waitFor(() => {
      const partialTexts = screen.getAllByText(/partial/i);
      expect(partialTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // NIM-67: key with underscore (snake_case) -- valid, does not block submit.
  it('принимает snake_case ключ owner_team (NIM-67)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(SUCCESS_REPLY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderModal(true, { kind: 'single', sid: 'host01.example.com' });
    const user = userEvent.setup();

    const keyInput = screen.getByTestId('trait-key-0');
    const valInput = screen.getByTestId('trait-val-0');
    await user.clear(keyInput);
    await user.type(keyInput, 'owner_team');
    await user.clear(valInput);
    await user.type(valInput, 'dba');

    await user.click(screen.getByRole('button', { name: /Применить/i }));

    // Key with `_` is NOT rejected by validation -- reaches success-state.
    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
  });
});
