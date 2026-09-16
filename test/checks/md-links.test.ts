import { describe, it, expect } from 'vitest';
import {
  intraRepoTarget,
  parseLinkTarget,
  resolveRel,
  scanLinks,
} from '../../src/checks/md-links.js';

describe('scanLinks', () => {
  it('extracts each link href with its 1-based line number', () => {
    const content = 'intro\n\nsee [the page](../packages/foo.md) and [x](./bar.md) here\n';
    expect(scanLinks(content)).toEqual([
      { href: '../packages/foo.md', line: 3 },
      { href: './bar.md', line: 3 },
    ]);
  });

  it('returns nothing for prose without links', () => {
    expect(scanLinks('just some text\nwith no links')).toEqual([]);
  });
});

describe('resolveRel', () => {
  it('resolves ../ against the source directory to a repo-relative path', () => {
    expect(resolveRel('docs/packages', '../../packages/repo-hygiene/src/index.ts')).toBe(
      'packages/repo-hygiene/src/index.ts',
    );
  });

  it('resolves ./ within the source directory', () => {
    expect(resolveRel('docs', './guide.md')).toBe('docs/guide.md');
  });
});

describe('intraRepoTarget', () => {
  it('returns the file part of a relative link, stripping the anchor', () => {
    expect(intraRepoTarget('../foo.md#a-section')).toBe('../foo.md');
  });

  it('strips an optional link title', () => {
    expect(intraRepoTarget('./foo.md "Some Title"')).toBe('./foo.md');
  });

  it('ignores an external scheme (http / mailto)', () => {
    expect(intraRepoTarget('https://example.com/x')).toBeNull();
    expect(intraRepoTarget('mailto:a@b.com')).toBeNull();
  });

  it('ignores a pure anchor link', () => {
    expect(intraRepoTarget('#a-section')).toBeNull();
  });

  it('ignores an absolute or protocol-relative path', () => {
    expect(intraRepoTarget('/repo/root')).toBeNull();
    expect(intraRepoTarget('//cdn.example.com/x')).toBeNull();
  });
});

describe('parseLinkTarget', () => {
  it('splits a relative link into its file path and anchor', () => {
    expect(parseLinkTarget('../foo.md#a-section')).toEqual({
      path: '../foo.md',
      anchor: 'a-section',
    });
  });

  it('returns a null anchor when the href has no fragment', () => {
    expect(parseLinkTarget('./foo.md')).toEqual({ path: './foo.md', anchor: null });
  });

  it('treats a pure anchor as a same-document link (null path)', () => {
    expect(parseLinkTarget('#a-section')).toEqual({ path: null, anchor: 'a-section' });
  });

  it('strips an optional link title before splitting', () => {
    expect(parseLinkTarget('./foo.md#x "Title"')).toEqual({ path: './foo.md', anchor: 'x' });
  });

  it('returns null for external, absolute, empty, and bare-hash hrefs', () => {
    expect(parseLinkTarget('https://example.com/x#y')).toBeNull();
    expect(parseLinkTarget('mailto:a@b.com')).toBeNull();
    expect(parseLinkTarget('/repo/root#x')).toBeNull();
    expect(parseLinkTarget('')).toBeNull();
    expect(parseLinkTarget('#')).toBeNull();
  });
});
