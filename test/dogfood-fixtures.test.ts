import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../src/registry.js';
import { runHygiene } from '../src/runner.js';

// The Repo Hygiene dogfood workflow runs the *published* Action against these two
// fixtures (#73): it must pass on known-good and fail on known-bad. A CLI that
// silently no-ops passes both and one that crashes fails both, so only a run
// that really checked produces that contrast. These tests pin the fixtures'
// half of the contract against the local engine, the same way the Action's
// runner calls it: `--check` from the fixture directory as the working directory,
// so `git ls-files` yields `.github/…`-relative paths.
const fixtures = fileURLToPath(new URL('fixtures/dogfood', import.meta.url));
const WORKFLOW = '.github/workflows/ci.yml';

const runFixture = (name: string) =>
  runHygiene(createRegistry(), {
    mode: '--check',
    only: ['action-pins'],
    config: { checks: {} },
    cwd: join(fixtures, name),
    env: {},
  });

const workflowLines = (name: string): string[] =>
  readFileSync(join(fixtures, name, WORKFLOW), 'utf8').split('\n');

describe('known-good dogfood fixture', () => {
  it('passes action-pins with no findings', async () => {
    expect(await runFixture('known-good')).toEqual({ findings: [], exitCode: 0 });
  });
});

describe('known-bad dogfood fixture', () => {
  it('fails action-pins with exactly the deliberate unpinned-tag finding', async () => {
    expect(await runFixture('known-bad')).toEqual({
      findings: [
        {
          check: 'action-pins',
          path: WORKFLOW,
          line: 10,
          message: expect.stringMatching(/^actions\/checkout@v7\.0\.1 — not SHA-pinned/),
          severity: 'error',
        },
      ],
      exitCode: 1,
    });
  });
});

describe('dogfood fixture pair', () => {
  it('differs only on the deliberate violation line', () => {
    const good = workflowLines('known-good');
    const bad = workflowLines('known-bad');
    const differing = good.flatMap((line, i) => (line === bad[i] ? [] : [i + 1]));

    expect(bad).toHaveLength(good.length);
    expect(differing).toEqual([10]);
  });
});
