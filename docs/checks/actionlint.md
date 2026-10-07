---
type: Library
title: The actionlint check
description: 'Opt-in workflow linter: runs a pinned, checksum-verified actionlint (shellcheck included) over .github/workflows, strict by default with explicit per-repo opt-outs.'
resource: src/checks/actionlint.ts
tags: [hygiene, ci, checks, github-actions, shellcheck, dependabot]
---

# `actionlint`

**Default:** opt-in (never default-on) · **Config:** `shellcheck`,
`shellcheckSeverity`, `ignore` · **Network:** yes (downloads actionlint)

[actionlint](https://github.com/rhysd/actionlint) type-checks `${{ }}`
expressions, validates `workflow_call` inputs, outputs and secrets, and runs
shellcheck over every `run:` block. That matters most for **shipped** reusable
workflows: a mistyped expression in one never fails in the repo that owns it,
only later in a consumer's CI.

## What it does

For the `.github/workflows/*.yml` / `*.yaml` files in scope (all of them under
`--check`, only the changed ones under `--check-diff`), it:

1. Downloads the pinned actionlint release for the runner's platform from
   `github.com/rhysd/actionlint/releases` into a fresh temp dir, and **rejects
   it unless its SHA-256 matches the pin** (see [The pin](#the-pin)).
2. Confirms `shellcheck` is on `PATH` (GitHub's `ubuntu-latest` ships it).
3. Runs actionlint from the repo root over those files, then deletes the binary.

Every actionlint error becomes an `error` finding, tagged with its kind
(`[expression]`, `[shellcheck]`, `[syntax-check]`, …). With no workflow in scope
the check does nothing, and downloads nothing.

actionlint lints the workflows as they are on disk, so under `--staged` it sees
the working-tree content, not the staged blob. actionlint also reads the repo's
own `.github/actionlint.yaml` if one exists (self-hosted runner labels,
`config-variables`), and shellcheck reads `.shellcheckrc`; both work as usual.

## Strict by default

Once named, the check runs at its strictest: shellcheck at its own lowest
severity (`style`, so info and style notes fail too), and nothing ignored. A
repo loosens it only by **writing the opt-out down** in `.repo-hygiene.yml`, so
every relaxation is visible and reviewable. There is no built-in ignore list,
not even for known actionlint false positives.

If shellcheck is missing, actionlint would silently skip it. This check
reports that as an `error` instead (and still runs the rest of actionlint), so
"no shellcheck findings" never means "shellcheck never ran".

## Opt-outs

```yaml
checks:
  actionlint:
    # Drop shellcheck findings below this severity: style (default) | info |
    # warning | error. Passed to shellcheck as SHELLCHECK_OPTS="-S <level>".
    shellcheckSeverity: warning
    # Don't shellcheck run: blocks at all (and don't require shellcheck).
    shellcheck: false
    # Per-glob message ignores, mirroring actionlint's own `paths.<glob>.ignore`:
    # each regex is matched against the finding's message, for the workflow
    # files the glob matches. `**` applies repo-wide.
    ignore:
      '.github/workflows/release.yml':
        - 'property "workflow_(sha|repository)" is not defined'
```

Plus the framework's `severity: warn` for the usual ramp (report the backlog
without failing, fix it, then remove the override). A malformed key (an unknown
severity, a non-list ignore, an invalid regex) fails the run loudly.

### Known false positives (actionlint 1.7.12)

A fleet baseline over every `rmartz` Actions repo found no real bugs, only these.
Each repo that hits one opts out explicitly:

| Finding                                                 | Opt-out                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `property "workflow_repository"` / `"workflow_sha"` …   | `ignore: { '<the workflow>': ['property "workflow_(sha\|repository)" is not defined'] }`   |
| SC2016 on deliberate Markdown backticks in single quote | `ignore: { '<the workflow>': ['SC2016'] }`, or a `# shellcheck disable=SC2016` in the step |
| SC2086 / SC2129 (info / style)                          | fix them, or `shellcheckSeverity: warning`                                                 |

The `job.workflow_*` contexts are real; actionlint 1.7.12 does not model them
yet. Drop the ignore once a pinned release does.

## The pin

The actionlint version and the SHA-256 of every release archive live in
[`src/checks/actionlint-release.ts`](../../src/checks/actionlint-release.ts),
copied from upstream's `actionlint_<version>_checksums.txt`. A consumer gets a
new actionlint only through a new `@rmartz/repo-hygiene` release.

Dependabot can't read a TypeScript constant, so it watches the same version
through a sensor, [`tools/actionlint/Dockerfile`](../../tools/actionlint/Dockerfile)
(`FROM rhysd/actionlint:<version>@sha256:…`, the `docker` ecosystem; nothing
builds it). A test asserts the two agree, so a Dependabot bump goes red on
purpose. To land it, regenerate the pin on the Dependabot branch and review the
new digests in the diff:

```bash
node scripts/update-actionlint.mjs <version>
```

The bump is committed as `fix`, so it cuts a patch release that ships the new
actionlint to consumers.

## Not covered: composite actions

actionlint lints only `.github/workflows/*`. It does **not** shellcheck the
`run:` steps of a composite action's `action.yml`, the main product of every
`-action` repo. That needs a separate extractor, tracked in
[#126](https://github.com/rmartz/repo-hygiene/issues/126); this check doesn't
pretend to cover it.

## Why opt-in

It downloads a ~2 MB release archive on every run, which the default suite's
offline, tree-only cost model excludes (see the
[distribution contract](../distribution-contract.md)). Only a repo that ships
workflows worth linting names it in its `checks` input.
