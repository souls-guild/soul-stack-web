import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { KeeperSidCell } from '../components/KeeperSidCell';
import { isKeeperSid } from '../components/keeperSid';

describe('isKeeperSid', () => {
  it('matches EXACTLY the synthetic keeper / __run__', () => {
    expect(isKeeperSid('keeper')).toBe(true);
    expect(isKeeperSid('__run__')).toBe(true);
  });

  it('does NOT match real soul-sids, including keeper-like ones (NIM-36)', () => {
    for (const sid of ['soul-keeper-1', 'keeper-1', 'keeper.example.com', 'host-a.local', '']) {
      expect(isKeeperSid(sid)).toBe(false);
    }
  });
});

describe('KeeperSidCell', () => {
  it('keeper — keeper-side badge without a link to /souls', () => {
    renderWithProviders(<KeeperSidCell sid="keeper" />);
    expect(screen.queryByRole('link', { name: /^keeper$/ })).not.toBeInTheDocument();
    expect(screen.getByText('keeper-side')).toBeInTheDocument();
  });

  it('__run__ (run-sentinel) — badge without a link', () => {
    renderWithProviders(<KeeperSidCell sid="__run__" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('no host')).toBeInTheDocument();
  });

  it('real soul — clickable /souls/<sid> link', () => {
    renderWithProviders(<KeeperSidCell sid="host-a.local" />);
    expect(screen.getByRole('link', { name: 'host-a.local' })).toHaveAttribute(
      'href',
      '/souls/host-a.local',
    );
  });

  it('keeper-like real soul (soul-keeper-1) stays a link, not a badge', () => {
    renderWithProviders(<KeeperSidCell sid="soul-keeper-1" />);
    expect(screen.getByRole('link', { name: 'soul-keeper-1' })).toHaveAttribute(
      'href',
      '/souls/soul-keeper-1',
    );
  });
});
