import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../hooks/useTheme';

export function renderWithProviders(ui: ReactElement, initialPath = '/') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrap({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }
  return render(ui, { wrapper: Wrap });
}
