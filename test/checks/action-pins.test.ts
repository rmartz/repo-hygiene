import { describe, it, expect } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import {
  parseUsesLine,
  checkActionRef,
  scanYaml,
  actionPinsCheck,
} from '../../src/checks/action-pins.js';

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

describe('parseUsesLine', () => {
  it('extracts a step uses value and its version comment', () => {
    expect(parseUsesLine(`      - uses: actions/checkout@${SHA} # v7.0.0`)).toEqual({
      uses: `actions/checkout@${SHA}`,
      comment: 'v7.0.0',
    });
  });

  it('extracts a composite-action uses with no comment', () => {
    expect(parseUsesLine('    - uses: ./.github/actions/setup')).toEqual({
      uses: './.github/actions/setup',
    });
  });

  it('returns null for a non-uses line', () => {
    expect(parseUsesLine('      - run: pnpm test')).toBeNull();
  });
});

describe('checkActionRef', () => {
  it('accepts a full SHA pin with a version comment', () => {
    expect(checkActionRef(`actions/checkout@${SHA}`, 'v7.0.0')).toBeNull();
  });

  it('exempts a local action path', () => {
    expect(checkActionRef('./.github/actions/setup')).toBeNull();
  });

  it('rejects a mutable tag ref', () => {
    expect(checkActionRef('actions/checkout@v7', 'v7')).toMatch(/not SHA-pinned/);
  });

  it('rejects an abbreviated SHA', () => {
    expect(checkActionRef('actions/checkout@a1b2c3d', 'v7.0.0')).toMatch(/not SHA-pinned/);
  });

  it('rejects a SHA pin with no version comment', () => {
    expect(checkActionRef(`actions/checkout@${SHA}`)).toMatch(/full major\.minor\.patch/);
  });

  it('rejects a SHA pin whose comment is a partial (non-full-semver) version', () => {
    expect(checkActionRef(`actions/checkout@${SHA}`, 'v7')).toMatch(/full major\.minor\.patch/);
    expect(checkActionRef(`actions/checkout@${SHA}`, 'v6.4')).toMatch(/full major\.minor\.patch/);
  });

  it('accepts a full semver comment without the v prefix and with a pre-release', () => {
    expect(checkActionRef(`actions/checkout@${SHA}`, '7.0.0')).toBeNull();
    expect(checkActionRef(`actions/checkout@${SHA}`, 'v7.0.0-rc.1')).toBeNull();
  });

  it('accepts a valid 40-hex SHA with uppercase characters', () => {
    const upperSha = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0';
    expect(checkActionRef(`actions/checkout@${upperSha}`, 'v7.0.0')).toBeNull();
  });

  it('requires a docker image to be digest-pinned', () => {
    expect(checkActionRef('docker://alpine:3.20')).toMatch(/@sha256 digest/);
    expect(checkActionRef(`docker://alpine@sha256:${'b'.repeat(64)}`)).toBeNull();
  });

  it('rejects a docker image with a truncated sha256 digest', () => {
    expect(checkActionRef('docker://alpine@sha256:abc')).toMatch(/@sha256 digest/);
  });
});

describe('scanYaml', () => {
  it('flags only the offending line, with its file and line number', () => {
    const yaml = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v7 # v7.0.0',
      `      - uses: actions/setup-node@${SHA} # v6.4.0`,
    ].join('\n');
    const errors = scanYaml('ci.yml', yaml);
    expect(errors).toEqual([
      { file: 'ci.yml', line: 4, reason: expect.stringMatching(/not SHA-pinned/) },
    ]);
  });
});

describe('actionPinsCheck.run', () => {
  const filesOf = (entries: Record<string, string>): FileSet => ({
    paths: Object.keys(entries),
    read: (p) => entries[p] ?? '',
  });
  const ctx = (files: FileSet) => ({
    mode: '--check' as const,
    files,
    settings: {},
    env: {},
  });

  it('flags a bad pin under .github and ignores non-.github yaml', async () => {
    const files = filesOf({
      '.github/workflows/ci.yml': '      - uses: actions/checkout@v7 # v7.0.0\n',
      'other/config.yml': '      - uses: actions/checkout@v7 # v7.0.0\n',
    });
    const findings = await actionPinsCheck.run(ctx(files));
    expect(findings).toEqual([
      {
        check: 'action-pins',
        path: '.github/workflows/ci.yml',
        line: 1,
        message: expect.stringMatching(/not SHA-pinned/),
        severity: 'error',
      },
    ]);
  });
});
