---
type: Library
title: The conflict-markers check
description: Flags leftover Git merge-conflict markers in tracked or staged files; default-on and config-free.
resource: src/checks/conflict-markers.ts
tags: [hygiene, ci, checks, git]
---

# `conflict-markers`

**Default:** on · **Config:** none

Flags leftover Git merge-conflict markers in tracked (or staged) content. A
botched conflict resolution can leave markers behind, and nothing else stops them
being committed and pushed — so this is the commit-time guard (the `pre-commit`
hook) plus a CI backstop.

## What it flags

Detection is **full-triple** with no doc special-casing. A file is flagged only
when it contains an unambiguous conflict **angle** marker — a line beginning with
seven `<` or seven `>` (`<<<<<<< HEAD`, `>>>>>>> branch`), which never occur in
normal source or Markdown. The separator line (seven `=`) and the diff3 base line
(seven `|`) are reported too, but **only** in a file that already has an angle
marker — so a Markdown setext underline or a `=======` divider is never a false
positive.

## Why default-on

A leftover conflict marker is never intentional, so the check is universally
correct with no configuration and cannot spuriously break a consumer — it joins
the [default-on set](../distribution-contract.md).

## Bypass

In `--staged` mode (the pre-commit hook), setting `ALLOW_CONFLICT_MARKERS` in the
environment skips the check for that commit — the standalone checker's intentional
escape hatch. The CI backstop (`--check`) has no bypass.

## Related

The pure detector lives in `src/check-conflict-markers.ts` and is also exposed
through the standalone `ai-check-conflict-markers` CLI; this check is the thin
framework adapter over it.
