import { describe, it, expect } from 'vitest';
import { isIgnored, parseActionlintSettings } from '../../src/checks/actionlint-config.js';

describe('parseActionlintSettings', () => {
  it('defaults to the strict configuration', () => {
    expect(parseActionlintSettings({})).toEqual({
      shellcheck: true,
      shellcheckSeverity: 'style',
      ignore: [],
    });
  });

  it('accepts each opt-out', () => {
    const parsed = parseActionlintSettings({
      shellcheck: false,
      shellcheckSeverity: 'warning',
      ignore: { '.github/workflows/*.yml': ['SC2016'] },
    });
    expect(parsed.shellcheck).toBe(false);
    expect(parsed.shellcheckSeverity).toBe('warning');
    expect(parsed.ignore).toEqual([
      expect.objectContaining({ glob: '.github/workflows/*.yml', patterns: [/SC2016/] }),
    ]);
  });

  it.each([
    [{ shellcheck: 'no' }, /"shellcheck" must be true or false/],
    [{ shellcheckSeverity: 'loud' }, /"shellcheckSeverity" must be one of/],
    [{ ignore: ['SC2016'] }, /"ignore" must be a mapping/],
    [{ ignore: { '**': 'SC2016' } }, /must be a list of strings/],
    [{ ignore: { '**': ['('] } }, /invalid ignore regex "\("/],
  ])('rejects a malformed config %j', (settings, error) => {
    expect(() => parseActionlintSettings(settings)).toThrow(error);
  });
});

describe('isIgnored', () => {
  const { ignore } = parseActionlintSettings({
    ignore: { '.github/workflows/release.yml': ['workflow_sha', 'SC2016'] },
  });

  it('matches a pattern within the glob', () => {
    expect(isIgnored(ignore, '.github/workflows/release.yml', 'job.workflow_sha bad')).toBe(true);
  });

  it('does not match outside the glob or for other messages', () => {
    expect(isIgnored(ignore, '.github/workflows/ci.yml', 'job.workflow_sha bad')).toBe(false);
    expect(isIgnored(ignore, '.github/workflows/release.yml', 'other')).toBe(false);
  });
});
