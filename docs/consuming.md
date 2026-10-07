---
type: Reference
title: Setting up repo-hygiene in a consuming repo
description: How to add the repo-hygiene GitHub Action to a repo, choose and configure checks in .repo-hygiene.yml, and verify the setup is working.
tags: [consumer, setup, configuration]
---

# Setting up repo-hygiene in a consuming repo

This is the consumer-facing guide: how to adopt `@rmartz/repo-hygiene` in a
repository, choose and configure its checks, and confirm the setup works. For
the check registry and how a new check is authored, see the
[checks reference](checks/index.md) and [authoring a check](authoring-a-check.md).

## Local vs CI: what you actually need

**CI-only is the baseline.** Adopting repo-hygiene requires only the caller
workflow and Dependabot entry in section 1 — the checks run in the
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
GitHub Action. You do **not** need a local `@rmartz/repo-hygiene`
devDependency, `.npmrc` `@rmartz` auth, `package.json` hygiene scripts, or a
pre-commit/husky hook.

**A local install is an optional enhancement** for fast feedback while you edit —
running the checks (or `--staged` over just your changed files) before you push,
and, in the legacy baseline mode, ratcheting the `file-caps` baseline (section 4). It never changes what CI
enforces. If you want it, add `@rmartz/repo-hygiene` as a devDependency (current
versions are public on npmjs, so no `.npmrc` scope mapping or token is needed) and
wire your own scripts or hook; otherwise skip straight to section 1 and stay
CI-only.

## 1. Add the caller workflow and Dependabot entry

