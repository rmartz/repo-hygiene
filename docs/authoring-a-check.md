---
type: Reference
title: Authoring a check
description: How to write, register, configure, and test a new @rmartz/repo-hygiene check against the Check contract, with a worked example.
tags: [hygiene, ci, authoring]
---

# Authoring a check

A check is a plain object implementing the `Check` interface. The framework
resolves the file set once, hands every check the same inputs, and applies the
per-check `severity` override — so a check only has to turn inputs into findings.
Adding one is four edits: write the check, register it, test it, and (if it takes
config) document its keys. Whether a new check runs by default for consumers is the
separate default-safety decision covered in
[the distribution contract](distribution-contract.md).

## 1. The `Check` contract (`src/types.ts`)

```ts
export interface Check {
  name: string; // CLI id AND `.repo-hygiene.yml` key — keep them identical
  description: string;
  run(ctx: CheckContext): Promise<Finding[]>;
}
```

`run` receives a `CheckContext` and returns `Finding[]` — never throws for a
"violation", and never sets an exit code itself (the runner derives that):

```ts
export interface CheckContext {
  mode: Mode; // '--staged' | '--check' | '--check-diff'
  files: FileSet; // the resolved in-scope paths + a reader
  cwd?: string;
  settings: CheckConfig; // this check's `.repo-hygiene.yml` section
  env: Record<string, string | undefined>; // for an env-var bypass
}

export interface Finding {
  check: string; // your check's name
  path?: string; // omit for a repo-level finding (about the tree as a whole)
  line?: number; // 1-based; omit when not line-anchored
  message: string;
  severity: Severity; // 'warn' | 'error'
}
```

`error` findings drive `exit 1` (the enforced floor); a `warn`-only run exits `0`
(the migration-ramp signal). Emit the severity that is _intrinsically_ right for
the finding; the repo tunes it via config (see step 4). `types.ts` depends only on
discovery's file-set types and is kept type-only, so it sits at the bottom of the
import graph — put shared types there, not runtime code.

## 2. Read files through the resolved `FileSet` (`src/discovery.ts`)

Do **not** call `git` or `readFileSync` yourself. The runner has already resolved
the correct file set for the mode and handed it to you as `ctx.files`; using it is
what lets a consumer run one job per check or a single aggregate job over identical
inputs, and it gives you ignore-handling for free (an untracked or `.gitignore`d
file is never in scope):

```ts
export interface FileSet {
  paths: string[]; // in-scope repo-relative paths
  read: ContentReader; // path → content (staged blob in --staged, worktree otherwise)
}
```

