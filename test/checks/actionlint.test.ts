import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import type { CheckConfig } from '../../src/types.js';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));
const installActionlint = vi.fn();
vi.mock('../../src/checks/actionlint-binary.js', () => ({ installActionlint }));
const rm = vi.fn();
vi.mock('node:fs/promises', () => ({ rm }));

const result = (stdout: string, code = 0) => ({ stdout, stderr: '', code, timedOut: false });

const { actionlintCheck, parseActionlintJson, isWorkflowPath } =
  await import('../../src/checks/actionlint.js');
const { InconclusiveError } = await import('../../src/outcome.js');
const { builtinChecks, createRegistry } = await import('../../src/registry.js');

const CWD = '/repo';
const filesOf = (...paths: string[]): FileSet => ({ paths, read: () => '' });
const ctx = (files: FileSet, settings: CheckConfig = {}) => ({
  mode: '--check' as const,
  files,
  cwd: CWD,
  settings,
  env: { PATH: '/usr/bin' },
});
const lintError = (filepath: string, message: string, kind = 'expression', line = 7) => ({
  message,
  filepath,
  line,
  column: 3,
  kind,
  snippet: '',
  end_column: 9,
});
const WORKFLOW_SHA = 'property "workflow_sha" is not defined in object type {}';
/** actionlint 1.7.12's real message for the `job.workflow_*` false positive. */
const JOB_CONTEXT =
  '{check_run_id: number; container: {id: string; network: string}; status: string}';
const jobProperty = (name: string) =>
  `property "${name}" is not defined in object type ${JOB_CONTEXT}`;
const SC2016 = 'shellcheck reported issue in this script: SC2016:info:1:6: Expressions don';

/** Queue a present shellcheck, then actionlint's JSON output. */
const queueRun = (errors: object[], { shellcheck = true } = {}) => {
  if (shellcheck) boundedRun.mockResolvedValueOnce(result('ShellCheck - shell script analysis'));
  boundedRun.mockResolvedValueOnce(result(JSON.stringify(errors), errors.length ? 1 : 0));
};
const actionlintCall = () => boundedRun.mock.calls.find(([cmd]) => cmd === '/tmp/al/actionlint');

beforeEach(() => {
  boundedRun.mockReset();
  installActionlint.mockReset();
  installActionlint.mockResolvedValue('/tmp/al/actionlint');
  rm.mockReset();
});

