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

  // The reported defect was not "no groups" — groups existed. It was that the
  // three access items sat at positions 1, 7 and 8 of one eight-item group, so
  // Archons was cut off from RBAC and Synods by five unrelated entries. Pin the
  // adjacency, otherwise the next item added to the nav scatters them again.
  it('Archons, Synods and RBAC are adjacent in one group', () => {
    renderSidebar();
    const labels = screen.getAllByRole('link').map((el) => el.textContent?.trim());
    const first = labels.indexOf('Archons');
    expect(first, 'Archons link is missing from the nav').toBeGreaterThanOrEqual(0);
    expect(labels.slice(first, first + 3)).toEqual(['Archons', 'Synods', 'RBAC']);
  });

  // A divider used to render only while the sidebar was collapsed; expanded, the
  // groups were told apart by a heading alone.
  it('every group is separated by a divider while expanded', () => {
    renderSidebar();
    expect(screen.getAllByTestId('nav-divider').length).toBe(5);
  });
});