A typical check filters `ctx.files.paths` to the files it cares about, reads each
with `ctx.files.read(path)`, and pushes findings. Keep the pure detection logic in
an exported free function (like `action-pins`'s `scanYaml`) and let the `Check.run`
adapter map its output onto `Finding[]` — the pure function is what you unit-test,
and other callers can reuse it.

The three modes and their readers are fixed by `resolveFileSet`; you receive the
result, so a check never branches on which git command to run. Two shared helpers
exist for checks that need to resolve a path _reference_ against the tree rather
than scan file contents — `repoPathExists(mode)` (a mode-aware "does this path
exist in scope?" predicate) and `trackedFileModes()` (each tracked path → its git
index mode, so `md-pairing` can see a symlink _as_ a symlink instead of following
it). Reach for those instead of a fresh `git` call.

If a check must shell out for something discovery does not cover, use `boundedRun`
from `src/lib/bounded-subprocess.js` (a hard-timeout wrapper that kills the whole
process group) — never `child_process` directly. Routing every subprocess through
`boundedRun` is also what makes checks testable (step 5).

## 3. Register it (`src/registry.ts`)

Import the check and add it to the `builtinChecks()` list, in a stable position:

```ts
import { myNewCheck } from './checks/my-new-check.js';

export function builtinChecks(): Check[] {
  return [
    conflictMarkersCheck,
    // …existing checks…
    myNewCheck,
  ];
}
```

The registry is built from this explicit list (not a mutable global), so tests can
construct a registry from fakes with no import-order side effects. Being in
`builtinChecks()` makes the check _runnable_ by name; whether it runs by _default_
for consumers is the separate `defaultOn` flag on the check (step 4) —
`registry.defaultNames()` collects the default-on set, and that is what a bare run
and the workflow's empty `checks` input resolve to.

## 4. Config and default-safety (`.repo-hygiene.yml`)

The framework only understands one key in a check's config section: `severity`,
which the runner applies uniformly to override every finding the check emits (the
migration ramp — downgrade a whole check to `warn` while a backlog is worked off,
then flip it back). **Every other key is yours**, read off `ctx.settings` and
validated by the check itself:

```yaml
checks:
  my-new-check:
    severity: warn # framework-applied override (optional)
    overrides: # check-defined vocabulary, parsed by your check
      - glob: 'docs/**/*.md'
        max: 400
```

Parse and validate that vocabulary in a dedicated `*-config.ts` module (see
`file-caps-config.ts`), throwing a filename-prefixed error on a malformed shape so
a bad config fails loudly rather than silently mis-behaving.

**Default-safety is the gate for shipping.** Because a new check reaches every
consumer on the next Dependabot bump with no chance for them to edit YAML first, a
check must be safe to run with _no_ configuration. Two legal shapes:

- **Universally correct** — it does the right thing everywhere with sane built-in
  defaults (e.g. `conflict-markers`, `action-pins`). Mark it `defaultOn: true` on
  the check so it joins the default-on set.
- **No-op until opted in** — with no config section it returns `[]` and never
  fails. `file-caps` is the model: `fileCapsCheck.run` calls
  `parseFileCapsConfig(ctx.settings)` and, when there are no `overrides`, returns
  `[]` immediately. Leave `defaultOn` unset; a repo opts in by naming the check in
  its caller and adding a config section.

A check that _requires_ new config to avoid failing is disallowed — it would break
every consumer's CI the moment it shipped. "Universally correct" is a high bar: it
must not fail an arbitrary consumer on arrival. `package-pins` clears the
config-free bar but not this one (a repo with `^3` ranges would break), so it stays
opt-in — being config-free is necessary but not sufficient for `defaultOn`. See
[the distribution contract](distribution-contract.md) for the full rationale.

Two levers soften "default-on" for an opinionated check: set `defaultSeverity:
'warn'` on the check so it surfaces findings everywhere but does not fail CI until
a repo sets `severity: error`; and every default-on check is opt-out per repo via
`enabled: false`. A check that is only _sometimes_ correct is a better fit for
`defaultOn: true` + `defaultSeverity: 'warn'` than for staying opt-in.

## 5. Test it (`test/checks/*.test.ts`)

Vitest, one file per check. There are two complementary layers:

**Pure logic + in-memory `FileSet`** — the common case. Test the exported
detection function directly, then exercise `check.run` with a hand-built `FileSet`
(no git, no disk):

```ts
import { describe, it, expect } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import { myNewCheck } from '../../src/checks/my-new-check.js';

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (files: FileSet) => ({ mode: '--check' as const, files, settings: {}, env: {} });

it('flags the offending file', async () => {
  const findings = await myNewCheck.run(ctx(filesOf({ 'a.ts': 'bad\n' })));
  expect(findings).toEqual([
    {
      check: 'my-new-check',
      path: 'a.ts',
      line: 1,
      message: expect.any(String),
      severity: 'error',
    },
  ]);
});
```

**Mocking `boundedRun`** — when the check (or the discovery path it drives) shells
out to git and you want to assert the exact argv or drive git's output. Mock the
subprocess boundary, then dynamically `import()` the modules under test _after_ the
mock is registered so they pick up the mock:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const fail = (stderr = '') => ({ stdout: '', stderr, code: 1, timedOut: false });

const { trackedFiles } = await import('../../src/discovery.js');

beforeEach(() => boundedRun.mockReset());

it('passes the expected git argv', async () => {
  boundedRun.mockResolvedValueOnce(ok('a.ts\0b.ts\0'));
  await trackedFiles({ cwd: '/repo' });
  const [cmd, args, opts] = boundedRun.mock.calls[0] ?? [];
  expect(cmd).toBe('git');
  expect(args).toEqual(['ls-files', '-z']);
  expect(opts).toMatchObject({ cwd: '/repo' });
});
```

`ok`/`fail` are the shared shape of a `BoundedResult`; `mockResolvedValueOnce`
queues one git invocation's output, so multi-git checks chain several. See
`test/check-conflict-markers.test.ts` and `test/framework.test.ts` for the full
pattern. Run the suite with `pnpm test` (and `pnpm typecheck` / `pnpm lint`) before
pushing; the pre-push gate runs the same commands CI does.

## A worked example: `banned-phrases`

The five steps above, assembled into one small check that flags configured
forbidden substrings (say `@ts-ignore` or a `DO NOT MERGE` marker) in tracked
files. It is **illustrative** — this check is _not_ shipped in the package — but the
snippets are a complete, adaptable template. Note the shape it models: it reads a
config section and **no-ops when unconfigured**, so it is strictly opt-in (the
safe-default shape from step 4).

**The check module** (`src/checks/banned-phrases.ts`) — a pure scanner plus the
thin adapter (steps 1–2 and 4):

```ts
import type { Check, CheckConfig, Finding } from '../types.js';

const NAME = 'banned-phrases';

/** The `phrases` config: a list of forbidden substrings (empty when unset). */
function bannedPhrases(settings: CheckConfig): string[] {
  const raw = settings.phrases;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((p) => typeof p === 'string')) {
    throw new Error(`${NAME}: "phrases" must be a list of strings`);
  }
  return raw;
}

