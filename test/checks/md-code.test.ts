import { describe, it, expect } from 'vitest';
import { maskCode } from '../../src/checks/md-code.js';

/** `n` spaces — the blank a masked code span of that length leaves behind. */
const blank = (n: number): string => ' '.repeat(n);

describe('maskCode — inline code spans', () => {
  it('blanks a single-backtick span, delimiters included', () => {
    expect(maskCode('embed `![](url)` here')).toBe(`embed ${blank(10)} here`);
  });

  it('blanks a multi-backtick span that contains a lone backtick', () => {
    expect(maskCode('a ``x ` [y](z)`` b')).toBe(`a ${blank(14)} b`);
  });

  it('closes a span only on a backtick run of the same length', () => {
    expect(maskCode('``a`b`` [l](t)')).toBe(`${blank(7)} [l](t)`);
  });

  it('leaves an unmatched backtick run as literal text', () => {
    expect(maskCode('a ` [l](t)')).toBe('a ` [l](t)');
  });

  it('treats a backslash-escaped backtick as literal, not a span opener', () => {
    expect(maskCode('\\` [l](t) `')).toBe('\\` [l](t) `');
  });

  it('masks a span that wraps onto the next line, keeping the newline', () => {
    expect(maskCode('`a\n[l](t)` b')).toBe(`${blank(2)}\n${blank(7)} b`);
  });

  it('does not let a span cross a blank line (paragraph break)', () => {
    expect(maskCode('` a\n\n[l](t) `')).toBe('` a\n\n[l](t) `');
  });
});

describe('maskCode — fenced code blocks', () => {
  it('blanks every line of a backtick fence, keeping the line count', () => {
    expect(maskCode('before\n```md\n[l](t)\n```\nafter')).toBe('before\n\n\n\nafter');
  });

  it('blanks a tilde fence', () => {
    expect(maskCode('~~~\n[l](t)\n~~~\nx')).toBe('\n\n\nx');
  });

  it('keeps a fence open past a shorter or different closer', () => {
    expect(maskCode('````\n```\n~~~\n[l](t)\n````\nx')).toBe('\n\n\n\n\nx');
  });

  it('blanks an unclosed fence through to the end of the page', () => {
    expect(maskCode('x\n```\n[l](t)')).toBe('x\n\n');
  });

  it('does not pair a backtick before a fence with one after it', () => {
    expect(maskCode('a ` b\n```\ncode\n```\nc ` [l](t)')).toBe('a ` b\n\n\n\nc ` [l](t)');
  });
});
