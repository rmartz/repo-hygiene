import { repoPathExists } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';
import { intraRepoTarget, resolveRel, scanLinks } from './md-links.js';

/**
 * Docs link integrity — intra-repo relative Markdown links must resolve to a
 * file that exists. `okf` validates only a page's `resource:` frontmatter target
 * and `okf-index` only that content pages are *reachable* from an index; neither
 * checks that the inline `[text](path)` links in a page body still point at a
 * real file. When a docs page or a source file is renamed, moved, or deleted,
 * such a link silently rots — it still parses, but a reader hits a 404. This
 * check resolves every intra-repo link target (relative Markdown links between
 * docs pages and links from `docs/**` into source) and flags any whose path no
 * longer exists on disk.
 *
 * Static, filesystem-only: external `http(s)`/`mailto` links, pure `#anchor`
 * links, and absolute paths are out of scope (no network fetching — hermetic by
 * construction). Anchor *validity* is neighbouring work (#204/#226); only the
 * file part of a link is resolved.
 */

const NAME = 'docs-links';

const DEFAULT_ROOTS = ['docs'];
const DEFAULT_EXEMPT: string[] = [];

interface DocsLinksConfig {
  roots: string[];
  /** Resolved target paths allowed to dangle (intentionally-missing links). */
  exempt: string[];
}

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

function resolveConfig(settings: CheckConfig): DocsLinksConfig {
  return {
    roots: stringList(settings, 'roots', DEFAULT_ROOTS),
    exempt: stringList(settings, 'exempt', DEFAULT_EXEMPT),
  };
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** A docs Markdown page under a scanned root. */
function inScope(path: string, cfg: DocsLinksConfig): boolean {
  if (!path.endsWith('.md')) return false;
  return cfg.roots.some((root) => isUnder(path, root));
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

/** Validate one page's intra-repo links; a finding per broken (missing) target. */
export function checkDocLinks(
  path: string,
  content: string,
  cfg: DocsLinksConfig,
  existsFn: (target: string) => boolean,
): Finding[] {
  const fromDir = dirOf(path);
  const exempt = new Set(cfg.exempt);
  const findings: Finding[] = [];
  for (const { href, line } of scanLinks(content)) {
    const rel = intraRepoTarget(href);
    if (rel === null) continue; // external, anchor-only, or absolute — out of scope
    const target = resolveRel(fromDir, rel);
    if (target === '' || exempt.has(target) || existsFn(target)) continue;
    findings.push({
      check: NAME,
      path,
      line,
      message: `broken link: ${href} → ${target} does not exist`,
      severity: 'error',
    });
  }
  return findings;
}

export const docsLinksCheck: Check = {
  name: NAME,
  description: 'Intra-repo relative Markdown links in docs pages must resolve to a file on disk.',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    const exists = await repoPathExists(ctx.mode, { cwd: ctx.cwd });
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      if (!inScope(path, cfg)) continue;
      const text = await ctx.files.read(path);
      findings.push(...checkDocLinks(path, text, cfg, exists));
    }
    return findings;
  },
};
