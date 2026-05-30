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
  it('Tides и Command runs убраны из навигации (Voyage-only cutover)', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Tides/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Command runs/ })).not.toBeInTheDocument();
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
