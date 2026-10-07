---
type: Library
title: The action-pin-tags check
description: 'Default-on, network-dependent companion to action-pins: flags a pin comment that names no upstream tag, or a tag at a different commit than the pinned SHA.'
resource: src/checks/action-pin-tags.ts
tags: [hygiene, ci, checks, supply-chain, dependabot]
---

# `action-pin-tags`

**Default:** on · **Config:** none · **Network:** yes · **Opt out:** `enabled: false` (with a `reason`)

[`action-pins`](action-pins.md) proves a pin's version comment is a well-formed
full semver. It cannot prove the comment names a tag that **exists**. A
well-formed but false comment fails silently in both directions: `action-pins`
stays green, Dependabot never bumps the pin, and nothing reports it. This check
closes that gap by resolving each comment against the upstream's real tags.

## What it flags

For each SHA-pinned external `uses:` line with a `# comment` in
`.github/**/*.yml`, it lists the upstream's tags once with
`git ls-remote --tags https://github.com/<owner>/<repo>.git` and reports:

- **No such tag** (`error`): the comment names no tag upstream. For example,
  `# v1.0.1` on a commit whose only tag is `repo-hygiene-v1.0.1`.
- **Tag at a different commit** (`error`): the tag exists but points at another
  commit, so the comment lies about what the SHA is. An annotated tag is compared
  by the commit it peels to.

A `v`-prefix mismatch is tolerated: `# 1.2.3` resolves against tag `v1.2.3` and
the reverse, matching what `action-pins` accepts. Refs that `action-pins` already
owns are skipped: local (`./…`), self-repository (`$/…`), `docker://`, anything
not pinned to a SHA, and pins with no comment.

## When an upstream can't be listed

An upstream that can't be listed never fails the run, since that says nothing
about the change. The check emits one finding for that upstream and skips its
pins:

- **Definitively unreadable** (`git ls-remote` reports the repository not found,
  an auth failure, or an HTTP 401/404, e.g. private with no token): a `warn`.
- **Anything else** (rate-limited, timed out after 20s, offline, an HTTP 403 or
  5xx, git unable to run): an `inconclusive` finding. With no `error` elsewhere,
  the run [exits `3`](../overview.md), and re-running it is the fix. A 403 counts
  as transient because GitHub also uses it for rate limits.

Upstreams that list cleanly are still verified, so a real mismatch on one pin
still fails the run while another upstream is rate-limited.

For **private upstreams**, provide `GITHUB_TOKEN` (or `GH_TOKEN`) in the
environment. The token is passed to git as an HTTP header through `GIT_CONFIG_*`
env vars, the same mechanism `actions/checkout` uses, so it never appears in
argv. Public upstreams need no token.

## Why a separate check

[`action-pins`](action-pins.md) is tree-only: `git ls-files` plus file reads,
with no history and no network. This check makes one network call per upstream,
so it is a separate check that fails safe (never an `error` on a network it
can't reach), and `action-pins` stays offline and honest about its scope. Both
run by default; a repo that can't reach GitHub takes an exception with
`enabled: false` and a `reason` (see the
[distribution contract](../distribution-contract.md#exceptions)).

## A note on this repo's tags

`@rmartz/repo-hygiene` releases up to 3.0.0 were tagged `repo-hygiene-vX.Y.Z`.
From 3.0.0 onward they are tagged plain `vX.Y.Z`, and 3.0.0 carries both. The old
prefixed tags are **not** aliased to plain ones. A pin to a pre-3.0.0 commit with
a `# vX.Y.Z` comment therefore names no tag and never receives a Dependabot bump.
The comment also can't be corrected in place, because the real tag name isn't
full-semver. Move such a pin to a v3.0.0-or-later commit instead.
