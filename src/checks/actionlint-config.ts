import picomatch from 'picomatch';
import { isPlainObject } from '../lib/is-plain-object.js';
import type { CheckConfig } from '../types.js';

/**
 * Config vocabulary for the `actionlint` check. Every default is the strict one:
 * shellcheck runs over every `run:` block at shellcheck's own lowest severity, and
 * nothing is ignored. Each key is an explicit opt-out a repo writes down when it
 * needs to loosen the check.
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
  /** The lowest shellcheck severity reported (default `style`, i.e. everything). */
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

/** Parse and validate the check's `.repo-hygiene.yml` section. */
export function parseActionlintSettings(settings: CheckConfig): ActionlintSettings {
  const { shellcheck = true, shellcheckSeverity = 'style', ignore } = settings;
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

/** Whether an ignore rule covers a finding's message in `path`. */
export function isIgnored(rules: IgnoreRule[], path: string, message: string): boolean {
  return rules.some((rule) => rule.matches(path) && rule.patterns.some((re) => re.test(message)));
}
