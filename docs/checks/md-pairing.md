---
type: Library
title: The md-pairing check
description: Enforces that CLAUDE.md and AGENTS.md travel together as paired regular files, optionally with a bare-wrapper CLAUDE.md; default-on at warn severity.
resource: src/checks/md-pairing.ts
tags: [hygiene, ci, checks, agents]
---

# `md-pairing`

**Default:** on (warn) · **Config:** `wrapper` · **Opt out:** `enabled: false`

Default-on at `warn` severity: many repos carry a `CLAUDE.md` without an
`AGENTS.md`, so it nudges toward pairing without failing them on arrival. Enforce
with `severity: error`, or turn it off with `enabled: false`.

The `CLAUDE.md` / `AGENTS.md` pairing invariant. The two agent-directive files
must travel together: a directory that carries one must carry the other, and each
must be a **regular file**, never a symlink — a symlinked directive file (git index
mode `120000`) is a violation, not a link to follow. Keeping both as real files
means every tool that reads only one of the two names sees the same content.

## What it flags

- A directory with one of the pair but not the other (`AGENTS.md has no paired
CLAUDE.md`, or vice versa).
- A directive file that is a symlink or otherwise not a regular file.
- **(when `wrapper` is set)** a `CLAUDE.md` whose only meaningful line is not the
  configured bare import — the bare-wrapper convention: directives live in
  `AGENTS.md`, and each `CLAUDE.md` is a bare wrapper (e.g. `@AGENTS.md`).

Pairing is a whole-tree structural invariant (seeing only a changed subset cannot
tell whether a pair is complete), so the check reads the full tracked set and its
git modes directly rather than the mode-scoped file set.

## Config

```yaml
checks:
  md-pairing:
    wrapper: '@AGENTS.md' # or `true` (→ '@AGENTS.md'); omit or `false` to skip the wrapper rule
```
