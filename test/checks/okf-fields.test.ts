import { describe, it, expect } from 'vitest';
import { validateOptionalFields } from '../../src/checks/okf-fields.js';

const AT = '2026-06-30T14:00:00Z';

describe('validateOptionalFields', () => {
  it('accepts a page with no optional fields', () => {
    expect(validateOptionalFields({ type: 'Script', title: 't' })).toEqual([]);
  });

  it('accepts a fully-populated, well-formed set of optional families', () => {
    expect(
      validateOptionalFields({
        status: 'stable',
        tags: ['a', 'b'],
        stale_after: AT,
        generated: { by: 'claude/4.8', at: AT },
        verified: [{ by: 'human:reed', at: AT }],
        sources: [{ resource: 'src/x.ts', author: 'process:crawler', last_modified: AT }],
        executor: { resource: 'bin/run.ts' },
        attester: { resource: 'bin/attest.ts' },
        usage_window: { from: AT, to: AT },
      }),
    ).toEqual([]);
  });

  it('tolerates unknown keys', () => {
    expect(validateOptionalFields({ some_future_field: { nested: true } })).toEqual([]);
  });

  it('rejects an out-of-vocabulary status', () => {
    expect(validateOptionalFields({ status: 'archived' })).toContain(
      'status must be one of draft, stable, deprecated',
    );
  });

  it('rejects tags that are not a list of strings', () => {
    expect(validateOptionalFields({ tags: ['ok', 3] })).toContain('tags must be a list of strings');
  });

  it('rejects a timestamp without an explicit offset', () => {
    expect(validateOptionalFields({ stale_after: '2026-06-30T14:00:00' })).toContain(
      'stale_after must be an ISO-8601 datetime with offset (e.g. 2026-06-30T14:00:00Z)',
    );
  });

  it('requires generated.by and validates its actor format', () => {
    expect(validateOptionalFields({ generated: { at: AT } })).toContain('generated.by is required');
    expect(validateOptionalFields({ generated: { by: 'not an actor' } })).toContain(
      'generated.by must use actor format (<producer>/<version>, human:<id>, or process:<id>)',
    );
  });

  it('validates each verified entry (mapping or list)', () => {
    expect(validateOptionalFields({ verified: 'nope' })).toContain(
      'verified must be a { by, at } mapping',
    );
    expect(validateOptionalFields({ verified: [{ by: 'bad', at: AT }] })).toContain(
      'verified[0].by must use actor format (<producer>/<version>, human:<id>, or process:<id>)',
    );
  });

  it('requires a resource on each source and on executor/attester', () => {
    expect(validateOptionalFields({ sources: [{ author: 'human:x' }] })).toContain(
      'sources[0].resource is required',
    );
    expect(validateOptionalFields({ executor: {} })).toContain(
      'executor must be an object with a required `resource`',
    );
  });

  it('requires usage_window to be a { from, to } mapping with valid timestamps', () => {
    expect(validateOptionalFields({ usage_window: [] })).toContain(
      'usage_window must be a { from, to } mapping',
    );
    expect(validateOptionalFields({ usage_window: { from: 'bad', to: AT } })).toContain(
      'usage_window.from must be an ISO-8601 datetime with offset (e.g. 2026-06-30T14:00:00Z)',
    );
  });
});
