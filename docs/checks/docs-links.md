---
type: Library
title: The docs-links check
description: Flags intra-repo Markdown links in docs pages whose target file — or, optionally, whose #anchor — does not exist; opt-in.
resource: src/checks/docs-links.ts
tags: [hygiene, ci, checks, docs]
---

# `docs-links`

**Default:** opt-in · **Config:** `roots`, `exempt`, `anchors`, `anchorExempt`

Intra-repo Markdown link integrity: every relative Markdown link in a docs page
must resolve to a file that exists, and — when `anchors` is enabled — its
`#anchor` fragment must point at a real section in the target page. When a docs
page, a source file, or a heading is renamed, moved, or deleted, such a link
silently rots — it still parses, but a reader hits a 404 or lands nowhere.
[`okf`](okf.md) validates only a page's `resource:` frontmatter and
[`okf-index`](okf-index.md) only that pages are _reachable_ from an index;
neither checks the inline body links.

## What it flags

- **Broken file targets (always):** every intra-repo link target — relative
  Markdown links between docs pages and links from `docs/**` into source — whose
  file part no longer exists on disk.
- **Broken anchors (opt-in, `anchors: true`):** a link whose file resolves but
  whose `#anchor` matches no heading or explicit anchor in the target. Covers
  both **same-document** (`#section`) and **cross-document**
  (`other.md#section`) links to Markdown files.

**Out of scope (never fetched or flagged):** external `http(s)`/`mailto` links
and absolute paths (the check is static and filesystem-only — hermetic by
construction, no network); anchors into **non-Markdown** targets; and GitHub
source line ranges (`#L10`, `#L10-L20`).

### How anchors are computed

An anchor matches the target page's **GitHub-generated heading slugs** (ATX and
Setext headings, with `-1`/`-2` disambiguation for duplicates, and code fences
skipped so a `#` inside a fenced block is not a heading) plus explicit HTML
`id` / `name` attributes. Slug generation mirrors GitHub's slugger for the common
cases: it lowercases, reduces inline links/code/HTML to their rendered text, and
strips punctuation and emoji.

**Parity boundaries** (rare; use `anchorExempt` if one bites): emphasis-marker
underscores (`_word_` renders as `word` on GitHub but keeps the underscores
here), and the non-GitHub `{#custom-id}` heading syntax (not recognized, matching
GitHub). Anchor comparison is case-insensitive.

## Config

```yaml
checks:
  docs-links:
    roots: [docs] # directories whose .md pages are scanned (default: [docs])
    exempt: [] # resolved target file paths allowed to dangle (intentionally missing)
    anchors: false # validate #anchor fragments (default: false — opt-in)
    anchorExempt: [] # anchors allowed to dangle: "target.md#id", "#id", or the raw href
```

`anchors` is **off by default** even when the check is enabled: slug parity is
best-effort, so anchor validation is opt-in to keep a first adoption of
`docs-links` from failing on a parity edge case. Turn it on once file-target
integrity is green.
