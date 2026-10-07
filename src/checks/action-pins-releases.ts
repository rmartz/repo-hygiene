import type { CheckConfig } from '../types.js';

/**
 * Exact-tag pins on immutable first-party releases — the `action-pins` exception
 * (#76). Dependabot raises no security alerts for SHA-pinned actions, so a fleet
 * that SHA-pins everything never hears about an advisory on its own actions. A
 * release published with GitHub's immutable releases on can't have its tag moved,
 * deleted or reused, which makes an exact `vX.Y.Z` tag pin on it about as safe as a
 * SHA pin while keeping Dependabot security updates working.
 *
 * Owner allowlisting alone is not trusted: the release's `immutable` flag is
 * confirmed through the GitHub REST API, and every way that confirmation can fail
 * fails closed — a definitive answer (no release, or a mutable one) is an `error`,
 * and an unreachable API is `inconclusive`. Third-party actions stay SHA-pinned,
 * since we can't rely on their publishers having turned immutability on.
 */

const NAME = 'action-pins';
// Only an exact release tag is eligible — never a floating major (`v2`) or branch.
export const EXACT_TAG = /^v\d+\.\d+\.\d+$/;
const API_TIMEOUT_MS = 20_000;

/**
 * The owners whose refs may be tag-pinned: the `tagPinOwners` setting, else the
 * repository's own owner from the Actions env. Outside Actions with no config the
 * list is empty, so every tag pin falls back to needing a SHA.
 */
export function tagPinOwners(
  settings: CheckConfig,
  env: Record<string, string | undefined>,
): string[] {
  const value = settings.tagPinOwners;
  if (value !== undefined) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
    throw new Error(`${NAME}: "tagPinOwners" must be a list of strings`);
  }
  const owner = env.GITHUB_REPOSITORY_OWNER || env.GITHUB_REPOSITORY?.split('/')[0];
  return owner ? [owner] : [];
}

/** Whether a `uses:` ref's owner is on the tag-pin allowlist (case-insensitive). */
export function isTagPinOwner(uses: string, owners: readonly string[]): boolean {
  const owner = uses.split('/')[0]?.toLowerCase();
  return !!owner && owners.some((o) => o.toLowerCase() === owner);
}

/**
 * The release a `uses:` ref must resolve to for its tag pin to be accepted, or null
 * when the ref is not an exact-tag pin by an allowlisted owner.
 */
export function tagPinTarget(
  uses: string,
  owners: readonly string[],
): { repo: string; tag: string } | null {
  const at = uses.lastIndexOf('@');
  if (at === -1 || !isTagPinOwner(uses, owners)) return null;
  const tag = uses.slice(at + 1);
  const [owner, repo] = uses.slice(0, at).split('/');
  return EXACT_TAG.test(tag) && owner && repo ? { repo: `${owner}/${repo}`, tag } : null;
}

/** What the API said about a release's immutability. */
export type ReleaseLookup =
  | { kind: 'immutable' }
  | { kind: 'mutable' }
  | { kind: 'missing'; reason: string }
  | { kind: 'transient'; reason: string };

/**
 * Look up `repo`'s release for `tag` and report whether it is immutable. A 404 is
 * definitive (no release, or a private repo the token can't see); a 401 is a
 * definitive auth refusal. Anything else — a 403 (GitHub's rate-limit status too),
 * 429, 5xx, a timeout, no network — is transient.
 */
export async function lookupRelease(
  repo: string,
  tag: string,
  env: Record<string, string | undefined>,
): Promise<ReleaseLookup> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    );
    if (res.status === 404 || res.status === 401) {
      return { kind: 'missing', reason: `HTTP ${res.status}` };
    }
    if (!res.ok) return { kind: 'transient', reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { immutable?: unknown };
    return body.immutable === true ? { kind: 'immutable' } : { kind: 'mutable' };
  } catch (err) {
    return { kind: 'transient', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The finding for a tag pin whose release lookup came back, or null when the
 * release is immutable and the pin is accepted.
 */
export function releaseFinding(
  uses: string,
  target: { repo: string; tag: string },
  lookup: ReleaseLookup,
): { message: string; severity: 'error' | 'inconclusive' } | null {
  const { repo, tag } = target;
  const fallback = 'pin to a full 40-char commit SHA instead';
  switch (lookup.kind) {
    case 'immutable':
      return null;
    case 'mutable':
      return {
        message: `${uses} — release ${tag} in ${repo} is not immutable; a tag pin is only accepted on an immutable release — ${fallback}`,
        severity: 'error',
      };
    case 'missing':
      return {
        message: `${uses} — no release ${tag} found in ${repo} (${lookup.reason}; a private repo needs GITHUB_TOKEN); a tag pin needs an immutable release — ${fallback}`,
        severity: 'error',
      };
    case 'transient':
      return {
        message: `${uses} — could not confirm release ${tag} in ${repo} is immutable (${lookup.reason}); re-run, and set GITHUB_TOKEN to avoid unauthenticated rate limits`,
        severity: 'inconclusive',
      };
  }
}
