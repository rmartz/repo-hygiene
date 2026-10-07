import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Check, Finding } from '../types.js';
import { boundedRun } from '../lib/bounded-subprocess.js';
import { InconclusiveError } from '../outcome.js';
import { installActionlint } from './actionlint-binary.js';
import { isIgnored, parseActionlintSettings } from './actionlint-config.js';

/**
 * Workflow linting with [actionlint](https://github.com/rhysd/actionlint) (#104):
 * type-checks `${{ }}` expressions, validates `workflow_call` inputs, outputs and
 * secrets, and runs shellcheck over every `run:` block. A mistyped expression in a
 * shipped reusable workflow never fails in the repo that owns it, only later in a
 * consumer's CI, which is the gap this closes.
 *
 * Default-on at recommended settings (see `actionlint-config.ts`). It downloads a
 * pinned actionlint release, so like every network check it fails safe: a download
 * that can't complete is inconclusive, never an `error`.
 */

const NAME = 'actionlint';
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const RUN_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 10_000;

/** One entry of actionlint's `-format '{{json .}}'` output. */
export interface ActionlintError {
  message: string;
  filepath: string;
  line: number;
  column: number;
  kind: string;
}

/** Whether a repo-relative path is a workflow actionlint lints. */
export const isWorkflowPath = (path: string): boolean => WORKFLOW.test(path);

/**
 * Parse actionlint's JSON output, normalizing each `filepath` (relative to the
 * directory actionlint ran in, or absolute) to a repo-relative POSIX path.
 */
export function parseActionlintJson(stdout: string, cwd: string): ActionlintError[] {
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  if (!Array.isArray(parsed)) throw new Error('actionlint: expected a JSON array of errors');
  return (parsed as ActionlintError[]).map((e) => {
    const abs = isAbsolute(e.filepath) ? e.filepath : resolve(cwd, e.filepath);
    return { ...e, filepath: relative(cwd, abs).split(sep).join('/') };
  });
}

/** Whether `shellcheck` is runnable from PATH. */
async function hasShellcheck(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const res = await boundedRun('shellcheck', ['--version'], {
      timeoutMs: PROBE_TIMEOUT_MS,
      env,
    });
    return res.code === 0;
  } catch {
    return false; // spawn ENOENT: not installed
  }
}

export const actionlintCheck: Check = {
  name: NAME,
  description: 'Lints GitHub Actions workflows with a pinned actionlint, shellcheck included.',
  defaultOn: true,
  async run(ctx) {
    const settings = parseActionlintSettings(ctx.settings);
    const workflows = ctx.files.paths.filter(isWorkflowPath);
    if (workflows.length === 0) return [];

    const cwd = ctx.cwd ?? process.cwd();
    const env: NodeJS.ProcessEnv = { ...ctx.env };
    const findings: Finding[] = [];
    let shellcheck = settings.shellcheck;
    if (shellcheck && !(await hasShellcheck(env))) {
      // actionlint silently skips shellcheck when it is missing; say so loudly
      // rather than pass `run:` blocks nobody checked.
      findings.push({
        check: NAME,
        message:
          'shellcheck is not on PATH, so no `run:` block was shellchecked; install shellcheck, or take an exception with `shellcheck: false` (and a comment saying why)',
        severity: 'error',
      });
      shellcheck = false;
    }
    if (shellcheck && settings.shellcheckSeverity !== 'style') {
      env.SHELLCHECK_OPTS = `-S ${settings.shellcheckSeverity}`;
    }

    const binary = await installActionlint();
    const args = ['-format', '{{json .}}', '-no-color'];
    if (!shellcheck) args.push('-shellcheck=');
    let res;
    try {
      res = await boundedRun(binary, [...args, ...workflows], {
        timeoutMs: RUN_TIMEOUT_MS,
        cwd,
        env,
      });
    } finally {
      await rm(dirname(binary), { recursive: true, force: true });
    }
    if (res.timedOut) {
      throw new InconclusiveError(`actionlint timed out after ${RUN_TIMEOUT_MS / 1000}s — re-run`);
    }
    // 0: clean, 1: lint errors found. 2 (bad flags) and 3 (fatal) are faults.
    if (res.code !== 0 && res.code !== 1) {
      throw new Error(`actionlint exited ${res.code}: ${res.stderr.trim()}`);
    }

    for (const e of parseActionlintJson(res.stdout, cwd)) {
      if (isIgnored(settings.ignore, e.filepath, e.message)) continue;
      findings.push({
        check: NAME,
        path: e.filepath,
        line: e.line,
        message: `${e.message} [${e.kind}]`,
        severity: 'error',
      });
    }
    return findings;
  },
};
