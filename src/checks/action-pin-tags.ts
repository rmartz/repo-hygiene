import type { Check, Finding } from '../types.js';
import { boundedRun } from '../lib/bounded-subprocess.js';
import { parseUsesLine } from './action-pins.js';

/**
 * Pin-comment tag resolution — the network-dependent companion to `action-pins`
 * (#66). `action-pins` proves a pin's `# vX.Y.Z` comment is *well-formed*; it
 * cannot prove the comment names a tag that exists upstream, and a well-formed
 * but false comment silently strands the pin (Dependabot never bumps it and no
 * check goes red). This check lists each upstream's tags with `git ls-remote` and
 * flags a comment that names no tag, or names a tag at a different commit.
 *
 * It is deliberately a separate, never-default-on check so `action-pins` stays
 * offline for SHA pins (it goes online only to confirm a first-party tag pin):
 * only a repo that names `action-pin-tags` pays a network call per upstream. An upstream that cannot be listed is never a failure, since it says
 * nothing about the change: a definitive "not found" or auth refusal (deleted,
 * renamed, or private without a token) yields a `warn` and is skipped, and any
 * other failure (rate limit, timeout, network error) makes the run inconclusive.
 */

const NAME = 'action-pin-tags';
const SHA = /^[0-9a-fA-F]{40}$/;
const LS_REMOTE_TIMEOUT_MS = 20_000;

/**
 * The `owner/repo` a SHA-pinned external `uses:` ref resolves against, or null
 * for refs this check does not verify (local, self-repo, docker, non-SHA pins —
 * `action-pins` already owns those).
 */
export function upstreamOf(uses: string): string | null {
  if (/^(?:\.\.?\/|\$\/|docker:\/\/)/.test(uses)) return null;
  const at = uses.lastIndexOf('@');
  if (at === -1 || !SHA.test(uses.slice(at + 1))) return null;
  const [owner, repo] = uses.slice(0, at).split('/');
  return owner && repo ? `${owner}/${repo}` : null;
}

/**
 * Parse `git ls-remote --tags` output into tag → commit SHA. An annotated tag
 * appears twice (the tag object, then `^{}` peeled to its commit); the peeled
 * commit wins, since that is what a SHA pin refers to.
 */
export function parseLsRemoteTags(stdout: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (!sha || !ref?.startsWith('refs/tags/')) continue;
    const name = ref.slice('refs/tags/'.length);
    if (name.endsWith('^{}')) tags.set(name.slice(0, -3), sha);
    else if (!tags.has(name)) tags.set(name, sha);
  }
  return tags;
}

/**
 * The tag a pin comment names, tolerating a `v`-prefix mismatch (`# 1.2.3`
 * against tag `v1.2.3`, or the reverse) — `action-pins` accepts either spelling.
 */
export function resolveTag(
  tags: Map<string, string>,
  comment: string,
): { tag: string; sha: string } | undefined {
  const alt = comment.startsWith('v') ? comment.slice(1) : `v${comment}`;
  for (const tag of [comment, alt]) {
    const sha = tags.get(tag);
    if (sha) return { tag, sha };
  }
  return undefined;
}

/**
 * Git env for a non-interactive `ls-remote`. A token (for private upstreams) is
 * injected as an HTTP header through `GIT_CONFIG_*` env vars — the same mechanism
 * `actions/checkout` uses — so it never appears in argv or the process list.
 */
function gitEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: '0' };
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    Object.assign(out, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
  }
  return out;
}

/**
 * `git ls-remote` stderr that definitively means the upstream can't be read with
 * the credentials at hand: it doesn't exist, or it is private and the token (if
 * any) can't see it. Anything else is treated as transient.
 */
// A 403 is deliberately absent: GitHub also answers a rate-limited request with
// 403, so it is treated as transient.
const UNREADABLE =
  /repository not found|authentication failed|could not read username|terminal prompts disabled|returned error: 40[14]\b/i;

