import { describe, it, expect } from 'vitest';
import { evaluateOkfIndex, type DocFile } from '../../src/checks/okf-index.js';

const cfg = { roots: ['docs'], indexName: 'index.md' };
const file = (path: string, content = ''): DocFile => ({ path, content });
const messages = (files: DocFile[]): string[] => evaluateOkfIndex(files, cfg).map((f) => f.message);

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
