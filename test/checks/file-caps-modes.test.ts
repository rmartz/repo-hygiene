import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileCapsCheck, updateFileCapsBaseline } from '../../src/checks/file-caps.js';
import { BASELINE_FILENAME } from '../../src/checks/file-caps-baseline.js';
import type { CheckConfig } from '../../src/types.js';

// Integration tests for `mode`, run against a real temporary git repo so the
// grandfather mode's base-ref reads go through git.

const lines = (n: number): string => 'x\n'.repeat(n);
const caps = { overrides: [{ glob: '**/*.ts', lines: { error: 10 } }] };

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
const write = (path: string, text: string) => writeFileSync(join(dir, path), text);

async function run(settings: CheckConfig) {
  const paths = ['big.ts', 'shrunk.ts', 'new.ts'];
  const files = { paths, read: async (p: string) => readFileSync(join(dir, p), 'utf8') };
  const findings = await fileCapsCheck.run({ mode: '--check', files, cwd: dir, settings, env: {} });
  return Object.fromEntries(findings.map((f) => [f.path, f.severity]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rh-caps-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  // On the base: big.ts and shrunk.ts are over the 10-line cap.
  write('big.ts', lines(20));
  write('shrunk.ts', lines(20));
  git('add', '.');
  git('commit', '-qm', 'base');
  git('branch', 'base');
  // On HEAD: big.ts grows, shrunk.ts dropped under then back over, new.ts is new.
  write('big.ts', lines(40));
  write('shrunk.ts', lines(15));
  write('new.ts', lines(15));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('file-caps mode: grandfather', () => {
  it('exempts files over cap on the base ref and enforces new ones', async () => {
    expect(await run({ ...caps, mode: 'grandfather', base: 'base' })).toEqual({
      'big.ts': 'warn',
      'shrunk.ts': 'warn',
      'new.ts': 'error',
    });
  });

  it('enforces a file once it is under cap on the base ref', async () => {
    write('shrunk.ts', lines(5));
    git('add', 'shrunk.ts');
    git('commit', '-qm', 'shrink');
    git('branch', '-f', 'base');
    write('shrunk.ts', lines(15));
    expect((await run({ ...caps, mode: 'grandfather', base: 'base' }))['shrunk.ts']).toBe('error');
  });

  it('errors when the base ref cannot be resolved', async () => {
    await expect(run({ ...caps, mode: 'grandfather', base: 'origin/nope' })).rejects.toThrow(
      /cannot resolve base ref "origin\/nope"/,
    );
  });

  it('errors when a baseline file is also present', async () => {
    write(BASELINE_FILENAME, '{"file-caps":{}}\n');
    await expect(run({ ...caps, mode: 'grandfather', base: 'base' })).rejects.toThrow(
      /does not use \.repo-hygiene-baseline\.json/,
    );
  });
});

describe('file-caps mode: strict / ratchet', () => {
  beforeEach(() => write(BASELINE_FILENAME, '{"file-caps":{"big.ts":{"lines":40}}}\n'));

  it('strict ignores the baseline file', async () => {
    expect((await run({ ...caps, mode: 'strict' }))['big.ts']).toBe('error');
  });

  it('ratchet (and unset mode) honor the baseline file', async () => {
    expect((await run({ ...caps, mode: 'ratchet' }))['big.ts']).toBe('warn');
    expect((await run(caps))['big.ts']).toBe('warn');
  });

  it('--update-baseline refuses the modes that do not use a baseline', async () => {
    for (const mode of ['strict', 'grandfather']) {
      await expect(
        updateFileCapsBaseline({ cwd: dir, mode: '--check', settings: { ...caps, mode } }),
      ).rejects.toThrow(/does not apply to mode/);
    }
  });
});