/** Whether `git ls-remote` stderr names a definitive not-found / auth refusal. */
export function isUnreadableUpstream(stderr: string): boolean {
  return UNREADABLE.test(stderr);
}

/** Why an upstream's tags could not be listed, and whether that is transient. */
interface ListFailure {
  reason: string;
  transient: boolean;
}

/** List an upstream's tags, or why they could not be listed. */
async function listTags(
  repo: string,
  env: Record<string, string | undefined>,
): Promise<Map<string, string> | ListFailure> {
  try {
    const res = await boundedRun('git', ['ls-remote', '--tags', `https://github.com/${repo}.git`], {
      timeoutMs: LS_REMOTE_TIMEOUT_MS,
      env: gitEnv(env),
    });
    if (res.timedOut) {
      return { reason: `timed out after ${LS_REMOTE_TIMEOUT_MS / 1000}s`, transient: true };
    }
    if (res.code !== 0) {
      const reason = res.stderr.trim().split('\n')[0] || `git exited ${res.code}`;
      return { reason, transient: !isUnreadableUpstream(res.stderr) };
    }
    return parseLsRemoteTags(res.stdout);
  } catch (err) {
    return { reason: err instanceof Error ? err.message : String(err), transient: true };
  }
}

interface Pin {
  path: string;
  line: number;
  uses: string;
  comment: string;
  repo: string;
}

export const actionPinTagsCheck: Check = {
  name: NAME,
  description: 'GitHub Actions pin comments name an upstream tag at the pinned SHA (network).',
  // Default-on like every check, though it lists each upstream's tags over the
  // network: an unreachable upstream is inconclusive or warn-and-skip, never a
  // failure, so it is safe on any consumer.
  defaultOn: true,
  async run(ctx) {
    const pins: Pin[] = [];
    for (const path of ctx.files.paths) {
      if (!path.startsWith('.github/') || !/\.ya?ml$/.test(path)) continue;
      const text = await ctx.files.read(path);
      text.split('\n').forEach((lineText, i) => {
        const parsed = parseUsesLine(lineText);
        const repo = parsed && upstreamOf(parsed.uses);
        if (!parsed?.comment || !repo) return;
        pins.push({ path, line: i + 1, uses: parsed.uses, comment: parsed.comment, repo });
      });
    }

    // Start every distinct upstream's lookup before awaiting any, so a black-holed
    // network costs one timeout rather than one per upstream.
    const tagsByRepo = new Map(
      [...new Set(pins.map((pin) => pin.repo))].map((repo) => [repo, listTags(repo, ctx.env)]),
    );
    const warned = new Set<string>();
    const findings: Finding[] = [];
    for (const pin of pins) {
      const tags = await tagsByRepo.get(pin.repo)!;
      const at = { check: NAME, path: pin.path, line: pin.line };
      if (!(tags instanceof Map)) {
        if (warned.has(pin.repo)) continue;
        warned.add(pin.repo);
        findings.push({
          ...at,
          message: tags.transient
            ? `could not list tags for ${pin.repo} (${tags.reason}); its pins are unverified — re-run`
            : `could not list tags for ${pin.repo} (${tags.reason}); skipped its pins`,
          severity: tags.transient ? 'inconclusive' : 'warn',
        });
        continue;
      }
      const pinnedSha = pin.uses.slice(pin.uses.lastIndexOf('@') + 1).toLowerCase();
      const resolved = resolveTag(tags, pin.comment);
      if (!resolved) {
        findings.push({
          ...at,
          message: `${pin.uses} — version comment "# ${pin.comment}" names no tag in ${pin.repo}; Dependabot cannot bump a pin whose comment does not resolve`,
          severity: 'error',
        });
      } else if (resolved.sha.toLowerCase() !== pinnedSha) {
        findings.push({
          ...at,
          message: `${pin.uses} — tag ${resolved.tag} in ${pin.repo} points at ${resolved.sha.slice(0, 12)}, not the pinned SHA`,
          severity: 'error',
        });
      }
    }
    return findings;
  },
};