You add two small files once; Dependabot maintains the pin from then on. Both are
seeded automatically by
[`@rmartz/bootstrap`](https://github.com/rmartz/ai-tools) (`ai-ensure-project-config`),
so you rarely write them by hand — but here is what they are.

The caller workflow checks out the repository (the Action scans the workspace and
checks out nothing itself) and runs the Action, pinned by commit SHA:

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
# push is limited to main: pull_request covers PR branches, and an unfiltered
# push would run the job twice per PR-branch push.
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  statuses: write # optional: one `repo-hygiene / <check>` commit status per check
jobs:
  hygiene:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
      - uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z
```

The Action's full input list (`checks`, `config`, `node-version`,
`working-directory`, per-check statuses) is in its
[README](https://github.com/rmartz/repo-hygiene-action#inputs).

The Dependabot entry keeps that `@<sha>` pin current — this is the channel new
checks and fixes reach you through:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

**Auth:** the published `@rmartz/repo-hygiene` package is **public** on npmjs, so
the install needs no token and no `packages: read` permission. No per-repo PAT.

**Pin to a commit with a plain `vX.Y.Z` tag.** Releases up to 3.0.0 were tagged
`repo-hygiene-vX.Y.Z`, and those prefixed tags are not aliased to plain ones. A
`# vX.Y.Z` comment on a pre-3.0.0 commit names no tag, so Dependabot never bumps
it. If your pin predates 3.0.0, move it to a v3.0.0-or-later commit. The
[`action-pin-tags`](checks/action-pin-tags.md) check detects stranded comments
like this.

## 2. Choose which checks run

The Action's `checks` input decides which checks run, with the default derived
from the package's registry:

- **Omit `checks` entirely** → the Action runs the **default-on** set — every
  built-in check (`conflict-markers`, `action-pins`, `action-pin-tags`,
  `package-pins`, `docs-links`, `md-pairing`, `okf`, `okf-index`, `file-caps`) —
  and a newly-added check **auto-joins** on your next Dependabot bump with no
  edit to your caller. This is the recommended default. Every one of them
  enforces at `error` at its recommended settings; take an exception in
  `.repo-hygiene.yml` (section 3) rather than dropping one from the list.
- **Set `checks: <names>`** → runs **exactly** those checks. This pins the set:
  you manage the list, and you forfeit auto-join for future default-on checks. To
  drop one check, prefer `enabled: false` (with a `reason`) in its config section.

```yaml
- uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z
  with:
    # pin an explicit set (forfeits auto-join of future checks)
    checks: conflict-markers action-pins action-pin-tags package-pins docs-links md-pairing okf okf-index file-caps
    config: .repo-hygiene.yml
```

`config:` points at your per-repo `.repo-hygiene.yml` (section 3). Why every
check is on by default, and how exceptions work, is documented in
[the distribution contract](distribution-contract.md).

## 3. Configure checks in `.repo-hygiene.yml`

Per-repo settings live under `checks.<name>`. The framework understands three keys
everywhere — `severity` (see the ramp below), `enabled`, and `reason` — and every
other key is defined by the owning check. **Every loosening needs a `reason`** in
the same section, or the run fails with a config error (exit `2`); keys that
loosen are marked _(exception)_ below:

| Check              | Default | `.repo-hygiene.yml` keys under `checks.<name>`                                                                                                                                                                                                                                                                                 |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `conflict-markers` | on      | none (the `ALLOW_CONFLICT_MARKERS` env var bypasses it in `--staged` only)                                                                                                                                                                                                                                                     |
| `action-pins`      | on      | none                                                                                                                                                                                                                                                                                                                           |
| `action-pin-tags`  | on      | none (network: lists upstream tags; reads `GITHUB_TOKEN`/`GH_TOKEN` for private upstreams, and warns and skips an unreachable upstream)                                                                                                                                                                                        |
| `package-pins`     | on      | none                                                                                                                                                                                                                                                                                                                           |
| `docs-links`       | on      | `roots` (dirs to scan, default `[docs]`); `exempt` _(exception)_ (link targets allowed to dangle); `anchors` (validate `#fragment` targets, bool, default `true`; `false` is an exception); `anchorExempt` _(exception)_                                                                                                       |
| `md-pairing`       | on      | `wrapper` (each `CLAUDE.md` must be a bare import line; default `@AGENTS.md`, a custom string, or `false` to skip the rule — an exception)                                                                                                                                                                                     |
| `okf`              | on      | `types` (list, or `"*"` for any non-empty type — an exception); `roots`; `exempt` _(exception)_; `resourceExemptTypes` (list, or `"*"` — no type needs a resource; a set one is still validated; anything beyond `[Design, Subsystem]` is an exception). `index.md`/`log.md` auto-skipped. See [okf-format.md](okf-format.md). |
| `okf-index`        | on      | `roots` (default `[docs]`); `indexName` (default `index.md`); `nestedIndexes` (bool, default `true` — `false` allows a flat hierarchy, an exception); `noUpwardLinks`; `noSiblingLinks`                                                                                                                                        |
| `file-caps`        | on      | `overrides: [{ glob, lines: {warn, error}, bytes: {warn, error} }]` _(exception)_ (bytes accept `40KB`-style sizes); `mode` (anything but `strict` is an exception); `base`                                                                                                                                                    |
| _(any check)_      |         | `severity: warn \| error` — overrides every finding this check emits (`warn`, the migration ramp, is an exception); `enabled: false` _(exception)_; `reason`                                                                                                                                                                   |

That table is the **complete check roster** — the names you can pass in `checks:`.
The `src/checks/` directory also contains `md-links` and `okf-fields`, but these
are internal library modules (link scanning for `docs-links`/`okf-index`, and
optional-field validation for `okf`), **not** separately selectable checks — do
not list them in `checks:`.

**Migrating a hand-rolled docs-index validator?** `okf-index` is the centralized
replacement for a bespoke `validate-docs-index.mjs`-style script: it enforces that
every docs page is reachable from a root `index.md`. Enable `okf-index` (with your
`roots`/`indexName`), retire the local script, and — if your bundle links a flat
root index rather than nested per-directory indexes — set `nestedIndexes: false`.

Every check runs at its recommended settings with no config, so most keys exist to
**relax** a default for a repo that needs an exception — and each such section
says why. A representative config:

```yaml
# .repo-hygiene.yml
checks:
  docs-links:
    roots: [docs, guides]
    anchorExempt: ['README.md#quick-start']
    reason: GitHub's slug for this heading differs from the one we compute.
  okf:
    types: [Skill, Script, Library, Design, Reference]
    resourceExemptTypes: [Design, Reference]
    reason: Reference pages are concept guides with no single source file.
  file-caps:
    overrides:
      - glob: 'src/**/*.ts'
        lines: { warn: 300, error: 400 }
        bytes: { warn: 16KB, error: 24KB }
    reason: Generated API clients run long; split tracked in #123.
```

**The migration ramp (`severity`).** Adopting an opinionated check against an
existing codebase often surfaces a backlog. Set `severity: warn` on that check to
report findings without failing CI (exit 0) while you work the backlog down, then
remove it (or set `error`) once the tree is clean:

```yaml
checks:
  okf:
    severity: warn # report, don't block — for now
    reason: Adopting OKF; 40 legacy pages left to migrate.
```

## 4. Adopt `file-caps` (the size-cap ramp)

`file-caps` needs a plan for files already over a hard cap. Pick a
[mode](checks/file-caps.md#modes):

- **`mode: ratchet`** (recommended) — no committed state. Files over cap on
  `origin/main` are reported as warnings while no larger than they are there, and
  error once they grow; everything else is enforced. Each merge that shrinks a
  file lowers its ceiling automatically. CI must fetch `origin/main`
  (`actions/checkout` with `fetch-depth: 0`).
- **`mode: grandfather`** — no committed state. Files over cap on `origin/main` are
  exempt (reported as warnings, with no ceiling); everything else is enforced, and
  a file loses its exemption once it is under cap on `origin/main`. Same
  `fetch-depth: 0` requirement.
- **`mode: baseline`** (legacy; the default when a baseline file exists) — baseline
  every file already over a hard cap at its current size, so the check reports them
  as warnings instead of blocking:

```bash
repo-hygiene --update-baseline --check --config .repo-hygiene.yml
```

Commit the generated `.repo-hygiene-baseline.json`. From then on the baseline
**only shrinks** — a file that gets smaller ratchets its ceiling down, one that
drops under the cap is removed, and one that grows past its recorded ceiling loses
its exemption and hard-errors. Re-run the same command to ratchet the baseline
after files shrink.

## 5. Verify the setup

1. **The workflow runs.** Open a PR (or push to `main`): a **Repo Hygiene**
   workflow appears in the repo's **Actions** tab, and its `hygiene` job runs to a
   pass. A green job on a repo with no violations confirms the caller, the pin,
   and the auth are all wired correctly.
2. **The checks you expect are active.** Introduce a deliberate violation of an
   enabled check on a scratch branch (e.g. an unpinned `uses:` for `action-pins`,
   or a broken `docs/` link for `docs-links`) and confirm the job fails on it —
   then revert. This proves your `checks` input and `.repo-hygiene.yml` are taking
   effect, not silently no-opping.
3. **Propagation works.** Within the Dependabot schedule you set, a
   `github-actions` bump PR appears against the caller's `@<sha>` pin. Merging it
   is how you pick up new checks and fixes — including any new default-on check,
   with no edit to your caller.

## Troubleshooting

- **You still call `rmartz/repo-hygiene/.github/workflows/hygiene.yml`.** That
  reusable workflow was removed in favor of the Action. Existing SHA pins still
  resolve but run a frozen CLI 3.0.0 and receive no updates — switch the caller to
  the section 1 shape.
- **The job is green but a check you configured never fires.** If you set
  `checks:` at all, it is the _exact_ run list — confirm the check is in it, not
  just in `.repo-hygiene.yml`.
- **The job fails with "loosens its recommended settings … without a reason".**
  A section relaxes a check (`severity: warn`, `enabled: false`, or a laxer
  option) but doesn't say why. Add a `reason:` to that section.
- **The job fails after a major-version bump.** Defaults only get stricter in a
  major release, so the check is finding a real backlog. Take an exception in
  `.repo-hygiene.yml` the same day — `severity: warn` (section 3), a laxer option
  (`anchors: false`, `wrapper: false`, a `file-caps` override), `mode: ratchet`
  for `file-caps`, or `enabled: false`, each with a `reason` — and fix the backlog
  on your own schedule. The
  [distribution contract](distribution-contract.md#exceptions) lists them.
- **`install` fails to find the package.** The package is public on npmjs and
  installs with no auth. If an `.npmrc` maps the `@rmartz` scope to
  `npm.pkg.github.com`, npm looks only there and finds nothing newer than 7.0.1 —
  remove that mapping.
