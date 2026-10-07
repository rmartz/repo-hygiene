---
type: Library
title: The private-repo-refs check
description: 'Opt-in, network-dependent check: on a public repo, flags any reference to a private repo in the same account.'
resource: src/checks/private-repo-refs.ts
tags: [hygiene, ci, checks, security]
---

# `private-repo-refs`

**Default:** opt-in (never default-on) · **Config:** `exclude`, `repository` ·
**Network:** yes

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
reader can't see it either, so the check treats it as private. Any other failure
(a rate limit, 403, 5xx, timeout after 20s, or offline) is transient. It produces
one `inconclusive` finding for that repo, and the run
[exits `3`](../overview.md) when nothing else fails. If the lookup for the repo
under test fails transiently, the whole check is inconclusive.

In GitHub Actions, the default `GITHUB_TOKEN` can only see the repo it runs in.
Every other private repo therefore returns 404 and is flagged, which is the
intended result. A public repo is visible with any token.

## Config

```yaml
checks:
  private-repo-refs:
    exclude: ['docs/history/**'] # extra globs to skip, added to the default
    repository: owner/repo # override the repo under test (rarely needed)
```

- `exclude`: globs of paths to skip. They are **added to** the built-in
  `**/CHANGELOG.md`. A changelog is generated and records history, so it's always
  excluded.
- `repository`: the `owner/repo` to check, for runs outside Actions where the
  `origin` remote doesn't point at it.

## Why opt-in

The check calls the GitHub API once per referenced repo. The default suite is
offline and tree-only (see the
[distribution contract](../distribution-contract.md)), so this check runs only
when a repo names it in its `checks` input. When you first enable it on a repo
that already has references, it lists all of them. Fix them, or temporarily set
`severity: warn` while you work through the list.
