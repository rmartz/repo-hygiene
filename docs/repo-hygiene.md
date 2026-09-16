# repo-hygiene checks

`@rmartz/repo-hygiene` runs a registry of independent checks over one of three
git-derived file sets, selected by mode:

- `--staged` — staged blobs (the `pre-commit` hook).
- `--check` — all tracked files (the CI backstop).
- `--check-diff` — files changed vs `origin/main`.

Pass check names to restrict a run (`ai-repo-hygiene okf docs-links --check`);
with none, the **default-on** checks run (`--all` runs every registered check).
Per-repo settings live in `.repo-hygiene.yml` under `checks.<name>`, where
`severity` (when set) overrides a check's findings.

## The distribution contract

Consumers run these checks through the reusable workflow
(`.github/workflows/hygiene.yml`), pinned by version and bumped by Dependabot.
For a **new check to reach consumers with no per-repo work**, it must be safe to
run with no configuration — either it does something universally correct with
sane defaults, or it no-ops until opted into via `.repo-hygiene.yml`. A check
that _requires_ new config to avoid failing would break every consumer's CI the
moment it ships, so that is disallowed.

Each check declares whether it is **default-on** through the `defaultOn` flag on
its registry entry (`src/types.ts`). The reusable workflow's `checks` input
defaults to **empty**, and an empty input runs the registry-derived default-on
set — so the default is _computed_ from the flags, never hardcoded in the YAML,
and a newly-added default-on check auto-joins every consumer on the next
Dependabot bump with no edit there. Opinionated checks leave `defaultOn` unset
and are opt-in per repo (named explicitly in the caller's `checks` input).

`package-pins` is the notable call: it is config-free like `action-pins` (its npm
analog) but is **not** default-on, because promoting it would break consumers
whose `package.json` uses abbreviated ranges — exactly the on-arrival breakage the
contract forbids. Making it a fleet default is a separate, deliberate decision.

## Checks

| Check              | Default | What it flags                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------ |
| `conflict-markers` | on      | Leftover Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).         |
| `action-pins`      | on      | GitHub Actions `uses:` refs not pinned to a full commit SHA.             |
| `package-pins`     | opt-in  | Dependency specifiers that violate the repo's pinning policy.            |
| `docs-links`       | opt-in  | Broken intra-repo Markdown links among docs pages (`roots`).             |
| `md-pairing`       | opt-in  | Directive/doc `.md` pairing rules (symlinked directives are violations). |
| `okf`              | opt-in  | OKF docs-frontmatter vocabulary + exemptions (`types`, `roots`).         |
| `okf-index`        | opt-in  | The reserved OKF root index listing.                                     |
| `file-caps`        | opt-in  | Files exceeding size caps, with a grandfathered baseline.                |

`md-links` and `okf-fields` are **shared modules** (inline-link parsing and OKF
optional-field validation) consumed by the checks above, not separately
registered checks — so they have no default/opt-in status of their own.

## Authoring a check

A check is a plain object implementing the `Check` interface. The framework
resolves the file set once, hands every check the same inputs, and applies the
per-check `severity` override — so a check only has to turn inputs into findings.
Adding one is four edits: write the check, register it, test it, and (if it
takes config) document its keys.

### 1. The `Check` contract (`src/types.ts`)

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

`error` findings drive `exit 1` (the enforced floor); a `warn`-only run exits
`0` (the migration-ramp signal). Emit the severity that is _intrinsically_
right for the finding; the repo tunes it via config (see step 4). `types.ts`
depends only on discovery's file-set types and is kept type-only, so it sits at
the bottom of the import graph — put shared types there, not runtime code.

### 2. Read files through the resolved `FileSet` (`src/discovery.ts`)

Do **not** call `git` or `readFileSync` yourself. The runner has already
resolved the correct file set for the mode and handed it to you as
`ctx.files`; using it is what lets a consumer run one job per check or a single
aggregate job over identical inputs, and it gives you ignore-handling for free
(an untracked or `.gitignore`d file is never in scope):

```ts
export interface FileSet {
  paths: string[]; // in-scope repo-relative paths
  read: ContentReader; // path → content (staged blob in --staged, worktree otherwise)
}
```

A typical check filters `ctx.files.paths` to the files it cares about, reads
each with `ctx.files.read(path)`, and pushes findings. Keep the pure detection
logic in an exported free function (like `action-pins`'s `scanYaml`) and let the
`Check.run` adapter map its output onto `Finding[]` — the pure function is what
you unit-test, and other callers can reuse it.

The three modes and their readers are fixed by `resolveFileSet`; you receive the
result, so a check never branches on which git command to run. Two shared
helpers exist for checks that need to resolve a path _reference_ against the tree
rather than scan file contents — `repoPathExists(mode)` (a mode-aware
"does this path exist in scope?" predicate) and `trackedFileModes()` (each
tracked path → its git index mode, so `md-pairing` can see a symlink _as_ a
symlink instead of following it). Reach for those instead of a fresh `git` call.

If a check must shell out for something discovery does not cover, use
`boundedRun` from `src/lib/bounded-subprocess.js` (a hard-timeout wrapper that
kills the whole process group) — never `child_process` directly. Routing every
subprocess through `boundedRun` is also what makes checks testable (step 3).

### 3. Register it (`src/registry.ts`)

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

The registry is built from this explicit list (not a mutable global), so tests
can construct a registry from fakes with no import-order side effects. Being in
`builtinChecks()` makes the check _runnable_ by name; whether it runs by
_default_ for consumers is the separate `defaultOn` flag on the check (step 4) —
`registry.defaultNames()` collects the default-on set, and that is what a bare
run and the workflow's empty `checks` input resolve to.

### 4. Config and default-safety (`.repo-hygiene.yml`)

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
`file-caps-config.ts`), throwing a filename-prefixed error on a malformed shape
so a bad config fails loudly rather than silently mis-behaving.

