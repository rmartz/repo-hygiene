---
type: Library
title: The action-pins check
description: 'Flags GitHub Actions `uses:` refs not pinned to a full commit SHA with a full-semver version comment, except exact-tag pins on immutable first-party releases; default-on.'
resource: src/checks/action-pins.ts
tags: [hygiene, ci, checks, security, supply-chain]
---

# `action-pins`

**Default:** on · **Config:** optional `tagPinOwners` · **Network:** only for first-party tag pins

A security check: every external GitHub Action referenced under `.github/` must be
pinned to a full 40-character commit SHA with a full-semver version comment. A tag
can be force-moved by a compromised upstream to run code with your token; a commit
SHA is immutable. The one exception is an exact `vX.Y.Z` tag on an
[immutable first-party release](#first-party-tag-pins-on-immutable-releases).

## What it flags

For each `uses:` line in `.github/**/*.yml`:

- **Unpinned** — no `@ref` at all.
- **Not SHA-pinned** — the ref after `@` is a tag or branch, not a 40-char SHA
  (unless it is an accepted first-party tag pin, below).
- **Partial version comment** — SHA-pinned but the `# comment` is missing or is not
  a full `major.minor.patch` (e.g. `# v7` or `# v6.4`). Dependabot's
  `github-actions` ecosystem is unreliable at bumping a pin whose comment is a
  partial version, so all three components are required.

Full-semver format is **necessary but not sufficient**. This check validates only
the comment's shape, never that the tag exists upstream. `# v1.0.1` passes even
when the only tag at that commit is `repo-hygiene-v1.0.1`, and Dependabot then
silently never bumps the pin. Resolving the comment needs a network call, so that
verification lives in the separate opt-in
[`action-pin-tags`](action-pin-tags.md) check, and this one stays offline for SHA pins.

The conforming shape:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

**Exemptions:** local composite/action refs (`./…`, `../…`) move with the repo
commit and are never flagged, and so do self-repository refs (`$/…`), which GitHub
resolves to this repository at the exact commit already running — immutable by
construction and needing no checkout. `$/` is the only form that resolves correctly
inside a reusable workflow called from another repository, where `./` would resolve
against the _caller's_ workspace instead; a wrapper workflow therefore uses it to
reference its own repo's action without carrying a second pin to keep in sync. A
`docker://` image reference is pinned by an `@sha256:<digest>` (a mutable `:tag` is
not a pin).

## First-party tag pins on immutable releases

Dependabot raises no security alerts for actions pinned by commit SHA, so a repo
that SHA-pins everything never hears about an advisory on its own actions. A
release published with GitHub's
[immutable releases](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)
turned on can't have its tag moved, deleted or reused. An exact tag pin on such a
release is about as safe as a SHA pin, and it keeps Dependabot security updates
working. So for an **allowlisted owner** the check also accepts:

```yaml
- uses: rmartz/bot-automerge-action@v1.4.2
```

The rules:

- **Owner allowlist.** `tagPinOwners` under `checks.action-pins` in
  `.repo-hygiene.yml` lists the eligible owners (compared case-insensitively).
  It defaults to the repository's own owner, read from `GITHUB_REPOSITORY_OWNER`
  (or `GITHUB_REPOSITORY`). Outside Actions with no config the list is empty, and
  every tag pin needs a SHA. Set `tagPinOwners: []` to turn the exception off.

  ```yaml
  checks:
    action-pins:
      tagPinOwners: [rmartz, my-org]
  ```

- **Exact tag only.** The ref must match `vX.Y.Z` exactly. A floating tag
  (`@v2`) or a branch (`@main`) is mutable and fails, with a message naming this
  rule.
- **Immutability is confirmed, not assumed.** For each distinct release the check
  calls `GET /repos/<owner>/<repo>/releases/tags/<tag>` and requires
  `immutable: true`. Every failure fails closed:
  - a release without `immutable: true` (for example one published before
    immutability was turned on) is an `error`;
  - no release for the tag (HTTP 404, also what a private repo returns without a
    token) or an auth refusal (HTTP 401) is an `error`;
  - an unreachable API (offline, timed out after 20s, rate-limited, HTTP 403 or
    5xx) is an `inconclusive` finding, so the run
    [exits `3`](../overview.md) and re-running it is the fix.
- **Tokens.** Set `GITHUB_TOKEN` (or `GH_TOKEN`) to authenticate the lookup. It
  is needed for a private upstream, and it avoids the unauthenticated rate limit.
- **SHA pins stay valid.** A first-party ref may still be SHA-pinned with a
  `# vX.Y.Z` comment, so a repo can migrate one pin at a time.
- **Third-party refs stay SHA-pinned.** We can't rely on other publishers having
  turned immutability on.

The lookup is the check's only network call, and it runs only for an exact-tag
pin by an allowlisted owner. A repo that SHA-pins everything stays fully offline.

## Why default-on

SHA-pinning is the security floor the hygiene suite exists to spread; it needs no
config and only inspects `.github/**` workflow YAML, so it is safe on any
consumer. The tag-pin exception only ever accepts more refs than before, and only
after the API confirms the release is immutable, so it can't turn an existing
green run red. Its npm analog [`package-pins`](package-pins.md) is default-on too.
