import picomatch from 'picomatch';
import type { Check, CheckConfig, Finding } from '../types.js';
import { boundedRun } from '../lib/bounded-subprocess.js';
import { InconclusiveError } from '../outcome.js';

/**
 * Public → private reference guard (#87). A public repo's docs, comments, and
 * agent guidance are readable by anyone, so a reference to a private repo in the
 * same account (`owner/private#12`, a `github.com/owner/private/...` URL, or a
 * bare `owner/private`) is a 404 for public readers and leaks the private repo's
 * name and issue numbers. The allowed direction is one-way: a private repo may
 * reference anything; a public repo may reference only public repos.
 *
 * The check resolves the repo under test, asks the GitHub API for its visibility,
 * and no-ops unless it is public. It then scans every in-scope text file for
 * same-owner references and looks each distinct one up. A repo the token cannot
 * see (404) is treated as private — a public reader cannot see it either. Any
 * other lookup failure (rate limit, 5xx, timeout, offline) is transient and makes
 * the affected references inconclusive, never a failure.
 *
 * Opt-in only: it makes a network call per referenced repo.
 */

const NAME = 'private-repo-refs';
const API_TIMEOUT_MS = 20_000;
const GIT_TIMEOUT_MS = 10_000;
/** Generated history, not guidance: always excluded; `exclude` adds more globs. */
const DEFAULT_EXCLUDE = ['**/CHANGELOG.md'];
const FULL_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

interface Settings {
  repository?: string;
  exclude: string[];
}

/** Parse and validate this check's `.repo-hygiene.yml` section. */
export function parseSettings(settings: CheckConfig): Settings {
  const { repository, exclude } = settings;
  if (repository !== undefined && (typeof repository !== 'string' || !FULL_NAME.test(repository))) {
    throw new Error(`${NAME}: "repository" must be an "owner/repo" string`);
  }
  if (
    exclude !== undefined &&
    (!Array.isArray(exclude) || !exclude.every((g) => typeof g === 'string'))
  ) {
    throw new Error(`${NAME}: "exclude" must be a list of glob strings`);
  }
  return { repository, exclude: [...DEFAULT_EXCLUDE, ...(exclude ?? [])] };
}

