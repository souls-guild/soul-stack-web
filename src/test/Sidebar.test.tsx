import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar collapsed={false} onToggle={() => {}} />
    </MemoryRouter>,
  );
}

describe('Sidebar navigation', () => {
  it('ErrandRuns — primary ad-hoc-вход «Command runs» в History', () => {
    renderSidebar();
    const link = screen.getByRole('link', { name: /Command runs/ });
    expect(link).toHaveAttribute('href', '/errand-runs');
  });

  it('standalone «Errands» убран из верхней History-навигации', () => {
    renderSidebar();
    // Нет nav-ссылки именно «Errands» (per-host log доступен только drill-down/route).
    expect(screen.queryByRole('link', { name: /^Errands$/ })).not.toBeInTheDocument();
  });

  it('All runs (unified feed) присутствует', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /All runs/ })).toHaveAttribute('href', '/runs');
  });
});
