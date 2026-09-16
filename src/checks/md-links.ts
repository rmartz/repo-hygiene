/**
 * Shared Markdown-link primitives: extracting inline `[text](href)` links from a
 * page (with line numbers), normalizing a relative href to a repo-relative path,
 * and classifying an href as an intra-repo relative target worth resolving on
 * disk. Both the `okf-index` navigability check and the `docs-links`
 * link-integrity check scan the same `[text](href)` syntax, so the scanner and
 * the resolver live here once rather than in a copy per check.
 */

/** One inline Markdown link: its raw href and the 1-based line it sits on. */
export interface MarkdownLink {
  href: string;
  line: number;
}

// Inline `[text](href)` — the destination is everything up to the closing paren.
// `[^\]]`/`[^)]` intentionally span newlines, matching the whole-content scan the
// okf-index check has always used; the line number is derived from the offset.
// Caps prevent polynomial backtracking on pathological inputs (CodeQL CWE-1333).
const LINK_RE = /\[[^\]]{0,2000}\]\(([^)]{0,4000})\)/g;

/** Every inline `[text](href)` link in `content`, with 1-based line numbers. */
export function scanLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const m of content.matchAll(LINK_RE)) {
    const href = (m[1] ?? '').trim();
    if (!href) continue;
    const line = content.slice(0, m.index).split('\n').length;
    links.push({ href, line });
  }
  return links;
}

/** Normalize `href` (relative to `fromDir`) to a repo-relative path, resolving ./ and ../. */
export function resolveRel(fromDir: string, href: string): string {
  const out: string[] = [];
  for (const seg of (fromDir === '' ? [] : fromDir.split('/')).concat(href.split('/'))) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * The intra-repo relative target an href points at (its `#anchor` and any link
 * title stripped), or `null` when the href is not an intra-repo relative path —
 * a pure anchor (`#x`), an external scheme (`http:`, `mailto:`), or an absolute /
 * protocol-relative path (`/x`, `//host`). Anchor *validity* is out of scope
 * (that is neighbouring work); only the file part is returned.
 */
export function intraRepoTarget(href: string): string | null {
  // A CommonMark destination ends at the first whitespace; an optional "title"
  // may follow (`[x](dest "title")`), so keep only the first token.
  const dest = href.trim().split(/\s+/)[0] ?? '';
  const path = (dest.split('#')[0] ?? '').trim();
  if (!path) return null; // pure anchor or empty
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null; // external scheme
  if (path.startsWith('/')) return null; // absolute or protocol-relative
  return path;
}
