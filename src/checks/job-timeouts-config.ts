import picomatch from 'picomatch';
import { isPlainObject } from '../lib/is-plain-object.js';
import type { CheckConfig } from '../types.js';

/**
 * Config vocabulary for the `job-timeouts` check. The defaults are the recommended
 * ones: every job bounded at 15 minutes or less, and an expression-valued
 * timeout (which can't be checked statically) reported rather than trusted. A
 * repo may lower `maxMinutes` freely; raising it, `allowExpressions: true`, and
 * any `ignore` loosen the check, so a repo explains each in a comment beside it.
 */

export const DEFAULT_MAX_MINUTES = 15;

/** Job ids exempted for the workflow files one glob matches (`*` = every job). */
export interface JobIgnoreRule {
  glob: string;
  matches: (path: string) => boolean;
  jobs: string[];
}

export interface JobTimeoutSettings {
  /** The highest job-level `timeout-minutes` accepted (default 15). */
  maxMinutes: number;
  /** Accept a `${{ … }}` timeout as present but unverified (default `false`). */
  allowExpressions: boolean;
  /** Per-glob job exemptions. */
  ignore: JobIgnoreRule[];
}

function parseIgnore(raw: unknown): JobIgnoreRule[] {
  if (raw === undefined) return [];
  if (!isPlainObject(raw)) {
    throw new Error('job-timeouts: "ignore" must be a mapping of path glob → list of job ids');
  }
  return Object.entries(raw).map(([glob, jobs]) => {
    if (!Array.isArray(jobs) || !jobs.every((j) => typeof j === 'string')) {
      throw new Error(
        `job-timeouts: "ignore" for ${JSON.stringify(glob)} must be a list of job ids`,
      );
    }
    return { glob, matches: picomatch(glob, { dot: true }), jobs };
  });
}

/** Parse and validate the check's `.repo-hygiene.yml` section. */
export function parseJobTimeoutSettings(settings: CheckConfig): JobTimeoutSettings {
  const { maxMinutes = DEFAULT_MAX_MINUTES, allowExpressions = false, ignore } = settings;
  if (typeof maxMinutes !== 'number' || !Number.isInteger(maxMinutes) || maxMinutes <= 0) {
    throw new Error('job-timeouts: "maxMinutes" must be a positive integer');
  }
  if (typeof allowExpressions !== 'boolean') {
    throw new Error('job-timeouts: "allowExpressions" must be true or false');
  }
  return { maxMinutes, allowExpressions, ignore: parseIgnore(ignore) };
}

/** Whether a repo ignore rule exempts `job` in the workflow at `path`. */
export function isJobIgnored(rules: JobIgnoreRule[], path: string, job: string): boolean {
  return rules.some((rule) => rule.matches(path) && rule.jobs.some((j) => j === '*' || j === job));
}
