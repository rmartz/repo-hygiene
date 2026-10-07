# Checks

The checks `@rmartz/repo-hygiene` ships, each an independent module in the
registry. **Every check is default-on**: it runs with no configuration, at
`error` severity, with recommended settings. A repo loosens one (`severity:
warn`, a laxer option, or `enabled: false`) only as an exception with a written
`reason`. See the [distribution contract](../distribution-contract.md#exceptions)
for how exceptions work, the [overview](../overview.md) for how to run the
checks, and [authoring a check](../authoring-a-check.md) to add one.

| Check                                     | Default | Flags                                                                   |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------- |
| [`conflict-markers`](conflict-markers.md) | on      | Leftover Git merge-conflict markers.                                    |
| [`action-pins`](action-pins.md)           | on      | GitHub Actions `uses:` refs not SHA-pinned with a full-semver comment.  |
| [`docs-links`](docs-links.md)             | on      | Intra-repo Markdown links whose target file or `#anchor` is gone.       |
| [`file-caps`](file-caps.md)               | on      | Files exceeding per-glob line/byte caps (error-only shared defaults).   |
| [`okf`](okf.md)                           | on      | OKF frontmatter (type/title/description/resource) violations.           |
| [`okf-index`](okf-index.md)               | on      | OKF bundle navigability + no-frontmatter-on-index.                      |
| [`md-pairing`](md-pairing.md)             | on      | `CLAUDE.md`/`AGENTS.md` not paired, or `CLAUDE.md` not a bare wrapper.  |
| [`package-pins`](package-pins.md)         | on      | `package.json` deps not pinned to a full `major.minor.patch`.           |
| [`action-pin-tags`](action-pin-tags.md)   | on      | Pin comments naming no upstream tag, or a tag at another SHA (network). |

`md-links` and `okf-fields` are **shared modules** (inline-link parsing and OKF
optional-field validation) consumed by the checks above, not separately registered
checks — so they have no default status of their own.
