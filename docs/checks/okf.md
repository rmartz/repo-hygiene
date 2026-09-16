---
type: Library
title: The okf check
description: Validates Open Knowledge Format frontmatter (type vocabulary, title, description, resource existence) on docs pages; opt-in.
resource: src/checks/okf.ts
tags: [hygiene, ci, checks, docs, okf]
---

# `okf`

**Default:** opt-in · **Config:** `types`, `roots`, `exempt`, `resourceExemptTypes`

Open Knowledge Format frontmatter conformance for docs pages. Every docs page
except the configured reserved files must carry a valid `type` from the repo's
vocabulary plus a `title` and `description`; a non-exempt type must name a
`resource` that exists on disk. See [the OKF format](../okf-format.md) for how this
repo applies OKF.

## What it flags

For each in-scope `docs/**/*.md` page:

- `type` missing or outside the configured vocabulary.
- missing `title` or `description`.
- a non-`resourceExempt` type whose `resource` is missing or does not exist on
  disk.
- an OKF optional lifecycle/trust/provenance field with an invalid value (e.g. a
  `status` outside `draft|stable|deprecated`, or a non-ISO-8601 timestamp).

## Config

```yaml
checks:
  okf:
    types: [Skill, Script, Library, Design, Reference]
    roots: [docs]
    exempt: [docs/index.md, docs/checks/index.md] # pages skipped entirely
    resourceExemptTypes: [Design, Reference] # types that need no resource
```

`index.md` pages carry no frontmatter (that is [`okf-index`](okf-index.md)'s rule),
so each directory's `index.md` is listed in `exempt` here — otherwise `okf` would
flag it for a missing `type`.
