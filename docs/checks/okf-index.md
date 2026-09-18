---
type: Library
title: The okf-index check
description: Validates that an OKF docs bundle is fully navigable via index.md links and that index pages carry no frontmatter; default-on at warn severity.
resource: src/checks/okf-index.ts
tags: [hygiene, ci, checks, docs, okf]
---

# `okf-index`

**Default:** on (warn) · **Config:** `roots`, `indexName` · **Opt out:** `enabled: false`

Default-on at `warn` severity (like [`okf`](okf.md)): navigability findings surface
everywhere without failing a repo whose `docs/` is not yet an OKF bundle. Enforce
with `severity: error`, or turn it off with `enabled: false`.

The docs-bundle navigability invariant that [`okf`](okf.md) (frontmatter) does not
cover. Every content page must be reachable from a root `index.md` by following
links.

## What it flags

- a directory that holds any `.md` but has no `index.md`.
- a content page not linked from its directory's `index.md`.
- a documented sub-directory whose `index.md` is not linked from its parent's.
- an `index.md` that carries frontmatter — except a bundle-root `index.md`, which
  may carry only `okf_version` (any other key is flagged) — or a malformed
  frontmatter block.

Navigability is a whole-tree invariant, so the check reads the full tracked set
rather than the mode-scoped file set.

## Config

```yaml
checks:
  okf-index:
    roots: [docs]
    indexName: index.md # the reserved index filename (default: index.md)
```
