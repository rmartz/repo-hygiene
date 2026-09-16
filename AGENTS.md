# Agent guide — @rmartz/repo-hygiene

This repo is the standalone home of `@rmartz/repo-hygiene`: a suite of low-cost
CI checks (conflict markers, GitHub Actions SHA pins, package pins, docs link
integrity, OKF frontmatter, file-size caps, AGENTS/CLAUDE pairing) plus the
**reusable workflow** (`.github/workflows/hygiene.yml`) that distributes them to
consuming repos, pinned by version and kept current by Dependabot. See
[README.md](README.md) and [docs/repo-hygiene.md](docs/repo-hygiene.md).

## Documentation — update it as part of every task

Treat documentation as part of the change, not an afterthought. On **every**
task:

- **Read first.** Before editing code, read the relevant `docs/` page(s) and this
  file, so your change is consistent with what is already documented.
- **Update and correct in the same PR.** If your change adds, alters, or
  contradicts anything a doc says — a check's behavior, a config key, a command,
  an interface — fix that doc in the same PR. When you add a check, extend
  [docs/repo-hygiene.md](docs/repo-hygiene.md) (its behavior, config, and
  default-safety classification). An outdated doc is worse than no doc.
- **Correct drift you notice.** If you pass a doc that is stale or wrong while
  doing something else, fix it (or, if out of scope, note it) — do not leave
  known-wrong documentation in place.
- **Docs follow OKF.** Pages under `docs/` use Open Knowledge Format frontmatter
  (`type` required; `title`/`description`/`resource`/`tags` recommended) and stay
  reachable from `docs/index.md`. The `okf` and `docs-links` checks enforce this
  in CI — run `pnpm run build && node dist/bin/repo-hygiene.js --check` (or the
  Self-hygiene CI job) to verify.

## Repository conformance

This repo is held to the shared
[repository checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md),
and it **self-manages** its own config: fix conformance gaps directly here, in a
PR. Bootstrap (`ai-ensure-*`) is a one-time new-repo **starter**, not an ongoing
manager — do not defer a fix to a bootstrap re-run, and do not treat a `.github/`
file as off-limits just because bootstrap once seeded it.

- **Updates arrive the self-updating way:** the reusable-workflow caller
  (`repo-hygiene.yml`) is pinned and bumped by Dependabot; the CI checks
  (incl. PR-title lint + the `commit-convention` tripwire), labels, hardened
  `dependabot.yml`, and squash-merge setting are already in place and owned here.
- `ai-ensure-labels` / `ai-verify-squash-setting` are still useful one-shot
  helpers to (re)seed the label roster or confirm the squash setting, but this
  repo owns its `.github/` config going forward.

Follow the checklist directly — it is the source of truth for what "conformant"
means. (Bootstrap still seeds good starting defaults for _new_ repos; that is a
separate concern from managing this one.)

## Common commands

```bash
pnpm install                                   # deps (run in each worktree first)
pnpm run build                                 # tsup → dist (ESM + d.ts)
pnpm run typecheck                             # tsc --noEmit
pnpm run lint                                  # eslint (incl. max-lines caps)
pnpm run format:check                          # prettier --check
pnpm run test                                  # vitest
node dist/bin/repo-hygiene.js --check          # run this repo's own hygiene checks
```

Before pushing, run `ai-pre-push-verify -C <worktree>` and fix every failure — it
re-runs the actual CI checks locally so a green result predicts CI.

## Code standards

Most are enforced by eslint / the hygiene checks; the intent:

- **Strict TypeScript.** No `any`, no `@ts-ignore` (use `@ts-expect-error` with a
  reason). Favor type inference; explicit generic args are a smell.
- **Named exports only**; no default exports. No IIFEs. Prefer `async/await` over
  `.then()`.
- **Value sets:** default to a structural string union or `as const` array over an
  `enum` (reserve `enum` for internal-only sets never serialized raw).
- **File caps:** `max-lines` 480 (src) / 720 (tests) via eslint; non-TS files are
  capped by the `file-caps` check per [`.repo-hygiene.yml`](.repo-hygiene.yml).
  The response to a cap is extraction, never terser code.
- **Pin dependencies** to full `major.minor.patch` (keep the `^`), and **SHA-pin**
  every third-party GitHub Action with a `# vX.Y.Z` comment — both dogfooded by
  this package's own `package-pins` / `action-pins` checks.

## Adding a check

See the authoring guide in [docs/repo-hygiene.md](docs/repo-hygiene.md): implement
the `Check` contract, read files through the resolved `FileSet` (never call `git`
directly — use `boundedRun` from `src/lib/bounded-subprocess.js` if you must shell
out), register it in `src/registry.ts`, and set `defaultOn: true` **only** for a
check that is safe to run on an arbitrary repo with no config. A new default-on
check reaches consumers on their next Dependabot bump with no YAML edit, so the
default-safety bar is strict.

## Worktrees, PRs, and releases

- **Work in a dedicated worktree** under `.git-worktrees/` (`ai-new-worktree`),
  never on `main` in the root checkout. Run `pnpm install` in a fresh worktree
  before building.
- **PR titles must be Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  …). The repo squash-merges using the **PR title**, so the PR title is the only
  conventional subject that reaches `main` — a non-conventional title makes
  release-please skip the release.
- **Releases are automated** via release-please: merging its release PR tags the
  version and publishes to GitHub Packages (public); the version installed by
  `hygiene.yml` is bumped in lockstep via `extra-files`.

## Agent directive files

- **`AGENTS.md` is the single source of truth** for a directory's agent
  instructions — author directives here, never in `CLAUDE.md`.
- **Every `AGENTS.md` has a companion `CLAUDE.md`** in the same directory (and vice
  versa); the `CLAUDE.md` is a bare wrapper whose only content is `@AGENTS.md`.
  The pairing is enforced by this package's `md-pairing` check.
