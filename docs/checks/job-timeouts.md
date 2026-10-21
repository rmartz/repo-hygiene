---
type: Library
title: The job-timeouts check
description: 'Default-on workflow check: every job under jobs: sets an explicit timeout-minutes at or below a cap (default 15), with reusable-workflow callers exempt.'
resource: src/checks/job-timeouts.ts
tags: [hygiene, ci, checks, github-actions]
---

# `job-timeouts`

**Default:** on · **Config:** `maxMinutes`, `allowExpressions`, `ignore` ·
**Network:** no · **Exceptions** (explain each in a comment): a raised
`maxMinutes`, `allowExpressions: true`, `ignore`, `severity: warn`,
`enabled: false`

GitHub's default job timeout is **360 minutes**. A hung step (a stalled
download, a waiting prompt, a deadlocked test) can burn hours of runner time
before anything fails. A tight explicit timeout turns that into a fast, visible
failure. [`actionlint`](actionlint.md) validates `timeout-minutes` when it is
present but never requires it; this check closes that gap.

## What it does

For each `.github/workflows/*.yml` / `*.yaml` file in scope (all of them under
`--check`, only the changed ones under `--check-diff`), it parses the YAML and,
for every job under `jobs:`, reports an `error` when the job:

- has **no** `timeout-minutes` (anchored on the job's key line),
- sets one **above `maxMinutes`** (default 15; a value at the cap passes),
- sets one that **isn't a positive number**, or
- sets an **expression** (`${{ … }}`), which can't be checked statically.

Exempt:

- **Reusable-workflow callers** (jobs with `uses:`). GitHub rejects
  `timeout-minutes` on them, and the called workflow's own jobs carry the
  bound; those are checked wherever that workflow lives.
- **Step-level** `timeout-minutes`, which stays optional. The job-level bound is
  what limits runner time.
- **Composite actions** (`action.yml`), which have no job level. Their steps run
  inside a caller's job, under that job's timeout.

A workflow that doesn't parse, or has no `jobs:` mapping, is left to
`actionlint`.

## Recommended settings

With no config, every job must set a literal `timeout-minutes` of 15 or less.
Lowering `maxMinutes` tightens the check and needs no explanation.

## Exceptions

A repo loosens the check only as an exception, explained in a comment beside
the setting (see [exceptions](../distribution-contract.md#exceptions)).

```yaml
checks:
  job-timeouts:
    # Exception: the e2e suite runs ~25 minutes on a cold cache.
    maxMinutes: 30
    # Exception: the timeout is a workflow_call input, bounded by its callers.
    allowExpressions: true
    # Per-glob job exemptions; `*` exempts every job in the matched files.
    ignore:
      # Exception: the nightly backfill legitimately runs for hours.
      '.github/workflows/nightly.yml': [backfill]
```

The framework's `severity: warn` / `enabled: false` work as for any check. A
malformed key (a non-integer or non-positive `maxMinutes`, a non-boolean
`allowExpressions`, a non-list `ignore` entry) fails the run loudly.
