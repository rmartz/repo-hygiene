import { describe, it, expect } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import { jobTimeoutsCheck, scanJobTimeouts } from '../../src/checks/job-timeouts.js';
import { parseJobTimeoutSettings } from '../../src/checks/job-timeouts-config.js';

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (files: FileSet, settings: Record<string, unknown> = {}) => ({
  mode: '--check' as const,
  files,
  settings,
  env: {},
});

const CI = '.github/workflows/ci.yml';
const workflow = (jobs: string): string => `name: CI\non: push\njobs:\n${jobs}`;

describe('scanJobTimeouts', () => {
  const defaults = parseJobTimeoutSettings({});

  it('flags a job with no timeout-minutes, on the job key line', () => {
    const text = workflow('  build:\n    runs-on: ubuntu-latest\n    steps: []\n');
    expect(scanJobTimeouts(CI, text, defaults)).toEqual([
      { job: 'build', line: 4, reason: expect.stringMatching(/no timeout-minutes/) },
    ]);
  });

  it('flags a timeout above the cap, on the timeout line', () => {
    const text = workflow('  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 16\n');
    expect(scanJobTimeouts(CI, text, defaults)).toEqual([
      { job: 'build', line: 6, reason: expect.stringMatching(/16 exceeds the 15-minute cap/) },
    ]);
  });

  it('accepts a timeout exactly at the cap', () => {
    const text = workflow('  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n');
    expect(scanJobTimeouts(CI, text, defaults)).toEqual([]);
  });

  it('exempts a reusable-workflow caller (`uses:`)', () => {
    const text = workflow('  release:\n    uses: acme/ci/.github/workflows/r.yml@abc\n');
    expect(scanJobTimeouts(CI, text, defaults)).toEqual([]);
  });

  it('flags an expression value as unverifiable by default', () => {
    const text = workflow('  build:\n    runs-on: x\n    timeout-minutes: ${{ inputs.t }}\n');
    expect(scanJobTimeouts(CI, text, defaults)).toEqual([
      { job: 'build', line: 6, reason: expect.stringMatching(/expression.*cannot be verified/) },
    ]);
  });

  it('accepts an expression value under allowExpressions', () => {
    const text = workflow('  build:\n    runs-on: x\n    timeout-minutes: ${{ inputs.t }}\n');
    const lax = parseJobTimeoutSettings({ allowExpressions: true });
    expect(scanJobTimeouts(CI, text, lax)).toEqual([]);
  });

  it('flags a non-positive or non-numeric timeout', () => {
    const text = workflow('  a:\n    timeout-minutes: 0\n  b:\n    timeout-minutes: soon\n');
    expect(scanJobTimeouts(CI, text, defaults).map((f) => f.job)).toEqual(['a', 'b']);
  });

  it('honors a raised maxMinutes', () => {
    const text = workflow('  build:\n    runs-on: x\n    timeout-minutes: 45\n');
    expect(scanJobTimeouts(CI, text, parseJobTimeoutSettings({ maxMinutes: 60 }))).toEqual([]);
  });

  it('skips a named job ignored for a matching glob', () => {
    const text = workflow('  build:\n    runs-on: x\n  test:\n    runs-on: x\n');
    const settings = parseJobTimeoutSettings({ ignore: { '.github/workflows/*.yml': ['build'] } });
    expect(scanJobTimeouts(CI, text, settings).map((f) => f.job)).toEqual(['test']);
  });

  it('skips every job of a file ignored with "*"', () => {
    const text = workflow('  build:\n    runs-on: x\n  test:\n    runs-on: x\n');
    const settings = parseJobTimeoutSettings({ ignore: { [CI]: ['*'] } });
    expect(scanJobTimeouts(CI, text, settings)).toEqual([]);
  });

  it('does not apply an ignore outside its glob', () => {
    const text = workflow('  build:\n    runs-on: x\n');
    const settings = parseJobTimeoutSettings({ ignore: { '.github/workflows/other.yml': ['*'] } });
    expect(scanJobTimeouts(CI, text, settings).map((f) => f.job)).toEqual(['build']);
  });

  it('leaves unparseable YAML and a workflow with no jobs to actionlint', () => {
    expect(scanJobTimeouts(CI, 'jobs: [\n', defaults)).toEqual([]);
    expect(scanJobTimeouts(CI, 'name: x\non: push\n', defaults)).toEqual([]);
  });
});

describe('parseJobTimeoutSettings', () => {
  it('defaults to a 15-minute cap, strict expressions, no ignores', () => {
    expect(parseJobTimeoutSettings({})).toEqual({
      maxMinutes: 15,
      allowExpressions: false,
      ignore: [],
    });
  });

  it.each([
    [{ maxMinutes: 0 }, /"maxMinutes" must be a positive integer/],
    [{ maxMinutes: 2.5 }, /"maxMinutes" must be a positive integer/],
    [{ maxMinutes: '15' }, /"maxMinutes" must be a positive integer/],
    [{ allowExpressions: 'yes' }, /"allowExpressions" must be true or false/],
    [{ ignore: ['build'] }, /"ignore" must be a mapping/],
    [{ ignore: { '**': 'build' } }, /must be a list of job ids/],
  ])('rejects a malformed config %j', (settings, error) => {
    expect(() => parseJobTimeoutSettings(settings)).toThrow(error);
  });
});

describe('jobTimeoutsCheck', () => {
  it('is default-on', () => {
    expect(jobTimeoutsCheck.defaultOn).toBe(true);
  });

  it('reports error findings for workflow files only', async () => {
    const missing = workflow('  build:\n    runs-on: x\n');
    const findings = await jobTimeoutsCheck.run(
      ctx(filesOf({ [CI]: missing, '.github/dependabot.yml': missing, 'src/a.yml': missing })),
    );
    expect(findings).toEqual([
      {
        check: 'job-timeouts',
        path: CI,
        line: 4,
        message: expect.stringMatching(/^job "build": no timeout-minutes/),
        severity: 'error',
      },
    ]);
  });

  it('applies settings from config', async () => {
    const text = workflow('  build:\n    runs-on: x\n    timeout-minutes: 30\n');
    const findings = await jobTimeoutsCheck.run(ctx(filesOf({ [CI]: text }), { maxMinutes: 30 }));
    expect(findings).toEqual([]);
  });
});
