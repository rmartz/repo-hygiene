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
