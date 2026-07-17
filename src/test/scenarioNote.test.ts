import { describe, it, expect } from 'vitest';
import { splitScenarioNote } from '../pages/run/scenarioNote';

// NIM-73 A2: scenario description splits into a LEADING paragraph (a prominent
// info-callout above the fields — for add_user/update_users this is the precondition
// about pre-seeding the password) and the rest (muted, below the fields). folded-YAML
// paragraphs are separated by \n.
describe('splitScenarioNote', () => {
  it('splits description into a lead paragraph (callout) and the rest (dim)', () => {
    const { lead, rest } = splitScenarioNote(
      '★ Before running, seed the password of the user being added into Vault\n\nAdd or override a single ACL user on a running Redis without a restart.\nThe password is taken from Vault',
    );
    expect(lead).toBe('★ Before running, seed the password of the user being added into Vault');
    expect(rest).toContain('Add or override a single ACL user on a running Redis without a restart.');
    expect(rest).toContain('The password is taken from Vault');
  });

  it('single-paragraph description → all in lead, rest empty', () => {
    expect(splitScenarioNote('init')).toEqual({ lead: 'init', rest: '' });
  });

  it('empty / undefined / whitespace-only → empty strings (callout not rendered)', () => {
    expect(splitScenarioNote(undefined)).toEqual({ lead: '', rest: '' });
    expect(splitScenarioNote('')).toEqual({ lead: '', rest: '' });
    expect(splitScenarioNote('   ')).toEqual({ lead: '', rest: '' });
  });
});
