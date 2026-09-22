import type { CheckConfig } from '../types.js';

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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

/**
 * Two-tier fleet defaults — a `warn` nudge below a hard `error` cap — applied
 * beneath a repo's own `overrides` (which match first). Unlike the other default-on
 * checks, `file-caps` ships an `error` tier in its defaults, so a repo that
 * configures nothing still *hard-gates* on file size. This is a deliberate
 * departure from the usual warn-on-arrival posture (see
 * `docs/distribution-contract.md`): the change is meant to break loudly in a
 * consumer's CI on the next bump, and the consumer rectifies by grandfathering
 * existing over-cap files into the baseline (`--update-baseline`), setting a laxer
 * `error` cap for a glob in `.repo-hygiene.yml` (repo overrides match first), or
 * opting out with `enabled: false`.
 *
 * Order matters: entries are first-match-wins, so the narrower globs come first.
 *   1. Agent directive files (`AGENTS.md` / `CLAUDE.md`, plus Cursor's `.cursorrules`
 *      and `.cursor/rules/*.mdc`) — the tightest cap (warn 200 / error 300 lines). A
 *      directive file earns its keep only if the model actually reads it; Claude and
 *      Cursor guidance both push toward short, focused instruction files.
 *   2. Test files — the widest cap (warn 800 / error 1200 lines). Table-driven
 *      cases, fixtures, and exhaustive assertions legitimately run longer than code.
 *   3. Production code — warn 400 / error 600 lines.
 *   4. Markdown / docs — warn 700 / error 1000 lines.
 *
 * Byte caps track the same tiers. The two-tier scheme and the warn:error ratio
 * follow the model documented in hidden-role-game's AGENTS.md, widened for the
 * arbitrary consumer repo.
 */
export const DEFAULT_OVERRIDES: OverrideEntry[] = [
  // Agent directive files: the tightest cap, kept short and focused. Covers
  // AGENTS.md / CLAUDE.md plus Cursor's .cursorrules and .cursor/rules/*.mdc.
  {
    glob: '**/{AGENTS,CLAUDE}.md',
    lines: { warn: 200, error: 300 },
    bytes: { warn: 32 * 1024, error: 48 * 1024 },
  },
  {
    glob: '**/.cursorrules',
    lines: { warn: 200, error: 300 },
    bytes: { warn: 32 * 1024, error: 48 * 1024 },
  },
  {
    glob: '**/.cursor/rules/**/*.mdc',
    lines: { warn: 200, error: 300 },
    bytes: { warn: 32 * 1024, error: 48 * 1024 },
  },
  // Test files: the widest cap. Suffix conventions across languages…
  {
    glob: '**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
    lines: { warn: 800, error: 1200 },
    bytes: { warn: 96 * 1024, error: 128 * 1024 },
  },
  {
    glob: '**/*_{test,spec}.{go,py,rb}',
    lines: { warn: 800, error: 1200 },
    bytes: { warn: 96 * 1024, error: 128 * 1024 },
  },
  {
    glob: '**/test_*.py',
    lines: { warn: 800, error: 1200 },
    bytes: { warn: 96 * 1024, error: 128 * 1024 },
  },
  // …plus any code file under a conventional test directory.
  {
    glob: `**/{__tests__,test,tests,spec,specs}/**/*.{${CODE_EXTS}}`,
    lines: { warn: 800, error: 1200 },
    bytes: { warn: 96 * 1024, error: 128 * 1024 },
  },
  // Production code.
  {
    glob: `**/*.{${CODE_EXTS}}`,
    lines: { warn: 400, error: 600 },
    bytes: { warn: 48 * 1024, error: 64 * 1024 },
  },
  // Markdown / docs.
  {
    glob: '**/*.md',
    lines: { warn: 700, error: 1000 },
    bytes: { warn: 96 * 1024, error: 128 * 1024 },
  },
];

/**
 * The effective cap list: a repo's parsed `overrides` first (they match ahead of
 * the shared defaults, per first-match-wins), then {@link DEFAULT_OVERRIDES}.
 */
export function resolveFileCapsOverrides(settings: CheckConfig): OverrideEntry[] {
  return [...parseFileCapsConfig(settings), ...DEFAULT_OVERRIDES];
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
