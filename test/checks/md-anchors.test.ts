import { describe, it, expect } from 'vitest';
import { collectAnchors, slugify } from '../../src/checks/md-anchors.js';

describe('slugify', () => {
  it('lowercases, drops punctuation, and hyphenates spaces', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('keeps underscores and existing hyphens', () => {
    expect(slugify('foo_bar-baz')).toBe('foo_bar-baz');
  });

  it('preserves the double hyphen GitHub produces around a stripped symbol', () => {
    expect(slugify('a & b')).toBe('a--b');
  });

  it('reduces inline code and links to their rendered text', () => {
    expect(slugify('The `docs-links` check')).toBe('the-docs-links-check');
    expect(slugify('[Foo](bar.md) bar')).toBe('foo-bar');
  });

  it('drops emoji (leaving the surrounding spaces, as GitHub does) and HTML tags', () => {
    expect(slugify('Ship it 🚀 <sup>1</sup>')).toBe('ship-it--1');
  });
});

describe('collectAnchors', () => {
  it('collects ATX heading slugs at every level', () => {
    const anchors = collectAnchors('# Top\n\n## A Section\n\n### Deeper Still');
    expect(anchors).toEqual(new Set(['top', 'a-section', 'deeper-still']));
  });

  it('disambiguates duplicate headings with -1 / -2 suffixes', () => {
    const anchors = collectAnchors('## Setup\n\n## Setup\n\n## Setup');
    expect(anchors).toEqual(new Set(['setup', 'setup-1', 'setup-2']));
  });

  it('ignores # lines inside fenced code blocks', () => {
    const md = '# Real\n\n```bash\n# not a heading\n```\n\n~~~\n## also not\n~~~';
    expect(collectAnchors(md)).toEqual(new Set(['real']));
  });

  it('collects Setext (underline) headings', () => {
    expect(collectAnchors('Title\n=====\n\nSubtitle\n--------')).toEqual(
      new Set(['title', 'subtitle']),
    );
  });

  it('collects explicit HTML id / name anchors', () => {
    const md = '<a id="manual"></a>\n\n# Auto\n\n<div name="also-ok">x</div>';
    const anchors = collectAnchors(md);
    expect(anchors.has('manual')).toBe(true);
    expect(anchors.has('also-ok')).toBe(true);
    expect(anchors.has('auto')).toBe(true);
  });

  it('does not read frontmatter delimiters as Setext headings', () => {
    const md = '---\ntype: Library\ntitle: X\n---\n\n# Real Heading';
    expect(collectAnchors(md)).toEqual(new Set(['real-heading']));
  });
});
