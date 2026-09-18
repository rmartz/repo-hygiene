import { describe, it, expect } from 'vitest';
import { evaluateOkfIndex, type DocFile } from '../../src/checks/okf-index.js';

const cfg = {
  roots: ['docs'],
  indexName: 'index.md',
  nestedIndexes: true,
  noUpwardLinks: false,
  noSiblingLinks: false,
};
const file = (path: string, content = ''): DocFile => ({ path, content });
const messages = (files: DocFile[]): string[] => evaluateOkfIndex(files, cfg).map((f) => f.message);
const messagesWith = (files: DocFile[], overrides: Partial<typeof cfg>): string[] =>
  evaluateOkfIndex(files, { ...cfg, ...overrides }).map((f) => f.message);

describe('evaluateOkfIndex — navigability', () => {
  it('passes a fully navigable bundle', () => {
    const files = [
      file('docs/index.md', '- [Guide](guide.md)\n- [Scripts](scripts/index.md)\n'),
      file('docs/guide.md'),
      file('docs/scripts/index.md', '- [Build](build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    expect(evaluateOkfIndex(files, cfg)).toEqual([]);
  });

  it('flags a content page not linked from its directory index', () => {
    const files = [
      file('docs/index.md', '- [Guide](guide.md)\n'),
      file('docs/guide.md'),
      file('docs/orphan.md'),
    ];
    expect(messages(files)).toEqual(['docs/orphan.md is not linked from docs/index.md']);
  });

  it('flags a documented directory that has no index.md', () => {
    const files = [
      file('docs/index.md', '- [Build](scripts/build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    expect(messages(files)).toContain(
      'docs/scripts/ is missing an index.md (needed to index its pages)',
    );
  });

  it('flags a sub-directory index not linked from its parent index', () => {
    const files = [
      file('docs/index.md', ''), // does not link scripts/index.md
      file('docs/scripts/index.md', '- [Build](build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    expect(messages(files)).toContain(
      'docs/scripts/index.md is not linked from its parent index docs/index.md',
    );
  });

  it('resolves ../ links and ignores external, anchor-only, and non-md targets', () => {
    const files = [
      file(
        'docs/index.md',
        '- [Sub](sub/index.md)\n- [ext](https://x.com/y.md)\n- [anchor](#top)\n- [img](logo.png)\n',
      ),
      file('docs/sub/index.md', '- [Up](../top.md)\n'),
      file('docs/sub/child.md'), // linked from sub/index via ../? no — must be linked from sub/index
      file('docs/top.md'),
    ];
    // sub/child.md is not linked from docs/sub/index.md (which only links ../top.md)
    expect(messages(files)).toContain('docs/sub/child.md is not linked from docs/sub/index.md');
  });

  it('returns nothing when no docs are in scope', () => {
    expect(evaluateOkfIndex([file('src/x.ts'), file('README.md')], cfg)).toEqual([]);
  });
});

describe('evaluateOkfIndex — nesting rule', () => {
  it('flags an index linking directly to a page one directory down', () => {
    const files = [
      file('docs/index.md', '- [Build](scripts/build.md)\n- [Scripts](scripts/index.md)\n'),
      file('docs/scripts/index.md', '- [Build](build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    expect(messages(files)).toContain(
      'docs/index.md links directly to docs/scripts/build.md; link its subdirectory index.md instead',
    );
  });

  it('flags an index linking to a file more than one directory below', () => {
    const files = [
      file('docs/index.md', '- [Deep](a/b/deep.md)\n- [A](a/index.md)\n'),
      file('docs/a/index.md', '- [B](b/index.md)\n'),
      file('docs/a/b/index.md', '- [Deep](deep.md)\n'),
      file('docs/a/b/deep.md'),
    ];
    expect(messages(files)).toContain(
      'docs/index.md links to docs/a/b/deep.md, which is more than one directory below; nest it through subdirectory index.md files',
    );
  });

  it('allows same-directory pages and direct child indexes', () => {
    const files = [
      file('docs/index.md', '- [Guide](guide.md)\n- [Scripts](scripts/index.md)\n'),
      file('docs/guide.md'),
      file('docs/scripts/index.md', '- [Build](build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    expect(evaluateOkfIndex(files, cfg)).toEqual([]);
  });

  it('does not flag upward or sibling-subtree links from an index', () => {
    const files = [
      file('docs/index.md', '- [A](a/index.md)\n- [B](b/index.md)\n'),
      file('docs/a/index.md', '- [Up](../index.md)\n- [Sibling](../b/index.md)\n- [C](c.md)\n'),
      file('docs/a/c.md'),
      file('docs/b/index.md', '- [D](d.md)\n'),
      file('docs/b/d.md'),
    ];
    // ../index.md and ../b/index.md from docs/a/index.md are up/sibling — not flagged.
    expect(evaluateOkfIndex(files, cfg)).toEqual([]);
  });
});

describe('evaluateOkfIndex — flat hierarchy (nestedIndexes: false)', () => {
  it('allows a root index to link a page one directory down directly', () => {
    const files = [
      file('docs/index.md', '- [Build](scripts/build.md)\n'),
      file('docs/scripts/build.md'),
    ];
    // Nested (default) flags this over-reach; flat allows it.
    expect(messages(files)).toContain(
      'docs/index.md links directly to docs/scripts/build.md; link its subdirectory index.md instead',
    );
    expect(messagesWith(files, { nestedIndexes: false })).toEqual([]);
  });

  it('allows a root index to link a page several directories down directly', () => {
    const files = [file('docs/index.md', '- [Deep](a/b/deep.md)\n'), file('docs/a/b/deep.md')];
    expect(messagesWith(files, { nestedIndexes: false })).toEqual([]);
  });

  it('still requires an index at the root', () => {
    const files = [file('docs/guide.md')];
    expect(messagesWith(files, { nestedIndexes: false })).toContain(
      'docs/ is missing an index.md (needed to index its pages)',
    );
  });
});

describe('evaluateOkfIndex — noUpwardLinks', () => {
  const files = [
    file('docs/index.md', '- [A](a/index.md)\n'),
    file('docs/a/index.md', '- [Up](../index.md)\n- [C](c.md)\n'),
    file('docs/a/c.md'),
  ];

  it('leaves upward links alone by default', () => {
    expect(evaluateOkfIndex(files, cfg)).toEqual([]);
  });

  it('flags an index linking into an ancestor directory when enabled', () => {
    expect(messagesWith(files, { noUpwardLinks: true })).toContain(
      'docs/a/index.md links upward to docs/index.md; an index must not link to a file in an ancestor directory',
    );
  });
});

describe('evaluateOkfIndex — noSiblingLinks', () => {
  const files = [
    file('docs/index.md', '- [A](a/index.md)\n- [B](b/index.md)\n'),
    file('docs/a/index.md', '- [C](c.md)\n- [Sibling](../b/index.md)\n'),
    file('docs/a/c.md'),
    file('docs/b/index.md', '- [D](d.md)\n'),
    file('docs/b/d.md'),
  ];

  it('leaves sibling-subtree links alone by default', () => {
    expect(evaluateOkfIndex(files, cfg)).toEqual([]);
  });

  it('flags an index linking across to another subtree when enabled', () => {
    expect(messagesWith(files, { noSiblingLinks: true })).toContain(
      'docs/a/index.md links across to docs/b/index.md; an index must not link outside its own subtree',
    );
  });
});

describe('evaluateOkfIndex — index frontmatter rule', () => {
  const nav = '- [P](p.md)\n';
  const withPage = (indexContent: string): DocFile[] => [
    file('docs/index.md', indexContent),
    file('docs/p.md'),
  ];

  it('allows a bundle-root index.md carrying only okf_version', () => {
    expect(evaluateOkfIndex(withPage(`---\nokf_version: 1\n---\n${nav}`), cfg)).toEqual([]);
  });

  it('rejects extra keys on the bundle-root index.md', () => {
    expect(messages(withPage(`---\nokf_version: 1\ntitle: Nope\n---\n${nav}`))).toContain(
      'bundle-root index.md may carry only `okf_version` (found: title)',
    );
  });

  it('rejects any frontmatter on a non-root index.md', () => {
    const files = [
      file('docs/index.md', '- [Sub](sub/index.md)\n'),
      file('docs/sub/index.md', `---\ntitle: x\n---\n- [C](c.md)\n`),
      file('docs/sub/c.md'),
    ];
    expect(messages(files)).toContain(
      'index.md must not carry frontmatter (it is the OKF directory index)',
    );
  });

  it('flags a malformed (unclosed) frontmatter block', () => {
    expect(messages(withPage(`---\nokf_version: 1\n${nav}`))).toContain(
      'index.md has a malformed frontmatter block (opening --- without closing ---)',
    );
  });
});
