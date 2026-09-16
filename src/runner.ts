import { resolveFileSet, type Mode } from './discovery.js';
import type { Finding, RepoHygieneConfig } from './types.js';
import type { Registry } from './registry.js';

/**
 * The engine: resolve the file set once, run the selected checks over it, apply
 * each check's config `severity` override (the migration ramp), and derive the
 * exit code. `error` findings drive `exit 1`; a `warn`-only run exits `0`.
 */

export interface RunRequest {
  mode: Mode;
  /** Check names to run; empty or omitted → every registered check. */
  only?: string[];
  config: RepoHygieneConfig;
  cwd?: string;
  /** Environment bag passed to each check (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

export interface RunResult {
  /** Every finding, with its effective (post-override) severity. */
  findings: Finding[];
  /** `1` if any finding is an `error`, else `0`. */
  exitCode: number;
}

/** Resolve which checks to run for a request; throws on an unknown name. */
function selectChecks(registry: Registry, only?: string[]) {
  if (!only || only.length === 0) return registry.all();
  return only.map((name) => {
    const check = registry.get(name);
    if (!check) throw new Error(`unknown check: ${name}`);
    return check;
  });
}

/**
 * Run `req` against `registry`. Each check runs over the same resolved file set,
 * so a per-check invocation and an all-checks invocation see identical inputs.
 */
export async function runHygiene(registry: Registry, req: RunRequest): Promise<RunResult> {
  const env = req.env ?? process.env;
  const files = await resolveFileSet(req.mode, { cwd: req.cwd });
  const checks = selectChecks(registry, req.only);
  const findings: Finding[] = [];
  for (const check of checks) {
    const settings = req.config.checks[check.name] ?? {};
    const raw = await check.run({ mode: req.mode, files, cwd: req.cwd, settings, env });
    const override = settings.severity;
    for (const finding of raw) {
      findings.push(override ? { ...finding, severity: override } : finding);
    }
  }
  const exitCode = findings.some((f) => f.severity === 'error') ? 1 : 0;
  return { findings, exitCode };
}
