import { resolveFileSet, type ContentReader, type Mode, type ScanOptions } from './discovery.js';

/**
 * Block commits that introduce merge-conflict markers.
 *
 * A botched conflict resolution can leave markers behind; nothing else stops
 * them being committed and pushed, so they were only caught at review time. This
 * checker is the commit-time guard (run as a git `pre-commit` hook) plus a CI
 * backstop. TS port of dotfiles' `check_conflict_markers.py`.
 *
 * The file-set discovery it once owned now lives in `discovery.ts`, shared with
 * the check framework (#164); this module keeps the pure detector plus the
 * standalone `checkConflictMarkers` entrypoint the `ai-check-conflict-markers`
 * CLI wraps. The framework adapter lives in `checks/conflict-markers.ts`.
 *
 * Detection (full-triple, no doc special-casing): a file is flagged **only**
 * when it contains an unambiguous conflict **angle** marker — a line beginning
 * with seven `<` or seven `>` (`<<<<<<< HEAD`, `>>>>>>> branch`). These never
 * occur in normal source or Markdown. The separator line (seven `=`) and the
 * diff3 base line (seven `|`) are reported too, but **only** in a file that
 * already has an angle marker — so a Markdown setext underline or `=======`
 * divider is never a false positive.
 */

// Angle markers are unambiguous and flagged anywhere. Seven characters exactly,
// at line start, followed by whitespace or end-of-line.
const ANGLE_RE = /^(<<<<<<<|>>>>>>>)(\s|$)/;
// Separator / diff3-base lines. Only meaningful as conflict markers when an
// angle marker is also present in the same file (the full-triple rule), so a
// lone "=======" in docs is not mistaken for a conflict.
const MID_RE = /^(=======|\|\|\|\|\|\|\|)(\s|$)/;

/** A single conflict-marker line, 1-based line number. */
export interface MarkerLine {
  lineno: number;
  line: string;
}

/** A conflict-marker line attributed to a file path. */
export interface Violation extends MarkerLine {
  path: string;
}

/**
 * Return every conflict-marker line in `text`. Empty when the text has no angle
 * marker — the separator/base lines alone do not count, which is what keeps
 * Markdown `=======` underlines from being flagged. Line numbers are 1-based and
 * the result is sorted ascending.
 */
export function findConflictMarkers(text: string): MarkerLine[] {
  const lines = text.split('\n');
  const angles: MarkerLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (ANGLE_RE.test(line)) angles.push({ lineno: i + 1, line });
  }
  if (angles.length === 0) return [];
  const mids: MarkerLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (MID_RE.test(line)) mids.push({ lineno: i + 1, line });
  }
  return [...angles, ...mids].sort((a, b) => a.lineno - b.lineno);
}

/** Scan `paths`, reading each via `read`, and collect every marker violation. */
export async function scan(paths: string[], read: ContentReader): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const path of paths) {
    const text = await read(path);
    for (const { lineno, line } of findConflictMarkers(text)) {
      violations.push({ path, lineno, line });
    }
  }
  return violations;
}

export interface CheckOptions extends ScanOptions {
  /** Env bag for the `ALLOW_CONFLICT_MARKERS` bypass (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * Run the checker for `mode` and return its violations. In `--staged` mode the
 * `ALLOW_CONFLICT_MARKERS` env var short-circuits to an empty result, mirroring
 * the Python bypass.
 */
export async function checkConflictMarkers(
  mode: Mode,
  opts: CheckOptions = {},
): Promise<Violation[]> {
  const env = opts.env ?? process.env;
  if (mode === '--staged' && env.ALLOW_CONFLICT_MARKERS) return [];
  const { paths, read } = await resolveFileSet(mode, opts);
  return scan(paths, read);
}

/** Render the violation report exactly as the Python checker printed it. */
export function formatReport(violations: Violation[]): string {
  const lines = ['error: merge-conflict markers found in staged/changed content:'];
  for (const { path, lineno, line } of violations) {
    lines.push(`  ${path}:${lineno}: ${line}`);
  }
  lines.push(
    '\nResolve the conflict, or bypass intentionally with ' +
      '`git commit --no-verify` (or ALLOW_CONFLICT_MARKERS=1).',
  );
  return lines.join('\n');
}
