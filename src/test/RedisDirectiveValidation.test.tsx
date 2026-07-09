// NIM-76 guard-тесты: inline-валидация + typeahead имён Redis-директив в MapEditor.
//
// Матчинг по data-testid (устойчиво к языку). Инварианты: помеченное x-directives
// поле валидируется против каталога серии версии; unknown-directive блокирует submit
// через тот же канал onInvalidMapChange; каталог не на руках → graceful (не блокируем);
// поле без x-directives не валидируется; datalist несёт имена серии; версия реактивна;
// операционный сценарий берёт версию из incarnation.state.redis_version.

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScenarioInputFields } from '../pages/incarnations/ScenarioInputFields';
import { RunWizard } from '../pages/run/RunWizard';
import { tokenStore } from '../api/tokenStore';
import type { ScenarioInputSchema, ScenarioInputSchemaProperty } from '../api/keeper';
import {
  versionToSeries,
  directiveFieldTag,
  directiveNamesForVersion,
  schemaHasDirectiveField,
  type DirectiveCatalogContext,
  type ScenarioFieldsState,
} from '../pages/incarnations/scenarioInputFields.helpers';

// redis_settings — map по additional_properties + метка x-directives (контракт backend).
const directiveMapSchema: ScenarioInputSchema = {
  redis_settings: {
    type: 'object',
    additional_properties: { type: 'string' },
    'x-directives': 'redis',
  } as unknown as ScenarioInputSchemaProperty,
};

// Обычный map БЕЗ x-directives — против каталога НЕ валидируется.
const plainMapSchema: ScenarioInputSchema = {
  opts: {
    type: 'object',
    additional_properties: { type: 'string' },
  } as unknown as ScenarioInputSchemaProperty,
};

const CATALOG: DirectiveCatalogContext = {
  loaded: true,
  directives: {
    '6.2': ['maxmemory', 'save'],
    '8.2': ['appendonly', 'maxmemory', 'maxmemory-policy'],
  },
};

function StatefulFields({
  schema,
  directiveCatalog,
  directiveVersion,
  onInvalidMapChange,
}: {
  schema: ScenarioInputSchema;
  directiveCatalog?: DirectiveCatalogContext;
  directiveVersion?: string;
  onInvalidMapChange?: (fields: string[]) => void;
}) {
  const [state, setState] = useState<ScenarioFieldsState>({});
  return (
    <ScenarioInputFields
      schema={schema}
      value={state}
      onChange={setState}
      directiveCatalog={directiveCatalog}
      directiveVersion={directiveVersion}
      onInvalidMapChange={onInvalidMapChange}
    />
  );
}

// Добавляет одну пару и вводит ключ+значение в MapEditor поля `field`.
function addPair(field: string, idx: number, key: string, val: string) {
  fireEvent.click(screen.getByTestId(`field-map-add-${field}`));
  fireEvent.change(screen.getByTestId(`field-map-key-${field}-${idx}`), { target: { value: key } });
  fireEvent.change(screen.getByTestId(`field-map-val-${field}-${idx}`), { target: { value: val } });
}

