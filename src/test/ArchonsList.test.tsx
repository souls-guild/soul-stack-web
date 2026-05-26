import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { ArchonsList } from '../pages/archons/ArchonsList';
import { installFetchMock } from './fetchMock';
import { tokenStore } from '../api/tokenStore';

describe('ArchonsList', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  it('рендерит page и Create-кнопка disabled при пустом AID', () => {
    renderWithProviders(<ArchonsList />, '/archons');
    expect(screen.getByRole('heading', { name: /Archons/i })).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: /Создать/i });
    expect(createBtn).toBeDisabled();
  });

  it('Create — POST /v1/operators возвращает jwt, рендерит JwtReveal', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: '/v1/operators',
        status: 201,
        body: {
          aid: 'archon-alice',
          display_name: 'Alice',
          created_at: '2026-05-26T10:00:00Z',
          created_by_aid: 'archon-bob',
          jwt: 'eyJ.payload.sig',
        },
      },
    ]);
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();

    const aidInputs = screen.getAllByPlaceholderText(/archon-alice/i);
    await user.type(aidInputs[0], 'archon-alice');
    await user.type(screen.getByPlaceholderText(/Alice Ops/i), 'Alice');

    const createBtn = screen.getByRole('button', { name: /Создать/i });
    expect(createBtn).not.toBeDisabled();
    await user.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText(/JWT выпущен/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('eyJ.payload.sig')).toBeInTheDocument();
  });

  it('inline-ошибка pattern при некорректном AID', async () => {
    renderWithProviders(<ArchonsList />, '/archons');
    const user = userEvent.setup();
    const aidInputs = screen.getAllByPlaceholderText(/archon-alice/i);
    await user.type(aidInputs[0], 'Alice!');
    expect(screen.getAllByText(/pattern/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Создать/i })).toBeDisabled();
  });
});
