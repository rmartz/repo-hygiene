---
type: Library
title: The composite-shellcheck check
description: "Default-on shellcheck of every run: step in a composite action's action.yml, the shell actionlint can't reach, at the actionlint check's recommended settings and exceptions."
resource: src/checks/composite-shellcheck.ts
tags: [hygiene, ci, checks, github-actions, shellcheck]
---

# `composite-shellcheck`

**Default:** on · **Config:** `shellcheckSeverity`, `ignore` · **Network:** no ·
**Exceptions** (explain each in a comment): `shellcheckSeverity: error`,
`ignore`, `severity: warn`, `enabled: false`

[actionlint](actionlint.md) lints only `.github/workflows/*`, so it never sees
a composite action's `action.yml`, the main product of every `-action` repo.
This check shellchecks the `run:` steps actionlint can't reach.

## What it does

For every `action.yml` / `action.yaml` in scope, at any depth, whose
`runs.using` is `composite`, it:

1. Reads each step's `run:` script, through the mode's reader (the staged blob
   under `--staged`).
2. Masks every `${{ … }}` expression with underscores of the same length, as
   actionlint does, so expression syntax isn't read as shell and lines still
   line up.
3. Maps `shell:` to a shellcheck dialect: `bash` → `-s bash`, `sh` → `-s sh`,
   also as the command of a custom shell (`bash -e {0}`). Other shells (`pwsh`,
   `python`, `cmd`, …) are skipped.
4. Writes each script to a temp file and runs `shellcheck -f json1` over them,
   one run per dialect, then deletes the files.

Every shellcheck comment becomes an `error` finding, named for its step
(`name`, else `id`, else `step <n>`) and tagged with its code:

```text
error [composite-shellcheck] action.yml:8: Install: Use 'cd ... || exit' … [SC2164]
```

**Line numbers.** In a literal block (`run: |`) a finding points at its exact
line of `action.yml`. Any other scalar style (`run: echo …`, `run: >-`) joins
or folds lines, so its findings point at the `run:` line.

It also reports, as `error`s, two defects it finds while extracting: a `run:`
step with no `shell:` (GitHub requires one in a composite action), and an
`action.yml` that isn't valid YAML. With no composite action in scope it does
nothing, and doesn't need shellcheck.

## Recommended settings

The same as the [`actionlint` check's](actionlint.md#recommended-settings):

- **shellcheck at `warning` and above.** Info and style notes are opinion, so
  they're left out by default. A repo can tighten to `info` or `style` with
  nothing to explain.
- **shellcheck must be present.** A missing shellcheck is an `error`, never a
  silent pass. GitHub's `ubuntu-latest` ships it.

To silence one line, put a `# shellcheck disable=SC…` directive in the script
itself. The scripts are checked from a temp dir, so a repo's `.shellcheckrc`
does not apply.

## Exceptions

A repo loosens the check only as an exception, explained in a comment beside
the setting (see [exceptions](../distribution-contract.md#exceptions)).

```yaml
checks:
  composite-shellcheck:
    # Per-glob message ignores: each regex is matched against the finding's
    # message (`<step>: <text> [SC<code>]`), for the action.yml files the glob
    # matches. `**` applies repo-wide.
    ignore:
      # Exception: the step sources a file shellcheck can't follow.
      'action.yml':
        - 'SC1091'
```

The other exceptions are `shellcheckSeverity: error` (report only shellcheck
errors) and the framework's `severity: warn` / `enabled: false` (the way out
when shellcheck can't be installed). A malformed key fails the run loudly.

## Cost

One local shellcheck run per dialect in use, only when a composite action is in
scope. No network.
