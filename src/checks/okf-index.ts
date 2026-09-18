import matter from 'gray-matter';
import { trackedFiles, worktreeContent } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';
import { resolveRel, scanLinks } from './md-links.js';

/**
 * OKF index-tree navigability — the docs-bundle invariant that `okf`
 * (frontmatter conformance) does not cover. Every content page must be reachable
 * from a root `index.md` by following links: a directory that holds any `.md`
 * must have an `index.md`, every content page in it must be linked from that
 * `index.md`, and every documented sub-directory's `index.md` must be linked
 * from its parent's. Indexes must also stay *nested* by default: an index may
 * only point downward to a file in its own directory or to a direct child
 * directory's `index.md` — never straight to a page one directory down (link
 * that directory's index instead), and never to anything more than one directory
 * below. Link-direction strictness is configurable: `nestedIndexes: false`
 * allows a flat hierarchy (a single root index links every page directly, no
 * child indexes required), while `noUpwardLinks` / `noSiblingLinks` opt into
 * flagging links that leave an index's own subtree. `index.md` pages carry no
 * frontmatter, except a bundle-root
 * `index.md` which may carry only `okf_version`. Ported from
 * firebase-nextjs-template's `validate-docs-index.mjs` + the `validateIndex` half
 * of `validate-docs.mjs`.
 *
 * Navigability is a whole-tree invariant, so — like md-pairing — the check reads
 * the full tracked set rather than the mode-scoped file set.
 */

const NAME = 'okf-index';

interface OkfIndexConfig {
  roots: string[];
  indexName: string;
  /**
   * Enforce a nested index tree: an index may only link a file in its own
   * directory or a direct child directory's index (the default). Set `false` for
   * a **flat hierarchy** — a single root index that links every page directly, at
   * any depth, with no per-directory child indexes required.
   */
  nestedIndexes: boolean;
  /** Flag an index that links to a file in an ancestor directory (opt-in). */
  noUpwardLinks: boolean;
  /** Flag an index that links across to a directory outside its subtree (opt-in). */
  noSiblingLinks: boolean;
}

/** One in-scope docs file; `content` is only consulted for `index.md` files. */
export interface DocFile {
  path: string;
  content: string;
}

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};
const baseOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
};
const joinDir = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);
const underRoots = (path: string, roots: string[]): boolean =>
  roots.some((r) => path === r || path.startsWith(`${r}/`));

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

function boolOpt(settings: CheckConfig, key: string, fallback: boolean): boolean {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw new Error(`${NAME}: "${key}" must be a boolean`);
}

function resolveConfig(settings: CheckConfig): OkfIndexConfig {
  const indexName = settings.indexName ?? 'index.md';
  if (typeof indexName !== 'string') throw new Error(`${NAME}: "indexName" must be a string`);
  return {
    roots: stringList(settings, 'roots', ['docs']),
    indexName,
    nestedIndexes: boolOpt(settings, 'nestedIndexes', true),
    noUpwardLinks: boolOpt(settings, 'noUpwardLinks', false),
    noSiblingLinks: boolOpt(settings, 'noSiblingLinks', false),
  };
}

/** Repo-relative paths of the local `.md` files an index page links to. */
function linkedMdTargets(indexPath: string, content: string): Set<string> {
  const fromDir = dirOf(indexPath);
  const targets = new Set<string>();
  for (const { href } of scanLinks(content)) {
    const bare = (href.split('#')[0] ?? '').trim();
    // Only local .md targets; skip external (`scheme:`), pure-anchor, and non-md.
    if (!bare || /^[a-z]+:/i.test(bare) || !bare.endsWith('.md')) continue;
    targets.add(resolveRel(fromDir, bare));
  }
  return targets;
}

/** `target` sits below `indexDir`: its path relative to `indexDir`, else null. */
function descentOf(indexDir: string, target: string): string | null {
  if (indexDir === '') return target;
  return target.startsWith(`${indexDir}/`) ? target.slice(indexDir.length + 1) : null;
}

