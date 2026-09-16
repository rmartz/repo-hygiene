---
type: Reference
title: How a check reaches consumers
description: The release-to-pickup path by which a new repo-hygiene check reaches consuming repos with no per-repo change.
tags: [hygiene, ci, releases, dependabot]
---

# How a check reaches consumers

A newly-added check does **not** require any per-repo change to start running:

1. **Merge → release.** release-please opens a release PR; merging it publishes a
   new `@rmartz/repo-hygiene` version to GitHub Packages and, via the `extra-files`
   hook in `release-please-config.json`, bumps the `version` default inside
   `.github/workflows/hygiene.yml` in lockstep — so a given pinned ref installs a
   reproducible package version.
2. **Dependabot bump.** Each consumer pins the reusable workflow by SHA
   (`uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z`) and
   runs Dependabot's `github-actions` ecosystem. Dependabot opens a PR bumping that
   pin to the new release on its normal schedule.
3. **Pick-up.** Merging the Dependabot PR moves the consumer onto the new package
   version. A new **default-on** check now runs automatically — the consumer's
   empty `checks` input resolves to the registry's default-on set, so the check
   auto-joins with no edit to their caller. An **opt-in** check ships in the
   package but stays dormant until the repo adds it to its caller's `checks` input
   and a `.repo-hygiene.yml` section.

This is why default-safety is non-negotiable (see
[the distribution contract](distribution-contract.md)): step 3 gives the consumer
no opportunity to adjust configuration before the new check runs.
