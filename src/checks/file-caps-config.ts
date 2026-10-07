import type { CheckConfig } from '../types.js';
import { isPlainObject } from '../lib/is-plain-object.js';

/**
 * Config vocabulary for the `file-caps` check: an ordered `overrides` list of
 * per-glob caps, first-match-wins. Each entry configures two independent
 * metrics — `lines` (integer counts) and `bytes` (raw integer or a human size
 * like `"40KB"`) — and each metric carries its own optional `warn` / `error`
 * tier. Parsing/validation lives here; the check and the baseline consume the
 * typed result.
 */

export type Metric = 'lines' | 'bytes';
export const METRICS: readonly Metric[] = ['lines', 'bytes'];

/** Optional warn / error thresholds for one metric, in that metric's unit. */
export interface Tier {
  warn?: number;
  error?: number;
}

/** One per-glob cap entry. `lines`/`bytes` thresholds are already normalized. */
export interface OverrideEntry {
  glob: string;
  lines?: Tier;
  bytes?: Tier;
}

// Binary units (KB = 1024), plus single-letter aliases and a bare byte count.
const UNIT_BYTES: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
};

/** Normalize a byte threshold — a raw integer or a size string — to bytes. */
export function parseByteSize(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`file-caps: byte size must be a non-negative integer, got ${value}`);
    }
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error(`file-caps: byte size must be a number or string, got ${typeof value}`);
  }
  const trimmed = value.trim();
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(trimmed);
  if (!m || m[1] === undefined) {
    throw new Error(`file-caps: invalid byte size ${JSON.stringify(value)}`);
  }
  const unit = (m[2] || 'b').toLowerCase();
  const mult = Object.hasOwn(UNIT_BYTES, unit) ? UNIT_BYTES[unit] : undefined;
  if (mult === undefined) {
    throw new Error(
      `file-caps: unknown byte unit ${JSON.stringify(m[2])} in ${JSON.stringify(value)}`,
    );
  }
  return Math.round(Number.parseFloat(m[1]) * mult);
}

function parseTier(raw: unknown, metric: Metric, glob: string): Tier | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new Error(`file-caps: "${metric}" for glob ${JSON.stringify(glob)} must be a mapping`);
  }
  const normalize = (v: unknown): number =>
    metric === 'bytes' ? parseByteSize(v) : asLineCount(v, glob);
  const tier: Tier = {};
  if (raw.warn !== undefined) tier.warn = normalize(raw.warn);
  if (raw.error !== undefined) tier.error = normalize(raw.error);
  return tier;
}

function asLineCount(value: unknown, glob: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      `file-caps: line threshold for glob ${JSON.stringify(glob)} must be a non-negative integer`,
    );
  }
  return value;
}

/** Extensions treated as source code by the shared line/byte caps. */
const CODE_EXTS = 'ts,tsx,js,jsx,mts,cts,mjs,cjs,py,rb,go,rs,java,kt,swift,php,cs';

const TEST_CAP = { lines: { error: 600 }, bytes: { error: 128 * 1024 } };
const DIRECTIVE_CAP = { lines: { error: 300 }, bytes: { error: 48 * 1024 } };

/**
 * Error-only fleet defaults, applied beneath a repo's own `overrides` (which
 * match first). There is no `warn` tier: a warning exits 0, so a soft tier passes
 * CI silently and only accumulates (the same stance as `eslint --max-warnings 0`).
 * A repo that wants a nudge below a cap adds a `warn` in its own override. A repo
 * with existing over-cap files migrates with `mode: ratchet` or `grandfather`,
 * sets a laxer `error` cap for a glob, or opts out with `enabled: false`.
 *
 * Order matters: entries are first-match-wins, so the narrower globs come first.
 *   1. Generated files (lockfiles, snapshots, changelogs, minified bundles,
 *      source maps) — uncapped: an entry with no tier caps nothing.
 *   2. Agent directive files (`AGENTS.md` / `CLAUDE.md`, plus Cursor's
 *      `.cursorrules` and `.cursor/rules/*.mdc`) — 300 lines. A directive file
 *      earns its keep only if the model reads it in full.
 *   3. Test files — 600 lines. Table-driven cases and fixtures run longer.
 *   4. Production code — 400 lines.
 *   5. Markdown — 400 lines.
 *   6. Everything else (`.sh`, `.yml`, `.json`, …) — 400 lines. Lines only, so
 *      binary assets are not byte-capped, and a binary file has no line count
 *      (see `computeMetrics`).
 *
 * The values are the ones `rmartz/firebase-nextjs-template` and
 * `rmartz/hidden-role-game` enforce, and line up with an eslint `max-lines` of
 * 400 for code and 600 for specs.
 */
