# @rmartz/repo-hygiene

A suite of low-cost CI checks (conflict markers, GitHub Actions SHA pins,
Markdown link integrity, docs frontmatter, file-size caps, and more), packaged so
that:

1. **Updates propagate automatically.** Consuming repos pin one reusable workflow
   by version; Dependabot's `github-actions` ecosystem opens PRs to bump that pin
   on its normal schedule.
2. **Adding a check is low-friction for consumers.** New checks ship inside the
   central reusable workflow and package — consumers pick them up on the next
   Dependabot bump with no per-repo YAML edits.

## Using it in a consuming repo

Add one caller workflow (this is what Dependabot keeps current):

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
on: [pull_request, push]
jobs:
  hygiene:
    permissions:
      contents: read
      packages: read
    uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z
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
(`ai-ensure-project-config`); after that Dependabot maintains the pin. The public
`@rmartz/repo-hygiene` package on GitHub Packages is readable with the built-in
`GITHUB_TOKEN`, so no consumer PAT is required.

> For the full walkthrough — per-check configuration, the `file-caps` baseline,
> and how to verify your setup — see the
> [consumer setup & configuration guide](docs/consuming.md).

### Choosing checks

**Omit the `checks` input** and the workflow runs the registry's default-on set
(`conflict-markers`, `action-pins`) — and a newly-added default-on check
auto-joins on your next Dependabot bump with no edit here. To opt into
repo-specific checks, name them explicitly (this becomes the _exact_ run list, so
include the defaults you still want) and point at a config:

```yaml
uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z
with:
  checks: conflict-markers action-pins docs-links okf
  config: .repo-hygiene.yml
```

Per-check configuration lives in the consuming repo's `.repo-hygiene.yml` — see
the [consumer guide](docs/consuming.md) for the full reference.

## Checks

`conflict-markers`, `action-pins`, `package-pins`, `docs-links`, `md-links`,
`md-pairing`, `okf` (+ `okf-fields`, `okf-index`), `file-caps` — see
[docs/checks/](docs/checks/index.md).

## Requirements

- Node.js >= 20.11
- pnpm 9 (pinned via `packageManager`)

Consuming repos need neither — the reusable workflow runs the published CLI on a
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

The CLI (`ai-repo-hygiene`) supports `--staged` (pre-commit), `--check` (all
tracked files), and `--check-diff` (files changed vs `origin/main`); pass check
names to restrict the run, `--config <path>` to point at a config, and
`--update-baseline` to refresh the `file-caps` grandfather list.

## Releases

Versioned by [semantic-release](.releaserc.json). Every push to `main` with a
releasable conventional commit (`feat`/`fix`/…) publishes the `@rmartz/repo-hygiene`
CLI to GitHub Packages (public), tags `v<version>`, and cuts a GitHub Release — no
release PR. A `Release dry-run` CI job validates the semantic-release config (that
the changelog toolchain renders) on every PR, so a broken release setup is caught
before merge rather than on the post-merge release run. The reusable workflow that
installs this CLI is moving to the separate
[`rmartz/repo-hygiene-action`](https://github.com/rmartz/repo-hygiene-action) repo
(see [#45](https://github.com/rmartz/repo-hygiene/issues/45)).

---

🤖 Created by Claude Opus 4.8