// ─── чистые хелперы ─────────────────────────────────────────────────────────
describe('NIM-76 хелперы версии/каталога', () => {
  it('versionToSeries: первые два компонента полной версии', () => {
    expect(versionToSeries('8.2.2')).toBe('8.2');
    expect(versionToSeries('6.2.14')).toBe('6.2');
    expect(versionToSeries('7.0')).toBe('7.0');
  });

  it('versionToSeries: пустое/битое → undefined', () => {
    expect(versionToSeries(undefined)).toBeUndefined();
    expect(versionToSeries('')).toBeUndefined();
    expect(versionToSeries('8')).toBeUndefined();
  });

  it('versionToSeries: снимает "v"-префикс и Debian-epoch (зеркалит backend)', () => {
    // epoch — реальный операционный кейс state.redis_version (Debian-сборка Redis).
    expect(versionToSeries('5:7.4.1-1~deb12u7')).toBe('7.4');
    expect(versionToSeries('6:8.2.2')).toBe('8.2');
    // не сломать обычные и v-префикс.
    expect(versionToSeries('8.2.2')).toBe('8.2');
    expect(versionToSeries('v8.2.2')).toBe('8.2');
    expect(versionToSeries(' 8.2.2 ')).toBe('8.2');
  });

  it('directiveFieldTag: truthy x-directives → тег, иначе undefined', () => {
    expect(directiveFieldTag(directiveMapSchema.redis_settings)).toBe('redis');
    expect(directiveFieldTag(plainMapSchema.opts)).toBeUndefined();
  });

  it('directiveNamesForVersion: серия из каталога / graceful undefined', () => {
    expect(directiveNamesForVersion(CATALOG, '8.2.2')).toEqual(['appendonly', 'maxmemory', 'maxmemory-policy']);
    // каталог не загружен → undefined (graceful)
    expect(directiveNamesForVersion({ loaded: false, directives: CATALOG.directives }, '8.2.2')).toBeUndefined();
    // серии нет в каталоге → undefined
    expect(directiveNamesForVersion(CATALOG, '9.9.9')).toBeUndefined();
    // версия пустая → undefined
    expect(directiveNamesForVersion(CATALOG, undefined)).toBeUndefined();
  });

  it('schemaHasDirectiveField: гейт fetch каталога', () => {
    expect(schemaHasDirectiveField(directiveMapSchema)).toBe(true);
    expect(schemaHasDirectiveField(plainMapSchema)).toBe(false);
    expect(schemaHasDirectiveField(undefined)).toBe(false);
  });
});

// ─── #1 известная vs неизвестная директива (inline, не на submit) ────────────
describe('NIM-76 #1 inline-подсветка неизвестного ключа', () => {
  it('известная директива серии → нет ошибки', async () => {
    render(<StatefulFields schema={directiveMapSchema} directiveCatalog={CATALOG} directiveVersion="8.2.2" />);
    addPair('redis_settings', 0, 'maxmemory', '256mb');
    await waitFor(() => {
      expect(screen.queryByTestId('field-map-error-redis_settings')).not.toBeInTheDocument();
    });
  });

  it('неизвестная директива → красная подсветка + span с версией сразу (не на submit)', async () => {
    render(<StatefulFields schema={directiveMapSchema} directiveCatalog={CATALOG} directiveVersion="8.2.2" />);
    addPair('redis_settings', 0, 'not-a-directive', 'x');
    const err = await screen.findByTestId('field-map-error-redis_settings');
    expect(err).toBeInTheDocument();
    expect(err).toHaveTextContent('8.2.2');
    // Ключевой инпут aria-invalid.
    expect(screen.getByTestId('field-map-key-redis_settings-0')).toHaveAttribute('aria-invalid', 'true');
  });

  it('директива чужой серии (save есть в 6.2, нет в 8.2) → unknown на 8.2.2', async () => {
    render(<StatefulFields schema={directiveMapSchema} directiveCatalog={CATALOG} directiveVersion="8.2.2" />);
    addPair('redis_settings', 0, 'save', '900 1');
    await waitFor(() => {
      expect(screen.getByTestId('field-map-error-redis_settings')).toBeInTheDocument();
    });
  });
});

// ─── #2 unknown-directive блокирует submit через канал onInvalidMapChange ─────
describe('NIM-76 #2 unknown-directive → канал ошибок (submit-gate)', () => {
  it('unknown → onInvalidMapChange содержит поле; исправление известной → канал очищается', async () => {
    let invalid: string[] = [];
    render(
      <StatefulFields
        schema={directiveMapSchema}
        directiveCatalog={CATALOG}
        directiveVersion="8.2.2"
        onInvalidMapChange={(f) => { invalid = f; }}
      />,
    );
    addPair('redis_settings', 0, 'bogus', 'v');
    await waitFor(() => expect(invalid).toContain('redis_settings'));
    // Исправляем на валидную директиву → ошибка снимается, канал пуст.
    fireEvent.change(screen.getByTestId('field-map-key-redis_settings-0'), { target: { value: 'appendonly' } });
    await waitFor(() => expect(invalid).not.toContain('redis_settings'));
  });
});

