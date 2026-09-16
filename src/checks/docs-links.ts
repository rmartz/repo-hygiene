import { repoPathExists } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';
import { collectAnchors } from './md-anchors.js';
import { parseLinkTarget, resolveRel, scanLinks } from './md-links.js';

/**
 * Docs link integrity — intra-repo relative Markdown links must resolve to a
 * file that exists, and (when `anchors` is enabled) their `#anchor` fragment must
 * match a heading or explicit anchor in the target page. `okf` validates only a
 * page's `resource:` frontmatter target and `okf-index` only that content pages
 * are *reachable* from an index; neither checks that the inline `[text](path)`
 * links in a page body still point at a real file, let alone a real section. When
 * a docs page, a source file, or a heading is renamed, moved, or deleted, such a
 * link silently rots — it still parses, but a reader hits a 404 or lands nowhere.
 *
 * Static, filesystem-only: external `http(s)`/`mailto` links and absolute paths
 * are out of scope (no network fetching — hermetic by construction). Anchor
 * validation covers same-document (`#section`) and cross-document
 * (`other.md#section`) links to Markdown files; anchors into non-Markdown targets
 * and source line ranges (`#L10`, `#L10-L20`) are skipped, not flagged.
 */

const NAME = 'docs-links';

const DEFAULT_ROOTS = ['docs'];
const DEFAULT_EXEMPT: string[] = [];
const DEFAULT_ANCHORS = false;

/** Anchors resolver: the anchor set of a target page, or `null` to skip (non-md/unreadable). */
export type AnchorsFor = (target: string) => ReadonlySet<string> | null;

interface DocsLinksConfig {
  roots: string[];
  /** Resolved target paths allowed to dangle (intentionally-missing links). */
  exempt: string[];
  /** Validate `#anchor` fragments against the target page's headings/anchors. */
  anchors: boolean;
  /** `target#anchor` / `#anchor` / raw href strings allowed to dangle. */
  anchorExempt: string[];
}

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

function boolFlag(settings: CheckConfig, key: string, fallback: boolean): boolean {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw new Error(`${NAME}: "${key}" must be a boolean`);
}

function resolveConfig(settings: CheckConfig): DocsLinksConfig {
  return {
    roots: stringList(settings, 'roots', DEFAULT_ROOTS),
    exempt: stringList(settings, 'exempt', DEFAULT_EXEMPT),
    anchors: boolFlag(settings, 'anchors', DEFAULT_ANCHORS),
    anchorExempt: stringList(settings, 'anchorExempt', []),
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

const decodeAnchor = (anchor: string): string => {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
};

/** A GitHub source-view line anchor (`#L10`, `#L10-L20`) — a source convention, not a heading. */
const isLineAnchor = (anchor: string): boolean => /^L\d+(-L\d+)?$/.test(anchor);

/** Report a missing `#anchor` in `target` (or the same page when `sameDoc`). */
function anchorFinding(
  path: string,
  line: number,
  href: string,
  anchor: string,
  target: string,
  sameDoc: boolean,
): Finding {
  return {
    check: NAME,
    path,
    line,
    message: sameDoc
      ? `broken anchor: #${anchor} has no matching heading in this page`
      : `broken anchor: ${href} → #${anchor} not found in ${target}`,
    severity: 'error',
  };
}

/** Validate one page's intra-repo links; a finding per broken file target or anchor. */
export function checkDocLinks(
  path: string,
  content: string,
  cfg: DocsLinksConfig,
  existsFn: (target: string) => boolean,
  anchorsFor?: AnchorsFor,
): Finding[] {
  const fromDir = dirOf(path);
  const exempt = new Set(cfg.exempt);
  const anchorExempt = new Set(cfg.anchorExempt);
  const findings: Finding[] = [];
  for (const { href, line } of scanLinks(content)) {
    const parsed = parseLinkTarget(href);
    if (parsed === null) continue; // external, absolute, or empty — out of scope
    const sameDoc = parsed.path === null;

    let target = path; // same-document links resolve against the current page
    if (!sameDoc) {
      target = resolveRel(fromDir, parsed.path as string);
      if (target === '' || exempt.has(target)) continue;
      if (!existsFn(target)) {
        findings.push({
          check: NAME,
          path,
          line,
          message: `broken link: ${href} → ${target} does not exist`,
          severity: 'error',
        });
        continue; // don't anchor-check a target that isn't there
      }
    }

    if (!cfg.anchors || !anchorsFor || parsed.anchor === null) continue;
    const anchor = decodeAnchor(parsed.anchor);
    if (isLineAnchor(anchor)) continue;
    const key = sameDoc ? `#${anchor}` : `${target}#${anchor}`;
    if (anchorExempt.has(key) || anchorExempt.has(`#${anchor}`) || anchorExempt.has(href)) continue;
    const set = anchorsFor(target);
    if (set === null) continue; // non-markdown or unreadable target — skip anchor check
    if (set.has(anchor) || set.has(anchor.toLowerCase())) continue;
    findings.push(anchorFinding(path, line, href, anchor, target, sameDoc));
  }
  return findings;
}

/** All `.md` targets referenced by a page's links (resolved, deduped), for anchor pre-read. */
function referencedMdTargets(path: string, content: string): string[] {
  const fromDir = dirOf(path);
  const targets = new Set<string>();
  for (const { href } of scanLinks(content)) {
    const parsed = parseLinkTarget(href);
    if (parsed === null || parsed.path === null) continue;
    const target = resolveRel(fromDir, parsed.path);
    if (target.endsWith('.md')) targets.add(target);
  }
  return [...targets];
}

export const docsLinksCheck: Check = {
  name: NAME,
  description:
    'Intra-repo relative Markdown links in docs pages must resolve to a file on disk; optionally validate #anchors.',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    const exists = await repoPathExists(ctx.mode, { cwd: ctx.cwd });
    const pages = ctx.files.paths.filter((p) => inScope(p, cfg));

    const contents = new Map<string, string>();
    for (const p of pages) contents.set(p, await ctx.files.read(p));

    // Build the anchor cache once: in-scope pages from content already read, plus
    // any cross-document `.md` target read on demand. A page linked from many
    // places is slugged once.
    const anchorCache = new Map<string, ReadonlySet<string> | null>();
    if (cfg.anchors) {
      for (const [p, text] of contents) anchorCache.set(p, collectAnchors(text));
      for (const [p, text] of contents) {
        for (const target of referencedMdTargets(p, text)) {
          if (anchorCache.has(target)) continue;
          anchorCache.set(
            target,
            exists(target) ? collectAnchors(await ctx.files.read(target)) : null,
          );
        }
      }
    }
    const anchorsFor: AnchorsFor = (target) => anchorCache.get(target) ?? null;

    const findings: Finding[] = [];
    for (const p of pages) {
      findings.push(...checkDocLinks(p, contents.get(p) ?? '', cfg, exists, anchorsFor));
    }
    return findings;
  },
};
