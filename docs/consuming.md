---
type: Reference
title: Setting up repo-hygiene in a consuming repo
description: How to add the reusable hygiene workflow to a repo, choose and configure checks in .repo-hygiene.yml, and verify the setup is working.
tags: [consumer, setup, configuration]
---

# Setting up repo-hygiene in a consuming repo

This is the consumer-facing guide: how to adopt `@rmartz/repo-hygiene` in a
repository, choose and configure its checks, and confirm the setup works. For
the check registry and how a new check is authored, see the
[checks reference](checks/index.md) and [authoring a check](authoring-a-check.md).

## Local vs CI: what you actually need

**CI-only is the baseline.** Adopting repo-hygiene requires only the caller
workflow and Dependabot entry in section 1 — the checks run in the reusable
workflow on GitHub. You do **not** need a local `@rmartz/repo-hygiene`
devDependency, `.npmrc` `@rmartz` auth, `package.json` hygiene scripts, or a
pre-commit/husky hook.

**A local install is an optional enhancement** for fast feedback while you edit —
running the checks (or `--staged` over just your changed files) before you push,
and ratcheting the `file-caps` baseline (section 4). It never changes what CI
enforces. If you want it, add `@rmartz/repo-hygiene` as a devDependency (pointing
npm at the `@rmartz` scope on `npm.pkg.github.com`) and wire your own scripts or
hook; otherwise skip straight to section 1 and stay CI-only.

## 1. Add the caller workflow and Dependabot entry

You add two small files once; Dependabot maintains the pin from then on. Both are
seeded automatically by
[`@rmartz/bootstrap`](https://github.com/rmartz/ai-tools) (`ai-ensure-project-config`),
so you rarely write them by hand — but here is what they are.

The caller workflow pins the reusable workflow by commit SHA:

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
on: [pull_request, push]
jobs:
  hygiene:
    permissions:
      contents: read
      packages: read
    uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z
```

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

**Auth:** the published `@rmartz/repo-hygiene` package is **public** on GitHub
Packages, readable with the built-in `GITHUB_TOKEN` — so the `packages: read`
permission above is all the workflow needs. No per-repo PAT.

## 2. Choose which checks run

The `checks` workflow input decides which checks run. Its behavior changed in
1.0.0 to derive the default from the package's registry:

- **Omit `checks` entirely** → the reusable workflow runs the **default-on** set —
  currently every check **except** `package-pins` (`conflict-markers`,
  `action-pins`, `docs-links`, `md-pairing`, `okf`, `okf-index`, `file-caps`) —
  and a newly-added default-on check **auto-joins** on your next Dependabot bump
  with no edit to your caller. This is the recommended default. Three of them
  (`md-pairing`, `okf`, `okf-index`) default to `warn` severity, so they report
  without failing CI until you opt into `severity: error` (section 3).
- **Set `checks: <names>`** → runs **exactly** those checks. This pins the set:
  you manage the list, and you forfeit auto-join for future default-on checks. To
  add the opt-in `package-pins` (or drop a default-on check), name the full set
  you want.

```yaml
uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z
with:
  # pin an explicit set: the default-on checks you want + the opt-in package-pins
  checks: conflict-markers action-pins docs-links md-pairing okf okf-index file-caps package-pins
  config: .repo-hygiene.yml
```

`config:` points at your per-repo `.repo-hygiene.yml` (section 3). Which checks
are default-on vs opt-in, and why, is documented in
[the distribution contract](distribution-contract.md).

## 3. Configure checks in `.repo-hygiene.yml`

Per-repo settings live under `checks.<name>`. The framework understands one key
everywhere — `severity` (see the ramp below) — and every other key is defined by
the owning check:

| Check              | Default   | `.repo-hygiene.yml` keys under `checks.<name>`                                                                                                                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `conflict-markers` | on        | none (the `ALLOW_CONFLICT_MARKERS` env var bypasses it in `--staged` only)                                                                                                                                                           |
| `action-pins`      | on        | none                                                                                                                                                                                                                                 |
| `package-pins`     | opt-in    | none                                                                                                                                                                                                                                 |
| `docs-links`       | on        | `roots` (dirs to scan, default `[docs]`); `exempt` (link targets allowed to dangle); `anchors` (also validate `#fragment` targets, bool); `anchorExempt`                                                                             |
| `md-pairing`       | on (warn) | `wrapper` (require each `CLAUDE.md` be a bare import line; `true` → `@AGENTS.md`, or a custom string)                                                                                                                                |
| `okf`              | on (warn) | `types` (list, or `"*"` for any non-empty type); `roots`; `exempt`; `resourceExemptTypes` (list, or `"*"` to exempt all types — disables resource validation). `index.md`/`log.md` auto-skipped. See [okf-format.md](okf-format.md). |
| `okf-index`        | on (warn) | `roots` (default `[docs]`); `indexName` (default `index.md`); `nestedIndexes` (bool, default `true` — `false` allows a flat hierarchy); `noUpwardLinks`; `noSiblingLinks`                                                            |
| `file-caps`        | on        | `overrides: [{ glob, lines: {warn, error}, bytes: {warn, error} }]` (bytes accept `40KB`-style sizes)                                                                                                                                |
| _(any check)_      |           | `severity: warn \| error` — overrides every finding this check emits (the migration ramp)                                                                                                                                            |

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

A representative config:

```yaml
# .repo-hygiene.yml
checks:
  docs-links:
    roots: [docs]
    exempt: []
    anchors: true # also validate that #fragment link targets resolve
  okf:
    types: [Skill, Script, Library, Design, Reference] # or "*" for an open vocabulary
    resourceExemptTypes: [Design, Reference]
  file-caps:
    overrides:
      - glob: 'src/**/*.ts'
        lines: { warn: 300, error: 400 }
        bytes: { warn: 16KB, error: 24KB }
```

**The migration ramp (`severity`).** Adopting an opinionated check against an
existing codebase often surfaces a backlog. Set `severity: warn` on that check to
report findings without failing CI (exit 0) while you work the backlog down, then
remove it (or set `error`) once the tree is clean:

```yaml
checks:
  okf:
    severity: warn # report, don't block — for now
```

## 4. Adopt `file-caps` (the size-cap ramp)

`file-caps` has committed migration state. When you first enable it, grandfather
every file already over a hard cap at its current size so the check reports them
as warnings instead of blocking:

```bash
ai-repo-hygiene --update-baseline --check --config .repo-hygiene.yml
```

Commit the generated `.repo-hygiene-baseline.json`. From then on the baseline
**only shrinks** — a file that gets smaller ratchets its ceiling down, one that
drops under the cap is removed, and one that grows past its recorded ceiling loses
the grandfather and hard-errors. Re-run the same command to ratchet the baseline
after files shrink.

## 5. Verify the setup

1. **The workflow runs.** Open a PR (or push to a branch): a **Repo Hygiene**
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

- **The job is green but a check you configured never fires.** An opt-in check
  runs only when it is named in the `checks` input. If you set `checks:` at all,
  it is the _exact_ run list — confirm the check is in it, not just in
  `.repo-hygiene.yml`. A check also no-ops when its config is absent (e.g.
  `file-caps` with no `overrides`).
- **The job fails the moment you enable an opinionated check.** That is the check
  finding a real backlog. Use `severity: warn` (section 3) to ramp it in rather
  than blocking every PR at once.
- **`install` fails to find the package.** The package is public on GitHub
  Packages; the reusable workflow reads it with `GITHUB_TOKEN` and the
  `packages: read` permission. If you install it outside the workflow, point npm
  at the `@rmartz` scope on `npm.pkg.github.com`.