/**
 * Direction rule for one link out of an index, governed by the three strictness
 * dimensions. A same-directory file and a direct child directory's index are
 * always allowed. Beyond that:
 *
 * - *downward over-reach* (a page one directory down, or anything deeper) is
 *   flagged when `nestedIndexes` is on (the default) and allowed under a flat
 *   hierarchy;
 * - an *upward* link (into an ancestor directory) is flagged only when
 *   `noUpwardLinks` is enabled;
 * - a *sibling* link (across to another subtree) is flagged only when
 *   `noSiblingLinks` is enabled.
 *
 * Returns the violation message, or null when the link is allowed.
 */
function linkDirectionViolation(
  indexPath: string,
  target: string,
  cfg: OkfIndexConfig,
): string | null {
  const indexDir = dirOf(indexPath);
  const rest = descentOf(indexDir, target);
  if (rest !== null) {
    const depth = rest.split('/').length - 1;
    if (depth === 0) return null; // same directory — always allowed
    if (!cfg.nestedIndexes) return null; // flat hierarchy — downward reach is unrestricted
    if (depth === 1 && baseOf(rest) === cfg.indexName) return null; // direct child index
    if (depth === 1) {
      return `${indexPath} links directly to ${target}; link its subdirectory ${cfg.indexName} instead`;
    }
    return `${indexPath} links to ${target}, which is more than one directory below; nest it through subdirectory ${cfg.indexName} files`;
  }
  // Not at/below this index: it points into an ancestor (upward) or another subtree (sibling).
  const targetDir = dirOf(target);
  const upward = targetDir === '' || indexDir.startsWith(`${targetDir}/`);
  if (upward) {
    return cfg.noUpwardLinks
      ? `${indexPath} links upward to ${target}; an index must not link to a file in an ancestor directory`
      : null;
  }
  return cfg.noSiblingLinks
    ? `${indexPath} links across to ${target}; an index must not link outside its own subtree`
    : null;
}

/**
 * The nearest directory at or above `dir` (within its root) that has an index,
 * or undefined when none does. This is the index a page must be linked from —
 * its own directory's index under a nested tree, or the closest ancestor index
 * under a flat hierarchy where intermediate directories carry no index.
 */
function nearestIndexDir(dir: string, indexDirs: Set<string>, roots: string[]): string | undefined {
  const root = roots.find((r) => dir === r || dir.startsWith(`${r}/`));
  if (root === undefined) return undefined;
  let current = dir;
  while (current === root || current.startsWith(`${root}/`)) {
    if (indexDirs.has(current)) return current;
    if (current === root) break;
    current = dirOf(current);
  }
  return undefined;
}

/** The no-frontmatter-on-index rule; returns a message or null. */
function indexFrontmatterViolation(content: string, isBundleRoot: boolean): string | null {
  if (!/^---\r?\n/.test(content)) return null; // no frontmatter block — always fine
  if (!/\n---\s*(\r?\n|$)/.test(content.slice(3))) {
    return 'index.md has a malformed frontmatter block (opening --- without closing ---)';
  }
  if (!isBundleRoot) {
    return 'index.md must not carry frontmatter (it is the OKF directory index)';
  }
  let data: unknown;
  try {
    data = matter(content).data;
  } catch {
    return 'bundle-root index.md has invalid YAML frontmatter';
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return 'bundle-root index.md frontmatter must be a YAML mapping';
  }
  const extra = Object.keys(data).filter((k) => k !== 'okf_version');
  if (extra.length > 0) {
    return `bundle-root index.md may carry only \`okf_version\` (found: ${extra.join(', ')})`;
  }
  return null;
}

