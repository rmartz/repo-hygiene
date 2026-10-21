import { LineCounter, isMap, isScalar, parseDocument, type Node } from 'yaml';
import type { Check, Finding } from '../types.js';
import { isWorkflowPath } from './actionlint.js';
import {
  isJobIgnored,
  parseJobTimeoutSettings,
  type JobTimeoutSettings,
} from './job-timeouts-config.js';

/**
 * Bounded job timeouts. GitHub's default job timeout is 360 minutes, so a hung
 * step (a stalled download, a waiting prompt, a deadlocked test) can burn hours
 * of runner time before anything fails. Every job under `jobs:` in a workflow
 * must set an explicit `timeout-minutes` at or below the cap. actionlint
 * validates the key when present but never requires it.
 *
 * A reusable-workflow caller (a job with `uses:`) is exempt: GitHub rejects
 * `timeout-minutes` on it, and the called workflow's own jobs carry the bound.
 * YAML that doesn't parse is left to actionlint.
 */

const NAME = 'job-timeouts';

export interface TimeoutError {
  job: string;
  line: number;
  reason: string;
}

/** Scan one workflow's text for jobs without a bounded `timeout-minutes`. */
export function scanJobTimeouts(
  file: string,
  text: string,
  settings: JobTimeoutSettings,
): TimeoutError[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  if (doc.errors.length > 0) return [];
  const jobs = doc.get('jobs', true);
  if (!isMap(jobs)) return [];
  const lineOf = (node: unknown, fallback: number): number =>
    isNode(node) && node.range ? lineCounter.linePos(node.range[0]).line : fallback;

  const errors: TimeoutError[] = [];
  for (const { key, value } of jobs.items) {
    const job = isScalar(key) ? String(key.value) : String(key);
    if (!isMap(value) || value.has('uses') || isJobIgnored(settings.ignore, file, job)) continue;
    const jobLine = lineOf(key, 1);
    const timeout = value.get('timeout-minutes', true);
    const reason = timeoutReason(isScalar(timeout) ? timeout.value : timeout, settings);
    if (reason) errors.push({ job, line: lineOf(timeout, jobLine), reason });
  }
  return errors;
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && 'range' in value;

/** Why a job-level `timeout-minutes` value fails the policy, or null if it passes. */
function timeoutReason(value: unknown, settings: JobTimeoutSettings): string | null {
  const cap = settings.maxMinutes;
  if (value === undefined) {
    return `no timeout-minutes (GitHub's default is 360); set one of at most ${cap}`;
  }
  if (typeof value === 'string' && value.includes('${{')) {
    return settings.allowExpressions
      ? null
      : `timeout-minutes is an expression, which cannot be verified against the ${cap}-minute cap; use a literal number`;
  }
  if (typeof value !== 'number' || !(value > 0)) {
    return `timeout-minutes ${JSON.stringify(value)} is not a positive number of minutes`;
  }
  if (value > cap) {
    return `timeout-minutes ${value} exceeds the ${cap}-minute cap`;
  }
  return null;
}

export const jobTimeoutsCheck: Check = {
  name: NAME,
  description: 'Every workflow job sets a timeout-minutes at or below a cap (default 15).',
  // Default-on: offline, inspects only `.github/workflows/*` YAML, and every
  // finding is relaxable (`maxMinutes`, `allowExpressions`, `ignore`).
  defaultOn: true,
  async run(ctx) {
    const settings = parseJobTimeoutSettings(ctx.settings);
    const findings: Finding[] = [];
    for (const path of ctx.files.paths.filter(isWorkflowPath)) {
      const text = await ctx.files.read(path);
      for (const { job, line, reason } of scanJobTimeouts(path, text, settings)) {
        findings.push({
          check: NAME,
          path,
          line,
          message: `job "${job}": ${reason}`,
          severity: 'error',
        });
      }
    }
    return findings;
  },
};