// ─── #3 graceful-degrade: каталог недоступен → не помечаем/не блокируем ───────
describe('NIM-76 #3 graceful-degrade без каталога', () => {
  it('loaded=false → произвольный ключ НЕ помечается, канал не блокирует', async () => {
    let invalid: string[] = [];
    render(
      <StatefulFields
        schema={directiveMapSchema}
        directiveCatalog={{ loaded: false, directives: {} }}
        directiveVersion="8.2.2"
        onInvalidMapChange={(f) => { invalid = f; }}
      />,
    );
    addPair('redis_settings', 0, 'whatever-key', 'v');
    // даём эффекту/коммиту прогнаться
    await waitFor(() => {
      expect(screen.getByTestId('field-map-key-redis_settings-0')).toHaveValue('whatever-key');
    });
    expect(screen.queryByTestId('field-map-error-redis_settings')).not.toBeInTheDocument();
    expect(invalid).not.toContain('redis_settings');
  });

  it('каталог загружен, но серии нет (directives:{}) → тоже graceful', async () => {
    render(
      <StatefulFields
        schema={directiveMapSchema}
        directiveCatalog={{ loaded: true, directives: {} }}
        directiveVersion="8.2.2"
      />,
    );
    addPair('redis_settings', 0, 'anything', 'v');
    await waitFor(() => {
      expect(screen.getByTestId('field-map-key-redis_settings-0')).toHaveValue('anything');
    });
    expect(screen.queryByTestId('field-map-error-redis_settings')).not.toBeInTheDocument();
  });
});

// ─── #4 только помеченные поля валидируются ───────────────────────────────────
describe('NIM-76 #4 поле без x-directives не валидируется', () => {
  it('обычный map + каталог на руках → неизвестный ключ НЕ ошибка', async () => {
    render(<StatefulFields schema={plainMapSchema} directiveCatalog={CATALOG} directiveVersion="8.2.2" />);
    addPair('opts', 0, 'definitely-not-a-redis-directive', 'v');
    await waitFor(() => {
      expect(screen.getByTestId('field-map-key-opts-0')).toHaveValue('definitely-not-a-redis-directive');
    });
    expect(screen.queryByTestId('field-map-error-opts')).not.toBeInTheDocument();
    // datalist для непомеченного поля не навешивается.
    expect(screen.queryByTestId('field-map-directives-opts')).not.toBeInTheDocument();
  });
});

// ─── #5 typeahead: datalist несёт имена серии ────────────────────────────────
describe('NIM-76 #5 typeahead datalist', () => {
  it('datalist содержит имена выбранной серии, ключ-инпут ссылается на него', async () => {
    render(<StatefulFields schema={directiveMapSchema} directiveCatalog={CATALOG} directiveVersion="8.2.2" />);
    fireEvent.click(screen.getByTestId('field-map-add-redis_settings'));
    const datalist = await screen.findByTestId('field-map-directives-redis_settings');
    const values = Array.from(datalist.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['appendonly', 'maxmemory', 'maxmemory-policy']);
    // input list ссылается на id datalist-а.
    const keyInput = screen.getByTestId('field-map-key-redis_settings-0');
    expect(keyInput.getAttribute('list')).toBe(datalist.getAttribute('id'));
  });
});

