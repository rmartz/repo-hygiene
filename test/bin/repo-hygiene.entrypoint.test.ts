import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The entrypoint bug (#67) only manifests in a real process launched through a
// symlink, so these tests exercise the *built* artifact — the same file a
// consumer's `node_modules/.bin/ai-repo-hygiene` shim points at. The Test CI job
// does not build, and a stale dist/ could mask a reintroduced guard, so the
// build is provisioned here rather than assumed.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const built = join(repoRoot, 'dist', 'bin', 'repo-hygiene.js');

const temps: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/**
 * Invoke the built CLI the way npm/pnpm do: through a symlink whose path is not
 * the module's realpath. `process.argv[1]` is then the link, not the target.
 */
const runViaSymlink = (args: string[], cwd: string) => {
  const link = join(temp('hygiene-bin-'), 'ai-repo-hygiene');
  symlinkSync(built, link);
  return spawnSync(process.execPath, [link, ...args], { cwd, encoding: 'utf8' });
};

beforeAll(() => {
  execFileSync('pnpm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe('CLI entrypoint', () => {
  it('runs when launched through a node_modules/.bin-style symlink', () => {
    const result = runViaSymlink(['--nope'], repoRoot);

    // Before the fix this silently exited 0 with no output.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown option: --nope');
  });

  it('reports a real violation and exits non-zero through the symlink', () => {
    const repo = temp('hygiene-repo-');
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(
      join(repo, 'conflicted.txt'),
      ['<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> other', ''].join('\n'),
    );
    execFileSync('git', ['add', '.'], { cwd: repo });

    const result = runViaSymlink(['conflict-markers', '--format', 'text', '--check'], repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('conflicted.txt');
  });

  it('matches a direct invocation of the same artifact', () => {
    const viaLink = runViaSymlink(['--nope'], repoRoot);
    const direct = spawnSync(process.execPath, [built, '--nope'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(viaLink.status).toBe(direct.status);
    expect(viaLink.stderr).toBe(direct.stderr);
  });
});
