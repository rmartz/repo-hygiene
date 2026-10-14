---
type: Library
title: The private-repo-refs check
description: 'Default-on, network-dependent check: on a public repo, flags any reference to a private repo in the same account.'
resource: src/checks/private-repo-refs.ts
tags: [hygiene, ci, checks, security]
---

# `private-repo-refs`

**Default:** on · **Config:** `exclude`, `repository` · **Network:** yes ·
**Exceptions** (explain each in a comment): `exclude`, `severity: warn`,
`enabled: false`

## Why the direction matters

Anyone can read a public repo's docs, code comments, and agent guidance. A
reference from there to a **private** repo in the same account
(`owner/private-repo#123`, `https://github.com/owner/private-repo/...`, or a bare
`owner/private-repo`) causes two problems:

- **It's a dead link.** Public readers get a 404, so the reference gives them
  nothing.
- **It leaks.** The reference exposes the private repo's name, and an `#N` also
  exposes its issue and PR numbers.

So references may only point one way. A private repo may reference anything, and
a public repo may reference only public repos. This check enforces that
direction.

## What it flags

1. It resolves the repo under test from the `repository` setting, then
   `GITHUB_REPOSITORY` (set in GitHub Actions), then the `origin` remote. If none
   of these resolves, it emits one `warn` and skips.
2. It looks up that repo's visibility. On a **private** repo the check does
   nothing.
3. On a **public** repo, it scans every in-scope text file for references to other
   repos with the same owner, matched case-insensitively. That covers Markdown,
   source comments, workflow YAML, and `AGENTS.md` / `CLAUDE.md`. It recognizes
   `owner/repo#N`, `github.com/owner/repo/...` URLs, and bare `owner/repo`.
   Matches that continue a path (`docs/owner/x`), an npm scope (`@owner/pkg`), or
   a longer name (`owner-bot/x`) are not references. Binary files are skipped.
4. It looks up each distinct referenced repo's visibility once. Each reference to
   a private repo is an `error` that names the file, the line, and the referenced
   repo. References to the repo itself are never looked up.

Visibility comes from the GitHub REST API (`GET /repos/{owner}/{repo}`, at
`GITHUB_API_URL` when set). The check sends `GITHUB_TOKEN` (or `GH_TOKEN`) when
present. If the API returns **404**, the token can't see the repo. A public
reader can't see it either, so the check treats it as private.

A **403 or 429** (rate limit) or a **5xx** is retried up to twice. The first
retry waits 1s and the second 3s, unless the server asks for a specific wait
(`Retry-After`, or `x-ratelimit-reset` when the quota is spent). A requested
wait of up to 10s is honored. A longer one isn't worth waiting for, so the check
stops retrying. A failure that persists, and any other failure (another status,
a timeout after 20s, or offline), is transient. It produces one `inconclusive`
finding for that repo, and the run [exits `3`](../overview.md) when nothing else
fails. If the lookup for the repo under test fails transiently, the whole check
is inconclusive. Inconclusive stays visible on purpose: it never turns into a
pass.

### Pass a token

Give the check a token. Without one, every lookup is anonymous. Anonymous calls
share GitHub's limit of 60 requests an hour per IP, and a shared CI runner's IP
has often spent that already, so the lookups come back 403 and the run is
inconclusive. The finding names the missing token when this happens. In GitHub
Actions the workflow token is enough. Steps don't get it by default, so export
it on the step that runs the CLI:

```yaml
- run: npx @rmartz/repo-hygiene --check
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

The token needs only read access (`contents: read`).

In GitHub Actions, the default `GITHUB_TOKEN` can only see the repo it runs in.
Every other private repo therefore returns 404 and is flagged, which is the
intended result. A public repo is visible with any token.

A repo that doesn't exist also returns 404, so a made-up name under your own
account (a test fixture like `owner/x`) is flagged too. Give fixtures a
placeholder owner such as `acme` or `octo` instead.

## Config

```yaml
checks:
  private-repo-refs:
    # Exception: docs/history/ is an archived record we don't rewrite.
    exclude: ['docs/history/**'] # extra globs to skip, added to the default
    repository: owner/repo # override the repo under test (rarely needed)
```

- `exclude` _(exception)_: globs of paths to skip. They are **added to** the
  built-in `**/CHANGELOG.md`. A changelog is generated and records history, so
  it's always excluded.
- `repository`: the `owner/repo` to check, for runs outside Actions where the
  `origin` remote doesn't point at it.

## Why default-on

The check calls the GitHub API once per referenced repo, but it fails safe: a
transient lookup failure is `inconclusive`, never an `error`, and on a private
repo it does nothing. So, like every check, it runs by default (see the
[distribution contract](../distribution-contract.md#exceptions)). On a public
repo that already has references, the first run lists all of them. Fix them, or
take a temporary `severity: warn` exception, with a comment saying why, while you
work through the list. A repo that can't reach the GitHub API takes an exception
with `enabled: false` and a comment saying why.
