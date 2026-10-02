---
type: Reference
title: The distribution contract
description: Why repo-hygiene checks are strict by default and relaxed per repo, how the defaultOn flag drives the default-on set, the escape hatches a consumer uses, and why network checks stay opt-in.
tags: [hygiene, ci, distribution]
---

# The distribution contract

Consumers run these checks through the
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
GitHub Action, pinned by version and bumped by Dependabot (see
[how a check reaches consumers](consumer-path.md)). The defaults are **strict**: each default-on check enforces the fleet convention
at `error` with no configuration, and a repo that intentionally needs laxer rules
relaxes them in its `.repo-hygiene.yml`. The target is that the reference
consumer, `rmartz/firebase-nextjs-template`, runs on pure package defaults with no
custom config.

What a check must not do is fail a consumer with **no way out but a code change**.
Every default-on finding has a one-line escape hatch in `.repo-hygiene.yml` (see
[escape hatches](#escape-hatches)), so a consumer whose CI goes red on a bump
can relax the rule the same day and fix the backlog on its own schedule. A change
that makes a default stricter ships as a breaking release (`feat!` / `fix!`) whose
notes name the escape hatch.

## The `defaultOn` flag

Each check declares whether it is **default-on** through the `defaultOn` flag on
its registry entry (`src/types.ts`). The Action's `checks` input
defaults to **empty**, and an empty input runs the registry-derived default-on
set — so the default is _computed_ from the flags, never hardcoded in the YAML, and
a newly-added default-on check auto-joins every consumer on the next Dependabot
bump with no edit there. Opinionated checks leave `defaultOn` unset and are opt-in
per repo (named explicitly in the caller's `checks` input).

## Strict by default

Every built-in check reports its findings at `error`. A warning exits `0`, so a
default `warn` tier passes CI silently and only accumulates; the fleet takes the
same zero-soft-tier stance as `eslint --max-warnings 0`. `okf`, `okf-index`, and
`md-pairing` used to ship at `warn` so a repo that had not adopted OKF or the
`CLAUDE.md`/`AGENTS.md` convention was nudged rather than broken; that ramp is now
opt-in per repo instead. The same goes for the stricter option defaults:
`docs-links` validates `#anchors`, `md-pairing` enforces the bare `@AGENTS.md`
wrapper, `package-pins` is default-on, and `file-caps` ships error-only caps
(see [`file-caps`](checks/file-caps.md#shared-defaults)).

A check may still declare a `defaultSeverity` of `warn` (`src/types.ts`), but none
of the built-in checks do. A new check that can't enforce safely by default should
stay opt-in rather than ship at `warn`.

## Escape hatches

A consumer relaxes a default in its `.repo-hygiene.yml` section for that check:

- **`severity: warn`**: report the check's findings without failing CI. This is
  the migration ramp while a backlog is worked off.
- **A laxer option**: e.g. `anchors: false` or `anchorExempt` (`docs-links`),
  `wrapper: false` (`md-pairing`), a custom `types` vocabulary (`okf`), or a laxer
  `error` cap for a glob (`file-caps`, where repo `overrides` match first).
- **`mode: ratchet` / `mode: grandfather`** (`file-caps`): exempt files already
  over cap on the base ref, so adopting a tighter cap needs no commit to existing
  files.
- **`enabled: false`**: the runner skips the check entirely. This is the opt-out
  for a check a repo genuinely can't satisfy. It doesn't require re-listing the
  whole `checks` input, which would forfeit auto-join of future default-on checks.

## Network-dependent checks stay opt-in

The default-on set is tree-only: `git ls-files` and file reads, with no history and
no network. That cost model is part of what makes a check safe on any consumer. A
check that needs the network, such as
[`action-pin-tags`](checks/action-pin-tags.md), resolves tags upstream. It is
therefore never default-on, and it degrades to a `warn`-and-skip when the network
or auth is unavailable rather than failing. Keep the network check separate from
the offline check it extends, rather than adding a network flag to that check,
so the default-on check stays offline and honest about its scope.
