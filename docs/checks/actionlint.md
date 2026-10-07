---
type: Library
title: The actionlint check
description: 'Default-on workflow linter: runs a pinned, checksum-verified actionlint (shellcheck included) over .github/workflows at recommended settings, loosened only as a reasoned exception.'
resource: src/checks/actionlint.ts
tags: [hygiene, ci, checks, github-actions, shellcheck, dependabot]
---

# `actionlint`

**Default:** on · **Config:** `shellcheck`, `shellcheckSeverity`, `ignore` ·
**Network:** yes (downloads actionlint) · **Exceptions** (explain each in a
comment): `shellcheck: false`, `shellcheckSeverity: error`, `ignore`,
`severity: warn`, `enabled: false`

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

## Recommended settings

With no config the check runs at the settings the fleet should hold itself to:

- **shellcheck at `warning` and above.** Warnings and errors are defects; info
  and style notes (SC2086 quoting, SC2129 grouping, SC2016 on deliberate
  single-quoted backticks) are opinion, so they're left out by default. A repo
  can tighten to `info` or `style` with nothing to explain.
- **Known actionlint false positives dropped.** actionlint 1.7.12 doesn't model
  the `job.workflow_ref`, `job.workflow_sha`, `job.workflow_repository`, and
  `job.workflow_file_path` contexts GitHub added for reusable workflows, and
  flags them as undefined. The check drops exactly those four on the `job`
  context (`BUILTIN_IGNORES` in `actionlint-config.ts`), so a real typo such as
  `job.nope` still fails. An entry is removed once the pinned actionlint models
  it.
- **shellcheck must be present.** actionlint silently skips shellcheck when it
  is missing. This check reports that as an `error` instead (and still runs the
  rest of actionlint), so "no shellcheck findings" never means "shellcheck never
  ran". GitHub's `ubuntu-latest` ships shellcheck.

## Exceptions

A repo loosens the check only as an exception, explained in a comment beside
the setting (or in the commit message that adds it; see
[exceptions](../distribution-contract.md#exceptions)).

```yaml
checks:
  actionlint:
    # Per-glob message ignores, mirroring actionlint's own `paths.<glob>.ignore`:
    # each regex is matched against the finding's message, for the workflow
    # files the glob matches. `**` applies repo-wide.
    ignore:
      # Exception: `uses: $/…` is the runner's self-repository syntax, which
      # actionlint 1.7.12 does not parse.
      '.github/workflows/bot-automerge-reusable.yml':
        - 'invalid format because ref is missing'
```

The other exceptions are `shellcheckSeverity: error` (report only shellcheck
errors), `shellcheck: false` (don't shellcheck `run:` blocks, or require
shellcheck), and the framework's `severity: warn` / `enabled: false`. Tightening
(`shellcheckSeverity: info` or `style`) needs no explanation. A malformed key (an
unknown severity, a non-list ignore, an invalid regex) fails the run loudly.

### Fleet baseline (actionlint 1.7.12)

A baseline over every `rmartz` Actions repo found no real bugs. At the
recommended settings all of it clears with no config, except one finding still
to confirm:

| Finding                                                                    | At recommended settings                            |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| `property "workflow_repository"` / `"workflow_sha"` …                      | dropped by the built-in ignore                     |
| SC2016 / SC2086 / SC2129 (info / style)                                    | below the `warning` floor                          |
| `uses: $/…` "invalid format because ref is missing" (bot-automerge-action) | needs confirming; an explained `ignore` until then |

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

## Cost

It downloads a ~2 MB release archive whenever a workflow is in scope, and
nothing otherwise. A download that can't complete (offline, rate-limited, a
stalled body) makes the run inconclusive, never an `error` (see
[network-dependent checks](../distribution-contract.md#network-dependent-checks-fail-safe)).
