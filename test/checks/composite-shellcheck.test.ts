import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import type { CheckConfig } from '../../src/types.js';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));
const mkdtemp = vi.fn();
const writeFile = vi.fn();
const rm = vi.fn();
vi.mock('node:fs/promises', () => ({ mkdtemp, writeFile, rm }));

const result = (stdout: string, code = 0) => ({ stdout, stderr: '', code, timedOut: false });

const { compositeShellcheckCheck, parseCompositeShellcheckSettings } =
  await import('../../src/checks/composite-shellcheck.js');
const { InconclusiveError } = await import('../../src/outcome.js');
const { builtinChecks, createRegistry } = await import('../../src/registry.js');

const TMP = '/tmp/rh-composite';
const ACTION = [
  'name: Setup',
  'runs:',
  '  using: composite',
  '  steps:',
  '    - name: Install',
  '      run: |',
  '        echo start',
  '        cd $DIR',
  '      shell: bash',
  '    - name: Probe',
  '      run: echo ${{ inputs.x }}',
  '      shell: sh',
  '    - name: Script',
  '      run: print("hi")',
  '      shell: python',
  '',
].join('\n');

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (files: FileSet, settings: CheckConfig = {}) => ({
  mode: '--check' as const,
  files,
  settings,
  env: { PATH: '/usr/bin' },
});
const comment = (file: string, line: number, code: number, message: string) => ({
  file,
  line,
  endLine: line,
  column: 1,
  endColumn: 2,
  level: 'warning',
  code,
  message,
  fix: null,
});
const CD = "Use 'cd ... || exit' in case cd fails.";

/** Queue a present shellcheck, then one json1 output per dialect run. */
const queueRun = (...outputs: object[][]) => {
  boundedRun.mockResolvedValueOnce(result('ShellCheck - shell script analysis tool'));
  for (const comments of outputs) {
    boundedRun.mockResolvedValueOnce(result(JSON.stringify({ comments }), comments.length ? 1 : 0));
  }
};
const shellcheckRuns = () => boundedRun.mock.calls.filter(([, args]) => args[0] === '-f');

beforeEach(() => {
  boundedRun.mockReset();
  mkdtemp.mockReset();
  mkdtemp.mockResolvedValue(TMP);
  writeFile.mockReset();
  rm.mockReset();
});

describe('selecting steps and dialects', () => {
  it('does nothing — no shellcheck — when no composite action is in scope', async () => {
    const files = filesOf({
      'README.md': '# x\n',
      'action.yml': 'runs:\n  using: node20\n  main: index.js\n',
    });
    expect(await compositeShellcheckCheck.run(ctx(files))).toEqual([]);
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('shellchecks bash and sh steps with their dialect, skipping non-shell steps', async () => {
    queueRun([], []);
    await compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION })));
    expect(shellcheckRuns().map(([cmd, args, opts]) => [cmd, args, opts.cwd])).toEqual([
      ['shellcheck', ['-f', 'json1', '-s', 'bash', '-S', 'warning', '0.sh'], TMP],
      ['shellcheck', ['-f', 'json1', '-s', 'sh', '-S', 'warning', '1.sh'], TMP],
    ]);
  });

  it('writes each script with its ${{ }} expressions masked', async () => {
    queueRun([], []);
    await compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION })));
    expect(writeFile.mock.calls).toEqual([
      [`${TMP}/0.sh`, 'echo start\ncd $DIR\n'],
      [`${TMP}/1.sh`, `echo ${'_'.repeat(15)}`],
    ]);
    expect(rm).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });
});

