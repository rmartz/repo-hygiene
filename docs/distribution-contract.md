---
type: Reference
title: The distribution contract
description: Why a repo-hygiene check must be safe with no config, how the defaultOn flag drives the default-on set, and the package-pins call.
tags: [hygiene, ci, distribution]
---

# The distribution contract

Consumers run these checks through the reusable workflow
(`.github/workflows/hygiene.yml`), pinned by version and bumped by Dependabot (see
[how a check reaches consumers](consumer-path.md)). For a **new check to reach
consumers with no per-repo work**, it must be safe to run with no configuration —
either it does something universally correct with sane defaults, or it no-ops until
opted into via `.repo-hygiene.yml`. A check that _requires_ new config to avoid
failing would break every consumer's CI the moment it ships, so that is disallowed.

## The `defaultOn` flag

Each check declares whether it is **default-on** through the `defaultOn` flag on
its registry entry (`src/types.ts`). The reusable workflow's `checks` input
defaults to **empty**, and an empty input runs the registry-derived default-on
set — so the default is _computed_ from the flags, never hardcoded in the YAML, and
a newly-added default-on check auto-joins every consumer on the next Dependabot
bump with no edit there. Opinionated checks leave `defaultOn` unset and are opt-in
per repo (named explicitly in the caller's `checks` input).

## The `package-pins` call

[`package-pins`](checks/package-pins.md) is the notable case: it is config-free
like [`action-pins`](checks/action-pins.md) (its npm analog) but is **not**
default-on, because promoting it would break consumers whose `package.json` uses
abbreviated ranges — exactly the on-arrival breakage this contract forbids.
Config-free is necessary but not sufficient for default-on; making it a fleet
default is a separate, deliberate decision.
