# Agent guide — @rmartz/repo-hygiene

This repo is the standalone home of `@rmartz/repo-hygiene`: a suite of low-cost
CI checks (conflict markers, GitHub Actions SHA pins, package pins, docs link
integrity, OKF frontmatter, file-size caps, AGENTS/CLAUDE pairing), published as
a CLI to npmjs. Consumers run it through the separate
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
GitHub Action, pinned by version and kept current by Dependabot. See
[README.md](README.md) and the [documentation](docs/index.md).

## Documentation — update it as part of every task

Treat documentation as part of the change, not an afterthought. On **every**
task:

- **Read first.** Before editing code, read the relevant `docs/` page(s) and this
  file, so your change is consistent with what is already documented.
- **Update and correct in the same PR.** If your change adds, alters, or
  contradicts anything a doc says — a check's behavior, a config key, a command,
  an interface — fix that doc in the same PR. When you add a check, add a page
  under [docs/checks/](docs/checks/index.md) (its behavior, config, and
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

- **Updates arrive the self-updating way:** the hygiene caller
  (`repo-hygiene.yml`, which runs `rmartz/repo-hygiene-action`) is pinned and
  bumped by Dependabot; the CI checks
  (incl. PR-title lint + the `commit-convention` tripwire), labels, hardened
  `dependabot.yml`, and squash-merge setting are already in place and owned here.
- **PR policy:** the `pr-policy` caller
  ([pr-policy.yml](.github/workflows/pr-policy.yml)) runs the released
  `rmartz/pr-policy-action` on this repo's PRs, pinned and bumped by Dependabot.
  It passes `skip-uat: true`: the repo ships only a CLI, so there is nothing to
  user-test.
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
- **Bins stay bare.** A file under `src/bin/` is a wrapper that always calls
  `run()`. Never gate it behind an `import.meta.url === argv[1]` comparison: when
  the CLI is launched through a `node_modules/.bin` symlink (npm's shim, or
  pnpm's via the `.pnpm` store) `argv[1]` is the link and `import.meta.url` is
  the realpath, so the guard fails and the process exits 0 without running a
  single check — silently vacuous CI (#67). Keep the logic in a library module
  (`src/cli.ts`) so tests import that, and nothing needs to import the bin.
- **Value sets:** default to a structural string union or `as const` array over an
  `enum` (reserve `enum` for internal-only sets never serialized raw).
- **File caps:** `max-lines` 480 (src) / 720 (tests) via eslint; non-TS files are
  capped by the `file-caps` check per [`.repo-hygiene.yml`](.repo-hygiene.yml).
  The response to a cap is extraction, never terser code.
- **Pin dependencies** to full `major.minor.patch` (keep the `^`), and **SHA-pin**
  every third-party GitHub Action with a `# vX.Y.Z` comment — both dogfooded by
  this package's own `package-pins` / `action-pins` checks.

## Adding a check

See the authoring guide in [docs/authoring-a-check.md](docs/authoring-a-check.md): implement
the `Check` contract, read files through the resolved `FileSet` (never call `git`
directly — use `boundedRun` from `src/lib/bounded-subprocess.js` if you must shell
out), and register it in `src/registry.ts`. **Every check is default-on**
(`defaultOn: true`) at best-practice settings, and reaches consumers on their next
Dependabot bump with no YAML edit. A repo loosens one only as a written-down
exception — the loosening plus a `reason` in its `.repo-hygiene.yml` section — so
declare each of the check's laxer settings in its `loosenings` hook, and make a
network-dependent check fail safe (`inconclusive`, never `error`).

## Worktrees, PRs, and releases

- **Work in a dedicated worktree** under `.git-worktrees/` (`ai-new-worktree`),
  never on `main` in the root checkout. Run `pnpm install` in a fresh worktree
  before building.
- **PR titles must be Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  …). The repo squash-merges using the **PR title**, so the PR title is the only
  conventional subject that reaches `main` — a `feat`/`fix` triggers a release, a
  non-conventional title yields none.
- **Releases are automated** via [semantic-release](.releaserc.json): every push
  to `main` with a releasable commit publishes the `@rmartz/repo-hygiene` CLI to
  npmjs (public), tags `v<version>`, and cuts a GitHub Release — no release PR, no
  commit-back, no PAT. npm auth is OIDC trusted publishing tied to the
  `release.yml` filename, so there is no `NPM_TOKEN`; renaming that workflow
  breaks publishing until the trusted publisher on npmjs is updated. See #45 for
  the split from release-please and why. OIDC publishing needs npm >= 11.5.1, so
  the release runs on **Node 24** — keep it there. The publish runs in the
  `prepare` step (`@semantic-release/npm` with `npmPublish: false` writes the
  version, then `@semantic-release/exec` runs `npm publish`), **before**
  semantic-release pushes the tag, so a failed publish stops the release with no
  tag. Keep it that way — the shared `release-check` fails a config where
  `@semantic-release/npm` publishes. A legacy tag whose publish failed is
  backfilled by dispatching `release.yml` with `tag: vX.Y.Z`.
- **The release toolchain lives in
  [semantic-release-ci](https://github.com/rmartz/semantic-release-ci).**
  `release.yml`'s release job calls its shared workflow (pinned by SHA, bumped by
  Dependabot), which runs on Node 24 and fails before tagging if npm is too old
  for trusted publishing. The required `release-check / release-check` check
  proves `.releaserc.json` still works with that toolchain on every PR. The
  toolchain (`semantic-release`, its plugins, the changelog preset) is **not** in
  this repo's `package.json` — never add it back, and never reintroduce a
  `semantic-release --dry-run` job as a release guard: on a PR it exits before
  rendering notes, so it passes without testing anything. The backfill job stays
  local, in `release.yml`, because the npm trusted publisher is tied to that file.
- **This repo is CLI-only (#45).** Distribution lives in
  `rmartz/repo-hygiene-action`, which pins this CLI as a dependency and
  re-releases itself when Dependabot bumps it. Do not add a reusable workflow
  or Action back here; consumer-facing wiring changes belong in that repo.

## Agent directive files

- **`AGENTS.md` is the single source of truth** for a directory's agent
  instructions — author directives here, never in `CLAUDE.md`.
- **Every `AGENTS.md` has a companion `CLAUDE.md`** in the same directory (and vice
  versa); the `CLAUDE.md` is a bare wrapper whose only content is `@AGENTS.md`.
  The pairing is enforced by this package's `md-pairing` check.