/** Evaluate navigability + index-frontmatter over the in-scope docs files. */
export function evaluateOkfIndex(files: DocFile[], cfg: OkfIndexConfig): Finding[] {
  const inScope = files.filter((f) => f.path.endsWith('.md') && underRoots(f.path, cfg.roots));
  const paths = new Set(inScope.map((f) => f.path));
  const content = new Map(inScope.map((f) => [f.path, f.content]));

  // Every directory holding any .md is "documented"; track its content pages.
  const contentByDir = new Map<string, string[]>();
  for (const { path } of inScope) {
    const dir = dirOf(path);
    const pages = contentByDir.get(dir) ?? [];
    if (baseOf(path) !== cfg.indexName) pages.push(path);
    contentByDir.set(dir, pages);
  }
  const documented = new Set(contentByDir.keys());
  const indexDirs = new Set([...documented].filter((d) => paths.has(joinDir(d, cfg.indexName))));
  // Cache each existing index's linked .md targets — consulted for both the
  // page-linkage and child-index-linkage passes below.
  const linkedByDir = new Map(
    [...indexDirs].map((d) => {
      const indexPath = joinDir(d, cfg.indexName);
      return [d, linkedMdTargets(indexPath, content.get(indexPath) ?? '')] as const;
    }),
  );
  const isRoot = (dir: string): boolean => cfg.roots.includes(dir);

  const findings: Finding[] = [];
  const push = (path: string, message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };

  // Missing index: every documented directory needs one under a nested tree; a
  // flat hierarchy requires an index only at each root.
  for (const dir of [...documented].sort()) {
    if (indexDirs.has(dir)) continue;
    if (cfg.nestedIndexes || isRoot(dir)) {
      push(
        joinDir(dir, cfg.indexName),
        `${dir}/ is missing an ${cfg.indexName} (needed to index its pages)`,
      );
    }
  }

  // Per existing index: link-direction rule and the no-frontmatter rule.
  for (const dir of [...indexDirs].sort()) {
    const indexPath = joinDir(dir, cfg.indexName);
    for (const target of [...(linkedByDir.get(dir) ?? [])].sort()) {
      const violation = linkDirectionViolation(indexPath, target, cfg);
      if (violation) push(indexPath, violation);
    }
    const fmViolation = indexFrontmatterViolation(content.get(indexPath) ?? '', isRoot(dir));
    if (fmViolation) push(indexPath, fmViolation);
  }

  // Every content page must be linked from its nearest at-or-above index.
  for (const dir of [...documented].sort()) {
    const host = nearestIndexDir(dir, indexDirs, cfg.roots);
    if (host === undefined) continue; // no ancestor index (missing root already flagged)
    const hostIndex = joinDir(host, cfg.indexName);
    for (const page of (contentByDir.get(dir) ?? []).sort()) {
      if (!linkedByDir.get(host)?.has(page)) push(page, `${page} is not linked from ${hostIndex}`);
    }
  }

  // Every non-root index must be linked from its nearest ancestor index.
  for (const dir of [...indexDirs].sort()) {
    if (isRoot(dir)) continue;
    const parent = nearestIndexDir(dirOf(dir), indexDirs, cfg.roots);
    if (parent === undefined) continue;
    const indexPath = joinDir(dir, cfg.indexName);
    const parentIndex = joinDir(parent, cfg.indexName);
    if (!linkedByDir.get(parent)?.has(indexPath)) {
      push(indexPath, `${indexPath} is not linked from its parent index ${parentIndex}`);
    }
  }
  return findings;
}

export const okfIndexCheck: Check = {
  name: NAME,
  description: 'OKF docs bundle is navigable via index.md links; index pages carry no frontmatter.',
  // Default-on but warn by default (see okf): navigability findings surface
  // everywhere without failing a repo whose docs/ is not yet an OKF bundle.
  defaultOn: true,
  defaultSeverity: 'warn',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    const paths = (await trackedFiles({ cwd: ctx.cwd })).filter(
      (p) => p.endsWith('.md') && underRoots(p, cfg.roots),
    );
    const files = paths.map((path) => ({ path, content: worktreeContent(path, { cwd: ctx.cwd }) }));
    return evaluateOkfIndex(files, cfg);
  },
};