/** Every (phrase, line) hit in one file's text — the pure, unit-tested core. */
export function scanPhrases(text: string, phrases: string[]): { phrase: string; line: number }[] {
  const hits: { phrase: string; line: number }[] = [];
  text.split('\n').forEach((lineText, i) => {
    for (const phrase of phrases) {
      if (lineText.includes(phrase)) hits.push({ phrase, line: i + 1 });
    }
  });
  return hits;
}

export const bannedPhrasesCheck: Check = {
  name: NAME,
  description: 'Flags configured forbidden substrings in tracked files.',
  // No `defaultOn`: it no-ops with no config, so it ships opt-in.
  async run(ctx) {
    const phrases = bannedPhrases(ctx.settings);
    if (phrases.length === 0) return []; // dormant until a repo configures phrases
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      const text = await ctx.files.read(path);
      for (const { phrase, line } of scanPhrases(text, phrases)) {
        findings.push({
          check: NAME,
          path,
          line,
          message: `banned phrase "${phrase}"`,
          severity: 'error',
        });
      }
    }
    return findings;
  },
};
```

**Register it** (`src/registry.ts`, step 3) — add the import and one line to
`builtinChecks()`:

```ts
import { bannedPhrasesCheck } from './checks/banned-phrases.js';
// …then inside builtinChecks(): return [ …existing checks…, bannedPhrasesCheck ];
```

**Opt in** (a consumer's `.repo-hygiene.yml`, step 4) — with no section the check
stays silent; a repo turns it on by listing phrases and naming `banned-phrases` in
its caller's `checks` input:

```yaml
checks:
  banned-phrases:
    phrases: ['@ts-ignore', 'DO NOT MERGE']
```

**Test it** (`test/checks/banned-phrases.test.ts`, step 5) — the pure scanner
directly, then `run` with an in-memory `FileSet` (no git, no `boundedRun`),
including the no-op-when-unconfigured case:

```ts
import { describe, it, expect } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import { scanPhrases, bannedPhrasesCheck } from '../../src/checks/banned-phrases.js';

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (files: FileSet, settings = {}) => ({
  mode: '--check' as const,
  files,
  settings,
  env: {},
});

describe('banned-phrases', () => {
  it('reports each hit with its 1-based line', () => {
    expect(scanPhrases('ok\nx @ts-ignore\n', ['@ts-ignore'])).toEqual([
      { phrase: '@ts-ignore', line: 2 },
    ]);
  });

  it('no-ops when unconfigured', async () => {
    expect(await bannedPhrasesCheck.run(ctx(filesOf({ 'a.ts': 'DO NOT MERGE\n' })))).toEqual([]);
  });

  it('flags a configured phrase', async () => {
    const findings = await bannedPhrasesCheck.run(
      ctx(filesOf({ 'a.ts': 'DO NOT MERGE\n' }), { phrases: ['DO NOT MERGE'] }),
    );
    expect(findings).toEqual([
      {
        check: 'banned-phrases',
        path: 'a.ts',
        line: 1,
        message: 'banned phrase "DO NOT MERGE"',
        severity: 'error',
      },
    ]);
  });
});
```

That is the whole arc: a pure function you unit-test, a thin adapter, one registry
line, an opt-in config section, and a test — no framework plumbing to touch.
Whether it should be **default-on** is the separate `defaultOn` decision from step
4; a substring blocklist is inherently repo-specific, so it stays opt-in.
