import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const boundedRun = vi.fn();
vi.mock('../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const fail = (stderr = '') => ({ stdout: '', stderr, code: 1, timedOut: false });

const { findConflictMarkers, scan, checkConflictMarkers, formatReport } =
  await import('../src/check-conflict-markers.js');
const { worktreeContent, stagedFiles, trackedFiles, changedVsMain, stagedContent } =
  await import('../src/discovery.js');

const FULL_CONFLICT = [
  'line',
  '<<<<<<< HEAD',
  'mine',
  '=======',
  'theirs',
  '>>>>>>> branch',
  'end',
];

beforeEach(() => boundedRun.mockReset());

describe('findConflictMarkers', () => {
  it('flags a full conflict triple with 1-based, sorted line numbers', () => {
    const markers = findConflictMarkers(FULL_CONFLICT.join('\n'));
    expect(markers).toEqual([
      { lineno: 2, line: '<<<<<<< HEAD' },
      { lineno: 4, line: '=======' },
      { lineno: 6, line: '>>>>>>> branch' },
    ]);
  });

  it('returns nothing for clean code', () => {
    expect(findConflictMarkers('const x = 1;\nconst y = 2;\n')).toEqual([]);
  });

  it('does not flag a lone separator / Markdown setext underline (no angle marker)', () => {
    expect(findConflictMarkers('Heading\n=======\n\nbody')).toEqual([]);
  });

  it('flags angle markers even without a separator', () => {
    const markers = findConflictMarkers('<<<<<<< HEAD\nmine\n>>>>>>> other');
    expect(markers.map((m) => m.lineno)).toEqual([1, 3]);
  });

  it('reports the diff3 base line only alongside an angle marker', () => {
    const text = '<<<<<<< HEAD\nmine\n|||||||  base\norig\n=======\ntheirs\n>>>>>>> b';
    expect(findConflictMarkers(text).map((m) => m.lineno)).toEqual([1, 3, 5, 7]);
  });

  it('requires exactly seven chars at line start', () => {
    expect(findConflictMarkers('<<<<<< short\n>>>>>>>> eight')).toEqual([]);
  });
});

describe('scan', () => {
  it('attributes violations to paths and aggregates across files', async () => {
    const reader = (p: string) => (p === 'bad.ts' ? FULL_CONFLICT.join('\n') : 'clean');
    const violations = await scan(['clean.ts', 'bad.ts'], reader);
    expect(violations).toEqual([
      { path: 'bad.ts', lineno: 2, line: '<<<<<<< HEAD' },
      { path: 'bad.ts', lineno: 4, line: '=======' },
      { path: 'bad.ts', lineno: 6, line: '>>>>>>> branch' },
    ]);
  });

  it('awaits async readers', async () => {
    const reader = async () => '<<<<<<< HEAD\n>>>>>>> x';
    const violations = await scan(['f'], reader);
    expect(violations).toHaveLength(2);
  });
});

describe('worktreeContent', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'rh-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads file contents', () => {
    const p = join(dir, 'a.txt');
    writeFileSync(p, 'hello');
    expect(worktreeContent(p)).toBe('hello');
  });

  it('returns empty string for a missing file', () => {
    expect(worktreeContent(join(dir, 'nope.txt'))).toBe('');
  });

  it('resolves a relative path against opts.cwd', () => {
    writeFileSync(join(dir, 'rel.txt'), 'relative');
    expect(worktreeContent('rel.txt', { cwd: dir })).toBe('relative');
  });
});

