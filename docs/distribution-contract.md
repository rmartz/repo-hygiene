---
type: Reference
title: The distribution contract
description: Why a repo-hygiene check must be safe with no config, how the defaultOn flag drives the default-on set, how default severity and the enabled:false opt-out work, and the package-pins call.
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

## Default severity and the opt-out

Being default-on does not mean a check must _block_ every consumer. A check may
declare a `defaultSeverity` of `warn` (`src/types.ts`), so its findings surface
everywhere but exit `0` until a repo opts into enforcement with `severity: error`.
`okf`, `okf-index`, and `md-pairing` ship this way — on by default but advisory,
because a repo that has not adopted OKF or the `CLAUDE.md`/`AGENTS.md` convention
should be nudged, not broken, on arrival. `conflict-markers`, `action-pins`, and
`docs-links` stay at `error` (a leftover marker, an unpinned action, or a broken
link is never intentional).

### `file-caps`: the deliberate on-arrival exception

`file-caps` is the one default-on check whose shared defaults carry an `error`
tier, so it can **hard-fail a consumer's CI on the next bump** — a considered
departure from the nudge-don't-break posture above. A fleet-wide size standard is
only worth having if it actually gates; the defaults are meant to break loudly so a
repo notices and responds, rather than accumulating silent warnings forever. The
break is bounded and self-service: repo `overrides` match **first**, so a consumer
sets a laxer `error` cap for any glob, grandfathers existing over-cap files into the
baseline (`--update-baseline`, which downgrades them to `warn`), or opts out with
`enabled: false` — each a one-line change surfaced by the failing CI run. This is
the intended exception to "must be safe with no config," accepted for `file-caps`
alone; a new check does not get to copy it without the same deliberate decision.

Every default-on check is **opt-out** per repo: set `enabled: false` in its
`.repo-hygiene.yml` section and the runner skips it entirely — the escape hatch for
a check a repo genuinely cannot satisfy, without re-enumerating the whole `checks`
list (which would forfeit auto-join of future default-on checks).

## The `package-pins` call

[`package-pins`](checks/package-pins.md) is the notable case: it is config-free
like [`action-pins`](checks/action-pins.md) (its npm analog) but is **not**
default-on, because promoting it would break consumers whose `package.json` uses
abbreviated ranges — exactly the on-arrival breakage this contract forbids.
Config-free is necessary but not sufficient for default-on; making it a fleet
default is a separate, deliberate decision.
