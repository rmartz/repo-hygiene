import picomatch from 'picomatch';
import { isPlainObject } from '../lib/is-plain-object.js';
import type { CheckConfig } from '../types.js';

/**
 * Config vocabulary for the `actionlint` check. The defaults are the recommended
 * ones: shellcheck runs over every `run:` block and reports warnings and errors
 * (its info and style notes are opinion, not defects), and only the known
 * actionlint false positives in {@link BUILTIN_IGNORES} are dropped. A repo may
 * tighten freely; `shellcheck: false`, `shellcheckSeverity: error`, and any
 * `ignore` loosen it, so a repo explains each in a comment beside it.
 */

export const SHELLCHECK_SEVERITIES = ['style', 'info', 'warning', 'error'] as const;
export type ShellcheckSeverity = (typeof SHELLCHECK_SEVERITIES)[number];

/** Message patterns ignored for the workflow files one glob matches. */
export interface IgnoreRule {
  glob: string;
  matches: (path: string) => boolean;
  patterns: RegExp[];
}

export interface ActionlintSettings {
  /** Run shellcheck over `run:` blocks (default `true`). */
  shellcheck: boolean;
  /** The lowest shellcheck severity reported (default `warning`). */
  shellcheckSeverity: ShellcheckSeverity;
  /** Per-glob message ignores, mirroring actionlint's `paths.<glob>.ignore`. */
  ignore: IgnoreRule[];
}

function parseIgnore(raw: unknown): IgnoreRule[] {
  if (raw === undefined) return [];
  if (!isPlainObject(raw)) {
    throw new Error('actionlint: "ignore" must be a mapping of path glob → list of regexes');
  }
  return Object.entries(raw).map(([glob, list]) => {
    if (!Array.isArray(list) || !list.every((p) => typeof p === 'string')) {
      throw new Error(`actionlint: "ignore" for ${JSON.stringify(glob)} must be a list of strings`);
    }
    const patterns = list.map((source) => {
      try {
        return new RegExp(source);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`actionlint: invalid ignore regex ${JSON.stringify(source)}: ${reason}`);
      }
    });
    return { glob, matches: picomatch(glob, { dot: true }), patterns };
  });
}

/**
 * Messages actionlint reports in error on valid workflows, dropped for every repo.
 * actionlint 1.7.12 does not model the `job.workflow_*` contexts GitHub added for
 * reusable workflows; the match is anchored to the `job` object type (whose first
 * property is `check_run_id`), so a real typo like `job.nope` still fails. Drop an
 * entry once the pinned actionlint models it.
 */
export const BUILTIN_IGNORES: RegExp[] = [
  /^property "workflow_(?:ref|sha|repository|file_path)" is not defined in object type \{check_run_id: /,
];

/** Parse and validate the check's `.repo-hygiene.yml` section. */
export function parseActionlintSettings(settings: CheckConfig): ActionlintSettings {
  const { shellcheck = true, shellcheckSeverity = 'warning', ignore } = settings;
  if (typeof shellcheck !== 'boolean') {
    throw new Error('actionlint: "shellcheck" must be true or false');
  }
  if (!SHELLCHECK_SEVERITIES.some((s) => s === shellcheckSeverity)) {
    throw new Error(
      `actionlint: "shellcheckSeverity" must be one of ${SHELLCHECK_SEVERITIES.join(', ')}`,
    );
  }
  return {
    shellcheck,
    shellcheckSeverity: shellcheckSeverity as ShellcheckSeverity,
    ignore: parseIgnore(ignore),
  };
}

/** Whether a built-in or repo ignore rule covers a finding's message in `path`. */
export function isIgnored(rules: IgnoreRule[], path: string, message: string): boolean {
  return (
    BUILTIN_IGNORES.some((re) => re.test(message)) ||
    rules.some((rule) => rule.matches(path) && rule.patterns.some((re) => re.test(message)))
  );
}
