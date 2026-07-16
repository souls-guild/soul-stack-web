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
    // No nav link specifically "Errands" (per-host log is only available via drill-down/route).
    expect(screen.queryByRole('link', { name: /^Errands$/ })).not.toBeInTheDocument();
  });

  it('All runs (unified feed) присутствует', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /All runs/ })).toHaveAttribute('href', '/runs');
  });

  it('Incarnation runs дедуплицирован — свёрнут в единый /runs (NIM-38), отдельного пункта нет', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Incarnation runs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /incarnation-runs/ })).not.toBeInTheDocument();
  });

  it('Provisioning Policy убран из REGISTRY — нет прямой ссылки на /provisioning-policy', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Provisioning Policy/ })).not.toBeInTheDocument();
  });

  it('Settings присутствует и ведёт на /settings', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
  });
});
