import { boundedRun } from '../lib/bounded-subprocess.js';
import type { BaseRefMode } from './file-caps-config.js';
import { InconclusiveError } from '../outcome.js';

/**
 * Base-ref reads for the file-caps `ratchet` and `grandfather` modes: whether a
 * file was already over its cap — and, for `ratchet`, its ceiling — is decided
 * by its content on the base ref (by default `origin/main`), so a change that
 * shrinks a file tightens its treatment once it reaches that ref.
 */

const GIT_TIMEOUT_MS = 30_000;

const git = (args: string[], cwd: string) =>
  boundedRun('git', args, { timeoutMs: GIT_TIMEOUT_MS, cwd });

/**
 * Fail loudly when `base` does not resolve to a commit. A shallow CI checkout
 * (`actions/checkout`'s default `fetch-depth: 1`) has no `origin/main`, and
 * silently treating that as "nothing is grandfathered" or "everything is" would
 * make the check either spuriously red or vacuous.
 */
export async function assertBaseRef(base: string, mode: BaseRefMode, cwd: string): Promise<void> {
  const r = await git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd);
  if (r.timedOut)
    throw new InconclusiveError(`file-caps: timed out verifying base ref ${JSON.stringify(base)}`);
  if (r.code !== 0) {
    throw new Error(
      `file-caps: mode: ${mode} cannot resolve base ref ${JSON.stringify(base)}; ` +
        'fetch it first (e.g. actions/checkout with fetch-depth: 0)',
    );
  }
}

/**
 * Content of each of `paths` on `base`. A path absent there (new, or renamed
 * since) is omitted from the result, so it is enforced like any new file.
 */
export async function readAtBase(
  paths: string[],
  base: string,
  cwd: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of paths) {
    const r = await git(['show', `${base}:${path}`], cwd);
    // A timeout says nothing about the change, so the run is inconclusive.
    if (r.timedOut) throw new InconclusiveError(`file-caps: timed out reading ${path} at ${base}`);
    if (r.code === 0) out.set(path, r.stdout);
  }
  return out;
}
