# @rmartz/repo-hygiene

A suite of low-cost CI checks (conflict markers, GitHub Actions SHA pins,
Markdown link integrity, docs frontmatter, file-size caps, and more), packaged so
that:

1. **Updates propagate automatically.** Consuming repos pin one GitHub Action,
   [`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action),
   by version; Dependabot's `github-actions` ecosystem opens PRs to bump that pin
   on its normal schedule.
2. **Adding a check is low-friction for consumers.** New checks ship inside this
   CLI; the Action picks up each release automatically, and consumers pick it up
   on the next Dependabot bump with no per-repo YAML edits.

## Using it in a consuming repo

Check out the repository, then run the Action as a step:

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
  statuses: write # optional: one commit status per check
jobs:
  hygiene:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<sha> # vX.Y.Z
      - uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z
```

and a Dependabot entry so the pin stays current:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

Both files are seeded once by [`@rmartz/bootstrap`](https://github.com/rmartz/ai-tools)
(`ai-ensure-project-config`); after that Dependabot maintains the pin. The
`@rmartz/repo-hygiene` package is public on npmjs, so the install needs no token,
`packages: read` permission, or consumer PAT.

> For the full walkthrough — per-check configuration, the `file-caps` baseline,
> and how to verify your setup — see the
> [consumer setup & configuration guide](docs/consuming.md). The Action's inputs
> are documented in its
> [README](https://github.com/rmartz/repo-hygiene-action#inputs).

### Choosing checks

**Omit the `checks` input** and the Action runs every check — and a newly-added
check auto-joins on your next Dependabot bump with no edit here. Every check runs
at its recommended settings and enforces at `error`. A repo that needs laxer rules
takes an exception per check in its `.repo-hygiene.yml` — `severity: warn`, a
laxer option, or `enabled: false`, **plus a `reason`** saying why — rather than
trimming the list:

```yaml
checks:
  action-pin-tags:
    enabled: false
    reason: CI runs on an air-gapped runner with no route to github.com.
```

Per-check configuration lives in the consuming repo's `.repo-hygiene.yml` — see
the [consumer guide](docs/consuming.md) for the full reference.

## Checks

`conflict-markers`, `action-pins`, `action-pin-tags`, `package-pins`, `docs-links`, `md-links`,
`md-pairing`, `okf` (+ `okf-fields`, `okf-index`), `file-caps` — see
[docs/checks/](docs/checks/index.md).

## Requirements

- Node.js >= 20.11
- pnpm 9 (pinned via `packageManager`)

Consuming repos need neither — the Action runs the published CLI on a
GitHub-hosted runner.

## Local development

```bash
pnpm install
pnpm run build        # tsup → dist (ESM + d.ts)
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test         # vitest

# Run the checks against this repo:
node dist/bin/repo-hygiene.js --check
```

The CLI (`repo-hygiene`) supports `--staged` (pre-commit), `--check` (all
tracked files), and `--check-diff` (files changed vs `origin/main`); pass check
names to restrict the run, `--config <path>` to point at a config, and
`--update-baseline` to refresh the committed `file-caps` baseline (legacy
`mode: baseline`).

## Releases

Versioned by [semantic-release](.releaserc.json). Every push to `main` with a
releasable conventional commit (`feat`/`fix`/…) publishes the `@rmartz/repo-hygiene`
CLI to npmjs (public, via OIDC trusted publishing with provenance), tags
`v<version>`, and cuts a GitHub Release — no release PR and no npm token. Versions
up to 7.0.1 were published to GitHub Packages and stay there for existing pins;
new versions go to npmjs only. Releases run through the fleet's shared
[semantic-release-ci](https://github.com/rmartz/semantic-release-ci) workflows,
whose required `release-check / release-check` check renders the release notes
with the shared toolchain on every PR, so a broken release setup is caught before
merge rather than on the post-merge release run. Consumers get each release
through [`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action),
which pins this CLI and re-releases itself when Dependabot bumps it (see
[#45](https://github.com/rmartz/repo-hygiene/issues/45)). The reusable workflow
this repo used to ship (`.github/workflows/hygiene.yml`) has been removed; existing
SHA pins to it still resolve but run a frozen CLI 3.0.0.

---

🤖 Created by Claude Opus 4.8
