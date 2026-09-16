import picomatch from 'picomatch';
import { resolveFileSet, type Mode } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';
import {
  METRICS,
  parseFileCapsConfig,
  type Metric,
  type OverrideEntry,
  type Tier,
} from './file-caps-config.js';
import {
  buildBaseline,
  loadBaseline,
  ratchetBaseline,
  writeBaseline,
  type OverCap,
} from './file-caps-baseline.js';

/**
 * Per-glob file size caps with the migration ramp. Each file takes the first
 * matching `overrides` entry (most-specific first, first-match-wins — no merge),
 * and is measured on two independent metrics: `lines` and `bytes`. A metric hit
 * is an `error` when over the hard cap, downgraded to `warn` when the file is
 * grandfathered at or above its current size (see `file-caps-baseline.ts`), and
 * a plain `warn` when only over the softer `warn` threshold.
 */

const NAME = 'file-caps';

export interface FileMetrics {
  path: string;
  lines: number;
  bytes: number;
}

/** Line count (trailing newline not counted as an extra line) + UTF-8 byte size. */
export function computeMetrics(path: string, text: string): FileMetrics {
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { path, lines, bytes: Buffer.byteLength(text, 'utf8') };
}

interface CompiledOverride {
  entry: OverrideEntry;
  isMatch: (p: string) => boolean;
}
const compile = (entries: OverrideEntry[]): CompiledOverride[] =>
  entries.map((entry) => ({ entry, isMatch: picomatch(entry.glob, { dot: true }) }));

const firstMatch = (compiled: CompiledOverride[], path: string): OverrideEntry | undefined =>
  compiled.find(({ isMatch }) => isMatch(path))?.entry;

/** Files currently exceeding their `error` cap on a metric (drives the baseline). */
function collectOverCaps(metrics: FileMetrics[], compiled: CompiledOverride[]): OverCap[] {
  const out: OverCap[] = [];
  for (const m of metrics) {
    const entry = firstMatch(compiled, m.path);
    if (!entry) continue;
    for (const metric of METRICS) {
      const tier = entry[metric];
      if (tier?.error !== undefined && m[metric] > tier.error) {
        out.push({ path: m.path, metric, value: m[metric] });
      }
    }
  }
  return out;
}

const unitOf = (metric: Metric): string => (metric === 'bytes' ? 'B' : 'lines');

/** Evaluate one metric of one file against its tier and grandfathered ceiling. */
function evalTier(
  path: string,
  metric: Metric,
  value: number,
  tier: Tier,
  grandfathered: number | undefined,
): Finding | null {
  const unit = unitOf(metric);
  if (tier.error !== undefined && value > tier.error) {
    if (grandfathered !== undefined && value <= grandfathered) {
      return {
        check: NAME,
        path,
        message: `${value} ${unit} over the ${tier.error}-${metric} cap (grandfathered at ${grandfathered})`,
        severity: 'warn',
      };
    }
    return {
      check: NAME,
      path,
      message: `${value} ${unit} exceeds the ${tier.error}-${metric} cap`,
      severity: 'error',
    };
  }
  if (tier.warn !== undefined && value > tier.warn) {
    return {
      check: NAME,
      path,
      message: `${value} ${unit} exceeds the ${tier.warn}-${metric} warn threshold`,
      severity: 'warn',
    };
  }
  return null;
}

/** Findings for `metrics` under `entries`, applying the per-metric baseline ramp. */
export function evaluateFileCaps(
  metrics: FileMetrics[],
  entries: OverrideEntry[],
  baseline: Record<string, Partial<Record<Metric, number>>>,
): Finding[] {
  const compiled = compile(entries);
  const findings: Finding[] = [];
  for (const m of metrics) {
    const entry = firstMatch(compiled, m.path);
    if (!entry) continue;
    for (const metric of METRICS) {
      const tier = entry[metric];
      if (!tier) continue;
      const finding = evalTier(m.path, metric, m[metric], tier, baseline[m.path]?.[metric]);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

async function measureAll(mode: Mode, cwd: string): Promise<FileMetrics[]> {
  const files = await resolveFileSet(mode, { cwd });
  const metrics: FileMetrics[] = [];
  for (const path of files.paths) metrics.push(computeMetrics(path, await files.read(path)));
  return metrics;
}

export const fileCapsCheck: Check = {
  name: NAME,
  description: 'Per-glob line/byte size caps with a grandfather migration ramp.',
  async run(ctx) {
    const entries = parseFileCapsConfig(ctx.settings);
    if (entries.length === 0) return [];
    const cwd = ctx.cwd ?? process.cwd();
    const metrics: FileMetrics[] = [];
    for (const path of ctx.files.paths)
      metrics.push(computeMetrics(path, await ctx.files.read(path)));
    return evaluateFileCaps(metrics, entries, loadBaseline(cwd) ?? {});
  },
};

export interface BaselineUpdate {
  action: 'adopt' | 'ratchet';
  files: number;
}

/**
 * Regenerate the committed baseline. With no baseline file present this is
 * first-time adoption (grandfather everything currently over cap); otherwise it
 * ratchets the existing baseline down. Backs the CLI's `--update-baseline`.
 */
export async function updateFileCapsBaseline(opts: {
  cwd?: string;
  mode: Mode;
  settings: CheckConfig;
}): Promise<BaselineUpdate> {
  const cwd = opts.cwd ?? process.cwd();
  const entries = parseFileCapsConfig(opts.settings);
  const overCaps = collectOverCaps(await measureAll('--check', cwd), compile(entries));
  const existing = loadBaseline(cwd);
  const next = existing === null ? buildBaseline(overCaps) : ratchetBaseline(overCaps, existing);
  writeBaseline(cwd, next);
  return { action: existing === null ? 'adopt' : 'ratchet', files: Object.keys(next).length };
}
