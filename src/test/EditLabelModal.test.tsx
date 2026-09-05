import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { EditLabelModal } from '../components/EditLabelModal';
import { tokenStore } from '../api/tokenStore';

// The caption is the mutable half of a registry entity's identity, and for
// Vigils, Decrees and incarnations this modal is the ONLY place it can be
// changed — those registries have no other edit surface (ADR-0085 / NIM-731).
describe('EditLabelModal', () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  function render(label: string | undefined, setLabel: (body: unknown) => Promise<unknown>) {
    renderWithProviders(
      <EditLabelModal
        open
        onClose={() => {}}
        id="redis-prod"
        label={label}
        setLabel={setLabel}
        invalidate={[['incarnation', 'redis-prod']]}
        idHint="The id cannot be changed."
      />,
      '/',
    );
  }

  it('shows the id read-only beside the editable caption', async () => {
    render('Redis prod', vi.fn().mockResolvedValue({}));

    const id = screen.getByDisplayValue('redis-prod');
    expect(id).toHaveAttribute('readonly');
    expect(screen.getByTestId('edit-label-input')).toHaveValue('Redis prod');
  });

  it('sends the trimmed caption', async () => {
    const setLabel = vi.fn().mockResolvedValue({});
    render('Redis prod', setLabel);
    const user = userEvent.setup();

    await user.clear(screen.getByTestId('edit-label-input'));
    await user.type(screen.getByTestId('edit-label-input'), '  Redis production  ');
    await user.click(screen.getByTestId('edit-label-save'));

    await waitFor(() => expect(setLabel).toHaveBeenCalledWith({ label: 'Redis production' }));
  });

  // null, not "": the contract reads null as "cleared, consumers show the id",
  // and would store an empty string verbatim — an entity captioned with a blank.
  it('clears the caption with null rather than an empty string', async () => {
    const setLabel = vi.fn().mockResolvedValue({});
    render('Redis prod', setLabel);
    const user = userEvent.setup();

    await user.clear(screen.getByTestId('edit-label-input'));
    await user.click(screen.getByTestId('edit-label-save'));

    await waitFor(() => expect(setLabel).toHaveBeenCalledWith({ label: null }));
  });

  it('an entity with no caption opens on an empty field, not on its id', () => {
    render(undefined, vi.fn().mockResolvedValue({}));
    expect(screen.getByTestId('edit-label-input')).toHaveValue('');
  });
});
