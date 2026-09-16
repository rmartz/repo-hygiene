import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Check, Finding } from '../src/types.js';
import type { FileSet } from '../src/discovery.js';

const boundedRun = vi.fn();
vi.mock('../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const { createRegistry, builtinChecks } = await import('../src/registry.js');
const { runHygiene } = await import('../src/runner.js');
const { formatFinding, formatFindings, formatFindingGithub, formatFindingsGithub, resolveFormat } =
  await import('../src/reporter.js');
const { conflictMarkersCheck } = await import('../src/checks/conflict-markers.js');

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });

const fakeCheck = (name: string, findings: Finding[]): Check => ({
  name,
  description: name,
  run: async () => findings,
});

const err = (check: string): Finding => ({ check, message: 'boom', severity: 'error' });
const warn = (check: string): Finding => ({ check, message: 'meh', severity: 'warn' });

// runHygiene resolves a file set via git before running checks; the fakes ignore
// it, so an empty tracked-file list keeps these hermetic.
beforeEach(() => {
  boundedRun.mockReset();
  boundedRun.mockResolvedValue(ok(''));
});

describe('createRegistry', () => {
  it('looks up, lists, and names registered checks in order', () => {
    const registry = createRegistry([fakeCheck('a', []), fakeCheck('b', [])]);
    expect(registry.names()).toEqual(['a', 'b']);
    expect(registry.get('b')?.name).toBe('b');
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.all().map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('defaults to the built-in checks, which include conflict-markers', () => {
    expect(builtinChecks().map((c) => c.name)).toContain('conflict-markers');
    expect(createRegistry().get('conflict-markers')).toBeDefined();
  });

  it('includes okf in the built-in checks', () => {
    expect(builtinChecks().map((c) => c.name)).toContain('okf');
    expect(createRegistry().get('okf')).toBeDefined();
  });

  it('includes action-pins in the built-in checks', () => {
    expect(builtinChecks().map((c) => c.name)).toContain('action-pins');
    expect(createRegistry().get('action-pins')).toBeDefined();
  });

  it('includes package-pins in the built-in checks', () => {
    expect(builtinChecks().map((c) => c.name)).toContain('package-pins');
    expect(createRegistry().get('package-pins')).toBeDefined();
  });
});

describe('registry defaultNames', () => {
  it('returns only the defaultOn checks, in registration order', () => {
    const registry = createRegistry([
      fakeCheck('a', []),
      { ...fakeCheck('b', []), defaultOn: true },
      { ...fakeCheck('c', []), defaultOn: true },
    ]);
    expect(registry.defaultNames()).toEqual(['b', 'c']);
  });

  it('the built-in default-on set is exactly conflict-markers and action-pins', () => {
    expect(createRegistry().defaultNames()).toEqual(['conflict-markers', 'action-pins']);
  });

  it('the opinionated checks are opt-in (not default-on)', () => {
    const defaults = createRegistry().defaultNames();
    for (const name of [
      'package-pins',
      'docs-links',
      'md-pairing',
      'okf',
      'okf-index',
      'file-caps',
    ]) {
      expect(defaults).not.toContain(name);
    }
  });
});

describe('runHygiene', () => {
  const config = { checks: {} };

  it('runs every check by default and aggregates findings', async () => {
    const registry = createRegistry([fakeCheck('a', [warn('a')]), fakeCheck('b', [err('b')])]);
    const result = await runHygiene(registry, { mode: '--check', config });
    expect(result.findings.map((f) => f.check)).toEqual(['a', 'b']);
    expect(result.exitCode).toBe(1);
  });

  it('exits 0 when only warnings are found', async () => {
    const registry = createRegistry([fakeCheck('a', [warn('a')])]);
    expect((await runHygiene(registry, { mode: '--check', config })).exitCode).toBe(0);
  });

  it('runs only the named checks', async () => {
    const registry = createRegistry([fakeCheck('a', [err('a')]), fakeCheck('b', [err('b')])]);
    const result = await runHygiene(registry, { mode: '--check', only: ['b'], config });
    expect(result.findings.map((f) => f.check)).toEqual(['b']);
  });

  it('throws on an unknown check name', async () => {
    const registry = createRegistry([fakeCheck('a', [])]);
    await expect(runHygiene(registry, { mode: '--check', only: ['nope'], config })).rejects.toThrow(
      /unknown check: nope/,
    );
  });

  it('downgrades a check to warn via config severity (the ramp) → exit 0', async () => {
    const registry = createRegistry([fakeCheck('a', [err('a')])]);
    const ramped = { checks: { a: { severity: 'warn' as const } } };
    const result = await runHygiene(registry, { mode: '--check', config: ramped });
    expect(result.findings[0]?.severity).toBe('warn');
    expect(result.exitCode).toBe(0);
  });

  it('upgrades a warn finding to error via config severity → exit 1', async () => {
    const registry = createRegistry([fakeCheck('a', [warn('a')])]);
    const strict = { checks: { a: { severity: 'error' as const } } };
    const result = await runHygiene(registry, { mode: '--check', config: strict });
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.exitCode).toBe(1);
  });
});

describe('conflictMarkersCheck', () => {
  const filesOf = (text: string): FileSet => ({ paths: ['bad.ts'], read: () => text });
  const ctx = (over: Partial<Parameters<typeof conflictMarkersCheck.run>[0]>) => ({
    mode: '--check' as const,
    files: filesOf(''),
    settings: {},
    env: {},
    ...over,
  });

  it('maps detected markers onto error findings anchored to the file/line', async () => {
    const findings = await conflictMarkersCheck.run(
      ctx({ files: filesOf('<<<<<<< HEAD\nmine\n>>>>>>> other') }),
    );
    expect(findings).toEqual([
      {
        check: 'conflict-markers',
        path: 'bad.ts',
        line: 1,
        message: '<<<<<<< HEAD',
        severity: 'error',
      },
      {
        check: 'conflict-markers',
        path: 'bad.ts',
        line: 3,
        message: '>>>>>>> other',
        severity: 'error',
      },
    ]);
  });

  it('honours the ALLOW_CONFLICT_MARKERS bypass only in --staged mode', async () => {
    const staged = ctx({
      mode: '--staged',
      files: filesOf('<<<<<<< HEAD\n>>>>>>> x'),
      env: { ALLOW_CONFLICT_MARKERS: '1' },
    });
    expect(await conflictMarkersCheck.run(staged)).toEqual([]);
    // The same bypass env has no effect outside --staged.
    const checked = ctx({
      files: filesOf('<<<<<<< HEAD\n>>>>>>> x'),
      env: { ALLOW_CONFLICT_MARKERS: '1' },
    });
    expect(await conflictMarkersCheck.run(checked)).toHaveLength(2);
  });
});

describe('reporter', () => {
  it('renders severity, check tag, and path:line location', () => {
    expect(
      formatFinding({
        check: 'file-caps',
        path: 'a.ts',
        line: 12,
        message: 'too long',
        severity: 'warn',
      }),
    ).toBe('warn [file-caps] a.ts:12: too long');
  });

  it('omits the line when a finding is file-level and the path when repo-level', () => {
    expect(
      formatFinding({
        check: 'md-pairing',
        path: 'AGENTS.md',
        message: 'no CLAUDE.md',
        severity: 'error',
      }),
    ).toBe('error [md-pairing] AGENTS.md: no CLAUDE.md');
    expect(formatFinding({ check: 'x', message: 'repo-level', severity: 'error' })).toBe(
      'error [x] repo-level',
    );
  });

  it('joins findings with newlines', () => {
    expect(formatFindings([err('a'), warn('b')])).toBe('error [a] boom\nwarn [b] meh');
  });
});

describe('github reporter', () => {
  it('maps severity to the workflow command and carries file, line, and title', () => {
    expect(
      formatFindingGithub({
        check: 'file-caps',
        path: 'src/a.ts',
        line: 12,
        message: 'too long',
        severity: 'error',
      }),
    ).toBe('::error file=src/a.ts,line=12,title=file-caps::too long');
    expect(
      formatFindingGithub({
        check: 'okf',
        path: 'docs/x.md',
        line: 3,
        message: 'missing title',
        severity: 'warn',
      }),
    ).toBe('::warning file=docs/x.md,line=3,title=okf::missing title');
  });

  it('omits line for a file-level finding and file for a repo-level finding', () => {
    expect(
      formatFindingGithub({
        check: 'md-pairing',
        path: 'AGENTS.md',
        message: 'no CLAUDE.md',
        severity: 'error',
      }),
    ).toBe('::error file=AGENTS.md,title=md-pairing::no CLAUDE.md');
    expect(formatFindingGithub({ check: 'x', message: 'repo-level', severity: 'error' })).toBe(
      '::error title=x::repo-level',
    );
  });

  it('escapes command data in the message and property values', () => {
    expect(
      formatFindingGithub({
        check: 'okf',
        path: 'weird,file:name.ts',
        line: 1,
        message: 'bad: 50% off\nsecond line',
        severity: 'error',
      }),
    ).toBe('::error file=weird%2Cfile%3Aname.ts,line=1,title=okf::bad: 50%25 off%0Asecond line');
  });

  it('joins findings with newlines', () => {
    expect(formatFindingsGithub([err('a'), warn('b')])).toBe(
      '::error title=a::boom\n::warning title=b::meh',
    );
  });
});

describe('resolveFormat', () => {
  it('honours an explicit format over the environment', () => {
    expect(resolveFormat('text', { GITHUB_ACTIONS: 'true' })).toBe('text');
    expect(resolveFormat('github', {})).toBe('github');
  });

  it('auto-detects github under GITHUB_ACTIONS and defaults to text otherwise', () => {
    expect(resolveFormat(undefined, { GITHUB_ACTIONS: 'true' })).toBe('github');
    expect(resolveFormat(undefined, {})).toBe('text');
    expect(resolveFormat(undefined, { GITHUB_ACTIONS: 'false' })).toBe('text');
  });
});
