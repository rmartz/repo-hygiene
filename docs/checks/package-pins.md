---
type: Library
title: The package-pins check
description: Flags package.json dependencies not pinned to a full major.minor.patch base; config-free but opt-in.
resource: src/checks/package-pins.ts
tags: [hygiene, ci, checks, dependencies]
---

# `package-pins`

**Default:** opt-in · **Config:** none

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

## Why opt-in (not default-on)

`package-pins` is config-free, like `action-pins` — but it is **not** default-on,
because promoting it would break every consumer whose `package.json` uses
abbreviated ranges, exactly the on-arrival breakage the
[distribution contract](../distribution-contract.md) forbids. Config-free is
necessary but not sufficient for default-on; making this a fleet default is a
separate, deliberate decision. A repo opts in by naming `package-pins` in its
caller's `checks` input.
