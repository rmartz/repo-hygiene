---
type: Reference
title: Running repo-hygiene
description: What @rmartz/repo-hygiene is, the three file-set modes, the CLI invocation and flags, and per-repo configuration.
tags: [hygiene, ci, overview]
---

# Running repo-hygiene

`@rmartz/repo-hygiene` runs a registry of independent [checks](checks/index.md)
over one of three git-derived file sets, selected by mode:

- `--staged` — staged blobs (the `pre-commit` hook). **Default.**
- `--check` — all tracked files (the CI backstop).
- `--check-diff` — files changed vs `origin/main`.

## Invocation

```bash
repo-hygiene [<check>...] [--all] [--staged|--check|--check-diff] [--config <path>] [--format text|github]
repo-hygiene --update-baseline [--check] [--config <path>]
```

- **No check name** runs the registry's **default-on** set (the universally-safe
  checks — the same set the Action's empty `checks` default resolves to).
- **`--all`** runs every registered check.
- **Naming one or more** checks runs just those, with independent per-check
  statuses (`repo-hygiene okf docs-links --check`).
- **`--format`** is `text` (default; report on stderr) or `github` (workflow-command
  annotations on stdout); omitted, it auto-detects GitHub Actions
  (`GITHUB_ACTIONS=true`).
- **`--update-baseline`** regenerates the committed [`file-caps`](checks/file-caps.md)
  baseline (legacy `mode: baseline`) instead of running checks.

**Exit codes:**

| Code | Meaning                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Clean, or warn-only (the migration-ramp signal).                                                                                                                                            |
| `1`  | **Failure**: an `error` finding, meaning the run detected an issue in the change that needs fixing.                                                                                         |
| `2`  | Usage error: an unknown check or a malformed config.                                                                                                                                        |
| `3`  | **Inconclusive**: no `error`, but a check couldn't reach a verdict because of an external transient error (rate limit, timeout, network). Re-run it; there is nothing to fix in the change. |

A failure outranks an inconclusive result: if one check finds an `error` while
another is inconclusive, the run exits `1`. Under GitHub Actions,
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
reports an exit-`3` run as cancelled rather than failed.

## Configuration

Per-repo settings live in `.repo-hygiene.yml` under `checks.<name>`. The framework
understands two keys in any check's section: `severity`, which the runner applies
uniformly to override every finding that check emits (downgrade a whole check to
`warn` while a backlog is worked off, then flip it back — or set `error` to enforce
a check that is only advisory by default); and `enabled`, which when set to `false`
skips the check entirely — the per-repo opt-out for a default-on check a repo
cannot satisfy. Every other key is the check's own; see each
[check page](checks/index.md) for its vocabulary.

## How the pieces fit

- **[Checks](checks/index.md)** — one page per check: what it flags, its config,
  and whether it is default-on.
- **[The distribution contract](distribution-contract.md)** — default-on vs
  opt-in, and why.
- **[How a check reaches consumers](consumer-path.md)** — release → Dependabot →
  pick-up.
- **[Authoring a check](authoring-a-check.md)** — the `Check` contract, in five
  steps, with a worked example.
- **[The OKF documentation format](okf-format.md)** — how these docs pages are
  structured and validated.
