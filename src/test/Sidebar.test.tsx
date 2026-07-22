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
  it('Tides and Command runs removed from navigation (Voyage-only cutover)', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Tides/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Command runs/ })).not.toBeInTheDocument();
  });

  it('standalone «Errands» removed from the top History navigation', () => {
    renderSidebar();
    // No nav link specifically "Errands" (per-host log is only available via drill-down/route).
    expect(screen.queryByRole('link', { name: /^Errands$/ })).not.toBeInTheDocument();
  });

  it('All runs (unified feed) is present', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /All runs/ })).toHaveAttribute('href', '/runs');
  });

  it('Incarnation runs deduplicated — collapsed into a single /runs (NIM-38), no separate item', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Incarnation runs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /incarnation-runs/ })).not.toBeInTheDocument();
  });

  it('Provisioning Policy removed from REGISTRY — no direct link to /provisioning-policy', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /Provisioning Policy/ })).not.toBeInTheDocument();
  });

  it('Settings is present and links to /settings', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
  });
});
