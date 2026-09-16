# Checks

The checks `@rmartz/repo-hygiene` ships, each an independent module in the
registry. **Default-on** checks run with no configuration; **opt-in** checks ship
in the package but stay dormant until a repo names them in its caller's `checks`
input (and adds any config). See the
[distribution contract](../distribution-contract.md) for why each check is
default-on or opt-in, the [overview](../overview.md) for how to run them, and
[authoring a check](../authoring-a-check.md) to add one.

| Check                                     | Default | Flags                                                                  |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------- |
| [`conflict-markers`](conflict-markers.md) | on      | Leftover Git merge-conflict markers.                                   |
| [`action-pins`](action-pins.md)           | on      | GitHub Actions `uses:` refs not SHA-pinned with a full-semver comment. |
| [`package-pins`](package-pins.md)         | opt-in  | `package.json` deps not pinned to a full `major.minor.patch`.          |
| [`docs-links`](docs-links.md)             | opt-in  | Intra-repo Markdown links whose target no longer exists.               |
| [`md-pairing`](md-pairing.md)             | opt-in  | `CLAUDE.md`/`AGENTS.md` not paired as regular files.                   |
| [`okf`](okf.md)                           | opt-in  | OKF frontmatter (type/title/description/resource) violations.          |
| [`okf-index`](okf-index.md)               | opt-in  | OKF bundle navigability + no-frontmatter-on-index.                     |
| [`file-caps`](file-caps.md)               | opt-in  | Files exceeding per-glob line/byte caps.                               |

`md-links` and `okf-fields` are **shared modules** (inline-link parsing and OKF
optional-field validation) consumed by the checks above, not separately registered
checks — so they have no default/opt-in status of their own.
