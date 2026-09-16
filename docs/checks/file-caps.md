---
type: Library
title: The file-caps check
description: Enforces per-glob line and byte size caps with a grandfathered migration baseline; opt-in.
resource: src/checks/file-caps.ts
tags: [hygiene, ci, checks, size]
---

# `file-caps`

**Default:** opt-in · **Config:** `overrides` (plus the `.repo-hygiene-baseline.json` state file)

Per-glob file size caps with a migration ramp. Each file takes the **first
matching** `overrides` entry (most-specific first, first-match-wins — no merge) and
is measured on two independent metrics, `lines` and `bytes`, each with its own
optional `warn` and `error` tier.

## What it flags

- **over `warn`** → a `warn` finding (advisory).
- **over `error`** → an `error` finding (enforced, drives exit 1) — unless the file
  is grandfathered at or above its current size in the baseline, in which case it
  is downgraded to `warn`.

Annotations are **file-level, not line-level**, by design: the finding is that the
_file_ is over budget, not that any single line is. Under GitHub Actions (the
`github` report format, auto-enabled there) each over-threshold file gets a
`::warning` at the warn tier (an advisory split recommendation) and a `::error` at
the hard cap (enforced), rendered on the PR.

## Config

```yaml
checks:
  file-caps:
    overrides:
      - glob: 'src/**/*.ts'
        lines: { warn: 350, error: 500 }
        bytes: { warn: 16KB, error: 24KB } # raw integer or a size string (KB/MB/GB, binary)
      - glob: 'docs/**/*.md'
        lines: { warn: 500, error: 700 }
```

With no `overrides` the check returns `[]` immediately — the no-op-until-opted-in
shape that keeps it safe to ship.

## The baseline ramp (`--update-baseline`)

`file-caps` is the one check with committed migration state,
`.repo-hygiene-baseline.json`. On adoption, every file already over its hard cap is
grandfathered at its current size and reported as a `warn` instead of blocking;
thereafter the baseline **only shrinks** — a file that gets smaller ratchets its
ceiling down, one that drops under the cap is removed, and one that grows past its
recorded ceiling loses the grandfather and hard-errors. Each metric is tracked
independently.

Regenerate the baseline with the CLI rather than editing the JSON by hand:

```bash
ai-repo-hygiene --update-baseline --check --config .repo-hygiene.yml
```

With no baseline file present this is first-time **adoption** (grandfather
everything currently over cap); with one present it **ratchets** the existing
baseline down. A ratchet never _adds_ an entry — the grandfather list can only lose
entries — so the ramp always tightens toward the caps. Commit the regenerated
`.repo-hygiene-baseline.json` alongside the change that shifts file sizes.
