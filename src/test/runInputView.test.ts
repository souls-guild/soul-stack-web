import { describe, it, expect } from 'vitest';
import { buildInputGroups, objectListColumns } from '../pages/incarnations/runInputView';
import type { ServiceScenarioInfo } from '../api/keeper';

type Scenario = Pick<ServiceScenarioInfo, 'input_schema' | 'form'>;

const scenario: Scenario = {
  input_schema: {
    cloud_stand: { type: 'string', description: 'WB Cloud stand' },
    environment: { type: 'string' },
    environment_logical: { type: 'string' },
    replicas_per_master: { type: 'integer', default: 2 },
    dragonfly_flags: { type: 'object', default: {} },
    tls_ca: { type: 'string' },
    rm_external_id: { type: 'string' },
    data_mb: { type: 'integer' },
  },
  form: {
    sections: [
      {
        key: 'contacts',
        title: 'Contacts',
        fields: [
          { name: 'cloud_stand', label: 'Cloud stand' },
          { name: 'environment', label: 'Environment' },
          { name: 'environment_logical', label: 'Logical environment' },
          { name: 'tls_ca', label: 'TLS CA', show_when: 'input.environment == "prd"' },
        ],
      },
      {
        key: 'dragonfly',
        title: 'DragonFly',
        fields: [
          { name: 'replicas_per_master', label: 'Replicas' },
          { name: 'dragonfly_flags', label: 'Flags' },
        ],
      },
      { key: 'empty', title: 'Nothing here', fields: [{ name: 'not_declared' }] },
    ],
  },
};

describe('buildInputGroups', () => {
  it('lays the input out by the form: sections, labels, and the rest of what it carries', () => {
    const groups = buildInputGroups(
      {
        cloud_stand: 'cloud',
        environment: 'dev',
        replicas_per_master: 2,
        dragonfly_flags: { dbnum: '16' },
        rm_external_id: 'dba-cache',
        legacy_key: 'x',
      },
      scenario,
    );
    expect(groups.map((g) => [g.key, g.kind, g.title])).toEqual([
      ['contacts', 'section', 'Contacts'],
      ['dragonfly', 'section', 'DragonFly'],
      ['__other', 'other', undefined],
      ['__unknown', 'unknown', undefined],
    ]);
    const contacts = groups[0].rows;
    // tls_ca is hidden by its show_when and absent: the operator was never asked.
    expect(contacts.map((r) => [r.key, r.label, r.present])).toEqual([
      ['cloud_stand', 'Cloud stand', true],
      ['environment', 'Environment', true],
      ['environment_logical', 'Logical environment', false],
    ]);
    expect(contacts[0].description).toBe('WB Cloud stand');
    const df = groups[1].rows;
    expect(df[0].isDefault).toBe(true);
    // {dbnum:"16"} is not the default {}.
    expect(df[1].isDefault).toBe(false);
    // Schema fields outside the form appear only when the run carried them; data_mb did not.
    expect(groups[2].rows.map((r) => r.key)).toEqual(['rm_external_id']);
    expect(groups[3].rows.map((r) => r.key)).toEqual(['legacy_key']);
  });

  it('shows a field its show_when hides when the input carries it anyway', () => {
    const groups = buildInputGroups({ environment: 'dev', tls_ca: 'pem' }, scenario);
    expect(groups[0].rows.map((r) => r.key)).toContain('tls_ca');
  });

  it('compares defaults by value, not by reference', () => {
    const [, df] = buildInputGroups({ dragonfly_flags: {} }, scenario);
    expect(df.rows.find((r) => r.key === 'dragonfly_flags')?.isDefault).toBe(true);
  });

  it('a form-less schema is one untitled group in schema order, absent fields included', () => {
    const groups = buildInputGroups(
      { b: 1, extra: true },
      { input_schema: { a: { type: 'string' }, b: { type: 'integer' } } },
    );
    expect(groups.map((g) => [g.key, g.kind])).toEqual([
      ['input', 'section'],
      ['__unknown', 'unknown'],
    ]);
    expect(groups[0].rows.map((r) => [r.key, r.present])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('without a schema every key of the input is a row, labelled by its key', () => {
    const groups = buildInputGroups({ version: '7.2', users: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => [r.key, r.label])).toEqual([
      ['version', 'version'],
      ['users', 'users'],
    ]);
    expect(buildInputGroups({})).toEqual([]);
  });

  it('a group holding a list of objects is wide', () => {
    const groups = buildInputGroups({ users: [{ name: 'a' }], owners: ['x'] });
    expect(groups[0].wide).toBe(true);
    expect(buildInputGroups({ owners: ['x'] })[0].wide).toBe(false);
  });
});

describe('objectListColumns', () => {
  it('puts the item schema order first and keeps keys only the items carry', () => {
    const cols = objectListColumns(
      [{ state: 'on', name: 'app', extra: 1 }, { name: 'ro', perms: '+@read' }],
      { type: 'object', properties: { name: {}, perms: {}, state: {}, password: {} } },
    );
    expect(cols).toEqual(['name', 'perms', 'state', 'extra']);
  });
});