/** The `owner/repo` a GitHub remote URL (https or ssh) points at, or null. */
export function parseGithubRemote(url: string): string | null {
  const m = /github\.com[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Every reference to a repo under `owner` in `text`, with its 1-based line — the
 * pure, unit-tested core. Recognizes `owner/repo#N`, `github.com/owner/repo/...`
 * URLs, and bare `owner/repo`. A bare match must not continue a path, word, or
 * npm scope (`@owner/pkg` is a package, not a repo), so `docs/owner/x` and
 * `@owner/x` are ignored. Repo names are returned lower-cased (GitHub names are
 * case-insensitive), with a trailing `.git` or sentence-ending `.` stripped.
 */
export function findRepoRefs(text: string, owner: string): { repo: string; line: number }[] {
  const esc = owner.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const pattern = new RegExp(
    String.raw`(?:(?<![\w.@/-])|(?<=github\.com/)|(?<=githubusercontent\.com/))${esc}/([A-Za-z0-9._-]+)`,
    'gi',
  );
  const refs: { repo: string; line: number }[] = [];
  text.split('\n').forEach((lineText, i) => {
    const seen = new Set<string>();
    for (const m of lineText.matchAll(pattern)) {
      const repo = m[1]!
        .replace(/\.+$/, '')
        .replace(/\.git$/i, '')
        .toLowerCase();
      if (!repo || seen.has(repo)) continue;
      seen.add(repo);
      refs.push({ repo, line: i + 1 });
    }
  });
  return refs;
}

/** A repo's visibility, or why it could not be determined (always transient). */
export type Visibility = 'public' | 'private' | { reason: string };

/**
 * Look up `fullName`'s visibility with the GitHub REST API. A 404 means the token
 * (or an anonymous caller) cannot see the repo, which is exactly what a public
 * reader experiences, so it counts as private. Every other non-200 is transient.
 */
export async function fetchVisibility(
  fullName: string,
  env: Record<string, string | undefined>,
): Promise<Visibility> {
  const api = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  try {
    const res = await fetch(`${api}/repos/${fullName}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': '@rmartz/repo-hygiene',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 404) return 'private';
    if (!res.ok) return { reason: `GitHub API returned HTTP ${res.status}` };
    const body = (await res.json()) as { private?: unknown };
    return body.private === false ? 'public' : 'private';
  } catch (err) {
    return { reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The repo under test: the `repository` setting, else `GITHUB_REPOSITORY` (set in
 * Actions), else the `origin` remote. Null when none resolves.
 */
async function resolveRepository(
  configured: string | undefined,
  env: Record<string, string | undefined>,
  cwd: string | undefined,
): Promise<string | null> {
  if (configured) return configured;
  if (env.GITHUB_REPOSITORY && FULL_NAME.test(env.GITHUB_REPOSITORY)) return env.GITHUB_REPOSITORY;
  try {
    const res = await boundedRun('git', ['remote', 'get-url', 'origin'], {
      timeoutMs: GIT_TIMEOUT_MS,
      cwd,
    });
    return res.code === 0 ? parseGithubRemote(res.stdout) : null;
  } catch {
    return null;
  }
}

interface Ref {
  path: string;
  line: number;
  repo: string;
}

export const privateRepoRefsCheck: Check = {
  name: NAME,
  description: 'A public repo references no private repo in the same account (network).',
  // Never default-on: it calls the GitHub API per referenced repo, which the
  // default suite's offline, tree-only cost model deliberately excludes.
  async run(ctx) {
    const settings = parseSettings(ctx.settings);
    const self = await resolveRepository(settings.repository, ctx.env, ctx.cwd);
    if (!self) {
      return [
        {
          check: NAME,
          message:
            'could not determine this repository (set GITHUB_REPOSITORY or the "repository" setting); skipped',
          severity: 'warn',
        },
      ];
    }
    const selfVisibility = await fetchVisibility(self, ctx.env);
    if (typeof selfVisibility === 'object') {
      throw new InconclusiveError(
        `could not look up ${self}'s visibility (${selfVisibility.reason}) — re-run`,
      );
    }
    if (selfVisibility === 'private') return [];

    const [owner, selfName] = self.toLowerCase().split('/') as [string, string];
    const isExcluded = picomatch(settings.exclude, { dot: true });
    const refs: Ref[] = [];
    for (const path of ctx.files.paths) {
      if (isExcluded(path)) continue;
      const text = await ctx.files.read(path);
      if (text.includes('\0')) continue; // binary
      for (const { repo, line } of findRepoRefs(text, owner)) {
        if (repo !== selfName) refs.push({ path, line, repo });
      }
    }

    // Start every distinct lookup before awaiting any, so a black-holed network
    // costs one timeout rather than one per referenced repo.
    const lookups = new Map(
      [...new Set(refs.map((r) => r.repo))].map((repo) => [
        repo,
        fetchVisibility(`${owner}/${repo}`, ctx.env),
      ]),
    );
    const reportedTransient = new Set<string>();
    const findings: Finding[] = [];
    for (const ref of refs) {
      const visibility = await lookups.get(ref.repo)!;
      const fullName = `${owner}/${ref.repo}`;
      const at = { check: NAME, path: ref.path, line: ref.line };
      if (typeof visibility === 'object') {
        if (reportedTransient.has(ref.repo)) continue;
        reportedTransient.add(ref.repo);
        findings.push({
          ...at,
          message: `could not look up ${fullName}'s visibility (${visibility.reason}); its references are unverified — re-run`,
          severity: 'inconclusive',
        });
      } else if (visibility === 'private') {
        findings.push({
          ...at,
          message: `references private repo ${fullName} from public ${self} — public readers get a 404, and the reference exposes the private repo's name`,
          severity: 'error',
        });
      }
    }
    return findings;
  },
};
