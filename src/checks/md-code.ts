/**
 * Markdown code regions — fenced code blocks and inline code spans — whose text
 * is literal, not markup. A `[text](href)` inside backticks is an *example* of
 * link syntax, not a link, so link scanners blank these regions out before
 * matching. Masking keeps every newline in place, so offsets into the masked
 * text still map to the same 1-based line numbers as the original page.
 *
 * Best-effort CommonMark for the common cases: a fence closes only on a bare run
 * of the same character at least as long as its opener (an unclosed fence runs
 * to the end of the page); a code span closes only on a backtick run of exactly
 * its opener's length, never across a blank line; a backslash-escaped backtick
 * is literal. Indented (4-space) code blocks and HTML `<code>` are not masked.
 */

// A fence opener/closer: 3+ backticks or tildes (an opener may carry an info string).
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/** Fence state after one line: the active marker (`''` outside a block) and whether the line is code. */
export interface FenceStep {
  fence: string;
  code: boolean;
}

/**
 * Advance a line-by-line fence tracker by one `line`, given the active `fence`
 * marker (``` or ~~~, `''` when outside a block). Fence lines themselves count as
 * code. Inside a block, only a bare fence of the same kind and at least the same
 * length closes it.
 */
export function stepFence(fence: string, line: string): FenceStep {
  const fenceMatch = FENCE_RE.exec(line);
  if (fence) {
    const closes = fenceMatch && fenceMatch[2]?.trim() === '' && fenceMatch[1]?.startsWith(fence);
    return { fence: closes ? '' : fence, code: true };
  }
  if (fenceMatch) return { fence: fenceMatch[1] ?? '', code: true };
  return { fence: '', code: false };
}

/** Blank every line inside a fenced block (fence lines included) to `''`. */
function maskFences(content: string): string {
  let fence = '';
  const lines = content.split('\n').map((line) => {
    const step = stepFence(fence, line);
    fence = step.fence;
    return step.code ? '' : line;
  });
  return lines.join('\n');
}

/** The length of the backtick run starting at `i`. */
function runLength(text: string, i: number): number {
  let j = i;
  while (text[j] === '`') j++;
  return j - i;
}

/** Whether the character at `i` is escaped by an odd run of preceding backslashes. */
function isEscaped(text: string, i: number): boolean {
  let slashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) slashes++;
  return slashes % 2 === 1;
}

/** Whether the line starting just after the newline at `nl` is blank (whitespace only). */
function nextLineIsBlank(text: string, nl: number): boolean {
  const end = text.indexOf('\n', nl + 1);
  return text.slice(nl + 1, end === -1 ? text.length : end).trim() === '';
}

/** Index of the closing run of exactly `n` backticks after `from`, or -1 (paragraph end / EOF). */
function findCloser(text: string, from: number, n: number): number {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      const len = runLength(text, i);
      if (len === n) return i;
      i += len;
      continue;
    }
    // A blank line ends the paragraph — a code span never crosses it.
    if (ch === '\n' && nextLineIsBlank(text, i)) return -1;
    i++;
  }
  return -1;
}

/** Blank every inline code span (backtick delimiters included) to spaces, keeping newlines. */
function maskCodeSpans(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i];
      i++;
      continue;
    }
    if (isEscaped(text, i)) {
      out += '`'; // only this one backtick is literal; the rest of the run is rescanned
      i++;
      continue;
    }
    const n = runLength(text, i);
    const close = findCloser(text, i + n, n);
    if (close === -1) {
      out += text.slice(i, i + n); // no matching closer: the run is literal text
      i += n;
      continue;
    }
    out += text.slice(i, close + n).replace(/[^\n]/g, ' ');
    i = close + n;
  }
  return out;
}

/** `content` with fenced code blocks and inline code spans blanked, line structure preserved. */
export function maskCode(content: string): string {
  return maskCodeSpans(maskFences(content));
}
