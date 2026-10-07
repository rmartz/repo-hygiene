import type { FileSet, Mode } from './discovery.js';

/**
 * The check contract every hygiene check plugs into, plus the config vocabulary
 * `.repo-hygiene.yml` speaks. Kept type-only so `types.ts` sits at the bottom of
 * the package's import graph (it depends on nothing but discovery's file-set
 * types); the loader and the runner build on it.
 */

/**
 * Whether a finding blocks or only warns. `error` drives `exit 1` (the enforced
 * floor); `warn` reports but leaves the exit code clean (the migration-ramp
 * signal). A repo downgrades an entire check to `warn` via config while it works
 * off a backlog, then flips it back to `error` once green.
 */
export type Severity = 'warn' | 'error';

/**
 * A finding's outcome: a {@link Severity}, or `inconclusive` when the check could
 * not reach a verdict because of an external transient error (a rate limit, a
 * timeout, an unreachable network). An inconclusive finding says nothing about
 * the change under test, so the config `severity` override never applies to it,
 * and a run whose only blocking outcome is inconclusive exits `3`, not `1`.
 */
export type FindingSeverity = Severity | 'inconclusive';

/**
 * One reported problem. `path`/`line` are omitted for repo-level findings (a
 * check about the tree as a whole rather than one line of one file).
 */
export interface Finding {
  /** The check that produced this finding. */
  check: string;
  /** File the finding refers to; omitted for repo-level findings. */
  path?: string;
  /** 1-based line number, when the finding is line-anchored. */
  line?: number;
  /** Human-readable description. */
  message: string;
  severity: FindingSeverity;
}

/**
 * A check's config section from `.repo-hygiene.yml`. The framework only knows
 * `severity` (the ramp override, applied uniformly by the runner); every other
 * key is check-defined — globs, thresholds, vocabularies, exemptions — and read
 * by the check itself.
 */
export interface CheckConfig {
  /** Overrides the severity of every finding this check emits (the ramp). */
  severity?: Severity;
  /**
   * When `false`, the runner skips this check entirely — the per-repo opt-out for
   * a default-on check a repo cannot (yet) satisfy. Defaults to enabled; wins over
   * how the check was selected (default set or explicitly named).
   */
  enabled?: boolean;
  /**
   * Why this repo needs an exception to the check's recommended settings.
   * Required whenever the section loosens the check — `enabled: false`,
   * `severity: warn`, or any setting the check's `loosenings` reports — so every
   * relaxation is written down where review sees it. Tightening needs none.
   */
  reason?: string;
  [key: string]: unknown;
}

/** The whole `.repo-hygiene.yml`: a per-check-name map of config sections. */
export interface RepoHygieneConfig {
  checks: Record<string, CheckConfig>;
}

/** Everything a check needs to run: the resolved file set, its config, the env. */
export interface CheckContext {
  mode: Mode;
  files: FileSet;
  cwd?: string;
  /** This check's `.repo-hygiene.yml` section (check-defined shape). */
  settings: CheckConfig;
  /** Environment bag, for checks with an env-var bypass. */
  env: Record<string, string | undefined>;
}

/** A registered hygiene check. `name` is its CLI id and its config key. */
export interface Check {
  name: string;
  description: string;
  /**
   * Whether the check is in the **default-on** set — run for consumers when no
   * `checks` are named, so it reaches every repo on the next Dependabot bump with
   * no per-repo YAML edit. Set it `true` only for a check that is safe to run with
   * no configuration on an arbitrary repo: it does something universally correct
   * with sane defaults and cannot break an unconfigured consumer's CI on arrival.
   * Omitted (falsy) means **opt-in** — the check ships in the registry but only
   * runs when a repo names it in the Action's `checks` input. The Action's
   * empty default derives from this flag (see `registry.defaultNames`), so a
   * new default-on check auto-joins the default; it is not hardcoded in the YAML.
   */
  defaultOn?: boolean;
  /**
   * The severity this check's findings take when the repo has not set a
   * `severity` override — the check's built-in default. An opinionated default-on
   * check sets this to `warn` so it surfaces findings everywhere without blocking
   * CI; a repo enforces it by setting `severity: error`. Omitted → each finding
   * keeps the intrinsic severity the check emitted.
   */
  defaultSeverity?: Severity;
  /**
   * The settings in `settings` that make this check more lenient than its
   * recommended defaults, each named as written (e.g. `anchors: false`). The
   * runner refuses to run a check whose section loosens it without a `reason`.
   * Omit when the check has no lenient options. The framework's own `enabled:
   * false` and `severity: warn` are covered by the runner, not listed here.
   */
  loosenings?(settings: CheckConfig): string[];
  run(ctx: CheckContext): Promise<Finding[]>;
}
