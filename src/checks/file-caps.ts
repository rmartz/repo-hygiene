import picomatch from 'picomatch';
import { resolveFileSet, type Mode } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';
import {
  METRICS,
  isBaseRefMode,
  parseFileCapsMode,
  type BaseRefMode,
  resolveFileCapsOverrides,
  type Metric,
  type OverrideEntry,
  type Tier,
} from './file-caps-config.js';
import {
  BASELINE_FILENAME,
  buildBaseline,
  loadBaseline,
  ratchetBaseline,
  writeBaseline,
  type FileCapsBaseline,
  type OverCap,
} from './file-caps-baseline.js';
import { assertBaseRef, readAtBase } from './file-caps-base.js';

/**
 * Per-glob file size caps with the migration ramp. Each file takes the first
 * matching `overrides` entry (most-specific first, first-match-wins — no merge),
 * and is measured on two independent metrics: `lines` and `bytes`. A metric hit
 * is an `error` when over the hard cap, downgraded to `warn` when the file is
 * exempt by the mode, and a plain `warn` when only over the softer `warn`
 * threshold. A file over cap on the base ref is exempt under `mode: ratchet`
 * while at or under its size there, and under `mode: grandfather` with no
 * ceiling; under `mode: baseline` a file is exempt while at or under its size in
 * the committed baseline (see `file-caps-baseline.ts`).
 */

const NAME = 'file-caps';

export interface FileMetrics {
  path: string;
  lines: number;
  bytes: number;
}

/**
 * Line count (trailing newline not counted as an extra line) + UTF-8 byte size.
 * A binary file (one containing a NUL byte) counts as 0 lines: its newline
 * bytes are noise, so only byte caps apply to it.
 */
