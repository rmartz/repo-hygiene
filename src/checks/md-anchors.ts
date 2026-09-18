/**
 * The set of in-page anchors a GitHub-rendered Markdown file exposes: heading
 * slugs (GitHub's slugger, with `-1`/`-2` duplicate disambiguation) plus explicit
 * HTML `id`/`name` attributes. The `docs-links` check matches a link's `#anchor`
 * fragment against this set.
 *
 * Slug parity with GitHub is best-effort for the common cases — ATX and Setext
 * headings, inline code / emphasis / link markup, HTML tags, and punctuation
 * stripping. It intentionally errs toward *including* heading candidates
 * (Setext, explicit HTML ids) so an under-parse skews to a missed broken link (a
 * false negative) rather than falsely flagging a valid one. Known boundaries
 * (emphasis-marker underscores, non-GitHub `{#custom-id}` syntax) are documented
 * in docs/checks/docs-links.md; the `anchorExempt` config is the escape hatch.
 */

// ATX heading: 1–6 leading `#`, optional trailing `#` run, up to 3 leading spaces.
const ATX_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
// A fence opener/closer: 3+ backticks or tildes (an opener may carry an info string).
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
// Setext underline: a line of only `=` (h1) or only `-` (h2).
const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;
// Explicit anchors GitHub honours from raw HTML: `id`/`name` on any tag.
const HTML_ID_RE = /\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

/** Reduce a raw heading line to its rendered text: link text, no HTML tags. */
function headingText(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) / ![alt](url) → text/alt
    .replace(/<[^>]*>?/g, ''); // strip all HTML tags, complete (<b>) and unclosed (<script)
}

/**
 * GitHub's slug for one heading's rendered text (before duplicate suffixing):
 * lowercase, drop everything but letters, numbers, marks, spaces, `_` and `-`,
 * then spaces → `-`. Backticks, `*`, punctuation and emoji fall out via the class.
 */
export function slugify(text: string): string {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Skip a leading YAML frontmatter block so its `---` fences aren't read as Setext. */
function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return i + 1;
  }
  return 0;
}

/** Every anchor a GitHub render of `content` would expose (heading slugs + HTML ids). */
export function collectAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();
  const lines = content.split('\n');
  let fence = ''; // the active fence marker (``` or ~~~), empty when outside a block

  const addHeading = (raw: string): void => {
    const base = slugify(raw);
    const seen = occurrences.get(base);
    if (seen === undefined) {
      occurrences.set(base, 0);
      anchors.add(base);
    } else {
      const n = seen + 1;
      occurrences.set(base, n);
      anchors.add(`${base}-${n}`);
    }
  };

  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      // Inside a fenced block: only a bare fence of the same kind and length closes it.
      if (fenceMatch && fenceMatch[2]?.trim() === '' && fenceMatch[1]?.startsWith(fence)) {
        fence = '';
      }
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1] ?? '';
      continue;
    }
    for (const m of line.matchAll(HTML_ID_RE)) if (m[1]) anchors.add(m[1]);
    const atx = ATX_RE.exec(line);
    if (atx) {
      addHeading(atx[2] ?? '');
      continue;
    }
    // Setext: an underline turns the preceding non-blank text line into a heading.
    const prev = lines[i - 1];
    if (SETEXT_RE.test(line) && prev !== undefined && prev.trim() !== '' && !ATX_RE.test(prev)) {
      addHeading(prev);
    }
  }
  return anchors;
}
