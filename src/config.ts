import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { CheckConfig, RepoHygieneConfig, Severity } from './types.js';

/**
 * Loader for the committed `.repo-hygiene.yml`. It validates the envelope — a
 * top-level mapping with a `checks` map, each section optionally carrying a
 * `severity` — and passes every other key through untouched for the owning check
 * to interpret. A malformed shape throws with a filename-prefixed message; a
 * missing file is not an error (the defaults apply).
 */

export const CONFIG_FILENAME = '.repo-hygiene.yml';

const SEVERITIES: readonly Severity[] = ['warn', 'error'];

const isSeverity = (value: unknown): value is Severity =>
  typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The default config when no `.repo-hygiene.yml` is present. */
export const emptyConfig = (): RepoHygieneConfig => ({ checks: {} });

function validateCheckConfig(name: string, value: unknown): CheckConfig {
  if (value == null) return {};
  if (!isPlainObject(value)) {
    throw new Error(`${CONFIG_FILENAME}: check "${name}" must be a mapping`);
  }
  if (value.severity !== undefined && !isSeverity(value.severity)) {
    throw new Error(
      `${CONFIG_FILENAME}: check "${name}" has invalid severity ` +
        `${JSON.stringify(value.severity)} (expected "warn" or "error")`,
    );
  }
  return value as CheckConfig;
}

/** Parse and validate raw YAML text into a config. Throws on a malformed shape. */
export function parseConfig(text: string): RepoHygieneConfig {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new Error(`${CONFIG_FILENAME}: ${(err as Error).message}`);
  }
  if (raw == null) return emptyConfig();
  if (!isPlainObject(raw)) {
    throw new Error(`${CONFIG_FILENAME}: top level must be a mapping`);
  }
  const rawChecks = raw.checks ?? {};
  if (!isPlainObject(rawChecks)) {
    throw new Error(`${CONFIG_FILENAME}: "checks" must be a mapping`);
  }
  const checks: Record<string, CheckConfig> = {};
  for (const [name, value] of Object.entries(rawChecks)) {
    checks[name] = validateCheckConfig(name, value);
  }
  return { checks };
}

/**
 * Load config from `path` (default `.repo-hygiene.yml` in `cwd`). A missing file
 * yields the empty config; a present but malformed file throws.
 */
export function loadConfig(opts: { cwd?: string; path?: string } = {}): RepoHygieneConfig {
  const file = opts.path ?? join(opts.cwd ?? process.cwd(), CONFIG_FILENAME);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return emptyConfig();
  }
  return parseConfig(text);
}