describe('file-list helpers', () => {
  it('stagedFiles splits NUL-delimited git output and drops empties', async () => {
    boundedRun.mockResolvedValueOnce(ok('a.ts\0b.ts\0'));
    expect(await stagedFiles()).toEqual(['a.ts', 'b.ts']);
    const [cmd, args] = boundedRun.mock.calls[0] ?? [];
    expect(cmd).toBe('git');
    expect(args).toEqual(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  });

  it('trackedFiles uses `git ls-files -z`', async () => {
    boundedRun.mockResolvedValueOnce(ok('x\0y\0'));
    expect(await trackedFiles()).toEqual(['x', 'y']);
    expect(boundedRun.mock.calls[0]?.[1]).toEqual(['ls-files', '-z']);
  });

  it('changedVsMain returns [] when the ref is absent (non-zero exit)', async () => {
    boundedRun.mockResolvedValueOnce(fail('fatal: bad revision'));
    expect(await changedVsMain()).toEqual([]);
  });

  it('stagedContent returns empty string when the blob is unreadable', async () => {
    boundedRun.mockResolvedValueOnce(fail());
    expect(await stagedContent('missing')).toBe('');
  });

  it('passes through cwd to git', async () => {
    boundedRun.mockResolvedValueOnce(ok(''));
    await trackedFiles({ cwd: '/repo' });
    expect(boundedRun.mock.calls[0]?.[2]).toMatchObject({ cwd: '/repo' });
  });

  it('trackedFiles throws when git ls-files fails', async () => {
    boundedRun.mockResolvedValueOnce(fail('fatal: not a git repository'));
    await expect(trackedFiles()).rejects.toThrow(/git ls-files failed/);
  });

  it('stagedFiles throws when git diff --cached fails', async () => {
    boundedRun.mockResolvedValueOnce(fail('fatal: not a git repository'));
    await expect(stagedFiles()).rejects.toThrow(/git diff --cached failed/);
  });
});

describe('checkConflictMarkers', () => {
  it('--staged scans staged blobs and finds violations', async () => {
    boundedRun
      .mockResolvedValueOnce(ok('bad.ts\0')) // staged file list
      .mockResolvedValueOnce(ok(FULL_CONFLICT.join('\n'))); // staged blob
    const violations = await checkConflictMarkers('--staged', { env: {} });
    expect(violations.map((v) => v.lineno)).toEqual([2, 4, 6]);
  });

  it('--staged is bypassed by ALLOW_CONFLICT_MARKERS without shelling out', async () => {
    const violations = await checkConflictMarkers('--staged', {
      env: { ALLOW_CONFLICT_MARKERS: '1' },
    });
    expect(violations).toEqual([]);
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('--check scans all tracked files from the worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-chk-'));
    try {
      const bad = join(dir, 'bad.ts');
      const good = join(dir, 'good.ts');
      writeFileSync(bad, FULL_CONFLICT.join('\n'));
      writeFileSync(good, 'clean');
      // ls-files yields absolute paths here so worktreeContent resolves them.
      boundedRun.mockResolvedValueOnce(ok(`${bad}\0${good}\0`));
      const violations = await checkConflictMarkers('--check', { cwd: dir, env: {} });
      expect(violations.map((v) => v.path)).toEqual([bad, bad, bad]);
      expect(violations.map((v) => v.lineno)).toEqual([2, 4, 6]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check resolves relative paths from git against cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-chk-rel-'));
    try {
      writeFileSync(join(dir, 'rel.ts'), FULL_CONFLICT.join('\n'));
      // ls-files returns repo-root-relative paths; cwd resolves them.
      boundedRun.mockResolvedValueOnce(ok('rel.ts\0'));
      const violations = await checkConflictMarkers('--check', { cwd: dir, env: {} });
      expect(violations.map((v) => v.path)).toEqual(['rel.ts', 'rel.ts', 'rel.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check-diff returns clean when no files changed', async () => {
    boundedRun.mockResolvedValueOnce(ok(''));
    expect(await checkConflictMarkers('--check-diff', { env: {} })).toEqual([]);
  });
});

describe('formatReport', () => {
  it('renders path:line: line entries with the bypass hint', () => {
    const report = formatReport([{ path: 'a.ts', lineno: 3, line: '<<<<<<< HEAD' }]);
    expect(report).toContain('error: merge-conflict markers found');
    expect(report).toContain('  a.ts:3: <<<<<<< HEAD');
    expect(report).toContain('ALLOW_CONFLICT_MARKERS=1');
  });
});
