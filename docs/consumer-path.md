---
type: Reference
title: How a check reaches consumers
description: How a new repo-hygiene check reaches consuming repos, how its results surface in the PR, and why the suite is not path-filtered.
tags: [hygiene, ci, releases, dependabot]
---

# How a check reaches consumers

A newly-added check does **not** require any per-repo change to start running:

1. **Merge → release.** A merged `feat`/`fix` on `main` triggers semantic-release,
   which publishes a new `@rmartz/repo-hygiene` CLI version to npmjs and tags it.
2. **Action re-release.** [`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
   pins the CLI as an npm dependency. Its Dependabot opens a bump PR, bot-automerge
   merges patch/minor bumps, and the Action's own semantic-release cuts a new Action
   version. A **major** CLI bump stops there for a human.
3. **Consumer Dependabot bump.** Each consumer pins the Action by SHA
   (`uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z`) and runs Dependabot's
   `github-actions` ecosystem, which opens a PR bumping that pin to the new Action
   release on its normal schedule.
4. **Pick-up.** Merging the Dependabot PR moves the consumer onto the new package
   version. A new **default-on** check now runs automatically — the consumer's
   empty `checks` input resolves to the registry's default-on set, so the check
   auto-joins with no edit to their caller. An **opt-in** check ships in the
   package but stays dormant until the repo adds it to its caller's `checks` input
   and a `.repo-hygiene.yml` section.

This is why default-safety is non-negotiable (see
[the distribution contract](distribution-contract.md)): step 4 gives the consumer
no opportunity to adjust configuration before the new check runs.

## How results surface in a consumer repo

The Action runs as a step in the consumer's own job and runs every selected check
in one `ai-repo-hygiene … --check` invocation. That job is **one pass/fail
check-run** in the PR checks list, red if any check emits an `error` finding, so it
is safe to require as a single gate. When the calling job grants
`statuses: write`, the Action also posts one commit status per check
(`repo-hygiene / <check>`), so the status list shows _which_ check failed; without
it the Action warns and still reports the overall result. Individual findings
surface too: under GitHub Actions the CLI emits `--format github` annotations
(`::error` / `::warning file=…,line=…`), so each one renders **inline on the PR
diff** at its file and line.

## The suite is not path-filtered

The Action carries no path filtering and no per-check `if:` — an Action step has
no triggers of its own. Two layers:

- **Whether the job runs** is decided by the consumer's caller `on:` triggers, not
  by the Action. Out of the box the caller runs on every PR, so the hygiene job
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
