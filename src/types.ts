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
  severity: Severity;
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
  run(ctx: CheckContext): Promise<Finding[]>;
}
