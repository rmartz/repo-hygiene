---
type: Library
title: The docs-links check
description: Flags intra-repo Markdown links in docs pages whose target file no longer exists; opt-in.
resource: src/checks/docs-links.ts
tags: [hygiene, ci, checks, docs]
---

# `docs-links`

**Default:** opt-in · **Config:** `roots`, `exempt`

Intra-repo Markdown link integrity: every relative `[text](path)` link in a docs
page must resolve to a file that exists. When a docs page or a source file is
renamed, moved, or deleted, such a link silently rots — it still parses, but a
reader hits a 404. [`okf`](okf.md) validates only a page's `resource:` frontmatter
and [`okf-index`](okf-index.md) only that pages are _reachable_ from an index;
neither checks the inline body links.

## What it flags

Every intra-repo link target — relative Markdown links between docs pages and links
from `docs/**` into source — whose file part no longer exists on disk.

**Out of scope (never fetched or flagged):** external `http(s)`/`mailto` links,
pure `#anchor` links, and absolute paths. The check is static and
filesystem-only — hermetic by construction, no network. Only the file part of a
link is resolved; anchor _validity_ is separate.

## Config

```yaml
checks:
  docs-links:
    roots: [docs] # directories whose .md pages are scanned (default: [docs])
    exempt: [] # resolved target paths allowed to dangle (intentionally missing)
```
