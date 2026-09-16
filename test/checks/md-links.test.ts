import { describe, it, expect } from 'vitest';
import { intraRepoTarget, resolveRel, scanLinks } from '../../src/checks/md-links.js';

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
