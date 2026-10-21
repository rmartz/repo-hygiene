import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, CheckConfig, Finding } from '../types.js';
import { boundedRun } from '../lib/bounded-subprocess.js';
import { InconclusiveError } from '../outcome.js';
import { matchesIgnore, parseIgnore, parseShellcheckSeverity } from './actionlint-config.js';
import type { IgnoreRule, ShellcheckSeverity } from './actionlint-config.js';
import { actionLine, extractRunSteps, isActionPath } from './composite-steps.js';
import type { RunStep, ShellDialect } from './composite-steps.js';
import { hasShellcheck, parseShellcheckJson } from './shellcheck.js';

/**
 * Shellchecks the `run:` steps of composite actions (#126). actionlint lints only
 * `.github/workflows/*`, so the shell in an `action.yml`, the main product of
 * every `-action` repo, would otherwise go unchecked.
 *
 * Default-on at the `actionlint` check's recommended settings (shellcheck at
 * `warning` and above) with the same exceptions (`shellcheckSeverity`, per-glob
 * `ignore`). Tree-only: shellcheck runs locally, with no network.
 */

const NAME = 'composite-shellcheck';
const RUN_TIMEOUT_MS = 120_000;

export interface CompositeShellcheckSettings {
  /** The lowest shellcheck severity reported (default `warning`). */
  shellcheckSeverity: ShellcheckSeverity;
  /** Per-glob message ignores, keyed by `action.yml` path glob. */
  ignore: IgnoreRule[];
}

/** Parse and validate the check's `.repo-hygiene.yml` section. */
export function parseCompositeShellcheckSettings(
  settings: CheckConfig,
): CompositeShellcheckSettings {
  return {
    shellcheckSeverity: parseShellcheckSeverity(NAME, settings.shellcheckSeverity),
    ignore: parseIgnore(NAME, settings.ignore),
  };
}

/** A shell step queued for shellcheck, with the temp file it is written to. */
interface Script {
  path: string;
  step: RunStep;
  file: string;
}

const finding = (path: string, line: number | undefined, message: string): Finding => ({
  check: NAME,
  path,
  ...(line === undefined ? {} : { line }),
  message,
  severity: 'error',
});

/** Read every in-scope `action.yml`, collecting its shell steps and any defects. */
async function collectScripts(ctx: Parameters<Check['run']>[0]) {
  const scripts: Script[] = [];
  const findings: Finding[] = [];
  for (const path of ctx.files.paths.filter(isActionPath)) {
    const action = extractRunSteps(await ctx.files.read(path));
    if (action.kind === 'invalid') {
      findings.push(finding(path, action.line, `could not parse YAML: ${action.message}`));
      continue;
    }
    if (action.kind === 'other') continue;
    for (const step of action.steps) {
      if (step.shell === undefined) {
        findings.push(
          finding(path, step.line, `${step.label}: a composite \`run:\` step must set \`shell:\``),
        );
      } else if (step.dialect) {
        scripts.push({ path, step, file: `${scripts.length}.sh` });
      }
    }
  }
  return { scripts, findings };
}

/** Run shellcheck over `scripts` (all of one dialect) in `dir`, mapping its comments. */
async function shellcheck(
  scripts: Script[],
  dialect: ShellDialect,
  dir: string,
  settings: CompositeShellcheckSettings,
  env: NodeJS.ProcessEnv,
): Promise<Finding[]> {
  const args = ['-f', 'json1', '-s', dialect, '-S', settings.shellcheckSeverity];
  const res = await boundedRun('shellcheck', [...args, ...scripts.map((s) => s.file)], {
    timeoutMs: RUN_TIMEOUT_MS,
    cwd: dir,
    env,
  });
  if (res.timedOut) {
    throw new InconclusiveError(`shellcheck timed out after ${RUN_TIMEOUT_MS / 1000}s — re-run`);
  }
  // 0: clean, 1: issues found. Anything else is a fault, not a verdict.
  if (res.code !== 0 && res.code !== 1) {
    throw new Error(`${NAME}: shellcheck exited ${res.code}: ${res.stderr.trim()}`);
  }
  const byFile = new Map(scripts.map((s) => [s.file, s]));
  const findings: Finding[] = [];
  for (const comment of parseShellcheckJson(res.stdout)) {
    const script = byFile.get(comment.file);
    if (!script) throw new Error(`${NAME}: shellcheck reported an unknown file ${comment.file}`);
    const message = `${script.step.label}: ${comment.message} [SC${comment.code}]`;
    if (matchesIgnore(settings.ignore, script.path, message)) continue;
    findings.push(finding(script.path, actionLine(script.step, comment.line), message));
  }
  return findings;
}

export const compositeShellcheckCheck: Check = {
  name: NAME,
  description: "Shellchecks the `run:` steps of composite actions' action.yml.",
  defaultOn: true,
  async run(ctx) {
    const settings = parseCompositeShellcheckSettings(ctx.settings);
    const { scripts, findings } = await collectScripts(ctx);
    if (scripts.length === 0) return findings;

    const env: NodeJS.ProcessEnv = { ...ctx.env };
    if (!(await hasShellcheck(env))) {
      findings.push({
        check: NAME,
        message:
          'shellcheck is not on PATH, so no composite `run:` step was shellchecked; install shellcheck, or take an exception with `enabled: false` (and a comment saying why)',
        severity: 'error',
      });
      return findings;
    }

    const dir = await mkdtemp(join(tmpdir(), 'repo-hygiene-composite-'));
    try {
      for (const s of scripts) await writeFile(join(dir, s.file), s.step.script);
      for (const dialect of ['bash', 'sh'] as const) {
        const group = scripts.filter((s) => s.step.dialect === dialect);
        if (group.length > 0)
          findings.push(...(await shellcheck(group, dialect, dir, settings, env)));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return findings.sort(
      (a, b) => (a.path ?? '').localeCompare(b.path ?? '') || (a.line ?? 0) - (b.line ?? 0),
    );
  },
};
