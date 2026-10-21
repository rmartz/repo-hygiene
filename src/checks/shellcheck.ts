import { boundedRun } from '../lib/bounded-subprocess.js';

/**
 * The shellcheck boundary shared by the `actionlint` and `composite-shellcheck`
 * checks: probing for the binary (both fail loudly when it is missing rather than
 * pass scripts nobody checked) and reading its `-f json1` output.
 */

const PROBE_TIMEOUT_MS = 10_000;

/** One entry of shellcheck's `-f json1` output. */
export interface ShellcheckComment {
  file: string;
  line: number;
  column: number;
  level: string;
  code: number;
  message: string;
}

/** Whether `shellcheck` is runnable from PATH. */
export async function hasShellcheck(env: NodeJS.ProcessEnv): Promise<boolean> {
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

/** Parse shellcheck's `-f json1` output (`{"comments": [...]}`). */
export function parseShellcheckJson(stdout: string): ShellcheckComment[] {
  const parsed: unknown = JSON.parse(stdout.trim() || '{"comments":[]}');
  const comments: unknown =
    typeof parsed === 'object' && parsed !== null && 'comments' in parsed
      ? parsed.comments
      : undefined;
  if (!Array.isArray(comments)) {
    throw new Error('shellcheck: expected {"comments": [...]} JSON output');
  }
  return comments as ShellcheckComment[];
}