// ─── #6 реактивность версии (create): смена версии меняет валидный набор ──────
describe('NIM-76 #6 реактивность версии', () => {
  it('ранее валидный ключ становится unknown при смене серии', async () => {
    let invalid: string[] = [];
    const props = {
      schema: directiveMapSchema,
      directiveCatalog: CATALOG,
      onInvalidMapChange: (f: string[]) => { invalid = f; },
    };
    const { rerender } = render(<StatefulFields {...props} directiveVersion="8.2.2" />);
    // appendonly валиден на 8.2
    addPair('redis_settings', 0, 'appendonly', 'yes');
    await waitFor(() => {
      expect(screen.queryByTestId('field-map-error-redis_settings')).not.toBeInTheDocument();
      expect(invalid).not.toContain('redis_settings');
    });
    // Меняем версию на 6.2.x → appendonly больше не в наборе.
    rerender(<StatefulFields {...props} directiveVersion="6.2.14" />);
    await waitFor(() => {
      expect(screen.getByTestId('field-map-error-redis_settings')).toBeInTheDocument();
      expect(invalid).toContain('redis_settings');
    });
  });
});

// ─── BUG-1: epoch-пинованная версия валидируется как обычная (не гасим) ───────
describe('NIM-76 BUG-1 epoch-версия ведёт себя как обычная', () => {
  it('версия "6:8.2.2" → серия 8.2: unknown блокирует, known — нет', async () => {
    let invalid: string[] = [];
    render(
      <StatefulFields
        schema={directiveMapSchema}
        directiveCatalog={CATALOG}
        directiveVersion="6:8.2.2"
        onInvalidMapChange={(f) => { invalid = f; }}
      />,
    );
    // Неизвестная директива серии 8.2 → красная подсветка + hard-block.
    addPair('redis_settings', 0, 'not-a-directive', 'x');
    await waitFor(() => {
      expect(screen.getByTestId('field-map-error-redis_settings')).toBeInTheDocument();
      expect(invalid).toContain('redis_settings');
    });
    // Исправляем на валидную для 8.2 (appendonly) → ошибка снимается.
    fireEvent.change(screen.getByTestId('field-map-key-redis_settings-0'), { target: { value: 'appendonly' } });
    await waitFor(() => {
      expect(screen.queryByTestId('field-map-error-redis_settings')).not.toBeInTheDocument();
      expect(invalid).not.toContain('redis_settings');
    });
  });
});

// ─── #7 операционный сценарий: версия из incarnation.state.redis_version ──────────────────────
describe('NIM-76 #7 операционный update_config берёт версию из state.redis_version', () => {
  function stubFetch() {
    const scenarios = [
      {
        name: 'update_config',
        kind: 'operational',
        runnable: true,
        input_schema: {
          redis_settings: { type: 'object', additional_properties: { type: 'string' }, 'x-directives': 'redis' },
        },
      },
    ];
    tokenStore.set('jwt-test');
    return vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/v1/services/redis/directives')) {
        return json({ service: 'redis', ref: 'main', sha1: 'abc', directives: { '6.2': ['maxmemory', 'save'], '8.2': ['appendonly', 'maxmemory', 'maxmemory-policy'] } });
      }
      if (url.includes('/v1/services/redis/scenarios')) {
        return json({ service: 'redis', ref: 'main', scenarios });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [{ name: 'redis', ref: 'main' }], offset: 0, limit: 50, total: 1 });
      }
      // single incarnation GET — state.redis_version = 8.2.2
      if (/\/v1\/incarnations\/redis-prod(\?|$)/.test(url)) {
        return json({ name: 'redis-prod', service: 'redis', service_version: 'main', state_schema_version: 1, status: 'ready', spec: {}, state: { redis_version: '8.2.2' }, status_details: {}, created_at: '', updated_at: '' });
      }
      if (url.includes('/v1/incarnations')) {
        return json({ items: [{ name: 'redis-prod', service: 'redis', service_version: 'main', state_schema_version: 1, covens: ['prod'], status: 'ready', created_at: '', updated_at: '' }], offset: 0, limit: 50, total: 1 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
  }

  it('datalist серии 8.2 (из state.redis_version=8.2.2) на step 3', async () => {
    stubFetch();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/run?workload=scenario&service=redis&scenario=update_config&incarnation=redis-prod']}>
          <RunWizard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // step 1 → 2 → 3 (deep-link предвыбирает service+scenario+incarnation).
    fireEvent.click(await screen.findByRole('button', { name: /Далее/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Далее/ }));
    // На step 3 рендерится ScenarioInputFields с redis_settings; datalist от версии 8.2.2.
    const datalist = await screen.findByTestId('field-map-directives-redis_settings', {}, { timeout: 4000 });
    const values = Array.from(datalist.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['appendonly', 'maxmemory', 'maxmemory-policy']);
    vi.unstubAllGlobals();
    tokenStore.clear();
  });
});