**Default-safety is the gate for shipping.** Because a new check reaches every
consumer on the next Dependabot bump with no chance for them to edit YAML first,
a check must be safe to run with _no_ configuration. Two legal shapes:

- **Universally correct** — it does the right thing everywhere with sane
  built-in defaults (e.g. `conflict-markers`, `action-pins`). Mark it
  `defaultOn: true` on the check so it joins the default-on set.
- **No-op until opted in** — with no config section it returns `[]` and never
  fails. `file-caps` is the model: `fileCapsCheck.run` calls
  `parseFileCapsConfig(ctx.settings)` and, when there are no `overrides`,
  returns `[]` immediately. Leave `defaultOn` unset; a repo opts in by naming the
  check in its caller and adding a config section.

A check that _requires_ new config to avoid failing is disallowed — it would
break every consumer's CI the moment it shipped. "Universally correct" is a high
bar: it must not fail an arbitrary consumer on arrival. `package-pins` clears the
config-free bar but not this one (a repo with `^3` ranges would break), so it
stays opt-in — being config-free is necessary but not sufficient for
`defaultOn`.

### 5. Test it (`test/checks/*.test.ts`)

Vitest, one file per check. There are two complementary layers:

**Pure logic + in-memory `FileSet`** — the common case. Test the exported
detection function directly, then exercise `check.run` with a hand-built
`FileSet` (no git, no disk):

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

**Mocking `boundedRun`** — when the check (or the discovery path it drives)
shells out to git and you want to assert the exact argv or drive git's output.
Mock the subprocess boundary, then dynamically `import()` the modules under test
_after_ the mock is registered so they pick up the mock:

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
pattern. Run the suite with `pnpm test` (and `pnpm typecheck` / `pnpm lint`)
before pushing; the pre-push gate runs the same commands CI does.

## A worked example: `banned-phrases`

The five steps above, assembled into one small check that flags configured
forbidden substrings (say `@ts-ignore` or a `DO NOT MERGE` marker) in tracked
files. It is **illustrative** — this check is _not_ shipped in the package — but
the snippets are a complete, adaptable template. Note the shape it models: it
reads a config section and **no-ops when unconfigured**, so it is strictly
opt-in (the safe-default shape from step 4).

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

**Opt in** (a consumer's `.repo-hygiene.yml`, step 4) — with no section the
check stays silent; a repo turns it on by listing phrases and naming
`banned-phrases` in its caller's `checks` input:

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
```

That is the whole arc: a pure function you unit-test, a thin adapter, one
registry line, an opt-in config section, and a test — no framework plumbing to
touch. Whether it should be **default-on** is the separate `defaultOn` decision
from step 4; a substring blocklist is inherently repo-specific, so it stays
opt-in.

## How a check reaches consumers

A newly-added check does **not** require any per-repo change to start running:

1. **Merge → release.** release-please opens a release PR; merging it publishes a
   new `@rmartz/repo-hygiene` version to GitHub Packages and, via the
   `extra-files` hook in `release-please-config.json`, bumps the `version`
   default inside `.github/workflows/hygiene.yml` in lockstep — so a given pinned
   ref installs a reproducible package version.
2. **Dependabot bump.** Each consumer pins the reusable workflow by SHA
   (`uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z`) and
   runs Dependabot's `github-actions` ecosystem. Dependabot opens a PR bumping
   that pin to the new release on its normal schedule.
3. **Pick-up.** Merging the Dependabot PR moves the consumer onto the new
   package version. A new **default-on** check now runs automatically — the
   consumer's empty `checks` input resolves to the registry's default-on set, so
   the check auto-joins with no edit to their caller. An **opt-in** check ships in
   the package but stays dormant until the repo adds it to its caller's `checks`
   input and a `.repo-hygiene.yml` section.

This is why default-safety (step 4) is non-negotiable: step 3 gives the consumer
no opportunity to adjust configuration before the new check runs.

### The `file-caps` baseline ramp (`--update-baseline`)

`file-caps` is the one check with committed migration state:
`.repo-hygiene-baseline.json`. On adoption in a repo, every file already over its
hard (`error`) cap is grandfathered at its current size and reported as a `warn`
instead of blocking; thereafter the baseline **only shrinks** — a file that gets
smaller ratchets its ceiling down, one that drops under the cap is removed, and
one that grows past its recorded ceiling loses the grandfather and hard-errors.
Each metric (`lines`, `bytes`) is tracked independently.

Regenerate the baseline with the CLI rather than editing the JSON by hand:

```bash
ai-repo-hygiene --update-baseline --check --config .repo-hygiene.yml
```

With no baseline file present this is first-time **adoption** (grandfather
everything currently over cap); with one present it **ratchets** the existing
baseline down. Commit the regenerated `.repo-hygiene-baseline.json` alongside the
change that shifts file sizes. A new baseline is never _added_ by a ratchet — the
grandfather list can only lose entries — so the ramp always tightens toward the
caps.
