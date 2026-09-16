---
type: Library
title: The action-pins check
description: 'Flags GitHub Actions `uses:` refs not pinned to a full commit SHA with a full-semver version comment; default-on and config-free.'
resource: src/checks/action-pins.ts
tags: [hygiene, ci, checks, security, supply-chain]
---

# `action-pins`

**Default:** on · **Config:** none

A security check: every external GitHub Action referenced under `.github/` must be
pinned to a full 40-character commit SHA with a full-semver version comment. A tag
can be force-moved by a compromised upstream to run code with your token; a commit
SHA is immutable.

## What it flags

For each `uses:` line in `.github/**/*.yml`:

- **Unpinned** — no `@ref` at all.
- **Not SHA-pinned** — the ref after `@` is a tag or branch, not a 40-char SHA.
- **Partial version comment** — SHA-pinned but the `# comment` is missing or is not
  a full `major.minor.patch` (e.g. `# v7` or `# v6.4`). Dependabot's
  `github-actions` ecosystem is unreliable at bumping a pin whose comment is a
  partial version, so all three components are required.

The conforming shape:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

**Exemptions:** local composite/action refs (`./…`, `../…`) move with the repo
commit and are never flagged. A `docker://` image reference is pinned by an
`@sha256:<digest>` (a mutable `:tag` is not a pin).

## Why default-on

SHA-pinning is the security floor the hygiene suite exists to spread; it needs no
config and only inspects `.github/**` workflow YAML, so it is safe on any
consumer. Its npm analog [`package-pins`](package-pins.md) is deliberately **not**
default-on — see the [distribution contract](../distribution-contract.md).
