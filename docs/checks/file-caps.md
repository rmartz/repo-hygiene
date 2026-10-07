---
type: Library
title: The file-caps check
description: Enforces per-glob line and byte size caps, with strict, ratchet (base-branch ceiling), grandfather (base-branch exemption), or legacy baseline (committed file) handling of existing over-cap files; on by default with error-only shared caps.
resource: src/checks/file-caps.ts
tags: [hygiene, ci, checks, size]
---

# `file-caps`

**Default:** on (error-only defaults) · **Config:** `overrides`, `mode`, `base` (+ `.repo-hygiene-baseline.json` in baseline mode) · **Exceptions** (each needs a `reason`): `overrides`, a `mode` other than `strict`, `severity: warn`, `enabled: false`

Per-glob file size caps with a migration ramp. Each file takes the **first
matching** `overrides` entry (most-specific first, first-match-wins — no merge) and
is measured on two independent metrics, `lines` and `bytes`, each with its own
optional `warn` and `error` tier.

## What it flags

- **over `warn`** → a `warn` finding (advisory).
- **over `error`** → an `error` finding (enforced, drives exit 1) — unless the
  [mode](#modes) exempts it: in ratchet mode, a file over that cap on the base ref
  and no larger than it is there; in grandfather mode, any file over that cap on
  the base ref; in baseline mode, a file baselined at or above its current size.
  An exempt file is downgraded to `warn`.

Annotations are **file-level, not line-level**, by design: the finding is that the
_file_ is over budget, not that any single line is. Under GitHub Actions (the
`github` report format, auto-enabled there) each over-threshold file gets a
`::warning` at the warn tier (an advisory split recommendation) and a `::error` at
the hard cap (enforced), rendered on the PR.

## Config

```yaml
checks:
  file-caps:
    overrides:
      - glob: 'src/**/*.ts'
        lines: { warn: 350, error: 500 }
        bytes: { warn: 16KB, error: 24KB } # raw integer or a size string (KB/MB/GB, binary)
      - glob: 'docs/**/*.md'
        lines: { warn: 500, error: 700 }
```

## Shared defaults

`file-caps` is **default-on** and ships **error-only shared defaults** that apply
when a repo configures nothing. They're ordered narrowest-first
(first-match-wins):

| Applies to              | Glob                                                                                                                                                                                       | `lines` error | `bytes` error |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------- |
| Generated files         | lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`, `poetry.lock`, …), `**/CHANGELOG.md`, `**/__snapshots__/**`, `**/*.{snap,map}`, `**/*.min.{js,css}` | uncapped      | uncapped      |
| Agent directive files   | `**/{AGENTS,CLAUDE}.md`, `**/.cursorrules`, `**/.cursor/rules/**/*.mdc`                                                                                                                    | 300           | 48 KB         |
| Test files (JS/TS)      | `**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}`                                                                                                                                         | 600           | 128 KB        |
| Test files (Go/Py/Ruby) | `**/*_{test,spec}.{go,py,rb}`, `**/test_*.py`                                                                                                                                              | 600           | 128 KB        |
| Code under a test dir   | `**/{__tests__,test,tests,spec,specs}/**/*.{…code…}`                                                                                                                                       | 600           | 128 KB        |
| Production code         | `**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,py,rb,go,rs,java,kt,swift,php,cs}`                                                                                                                    | 400           | 64 KB         |
| Markdown / docs         | `**/*.md`                                                                                                                                                                                  | 400           | 96 KB         |
| Everything else         | `**/*` (`.sh`, `.yml`, `.json`, …)                                                                                                                                                         | 400           | uncapped      |

**Error-only, with no `warn` tier.** A warning exits `0`, so a soft tier below
each cap passes CI silently and only accumulates. The defaults take the same
stance as `eslint --max-warnings 0`. A repo that wants an advisory nudge below a
cap adds a `warn` in its own override.

The values match what `rmartz/firebase-nextjs-template` and
`rmartz/hidden-role-game` enforce, and line up with an eslint `max-lines` of 400
for code and 600 for specs. Some rows depart from the generic cap on purpose:

- **Agent directive files** get a tighter cap. A directive file only earns its
  keep if the model reads it in full.
- **Test files** get a wider cap. Table-driven cases, fixtures, and exhaustive
  assertions run longer than production code.
- **Generated files** are uncapped. Tooling sets their size, not authors. An
  override entry with no `lines` or `bytes` uncaps its glob the same way.
- **The catch-all** caps lines only, so binary assets aren't byte-capped. A
  binary file (one containing a NUL byte) also counts as 0 lines, so only an
  explicit `bytes` cap applies to it.

Repo-specific vendored or append-only paths, such as shadcn's
`src/components/ui/**` or a metrics ledger, aren't in the defaults. List them in
the repo's own `overrides`.

A repo's own `overrides` are consulted **first** (they match ahead of the defaults,
per first-match-wins), so you tighten a glob, set a **laxer** `error` cap, or add
tiers by listing it. A consumer that trips the defaults on a bump fixes it with a
one-line override, with `mode: ratchet` or `mode: grandfather` (which downgrade
files already over cap on the base branch to `warn`, so no existing file needs a
commit), or with `enabled: false`. Each is an exception, so the section needs a
`reason`. That includes an override that only tightens a glob: the check can't
tell a tighter cap from a laxer one, so every override says why it departs from
the shared caps.

## Modes

`mode` sets how files that are already over their `error` cap are treated. Each
metric (`lines`, `bytes`) is judged independently in every mode.

| `mode`        | Existing over-cap files                                                               | State                             |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------- |
| `strict`      | Error, like any other.                                                                | None; a baseline file is ignored. |
| `ratchet`     | Warn while no larger than on the `base` ref; error once they grow past it.            | None; read from git.              |
| `grandfather` | Warn with no ceiling while over cap on the `base` ref.                                | None; read from git.              |
| `baseline`    | Warn while at or under their committed ceiling (legacy; see [below](#baseline-mode)). | `.repo-hygiene-baseline.json`     |
| _(unset)_     | `baseline` when a baseline file exists, otherwise `strict`.                           |                                   |

```yaml
checks:
  file-caps:
    mode: ratchet
    base: origin/main # ratchet and grandfather only; this is the default
```

### Ratchet mode

A file that is over its cap on the `base` ref (default `origin/main`) may not grow
beyond its size there, per metric: at or under that size it is a `warn`, past it
an `error`. A file at or under the cap on `base` — or absent there, such as a new
or renamed file — is enforced like any other. Every merge that shrinks a file
lowers its ceiling, and one that brings it under the cap removes its exemption,
with no `--update-baseline` step and nothing to commit.

The trade-offs against the committed baseline: there is no reviewable list of
exempt files (it is whatever is over cap on `base`), and ceilings compare against
the `base` ref rather than the lowest size ever recorded — in practice the same
thing, since the committed file also only records sizes when regenerated.

### Grandfather mode

A file that is over its cap on the `base` ref (default `origin/main`) is exempt:
it may grow freely and is reported as a `warn`. A file at or under the cap there —
or absent there, such as a new or renamed file — is enforced. So once a change
that brings a file under its cap reaches `base`, that file loses its exemption.
Nothing is committed; the exemptions are read from git on each run, and only for
files currently over a cap.

### The base ref (ratchet and grandfather)

The `base` ref must exist locally. `actions/checkout`'s default `fetch-depth: 1`
does not fetch `origin/main`, so set `fetch-depth: 0` (or fetch the base ref
explicitly). An unresolvable `base` is an error rather than a silent fallback.
Both modes also error if a `.repo-hygiene-baseline.json` is present; delete it, or
use `mode: baseline`.

### Baseline mode

Baseline mode keeps committed migration state, `.repo-hygiene-baseline.json`. It
is what an unset `mode` selects when that file exists, so existing adopters keep
working unchanged. Until v8 it was named `ratchet`; a config that sets
`mode: ratchet` with a baseline file present now errors, pointing here. To move to
the base-ref ratchet, delete the baseline file and set `mode: ratchet` (and
`fetch-depth: 0` in CI); to keep the committed file, set `mode: baseline` or leave
`mode` unset.

On adoption, every file already over its hard cap is baselined at its current size
and reported as a `warn` instead of blocking; thereafter the baseline **only
shrinks** — a file that gets smaller ratchets its ceiling down, one that drops
under the cap is removed, and one that grows past its recorded ceiling loses its
exemption and hard-errors.

Regenerate the baseline with the CLI rather than editing the JSON by hand:

```bash
repo-hygiene --update-baseline --check --config .repo-hygiene.yml
```

With no baseline file present this is first-time **adoption** (baseline
everything currently over cap); with one present it **ratchets** the existing
baseline down. A ratchet never _adds_ an entry — the baseline can only lose
entries — so the ramp always tightens toward the caps. Commit the regenerated
`.repo-hygiene-baseline.json` alongside the change that shifts file sizes.

`--update-baseline` refuses to run under `mode: strict`, `ratchet`, or
`grandfather`, which do not use a baseline.
