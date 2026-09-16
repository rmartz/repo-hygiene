import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSet } from '../../src/discovery.js';
import { checkDocLinks, docsLinksCheck } from '../../src/checks/docs-links.js';

const DEFAULTS = { roots: ['docs'], exempt: [] };
const exists = (present: string[]) => {
  const set = new Set(present);
  return (target: string) => set.has(target);
};

describe('checkDocLinks', () => {
  it('passes a relative link whose target exists', () => {
    expect(checkDocLinks('docs/a.md', '[b](./b.md)', DEFAULTS, exists(['docs/b.md']))).toEqual([]);
  });

  it('flags a relative link whose target is missing, with the source page and line', () => {
    const findings = checkDocLinks(
      'docs/a.md',
      'intro\n\nsee [gone](./missing.md)\n',
      DEFAULTS,
      exists([]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 'docs-links',
      path: 'docs/a.md',
      line: 3,
      severity: 'error',
    });
    expect(findings[0]?.message).toContain('docs/missing.md');
  });

  it('resolves a link from docs into a source file across ../', () => {
    const content = '[src](../../packages/repo-hygiene/src/checks/okf.ts)';
    const target = 'packages/repo-hygiene/src/checks/okf.ts';
    expect(checkDocLinks('docs/packages/x.md', content, DEFAULTS, exists([target]))).toEqual([]);
    const findings = checkDocLinks('docs/packages/x.md', content, DEFAULTS, exists([]));
    expect(findings[0]?.message).toContain(target);
  });

  it('ignores anchor-only, external, and mailto links', () => {
    const content = '[a](#sec) [b](https://example.com) [c](mailto:x@y.com)';
    expect(checkDocLinks('docs/a.md', content, DEFAULTS, exists([]))).toEqual([]);
  });

  it('does not flag a missing target listed in exempt', () => {
    const cfg = { roots: ['docs'], exempt: ['docs/generated.md'] };
    expect(checkDocLinks('docs/a.md', '[g](./generated.md)', cfg, exists([]))).toEqual([]);
  });
});

describe('docsLinksCheck.run', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docs-links-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const filesOf = (entries: Record<string, string>): FileSet => ({
    paths: Object.keys(entries),
    read: (p) => entries[p] ?? '',
  });
  const ctx = (files: FileSet, settings = {}) => ({
    mode: '--check' as const,
    files,
    cwd: dir,
    settings,
    env: {},
  });

  it('scans only in-scope docs pages, skipping out-of-root and non-md files', async () => {
    const files = filesOf({
      'docs/a.md': '[x](./missing.md)', // in scope, broken → flagged
      'guides/b.md': '[y](./missing.md)', // out of root → skipped
      'src/x.ts': 'const x = 1;', // not markdown → skipped
    });
    const findings = await docsLinksCheck.run(ctx(files));
    expect(findings.map((f) => f.path)).toEqual(['docs/a.md']);
  });

  it('honours custom roots from config', async () => {
    const files = filesOf({ 'guides/b.md': '[y](./missing.md)' });
    const findings = await docsLinksCheck.run(ctx(files, { roots: ['guides'] }));
    expect(findings.map((f) => f.path)).toContain('guides/b.md');
  });
});
