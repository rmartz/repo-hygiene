---
type: Reference
title: The distribution contract
description: Why every repo-hygiene check runs by default at recommended settings, how a repo loosens one as an explained exception, and how network checks stay safe by default.
tags: [hygiene, ci, distribution]
---

# The distribution contract

Consumers run these checks through the
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action)
GitHub Action, pinned by version and bumped by Dependabot (see
[how a check reaches consumers](consumer-path.md)). **Every check runs by
default, at its recommended (best-practice) settings**, enforcing the fleet
convention at `error` with no configuration. A repo that needs laxer rules takes
an **exception**: it loosens the check in its `.repo-hygiene.yml` _and_ says
why (see [exceptions](#exceptions)). The target is that the
reference consumer, `rmartz/firebase-nextjs-template`, runs on pure package
defaults with no custom config.

What a check must not do is fail a consumer with **no way out but a code change**.
Every finding can be relaxed from `.repo-hygiene.yml`, so a consumer whose CI goes
red on a bump can take an exception the same day and fix the backlog on its own
schedule. A change that adds a check or makes a default stricter ships as a
breaking release (`feat!` / `fix!`) whose notes name the exception to take.

## The `defaultOn` flag

Each check declares whether it is **default-on** through the `defaultOn` flag on
its registry entry (`src/types.ts`). The Action's `checks` input
defaults to **empty**, and an empty input runs the registry-derived default-on
set — so the default is _computed_ from the flags, never hardcoded in the YAML, and
a newly-added default-on check auto-joins every consumer on the next Dependabot
bump with no edit there. **Every built-in check sets `defaultOn: true`**; the flag
stays in the contract so a third-party registry can still ship an opt-in check.

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
of the built-in checks do. A new check that can't enforce safely by default needs
better defaults, not a softer tier or an opt-in flag.

## Exceptions

A consumer loosens a check in that check's `.repo-hygiene.yml` section, and by
convention explains why in a YAML comment beside the setting, or in the commit
message that introduces it. That keeps every relaxation reviewable in the diff
that adds it, and readable later where it lives. The tool doesn't enforce this;
review does. Tightening a check, or restating a default, needs no explanation.

```yaml
checks:
  docs-links:
    # Exception: our docs site generates these pages and rewrites heading slugs.
    anchors: false
```

What counts as loosening:

- **`severity: warn`**: report the check's findings without failing CI. This is
  the migration ramp while a backlog is worked off.
- **`enabled: false`**: the runner skips the check entirely, for a check a repo
  genuinely can't satisfy. It doesn't require re-listing the whole `checks` input,
  which would forfeit auto-join of future checks.
- **A laxer option**: `exempt` / `anchors: false` / `anchorExempt`
  (`docs-links`), `wrapper: false` (`md-pairing`), `types: "*"` / `exempt` / a
  `resourceExemptTypes` beyond the defaults (`okf`), `nestedIndexes: false`
  (`okf-index`), a laxer override or a `mode` other than `strict` (`file-caps`),
  `tagPinOwners` naming owners beyond the repo's own (`action-pins`),
  `shellcheck: false` / `shellcheckSeverity: error` / `ignore` (`actionlint`).
  Each check's page lists its own.

Configuration that only adapts a check to the repo's layout (`roots`,
`indexName`, a named `types` vocabulary, a custom `wrapper` file) is not an
exception.

## Network-dependent checks fail safe

Most checks are tree-only: `git ls-files` and file reads, with no history and no
network. A check that needs the network, such as
[`action-pin-tags`](checks/action-pin-tags.md), still runs by default, so it must
never fail on a network it can't reach: a transient network error makes the run
inconclusive (exit `3`), and an upstream that is definitively unreadable is a
`warn`-and-skip. Keep the network check separate from the offline check it
extends, rather than adding a network flag to that check, so the offline check
stays honest about its scope and a repo can take an exception for one without the
other.

[`action-pins`](checks/action-pins.md) is the one check that stays offline for
SHA pins yet looks up a release through the GitHub API, and only for an exact-tag
pin by an allowlisted first-party owner. Without the lookup, that ref would fail
anyway. The lookup can only turn such a ref from failing to passing, after it
confirms the release is immutable, so it never adds a failure to an unconfigured
consumer. A repo that SHA-pins everything never touches the network. The
verification lives in `action-pins` itself, not in a separate network check,
because accepting the tag offline would let a mutable release through.