describe('pass and fail', () => {
  it('reports nothing for clean scripts', async () => {
    queueRun([], []);
    expect(await compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION })))).toEqual([]);
  });

  it('reports a finding at its action.yml line', async () => {
    queueRun([comment('0.sh', 2, 2164, CD)], [comment('1.sh', 1, 2034, 'unused')]);
    const findings = await compositeShellcheckCheck.run(
      ctx(filesOf({ '.github/actions/setup/action.yml': ACTION })),
    );
    expect(findings).toEqual([
      {
        check: 'composite-shellcheck',
        path: '.github/actions/setup/action.yml',
        line: 8,
        message: `Install: ${CD} [SC2164]`,
        severity: 'error',
      },
      expect.objectContaining({ line: 11, message: 'Probe: unused [SC2034]' }),
    ]);
  });

  it('flags a run: step with no shell', async () => {
    const action = 'runs:\n  using: composite\n  steps:\n    - run: echo hi\n';
    const findings = await compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': action })));
    expect(findings).toEqual([
      expect.objectContaining({
        path: 'action.yml',
        line: 4,
        message: expect.stringMatching(/must set `shell:`/),
      }),
    ]);
  });

  it('flags an action.yml that is not valid YAML', async () => {
    const findings = await compositeShellcheckCheck.run(
      ctx(filesOf({ 'action.yml': 'runs:\n  steps: [\n' })),
    );
    expect(findings).toEqual([
      expect.objectContaining({
        path: 'action.yml',
        message: expect.stringMatching(/could not parse YAML/),
      }),
    ]);
  });

  it('fails loudly when shellcheck is missing', async () => {
    boundedRun.mockRejectedValueOnce(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    const findings = await compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION })));
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/shellcheck is not on PATH/),
        severity: 'error',
      }),
    ]);
    expect(findings[0]).not.toHaveProperty('path');
  });

  it('treats exit codes other than 0/1 as a fault, still cleaning up', async () => {
    boundedRun.mockResolvedValueOnce(result('ShellCheck'));
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 3, timedOut: false });
    await expect(
      compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION }))),
    ).rejects.toThrow(/exited 3: boom/);
    expect(rm).toHaveBeenCalledWith(TMP, { recursive: true, force: true });
  });

  it('makes a timeout inconclusive', async () => {
    boundedRun.mockResolvedValueOnce(result('ShellCheck'));
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: '', code: null, timedOut: true });
    await expect(
      compositeShellcheckCheck.run(ctx(filesOf({ 'action.yml': ACTION }))),
    ).rejects.toBeInstanceOf(InconclusiveError);
  });
});

describe('tightening and exceptions', () => {
  it('shellcheckSeverity sets the floor', async () => {
    queueRun([], []);
    await compositeShellcheckCheck.run(
      ctx(filesOf({ 'action.yml': ACTION }), { shellcheckSeverity: 'style' }),
    );
    expect(shellcheckRuns()[0]?.[1]).toEqual(['-f', 'json1', '-s', 'bash', '-S', 'style', '0.sh']);
  });

  it('ignore drops matching messages only for the paths its glob covers', async () => {
    queueRun([comment('0.sh', 2, 2164, CD), comment('1.sh', 2, 2164, CD)]);
    const action = ACTION.replace('shell: sh', 'shell: bash');
    const findings = await compositeShellcheckCheck.run(
      ctx(
        filesOf({
          'a/action.yml': ACTION.replace(/- name: Probe[\s\S]*/, ''),
          'b/action.yml': action,
        }),
        {
          ignore: { 'a/**': ['SC2164'] },
        },
      ),
    );
    expect(findings.map((f) => [f.path, f.line])).toEqual([['b/action.yml', 8]]);
  });

  it.each([
    [{ shellcheckSeverity: 'loud' }, /composite-shellcheck: "shellcheckSeverity" must be one of/],
    [{ ignore: ['SC2164'] }, /composite-shellcheck: "ignore" must be a mapping/],
  ])('rejects a malformed config %j', (settings, error) => {
    expect(() => parseCompositeShellcheckSettings(settings)).toThrow(error);
  });
});

describe('registration', () => {
  it('is registered and default-on', () => {
    const registry = createRegistry(builtinChecks());
    expect(registry.get('composite-shellcheck')).toBe(compositeShellcheckCheck);
    expect(registry.defaultNames()).toContain('composite-shellcheck');
  });
});
