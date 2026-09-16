---
type: Reference
title: How a check reaches consumers
description: How a new repo-hygiene check reaches consuming repos, how its results surface in the PR, and why the suite is not path-filtered.
tags: [hygiene, ci, releases, dependabot]
---

# How a check reaches consumers

A newly-added check does **not** require any per-repo change to start running:

1. **Merge → release.** release-please opens a release PR; merging it publishes a
   new `@rmartz/repo-hygiene` version to GitHub Packages and, via the `extra-files`
   hook in `release-please-config.json`, bumps the `version` default inside
   `.github/workflows/hygiene.yml` in lockstep — so a given pinned ref installs a
   reproducible package version.
2. **Dependabot bump.** Each consumer pins the reusable workflow by SHA
   (`uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z`) and
   runs Dependabot's `github-actions` ecosystem. Dependabot opens a PR bumping that
   pin to the new release on its normal schedule.
3. **Pick-up.** Merging the Dependabot PR moves the consumer onto the new package
   version. A new **default-on** check now runs automatically — the consumer's
   empty `checks` input resolves to the registry's default-on set, so the check
   auto-joins with no edit to their caller. An **opt-in** check ships in the
   package but stays dormant until the repo adds it to its caller's `checks` input
   and a `.repo-hygiene.yml` section.

This is why default-safety is non-negotiable (see
[the distribution contract](distribution-contract.md)): step 3 gives the consumer
no opportunity to adjust configuration before the new check runs.

## How results surface in a consumer repo

The reusable workflow (`.github/workflows/hygiene.yml`) is a **single job**
(`Repo hygiene`) that runs every selected check in one `ai-repo-hygiene … --check`
invocation. So a consumer sees **one bundled pass/fail check-run** in the PR checks
list — not one result per check — and it goes red if any check emits an `error`
finding. Individual findings still surface: under GitHub Actions the CLI emits
`--format github` annotations (`::error` / `::warning file=…,line=…`), so each one
renders **inline on the PR diff** at its file and line. The aggregate status keeps
the checks list clean and makes the job safe to require as a single gate; the price
is that the checks list alone does not say _which_ check failed — you read the
annotations or the job log. Per-check statuses would require the workflow to fan
out (a matrix or per-check jobs), which it deliberately does not.

## The suite is not path-filtered

The reusable workflow carries no `on.paths`, no `detect-changes` job, and no
per-check `if:` — and a `workflow_call` cannot filter by path anyway. Two layers:

- **Whether the job runs** is decided by the consumer's caller `on:` triggers, not
  by this workflow. Out of the box the caller runs on every PR, so the hygiene job
  runs on every PR regardless of which files changed.
- **What it scans** is `--check` mode — the full tracked set, every run. So the OKF
  checks execute on every run even when no `.md` changed; they simply self-scope by
  file type internally ([`okf`](checks/okf.md) / [`docs-links`](checks/docs-links.md)
  only look at `docs/**`, [`action-pins`](checks/action-pins.md) only at
  `.github/**` YAML), so an unrelated PR just yields no findings.

This is deliberate. Whole-tree checks like [`okf-index`](checks/okf-index.md) and
[`md-pairing`](checks/md-pairing.md) are structural invariants that cannot be judged
from a changed subset (you cannot tell a directive pair is complete by looking only
at the changed file), so diff-scoping them would be unsound. And a **required**
check must never be gated by `on.paths`: a required check that a path filter skips
never reports, and the PR hangs waiting for it forever. A single always-runs job
that self-scopes internally sidesteps both problems. A consumer that still wants
path-triggered runs sets `on: pull_request: paths:` in its own caller — but must
then keep the job out of required status checks (or add a `detect-changes` shim that
always reports) to avoid the hang.