export function computeMetrics(path: string, text: string): FileMetrics {
  const binary = text.includes('\0');
  const lines = text === '' || binary ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
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

/**
 * Base-ref sizes of the files over cap there: ceilings under `ratchet`,
 * uncapped exemptions under `grandfather`.
 */
export interface AtBase {
  mode: BaseRefMode;
  base: string;
  overCap: FileCapsBaseline;
}

/** One file's over-cap size on the base ref, for one metric. */
interface BaseSize {
  mode: BaseRefMode;
  base: string;
  value: number;
}

/** Evaluate one metric of one file against its tier, baselined ceiling, and base-ref size. */
function evalTier(
  path: string,
  metric: Metric,
  value: number,
  tier: Tier,
  baselined: number | undefined,
  atBase: BaseSize | undefined,
): Finding | null {
  const unit = unitOf(metric);
  if (tier.error !== undefined && value > tier.error) {
    if (atBase?.mode === 'grandfather') {
      return {
        check: NAME,
        path,
        message: `${value} ${unit} over the ${tier.error}-${metric} cap (grandfathered: ${atBase.value} on ${atBase.base})`,
        severity: 'warn',
      };
    }
    if (atBase?.mode === 'ratchet') {
      return value <= atBase.value
        ? {
            check: NAME,
            path,
            message: `${value} ${unit} over the ${tier.error}-${metric} cap (ratchet: ${atBase.value} on ${atBase.base})`,
            severity: 'warn',
          }
        : {
            check: NAME,
            path,
            message: `${value} ${unit} exceeds the ${tier.error}-${metric} cap and its ${atBase.value} on ${atBase.base}`,
            severity: 'error',
          };
    }
    if (baselined !== undefined && value <= baselined) {
      return {
        check: NAME,
        path,
        message: `${value} ${unit} over the ${tier.error}-${metric} cap (baselined at ${baselined})`,
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

/**
 * Findings for `metrics` under `entries`, applying the per-metric committed
 * baseline and, in the base-ref modes, the base-ref sizes.
 */
export function evaluateFileCaps(
  metrics: FileMetrics[],
  entries: OverrideEntry[],
  baseline: FileCapsBaseline,
  atBase?: AtBase,
): Finding[] {
  const compiled = compile(entries);
  const findings: Finding[] = [];
  for (const m of metrics) {
    const entry = firstMatch(compiled, m.path);
    if (!entry) continue;
    for (const metric of METRICS) {
      const tier = entry[metric];
      if (!tier) continue;
      const baseValue = atBase?.overCap[m.path]?.[metric];
      const baseSize =
        atBase && baseValue !== undefined
          ? { mode: atBase.mode, base: atBase.base, value: baseValue }
          : undefined;
      const finding = evalTier(
        m.path,
        metric,
        m[metric],
        tier,
        baseline[m.path]?.[metric],
        baseSize,
      );
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
  description: 'Per-glob line/byte size caps with a base-ref ratchet or grandfather ramp.',
  // Default-on: ships error-only shared defaults (see file-caps-config) that
  // hard-gate on size; a consumer sets mode: ratchet or grandfather, overrides
  // the cap, or opts out.
  defaultOn: true,
  async run(ctx) {
    const entries = resolveFileCapsOverrides(ctx.settings);
    const { mode, base } = parseFileCapsMode(ctx.settings);
    const cwd = ctx.cwd ?? process.cwd();
    const metrics: FileMetrics[] = [];
    for (const path of ctx.files.paths)
      metrics.push(computeMetrics(path, await ctx.files.read(path)));
    const baseline = loadBaseline(cwd);
    if (mode === 'strict') return evaluateFileCaps(metrics, entries, {});
    if (!isBaseRefMode(mode)) return evaluateFileCaps(metrics, entries, baseline ?? {});
    if (baseline !== null) {
      throw new Error(
        `file-caps: mode: ${mode} does not use ${BASELINE_FILENAME}; delete it or use mode: baseline`,
      );
    }
    const overCap = await overCapAtBase(metrics, compile(entries), mode, base, cwd);
    return evaluateFileCaps(metrics, entries, {}, { mode, base, overCap });
  },
};

/**
 * Which of the files over cap now were already over cap on `base`, per metric.
 * Only files over cap now are read at `base` — the rest cannot need exempting.
 */
async function overCapAtBase(
  metrics: FileMetrics[],
  compiled: CompiledOverride[],
  mode: BaseRefMode,
  base: string,
  cwd: string,
): Promise<FileCapsBaseline> {
  await assertBaseRef(base, mode, cwd);
  const paths = [...new Set(collectOverCaps(metrics, compiled).map((o) => o.path))];
  const contents = await readAtBase(paths, base, cwd);
  const atBase = [...contents].map(([path, text]) => computeMetrics(path, text));
  return buildBaseline(collectOverCaps(atBase, compiled));
}

export interface BaselineUpdate {
  action: 'adopt' | 'ratchet';
  files: number;
}

/**
 * Regenerate the committed baseline. With no baseline file present this is
 * first-time adoption (baseline everything currently over cap); otherwise it
 * ratchets the existing baseline down. Backs the CLI's `--update-baseline`.
 */
export async function updateFileCapsBaseline(opts: {
  cwd?: string;
  mode: Mode;
  settings: CheckConfig;
}): Promise<BaselineUpdate> {
  const cwd = opts.cwd ?? process.cwd();
  const { mode } = parseFileCapsMode(opts.settings);
  if (mode === 'strict' || isBaseRefMode(mode)) {
    throw new Error(`file-caps: --update-baseline does not apply to mode: ${mode}`);
  }
  const entries = resolveFileCapsOverrides(opts.settings);
  const overCaps = collectOverCaps(await measureAll('--check', cwd), compile(entries));
  const existing = loadBaseline(cwd);
  const next = existing === null ? buildBaseline(overCaps) : ratchetBaseline(overCaps, existing);
  writeBaseline(cwd, next);
  return { action: existing === null ? 'adopt' : 'ratchet', files: Object.keys(next).length };
}
