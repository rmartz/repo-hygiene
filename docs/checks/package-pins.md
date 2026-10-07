---
type: Library
title: The package-pins check
description: Flags package.json dependencies not pinned to a full major.minor.patch base; default-on and config-free.
resource: src/checks/package-pins.ts
tags: [hygiene, ci, checks, dependencies]
---

# `package-pins`

**Default:** on · **Config:** none · **Exceptions** (explain each in a comment): `severity: warn`, `enabled: false`

The npm analog of [`action-pins`](action-pins.md): every registry dependency in a
`package.json` must be pinned to a full `major.minor.patch` base, keeping the
`^`/`~` range operator (`^3.8.3`, `~1.2.0`). An abbreviated pin like `^3` or `^3.8`
lets Dependabot upgrade the dependency through a `pnpm-lock.yaml`-only change with
no `package.json` diff, hiding the bump from review.

## What it flags

Every `package.json` in scope is scanned; for each entry under `dependencies` and
`devDependencies`, a range whose base is not full semver is reported (`^3`, `^3.8`,
`*`, `latest`, `>=1.2.3`, `1.2.x`, …). A `package.json` that fails to parse is
reported as a single finding.

**Not pinned here:** non-registry specifiers that carry a protocol or path —
`workspace:`, `catalog:`, `npm:`, `link:`, `file:`, git/URL, and `owner/repo`
shorthand.

## Why default-on

Abbreviated ranges hide Dependabot bumps from review in every npm repo, so the
rule is fleet-wide. The check needs no config, and a repo with no `package.json`
yields no findings. A repo that deliberately uses abbreviated ranges takes an
exception with `enabled: false` and a comment saying why (see the
[distribution contract](../distribution-contract.md#exceptions)).
