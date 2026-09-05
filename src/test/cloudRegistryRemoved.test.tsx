import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { keeperApi } from '../api/keeper';
import i18n from '../i18n';
import type { paths } from '../api/types.gen';

// NIM-762 — the UI side of NIM-761. The engine deleted `core.cloud`, the
// CloudDriver plugin contract and the Provider/Profile registries; cloud is no
// longer a platform entity, just a keeper-side SoulModule plugin. These guards
// fail if any layer of the UI grows the old model back.

// Compile-time guard. `types.gen.ts` is generated from vendor/openapi/keeper.yaml,
// so re-vendoring a spec that still carries the registry breaks `tsc` here —
// before a single test runs, and without matching on source text.
type RemovedCloudRegistryPaths =
  | '/v1/providers'
  | '/v1/providers/{name}'
  | '/v1/profiles'
  | '/v1/profiles/{name}';
type NoCloudRegistryInContract =
  Extract<keyof paths, RemovedCloudRegistryPaths> extends never ? true : never;
const contractCarriesNoCloudRegistry: NoCloudRegistryInContract = true;

describe('cloud Provider/Profile registry is gone from the UI (NIM-762)', () => {
  it('[CONTRACT] the generated OpenAPI types carry no registry paths', () => {
    expect(contractCarriesNoCloudRegistry).toBe(true);
  });

  it('[API] keeperApi exposes no providers/profiles client', () => {
    expect(keeperApi).not.toHaveProperty('providers');
    expect(keeperApi).not.toHaveProperty('profiles');
    // The SSH Push-Provider registry (ADR-032) is a different entity and stays.
    expect(keeperApi).toHaveProperty('pushProviders');
  });

  it('[NAV] the sidebar offers no route into the registry', () => {
    render(
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /^Providers$/ })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toBe('/providers');
    }
  });

  it('[I18N] the providers namespace is not registered', () => {
    // Namespaces are derived from the src/i18n/locales/en/*.json glob, so a
    // re-added locale file would show up here — and would then also have to be
    // key-synced against public/locales/ru, which is what i18n.test.tsx checks.
    expect(i18n.options.ns).not.toContain('providers');
  });
});