export const DEFAULT_OVERRIDES: OverrideEntry[] = [
  // Generated files: uncapped. Their size is set by tooling, not authors.
  {
    glob: '**/{pnpm-lock.yaml,package-lock.json,npm-shrinkwrap.json,yarn.lock,bun.lock,go.sum,Cargo.lock,poetry.lock,uv.lock,Pipfile.lock,Gemfile.lock,composer.lock}',
  },
  { glob: '**/CHANGELOG.md' },
  { glob: '**/__snapshots__/**' },
  { glob: '**/*.{snap,map}' },
  { glob: '**/*.min.{js,css}' },
  // Agent directive files: the tightest cap, kept short and focused.
  { glob: '**/{AGENTS,CLAUDE}.md', ...DIRECTIVE_CAP },
  { glob: '**/.cursorrules', ...DIRECTIVE_CAP },
  { glob: '**/.cursor/rules/**/*.mdc', ...DIRECTIVE_CAP },
  // Test files. Suffix conventions across languages…
  { glob: '**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}', ...TEST_CAP },
  { glob: '**/*_{test,spec}.{go,py,rb}', ...TEST_CAP },
  { glob: '**/test_*.py', ...TEST_CAP },
  // …plus any code file under a conventional test directory.
  { glob: `**/{__tests__,test,tests,spec,specs}/**/*.{${CODE_EXTS}}`, ...TEST_CAP },
  // Production code.
  { glob: `**/*.{${CODE_EXTS}}`, lines: { error: 400 }, bytes: { error: 64 * 1024 } },
  // Markdown / docs.
  { glob: '**/*.md', lines: { error: 400 }, bytes: { error: 96 * 1024 } },
  // Every other tracked file.
  { glob: '**/*', lines: { error: 400 } },
];

/**
 * The effective cap list: a repo's parsed `overrides` first (they match ahead of
 * the shared defaults, per first-match-wins), then {@link DEFAULT_OVERRIDES}.
 */
export function resolveFileCapsOverrides(settings: CheckConfig): OverrideEntry[] {
  return [...parseFileCapsConfig(settings), ...DEFAULT_OVERRIDES];
}

/**
 * How over-cap files are treated. `strict` enforces every cap; `ratchet` caps
 * each file that is over cap on the `base` ref at its size there, so a merge that
 * shrinks it lowers its ceiling; `grandfather` exempts any file already over its
 * cap on `base`, with no ceiling; `baseline` (legacy) honors the committed
 * `.repo-hygiene-baseline.json`. Unset keeps the historical behavior: `baseline`
 * when that file exists, otherwise strict.
 */
export const FILE_CAPS_MODES = ['strict', 'ratchet', 'grandfather', 'baseline'] as const;
export type FileCapsMode = (typeof FILE_CAPS_MODES)[number];

/** The modes that read file sizes from the `base` ref. */
export const BASE_REF_MODES = ['ratchet', 'grandfather'] as const;
export type BaseRefMode = (typeof BASE_REF_MODES)[number];
export const isBaseRefMode = (mode: FileCapsMode | undefined): mode is BaseRefMode =>
  BASE_REF_MODES.some((m) => m === mode);

export const DEFAULT_BASE_REF = 'origin/main';

export interface FileCapsModeConfig {
  mode?: FileCapsMode;
  /** The ref the base-ref modes (`ratchet`, `grandfather`) compare against. */
  base: string;
}

/** Parse and validate `mode` / `base` from a `file-caps` config section. */
export function parseFileCapsMode(settings: CheckConfig): FileCapsModeConfig {
  const { mode, base } = settings;
  if (mode !== undefined && !FILE_CAPS_MODES.some((m) => m === mode)) {
    throw new Error(
      `file-caps: "mode" must be one of ${FILE_CAPS_MODES.join(', ')}, got ${JSON.stringify(mode)}`,
    );
  }
  const parsed: FileCapsModeConfig = {
    ...(mode !== undefined && { mode: mode as FileCapsMode }),
    base: DEFAULT_BASE_REF,
  };
  if (base === undefined) return parsed;
  // A leading '-' would be read by git as an option, not a ref.
  if (typeof base !== 'string' || base.trim() === '' || base.startsWith('-')) {
    throw new Error(`file-caps: "base" must be a git ref, got ${JSON.stringify(base)}`);
  }
  if (!isBaseRefMode(parsed.mode)) {
    throw new Error('file-caps: "base" only applies to mode: ratchet or grandfather');
  }
  return { ...parsed, base };
}

/** Parse and validate the `overrides` list from a `file-caps` config section. */
export function parseFileCapsConfig(settings: CheckConfig): OverrideEntry[] {
  const raw = settings.overrides;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('file-caps: "overrides" must be a list');
  return raw.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.glob !== 'string') {
      throw new Error('file-caps: each override needs a string "glob"');
    }
    const { glob } = entry;
    const lines = parseTier(entry.lines, 'lines', glob);
    const bytes = parseTier(entry.bytes, 'bytes', glob);
    return { glob, ...(lines && { lines }), ...(bytes && { bytes }) };
  });
}
