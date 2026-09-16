---
type: Library
title: The okf-index check
description: Validates that an OKF docs bundle is fully navigable via index.md links and that index pages carry no frontmatter; opt-in.
resource: src/checks/okf-index.ts
tags: [hygiene, ci, checks, docs, okf]
---

# `okf-index`

**Default:** opt-in · **Config:** `roots`, `indexName`

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
