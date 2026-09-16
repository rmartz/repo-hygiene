import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Metric } from './file-caps-config.js';

/**
 * The file-caps migration ramp state. On adoption, every file already over its
 * hard (`error`) cap is grandfathered at its current size — reported as a `warn`
 * rather than blocking. Thereafter the baseline **only shrinks**: a file that
 * gets smaller ratchets its ceiling down, a file that drops under the cap is
 * dropped, and a file that grows past its recorded ceiling loses the
 * grandfather and hard-errors. Each metric (`lines`, `bytes`) is tracked
 * independently, so a file grandfathered on bytes still errors if it later
 * crosses the line cap.
 */

export const BASELINE_FILENAME = '.repo-hygiene-baseline.json';
const SECTION = 'file-caps';

/** A grandfathered ceiling per metric for one file. */
export type MetricBaseline = Partial<Record<Metric, number>>;
/** path → grandfathered ceilings. */
export type FileCapsBaseline = Record<string, MetricBaseline>;

/** One file currently exceeding its `error` cap on a metric. */
export interface OverCap {
  path: string;
  metric: Metric;
  value: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Load the file-caps baseline from `<cwd>/.repo-hygiene-baseline.json`. Returns
 * `null` when the file is absent (adoption has not happened) — distinct from an
 * empty baseline (`{}`, nothing grandfathered).
 */
export function loadBaseline(cwd: string): FileCapsBaseline | null {
  let text: string;
  try {
    text = readFileSync(join(cwd, BASELINE_FILENAME), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return null;
  }
  const raw = JSON.parse(text) as unknown;
  if (!isPlainObject(raw) || !isPlainObject(raw[SECTION]))
    return Object.create(null) as FileCapsBaseline;
  const out: FileCapsBaseline = Object.create(null) as FileCapsBaseline;
  for (const [path, ceilings] of Object.entries(raw[SECTION])) {
    if (!isPlainObject(ceilings)) continue;
    const entry: MetricBaseline = {};
    if (typeof ceilings.lines === 'number') entry.lines = ceilings.lines;
    if (typeof ceilings.bytes === 'number') entry.bytes = ceilings.bytes;
    out[path] = entry;
  }
  return out;
}

/** Write the baseline back, namespaced under the `file-caps` section. */
export function writeBaseline(cwd: string, baseline: FileCapsBaseline): void {
  const sorted = Object.fromEntries(
    Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(
    join(cwd, BASELINE_FILENAME),
    `${JSON.stringify({ [SECTION]: sorted }, null, 2)}\n`,
  );
}

const record = (into: FileCapsBaseline, path: string, metric: Metric, value: number): void => {
  const entry = into[path] ?? {};
  entry[metric] = value;
  into[path] = entry;
};

/** Adoption snapshot: grandfather every currently-over-cap file at its size. */
export function buildBaseline(overCaps: OverCap[]): FileCapsBaseline {
  const baseline: FileCapsBaseline = Object.create(null) as FileCapsBaseline;
  for (const { path, metric, value } of overCaps) record(baseline, path, metric, value);
  return baseline;
}

/**
 * Maintenance: shrink an existing baseline. Every recorded (path, metric) that
 * is still over cap ratchets down to `min(current, recorded)`; one that is no
 * longer over cap (or whose file is gone) is dropped. Never adds an entry that
 * was not already grandfathered — the list only shrinks.
 */
export function ratchetBaseline(overCaps: OverCap[], existing: FileCapsBaseline): FileCapsBaseline {
  const current = new Map<string, number>();
  for (const { path, metric, value } of overCaps) current.set(`${path}\0${metric}`, value);

  const next: FileCapsBaseline = Object.create(null) as FileCapsBaseline;
  for (const [path, ceilings] of Object.entries(existing)) {
    for (const metric of Object.keys(ceilings) as Metric[]) {
      const recorded = ceilings[metric];
      const now = current.get(`${path}\0${metric}`);
      if (recorded === undefined || now === undefined) continue; // dropped: under cap or gone
      record(next, path, metric, Math.min(now, recorded));
    }
  }
  return next;
}
