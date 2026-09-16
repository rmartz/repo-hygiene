# repo-hygiene checks

`@rmartz/repo-hygiene` runs a registry of independent checks over one of three
git-derived file sets, selected by mode:

- `--staged` — staged blobs (the `pre-commit` hook).
- `--check` — all tracked files (the CI backstop).
- `--check-diff` — files changed vs `origin/main`.

Pass check names to restrict a run (`ai-repo-hygiene okf docs-links --check`);
with none, every registered check runs. Per-repo settings live in
`.repo-hygiene.yml` under `checks.<name>`, where `severity` (when set) overrides
a check's findings.

## The distribution contract

Consumers run these checks through the reusable workflow
(`.github/workflows/hygiene.yml`), pinned by version and bumped by Dependabot.
For a **new check to reach consumers with no per-repo work**, it must be safe to
run with no configuration — either it does something universally correct with
sane defaults, or it no-ops until opted into via `.repo-hygiene.yml`. A check
that _requires_ new config to avoid failing would break every consumer's CI the
moment it ships, so that is disallowed. The reusable workflow's default `checks`
input therefore lists only the universally-safe set; opinionated checks are
opt-in per repo.

## Checks

| Check              | What it flags                                                            |
| ------------------ | ------------------------------------------------------------------------ |
| `conflict-markers` | Leftover Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).         |
| `action-pins`      | GitHub Actions `uses:` refs not pinned to a full commit SHA.             |
| `package-pins`     | Dependency specifiers that violate the repo's pinning policy.            |
| `docs-links`       | Broken intra-repo Markdown links among docs pages (`roots`).             |
| `md-links`         | Markdown link integrity more broadly.                                    |
| `md-pairing`       | Directive/doc `.md` pairing rules (symlinked directives are violations). |
| `okf`              | OKF docs-frontmatter vocabulary + exemptions (`types`, `roots`).         |
| `okf-fields`       | Optional-field validation within OKF frontmatter.                        |
| `okf-index`        | The reserved OKF root index listing.                                     |
| `file-caps`        | Files exceeding size caps, with a grandfathered baseline.                |

Configuration keys mirror the ai-tools originals; a fuller authoring guide (how
to add a check to the registry, declare its default-safety, and test it) is
tracked as a follow-up.
