---
type: Library
title: The md-pairing check
description: Enforces that CLAUDE.md and AGENTS.md travel together as paired regular files, and that each CLAUDE.md is a bare @AGENTS.md wrapper; default-on at error severity.
resource: src/checks/md-pairing.ts
tags: [hygiene, ci, checks, agents]
---

# `md-pairing`

**Default:** on · **Config:** `wrapper` · **Exceptions** (explain each in a comment): `wrapper: false`, `severity: warn`, `enabled: false`

Default-on at `error` severity, bare-wrapper rule included. A repo with legacy
directive files relaxes it with `severity: warn` or `wrapper: false`, or turns it
off with `enabled: false`.

The `CLAUDE.md` / `AGENTS.md` pairing invariant. The two agent-directive files
must travel together: a directory that carries one must carry the other, and each
must be a **regular file**, never a symlink — a symlinked directive file (git index
mode `120000`) is a violation, not a link to follow. Keeping both as real files
means every tool that reads only one of the two names sees the same content.

## What it flags

- A directory with one of the pair but not the other (`AGENTS.md has no paired
CLAUDE.md`, or vice versa).
- A directive file that is a symlink or otherwise not a regular file.
- a `CLAUDE.md` whose only meaningful line isn't the bare import (`@AGENTS.md` by
  default). This is the bare-wrapper convention: directives live in `AGENTS.md`,
  and each `CLAUDE.md` only imports it, so a tool that reads only `AGENTS.md`
  never misses a directive.

Pairing is a whole-tree structural invariant (seeing only a changed subset cannot
tell whether a pair is complete), so the check reads the full tracked set and its
git modes directly rather than the mode-scoped file set.

## Config

```yaml
checks:
  md-pairing:
    wrapper: '@AGENTS.md' # the default (also `true`); a custom import line, or `false` to skip the rule
```