// ─── FIX-1: размонтирование errored поля снимает submit-gate (не залипает) ────
describe('NIM-76 FIX-1 unmount снимает ошибку map-поля', () => {
  it('скрытие errored redis_settings → onInvalidMapChange очищает поле', async () => {
    let invalid: string[] = [];
    function Wrapper({ show }: { show: boolean }) {
      const [state, setState] = useState<ScenarioFieldsState>({});
      return show ? (
        <ScenarioInputFields
          schema={directiveMapSchema}
          value={state}
          onChange={setState}
          directiveCatalog={CATALOG}
          directiveVersion="8.2.2"
          onInvalidMapChange={(f) => { invalid = f; }}
        />
      ) : (
        <div data-testid="hidden" />
      );
    }
    const { rerender } = render(<Wrapper show />);
    addPair('redis_settings', 0, 'bogus-directive', 'v');
    await waitFor(() => expect(invalid).toContain('redis_settings'));
    // Прячем поле (эмуляция show_when-скрытия / смены сценария) → gate снимается.
    rerender(<Wrapper show={false} />);
    await waitFor(() => expect(invalid).not.toContain('redis_settings'));
  });
});

// ─── FIX-2: операционный mixed-target (>1 инкарнация) → директивы не блокируют ───────
describe('NIM-76 FIX-2 операционный fan-out на >1 инкарнацию → graceful', () => {
  function stubFetchMulti() {
    const scenarios = [
      {
        name: 'update_config',
        kind: 'operational',
        runnable: true,
        input_schema: {
          redis_settings: { type: 'object', additional_properties: { type: 'string' }, 'x-directives': 'redis' },
        },
      },
    ];
    tokenStore.set('jwt-test');
    return vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const json = (obj: unknown, status = 200) =>
        new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/v1/services/redis/directives')) {
        return json({ service: 'redis', ref: 'main', directives: { '6.2': ['maxmemory', 'save'], '8.2': ['appendonly', 'maxmemory'] } });
      }
      if (url.includes('/v1/services/redis/scenarios')) {
        return json({ service: 'redis', ref: 'main', scenarios });
      }
      if (url.includes('/v1/services')) {
        return json({ items: [{ name: 'redis', ref: 'main' }], offset: 0, limit: 50, total: 1 });
      }
      if (url.includes('/v1/incarnations')) {
        return json({
          items: ['redis-a', 'redis-b'].map((name) => ({ name, service: 'redis', service_version: 'main', state_schema_version: 1, covens: ['prod'], status: 'ready', created_at: '', updated_at: '' })),
          offset: 0, limit: 50, total: 2,
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
  }

  it('regex матчит 2 инкарнации → MapEditor есть, datalist НЕ навешен', async () => {
    stubFetchMulti();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/run?workload=scenario&service=redis&scenario=update_config&incarnation_regex=^redis-']}>
          <RunWizard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Далее/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Далее/ }));
    // MapEditor рендерится, но директив-валидация выключена (mixed-target) → нет datalist.
    await screen.findByTestId('field-map-redis_settings', {}, { timeout: 4000 });
    expect(screen.queryByTestId('field-map-directives-redis_settings')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    tokenStore.clear();
  });
});
