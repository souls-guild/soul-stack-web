import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from './renderWithProviders';
import { SearchMultiSelect } from '../components/primitives/SearchMultiSelect';

interface Item {
  id: string;
  name: string;
  desc?: string;
}

const ITEMS: Item[] = [
  { id: 'apple', name: 'apple', desc: 'red fruit' },
  { id: 'banana', name: 'banana', desc: 'yellow' },
  { id: 'cherry', name: 'cherry', desc: 'red small' },
];

function Harness(props: {
  items?: Item[];
  search?: (q: string) => Promise<Item[]>;
  initial?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(props.initial ?? []);
  return (
    <SearchMultiSelect<Item>
      items={props.items}
      search={props.search}
      selected={selected}
      onChange={setSelected}
      getKey={(i) => i.id}
      getLabel={(i) => i.name}
      getSublabel={(i) => i.desc}
      placeholder="search…"
      emptyText="nothing found"
      testidPrefix="ms"
    />
  );
}

describe('SearchMultiSelect', () => {
  it('renders the search field; focus opens the listbox with options (items mode)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} />);

    const input = screen.getByTestId('ms-search');
    expect(input).toBeInTheDocument();
    // Not focused yet — dropdown is closed.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByTestId('ms-option-apple')).toBeInTheDocument();
    expect(screen.getByTestId('ms-option-banana')).toBeInTheDocument();
    expect(screen.getByTestId('ms-option-cherry')).toBeInTheDocument();
  });

  it('filters by label/sublabel substring on the client', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} />);

    await user.click(screen.getByTestId('ms-search'));
    await user.type(screen.getByTestId('ms-search'), 'ban');

    await waitFor(() => {
      expect(screen.getByTestId('ms-option-banana')).toBeInTheDocument();
      expect(screen.queryByTestId('ms-option-apple')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ms-option-cherry')).not.toBeInTheDocument();
    });
  });

  it('filters by sublabel (desc)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} />);

    await user.click(screen.getByTestId('ms-search'));
    await user.type(screen.getByTestId('ms-search'), 'yellow');

    await waitFor(() => {
      expect(screen.getByTestId('ms-option-banana')).toBeInTheDocument();
      expect(screen.queryByTestId('ms-option-apple')).not.toBeInTheDocument();
    });
  });

  it('multi-select: clicking options adds chips and sets aria-selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} />);

    await user.click(screen.getByTestId('ms-search'));
    await user.click(screen.getByTestId('ms-option-apple'));
    await user.click(screen.getByTestId('ms-option-cherry'));

    expect(screen.getByTestId('ms-chip-apple')).toBeInTheDocument();
    expect(screen.getByTestId('ms-chip-cherry')).toBeInTheDocument();
    // banana is not selected.
    expect(screen.queryByTestId('ms-chip-banana')).not.toBeInTheDocument();
    // Option apple is marked as selected.
    expect(screen.getByTestId('ms-option-apple')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('ms-option-banana')).toHaveAttribute('aria-selected', 'false');
  });

  it('removal: X on a chip deselects; clicking the option again also deselects', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} initial={['apple', 'banana']} />);

    // Chips already exist from initial.
    expect(screen.getByTestId('ms-chip-apple')).toBeInTheDocument();
    const chipApple = screen.getByTestId('ms-chip-apple');
    await user.click(within(chipApple).getByRole('button'));
    expect(screen.queryByTestId('ms-chip-apple')).not.toBeInTheDocument();

    // Clicking option banana again deselects it (toggle off).
    await user.click(screen.getByTestId('ms-search'));
    await user.click(screen.getByTestId('ms-option-banana'));
    expect(screen.queryByTestId('ms-chip-banana')).not.toBeInTheDocument();
  });

  it('async search mode: calls search(q) and renders the result', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (q: string) =>
      ITEMS.filter((i) => i.name.includes(q.toLowerCase())),
    );
    renderWithProviders(<Harness search={search} />);

    await user.click(screen.getByTestId('ms-search'));
    // Empty query -> search('') -> all items.
    await waitFor(() => expect(screen.getByTestId('ms-option-apple')).toBeInTheDocument());

    await user.type(screen.getByTestId('ms-search'), 'cher');
    await waitFor(() => {
      expect(screen.getByTestId('ms-option-cherry')).toBeInTheDocument();
      expect(screen.queryByTestId('ms-option-apple')).not.toBeInTheDocument();
    });
    expect(search).toHaveBeenCalled();
  });

  it('empty state: shows emptyText when there are no matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness items={ITEMS} />);

    await user.click(screen.getByTestId('ms-search'));
    await user.type(screen.getByTestId('ms-search'), 'zzz');

    await waitFor(() => {
      expect(screen.getByTestId('ms-empty')).toHaveTextContent('nothing found');
    });
  });
});
