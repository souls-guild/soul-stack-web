import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { AuditLog } from '../pages/audit/AuditLog';

describe('AuditLog', () => {
  it('рендерит placeholder с упоминанием отсутствующего endpoint-а', () => {
    renderWithProviders(<AuditLog />, '/audit');
    expect(screen.getByRole('heading', { name: /Audit/i })).toBeInTheDocument();
    expect(screen.getByText(/GET \/v1\/audit/)).toBeInTheDocument();
    expect(screen.getByText(/не выставлен/i)).toBeInTheDocument();
  });
});
