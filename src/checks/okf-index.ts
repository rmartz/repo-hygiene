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
 * from its parent's. `index.md` pages carry no frontmatter, except a bundle-root
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

function resolveConfig(settings: CheckConfig): OkfIndexConfig {
  const indexName = settings.indexName ?? 'index.md';
  if (typeof indexName !== 'string') throw new Error(`${NAME}: "indexName" must be a string`);
  return { roots: stringList(settings, 'roots', ['docs']), indexName };
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

/** Nearest documented ancestor of `dir` within its root, or undefined at a root. */
function parentDocumentedDir(
  dir: string,
  documented: Set<string>,
  roots: string[],
): string | undefined {
  const root = roots.find((r) => dir === r || dir.startsWith(`${r}/`));
  if (root === undefined || dir === root) return undefined;
  let current = dirOf(dir);
  while (current === root || current.startsWith(`${root}/`)) {
    if (documented.has(current)) return current;
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

  const findings: Finding[] = [];
  const push = (path: string, message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };

  for (const dir of [...documented].sort()) {
    const indexPath = joinDir(dir, cfg.indexName);
    if (!paths.has(indexPath)) {
      push(indexPath, `${dir}/ is missing an ${cfg.indexName} (needed to index its pages)`);
      continue;
    }
    const linked = linkedMdTargets(indexPath, content.get(indexPath) ?? '');
    for (const page of (contentByDir.get(dir) ?? []).sort()) {
      if (!linked.has(page)) push(page, `${page} is not linked from ${indexPath}`);
    }

    const isBundleRoot = cfg.roots.some((r) => indexPath === joinDir(r, cfg.indexName));
    const fmViolation = indexFrontmatterViolation(content.get(indexPath) ?? '', isBundleRoot);
    if (fmViolation) push(indexPath, fmViolation);

    const parent = parentDocumentedDir(dir, documented, cfg.roots);
    if (parent === undefined) continue;
    const parentIndex = joinDir(parent, cfg.indexName);
    if (
      paths.has(parentIndex) &&
      !linkedMdTargets(parentIndex, content.get(parentIndex) ?? '').has(indexPath)
    ) {
      push(indexPath, `${indexPath} is not linked from its parent index ${parentIndex}`);
    }
  }
  return findings;
}

export const okfIndexCheck: Check = {
  name: NAME,
  description: 'OKF docs bundle is navigable via index.md links; index pages carry no frontmatter.',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    const paths = (await trackedFiles({ cwd: ctx.cwd })).filter(
      (p) => p.endsWith('.md') && underRoots(p, cfg.roots),
    );
    const files = paths.map((path) => ({ path, content: worktreeContent(path, { cwd: ctx.cwd }) }));
    return evaluateOkfIndex(files, cfg);
  },
};
