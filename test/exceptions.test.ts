import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Check, CheckConfig, Finding } from '../src/types.js';

const boundedRun = vi.fn();
vi.mock('../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const { createRegistry } = await import('../src/registry.js');
const { runHygiene } = await import('../src/runner.js');
const { parseConfig } = await import('../src/config.js');
const { loosenings } = await import('../src/exceptions.js');

const err = (check: string): Finding => ({ check, message: 'boom', severity: 'error' });
const run = vi.fn(async (): Promise<Finding[]> => [err('a')]);
const lenientCheck: Check = {
  name: 'a',
  description: 'a',
  loosenings: (settings) => (settings.lax === true ? ['lax: true'] : []),
  run,
};

// runHygiene resolves a file set via git first; an empty tracked list keeps it hermetic.
beforeEach(() => {
  boundedRun.mockReset();
  boundedRun.mockResolvedValue({ stdout: '', stderr: '', code: 0, timedOut: false });
  run.mockClear();
});

const runWith = (settings: CheckConfig) =>
  runHygiene(createRegistry([lenientCheck]), {
    mode: '--check',
    config: { checks: { a: settings } },
  });

describe('a loosening needs a written reason', () => {
  it.each([
    [{ enabled: false }, /\(enabled: false\)/],
    [{ severity: 'warn' as const }, /\(severity: warn\)/],
    [{ lax: true }, /\(lax: true\)/],
    [{ enabled: false, lax: true }, /\(enabled: false, lax: true\)/],
  ])('refuses %j without a reason, before running anything', async (settings, named) => {
    await expect(runWith(settings)).rejects.toThrow(named);
    await expect(runWith(settings)).rejects.toThrow(/check "a" .* without a reason; add `reason:`/);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a loosened check once the section says why', async () => {
    const result = await runWith({ severity: 'warn', lax: true, reason: 'legacy layout' });
    expect(result.findings[0]?.severity).toBe('warn');
    expect(run).toHaveBeenCalledOnce();
  });

  it('needs no reason to tighten or keep the defaults', async () => {
    await expect(runWith({ severity: 'error' })).resolves.toMatchObject({ exitCode: 1 });
    await expect(runWith({ enabled: true, lax: false })).resolves.toMatchObject({ exitCode: 1 });
  });
});

describe('config validation of reason', () => {
  it('accepts a non-empty string', () => {
    expect(parseConfig('checks:\n  a:\n    reason: why\n').checks.a?.reason).toBe('why');
  });

  it.each(['reason: ""', 'reason: "  "', 'reason: 3'])('rejects %s', (line) => {
    expect(() => parseConfig(`checks:\n  a:\n    ${line}\n`)).toThrow(
      /check "a" has an empty or non-string reason/,
    );
  });
});

describe('built-in loosenings', () => {
  const registry = createRegistry();
  const of = (name: string, settings: CheckConfig) => loosenings(registry.get(name)!, settings);

  it.each([
    [
      'docs-links',
      { exempt: ['x.md'], anchors: false, anchorExempt: ['y'] },
      ['exempt', 'anchors: false', 'anchorExempt'],
    ],
    ['md-pairing', { wrapper: false }, ['wrapper: false']],
    [
      'okf',
      { types: '*', exempt: ['a.md'], resourceExemptTypes: ['Design', 'Reference'] },
      ['types: "*"', 'exempt', 'resourceExemptTypes'],
    ],
    ['okf', { resourceExemptTypes: '*' }, ['resourceExemptTypes']],
    ['okf-index', { nestedIndexes: false }, ['nestedIndexes: false']],
    [
      'file-caps',
      { overrides: [{ glob: '*.md' }], mode: 'ratchet' },
      ['overrides', 'mode: ratchet'],
    ],
  ])('%s reports %j as loosening', (name, settings, expected) => {
    expect(of(name, settings)).toEqual(expected);
  });

  it.each([
    ['docs-links', { roots: ['docs', 'guides'], anchors: true, exempt: [] }],
    ['md-pairing', { wrapper: '@CUSTOM.md' }],
    ['okf', { types: ['Library', 'Reference'], resourceExemptTypes: ['Design'] }],
    ['okf-index', { nestedIndexes: true, noUpwardLinks: true, noSiblingLinks: true }],
    ['file-caps', { mode: 'strict', overrides: [] }],
  ])('%s treats %j as configuration, not an exception', (name, settings) => {
    expect(of(name, settings)).toEqual([]);
  });
});
