---
type: Library
title: The okf check
description: Validates Open Knowledge Format frontmatter (type vocabulary, title, description, resource existence) on docs pages; default-on at warn severity.
resource: src/checks/okf.ts
tags: [hygiene, ci, checks, docs, okf]
---

# `okf`

**Default:** on (warn) · **Config:** `types`, `roots`, `exempt`, `resourceExemptTypes` · **Opt out:** `enabled: false`

Default-on at `warn` severity: it surfaces missing/invalid frontmatter on every
consumer without failing a repo that has `docs/` but has not adopted OKF. Enforce
it with `severity: error` once your docs conform, or turn it off with
`enabled: false`.

Open Knowledge Format frontmatter conformance for docs pages. Every docs page
except the reserved files must carry a non-empty `type` plus a `title` and
`description`; a non-exempt type must name a `resource` that exists on disk. See
[the OKF format](../okf-format.md) for how this repo applies OKF.

The OKF spec makes `type` the **only** always-required key and leaves its
vocabulary open to the producer. Accordingly the check supports both a closed
enum and the spec's open vocabulary (see `types` below), and treats `resource` as
optional (waivable per type, or wholesale).

## What it flags

For each in-scope `docs/**/*.md` page:

- `type` missing/empty, or — under a closed vocabulary — outside the configured
  list.
- missing `title` or `description`.
- a non-`resourceExempt` type whose `resource` is missing or does not exist on
  disk.
- an OKF optional lifecycle/trust/provenance field with an invalid value (e.g. a
  `status` outside `draft|stable|deprecated`, or a non-ISO-8601 timestamp).

## Reserved filenames

OKF reserves `index.md` (navigation) and `log.md` (update history) and forbids
them as concept documents, so `okf` **skips them automatically wherever they
appear** — no `exempt` entry needed. (`okf-index` owns the `index.md`
no-frontmatter rule.) Use `exempt` only for other pages you want skipped entirely.

## Config

```yaml
checks:
  okf:
    types: [Skill, Script, Library, Design, Reference] # or "*" for any non-empty type
    roots: [docs]
    exempt: [] # extra pages skipped entirely (index.md/log.md are automatic)
    resourceExemptTypes: [Design, Reference] # types needing no resource — or "*" for none
```

**Open vocabulary.** Set `types: "*"` to accept any non-empty `type` — the spec's
open, producer-defined vocabulary — instead of a closed enum. A knowledge hub that
also keeps no per-page resources can pair it with `resourceExemptTypes: "*"` to
waive the `resource` requirement across the board while still requiring `type`,
`title`, and `description`.
