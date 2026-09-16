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

### Choosing checks

The reusable workflow runs a universally-safe default set (`conflict-markers`,
`action-pins`). Opt into repo-specific checks — and point at a config — via
inputs:

```yaml
uses: rmartz/repo-hygiene/.github/workflows/hygiene.yml@<sha> # vX.Y.Z
with:
  checks: conflict-markers action-pins docs-links okf
  config: .repo-hygiene.yml
```

Per-check configuration lives in the consuming repo's `.repo-hygiene.yml`.

## Checks

`conflict-markers`, `action-pins`, `package-pins`, `docs-links`, `md-links`,
`md-pairing`, `okf` (+ `okf-fields`, `okf-index`), `file-caps` — see
[docs/repo-hygiene.md](docs/repo-hygiene.md).

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

Versioned by release-please. Merging its release PR tags the release and
publishes the package to GitHub Packages (public); the version installed by the
reusable workflow is bumped in lockstep via release-please `extra-files`.

---

🤖 Created by Claude Opus 4.8
