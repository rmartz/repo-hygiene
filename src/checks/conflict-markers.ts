import { findConflictMarkers } from '../check-conflict-markers.js';
import type { Check, Finding } from '../types.js';

/**
 * Framework adapter over the pure {@link findConflictMarkers} detector — the
 * reference check that proves the registry shape (#164). The detection logic
 * stays in `check-conflict-markers.ts` (and behind the standalone
 * `ai-check-conflict-markers` CLI); this only maps its markers onto the generic
 * {@link Finding} contract and preserves the `--staged` bypass.
 */

const NAME = 'conflict-markers';

export const conflictMarkersCheck: Check = {
  name: NAME,
  description: 'Merge-conflict markers in tracked or staged content.',
  async run(ctx) {
    // Preserve the standalone checker's intentional pre-commit bypass.
    if (ctx.mode === '--staged' && ctx.env.ALLOW_CONFLICT_MARKERS) return [];
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      const text = await ctx.files.read(path);
      for (const { lineno, line } of findConflictMarkers(text)) {
        findings.push({ check: NAME, path, line: lineno, message: line, severity: 'error' });
      }
    }
    return findings;
  },
};
