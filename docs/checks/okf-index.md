---
type: Library
title: The okf-index check
description: Validates that an OKF docs bundle is fully navigable via index.md links and that index pages carry no frontmatter; default-on at warn severity.
resource: src/checks/okf-index.ts
tags: [hygiene, ci, checks, docs, okf]
---

# `okf-index`

**Default:** on (warn) · **Config:** `roots`, `indexName`, `nestedIndexes`, `noUpwardLinks`, `noSiblingLinks` · **Opt out:** `enabled: false`

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
- an `index.md` that reaches past its immediate children — linking directly to a
  page one directory down (link that directory's `index.md` instead), or to any
  file more than one directory below. By default an index may only point downward
  to a file in its own directory or to a direct child directory's `index.md`.
  (Suppressed under a flat hierarchy — see `nestedIndexes` below.)
- an `index.md` that carries frontmatter — except a bundle-root `index.md`, which
  may carry only `okf_version` (any other key is flagged) — or a malformed
  frontmatter block.

Navigability is a whole-tree invariant, so the check reads the full tracked set
rather than the mode-scoped file set.

## Link-direction strictness

The three link directions out of an index are configurable, so a repo can choose
how strict it wants the tree. A same-directory file and a direct child
directory's `index.md` are always allowed.

| Direction               | Default | Option                           |
| ----------------------- | ------- | -------------------------------- |
| Downward over-reach     | flagged | `nestedIndexes: false` allows it |
| Upward (ancestor dir)   | allowed | `noUpwardLinks: true` flags it   |
| Sibling (other subtree) | allowed | `noSiblingLinks: true` flags it  |

Setting `nestedIndexes: false` selects a **flat hierarchy**: a single root
`index.md` may link every page directly, at any depth, and intermediate
directories no longer need their own `index.md` (each page is instead linked from
its nearest ancestor index — the root, by default). An index is still required at
each root, and pages must still be reachable.

## Config

```yaml
checks:
  okf-index:
    roots: [docs]
    indexName: index.md # the reserved index filename (default: index.md)
    nestedIndexes: true # false → allow a flat hierarchy (default: true)
    noUpwardLinks: false # true → flag links into an ancestor directory
    noSiblingLinks: false # true → flag links across to another subtree
```
