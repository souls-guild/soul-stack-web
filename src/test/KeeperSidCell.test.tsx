import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from './renderWithProviders';
import { KeeperSidCell } from '../components/KeeperSidCell';
import { isKeeperSid } from '../components/keeperSid';

describe('isKeeperSid', () => {
  it('матчит ТОЧНО синтетические keeper / __run__', () => {
    expect(isKeeperSid('keeper')).toBe(true);
    expect(isKeeperSid('__run__')).toBe(true);
  });

  it('НЕ матчит реальные soul-sid, включая keeper-подобные (NIM-36)', () => {
    for (const sid of ['soul-keeper-1', 'keeper-1', 'keeper.example.com', 'host-a.local', '']) {
      expect(isKeeperSid(sid)).toBe(false);
    }
  });
});

describe('KeeperSidCell', () => {
  it('keeper — бейдж keeper-side без ссылки на /souls', () => {
    renderWithProviders(<KeeperSidCell sid="keeper" />);
    expect(screen.queryByRole('link', { name: /^keeper$/ })).not.toBeInTheDocument();
    expect(screen.getByText('keeper-side')).toBeInTheDocument();
  });

  it('__run__ (run-sentinel) — бейдж без ссылки', () => {
    renderWithProviders(<KeeperSidCell sid="__run__" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('no host')).toBeInTheDocument();
  });

  it('реальный soul — кликабельная ссылка /souls/<sid>', () => {
    renderWithProviders(<KeeperSidCell sid="host-a.local" />);
    expect(screen.getByRole('link', { name: 'host-a.local' })).toHaveAttribute(
      'href',
      '/souls/host-a.local',
    );
  });

  it('keeper-подобный реальный soul (soul-keeper-1) остаётся ссылкой, не бейджем', () => {
    renderWithProviders(<KeeperSidCell sid="soul-keeper-1" />);
    expect(screen.getByRole('link', { name: 'soul-keeper-1' })).toHaveAttribute(
      'href',
      '/souls/soul-keeper-1',
    );
  });
});