describe('selecting workflows', () => {
  it('lints only top-level .github/workflows YAML', () => {
    expect(isWorkflowPath('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowPath('.github/workflows/release.yaml')).toBe(true);
    expect(isWorkflowPath('.github/workflows/sub/x.yml')).toBe(false);
    expect(isWorkflowPath('.github/actions/setup/action.yml')).toBe(false);
    expect(isWorkflowPath('.github/dependabot.yml')).toBe(false);
  });

  it('does nothing — no download — when no workflow is in scope', async () => {
    expect(await actionlintCheck.run(ctx(filesOf('README.md')))).toEqual([]);
    expect(installActionlint).not.toHaveBeenCalled();
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('passes only the in-scope workflow paths, run from the repo root', async () => {
    queueRun([]);
    await actionlintCheck.run(ctx(filesOf('README.md', '.github/workflows/ci.yml')));
    const [, args, opts] = actionlintCall() ?? [];
    expect(args).toEqual(['-format', '{{json .}}', '-no-color', '.github/workflows/ci.yml']);
    expect(opts).toMatchObject({ cwd: CWD });
  });
});

describe('pass and fail', () => {
  it('reports nothing for a clean workflow', async () => {
    queueRun([]);
    expect(await actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')))).toEqual([]);
  });

  it('maps every actionlint error to an error finding with its kind', async () => {
    queueRun([lintError('.github/workflows/ci.yml', 'bad expr'), lintError('x.yml', SC2016)]);
    const findings = await actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')));
    expect(findings).toEqual([
      {
        check: 'actionlint',
        path: '.github/workflows/ci.yml',
        line: 7,
        message: 'bad expr [expression]',
        severity: 'error',
      },
      expect.objectContaining({ path: 'x.yml', message: `${SC2016} [expression]` }),
    ]);
  });

  it('treats exit codes other than 0/1 as a fault', async () => {
    boundedRun.mockResolvedValueOnce(result('ShellCheck'));
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 3, timedOut: false });
    await expect(actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')))).rejects.toThrow(
      /exited 3: boom/,
    );
  });

  it('deletes the downloaded binary even when actionlint fails', async () => {
    boundedRun.mockResolvedValueOnce(result('ShellCheck'));
    boundedRun.mockRejectedValueOnce(new Error('spawn EACCES'));
    await expect(actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')))).rejects.toThrow();
    expect(rm).toHaveBeenCalledWith('/tmp/al', { recursive: true, force: true });
  });

  it('makes a timeout inconclusive', async () => {
    boundedRun.mockResolvedValueOnce(result('ShellCheck'));
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: '', code: null, timedOut: true });
    await expect(
      actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml'))),
    ).rejects.toBeInstanceOf(InconclusiveError);
  });
});

describe('recommended defaults', () => {
  it('runs shellcheck at warning and above', async () => {
    queueRun([]);
    await actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')));
    const [, args, opts] = actionlintCall() ?? [];
    expect(args).not.toContain('-shellcheck=');
    expect(opts.env).toMatchObject({ SHELLCHECK_OPTS: '-S warning', PATH: '/usr/bin' });
  });

  it('drops the job.workflow_* false positive, and nothing else', async () => {
    queueRun([
      ...['workflow_sha', 'workflow_repository', 'workflow_ref', 'workflow_file_path'].map((p) =>
        lintError('.github/workflows/a.yml', jobProperty(p)),
      ),
      lintError('.github/workflows/a.yml', jobProperty('nope')),
      lintError('.github/workflows/a.yml', WORKFLOW_SHA),
    ]);
    const findings = await actionlintCheck.run(ctx(filesOf('.github/workflows/a.yml')));
    expect(findings.map((f) => f.message)).toEqual([
      `${jobProperty('nope')} [expression]`,
      `${WORKFLOW_SHA} [expression]`,
    ]);
  });

  it('fails when shellcheck is missing rather than silently skipping it', async () => {
    boundedRun.mockRejectedValueOnce(
      Object.assign(new Error('spawn shellcheck ENOENT'), { code: 'ENOENT' }),
    );
    queueRun([], { shellcheck: false });
    const findings = await actionlintCheck.run(ctx(filesOf('.github/workflows/ci.yml')));
    expect(findings).toEqual([
      expect.objectContaining({
        check: 'actionlint',
        message: expect.stringMatching(/shellcheck is not on PATH/),
        severity: 'error',
      }),
    ]);
    expect(findings[0]).not.toHaveProperty('path');
    // The rest of actionlint still runs, with shellcheck explicitly off.
    expect(actionlintCall()?.[1]).toContain('-shellcheck=');
  });
});

describe('tightening and exceptions', () => {
  it('shellcheckSeverity: style tightens to every note shellcheck has', async () => {
    queueRun([lintError('.github/workflows/a.yml', SC2016, 'shellcheck')]);
    const findings = await actionlintCheck.run(
      ctx(filesOf('.github/workflows/a.yml'), { shellcheckSeverity: 'style' }),
    );
    expect(findings).toHaveLength(1);
    expect(actionlintCall()?.[2].env.SHELLCHECK_OPTS).toBeUndefined();
  });

  it('shellcheck: false disables shellcheck without probing for it', async () => {
    queueRun([], { shellcheck: false });
    const findings = await actionlintCheck.run(
      ctx(filesOf('.github/workflows/ci.yml'), { shellcheck: false }),
    );
    expect(findings).toEqual([]);
    expect(boundedRun).toHaveBeenCalledTimes(1);
    expect(actionlintCall()?.[1]).toContain('-shellcheck=');
  });

  it('shellcheckSeverity: error raises the floor through SHELLCHECK_OPTS', async () => {
    queueRun([]);
    await actionlintCheck.run(
      ctx(filesOf('.github/workflows/ci.yml'), { shellcheckSeverity: 'error' }),
    );
    expect(actionlintCall()?.[2].env.SHELLCHECK_OPTS).toBe('-S error');
  });

  it('ignore drops matching messages only for the paths its glob covers', async () => {
    queueRun([
      lintError('.github/workflows/release.yml', WORKFLOW_SHA),
      lintError('.github/workflows/ci.yml', WORKFLOW_SHA),
      lintError('.github/workflows/release.yml', 'some real bug'),
    ]);
    const findings = await actionlintCheck.run(
      ctx(filesOf('.github/workflows/release.yml', '.github/workflows/ci.yml'), {
        ignore: { '.github/workflows/release.yml': ['property "workflow_(sha|repository)"'] },
      }),
    );
    expect(findings.map((f) => [f.path, f.message])).toEqual([
      ['.github/workflows/ci.yml', `${WORKFLOW_SHA} [expression]`],
      ['.github/workflows/release.yml', 'some real bug [expression]'],
    ]);
  });

  it('a ** glob applies an ignore repo-wide', async () => {
    queueRun([lintError('.github/workflows/ci.yml', WORKFLOW_SHA)]);
    const findings = await actionlintCheck.run(
      ctx(filesOf('.github/workflows/ci.yml'), { ignore: { '**': ['workflow_sha'] } }),
    );
    expect(findings).toEqual([]);
  });
});

describe('parseActionlintJson', () => {
  it('normalizes relative and absolute filepaths to repo-relative', () => {
    const out = JSON.stringify([
      lintError('.github/workflows/a.yml', 'x'),
      lintError('/repo/.github/workflows/b.yml', 'y'),
    ]);
    expect(parseActionlintJson(out, CWD).map((e) => e.filepath)).toEqual([
      '.github/workflows/a.yml',
      '.github/workflows/b.yml',
    ]);
  });

  it('treats empty output as no errors and rejects non-arrays', () => {
    expect(parseActionlintJson('', CWD)).toEqual([]);
    expect(() => parseActionlintJson('{}', CWD)).toThrow(/JSON array/);
  });
});

describe('registration', () => {
  it('is registered and default-on', () => {
    const registry = createRegistry(builtinChecks());
    expect(registry.get('actionlint')).toBe(actionlintCheck);
    expect(registry.defaultNames()).toContain('actionlint');
  });
});
