import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FileSet } from '../../src/discovery.js';
import { checkDocLinks, docsLinksCheck } from '../../src/checks/docs-links.js';

const DEFAULTS = { roots: ['docs'], exempt: [], anchors: false, anchorExempt: [] };
const ANCHORS_ON = { ...DEFAULTS, anchors: true };
const exists = (present: string[]) => {
  const set = new Set(present);
  return (target: string) => set.has(target);
};
/** Fixed anchor resolver: a per-target anchor set, or null for skip. */
const anchorsOf =
  (byTarget: Record<string, string[] | null>) =>
  (target: string): ReadonlySet<string> | null => {
    const a = byTarget[target];
    return a === null || a === undefined ? null : new Set(a);
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
    const cfg = { ...DEFAULTS, exempt: ['docs/generated.md'] };
    expect(checkDocLinks('docs/a.md', '[g](./generated.md)', cfg, exists([]))).toEqual([]);
  });

  it('leaves anchors unchecked when anchors is off (default)', () => {
    const content = '[x](./b.md#nope) and [y](#gone)';
    const anchors = anchorsOf({ 'docs/b.md': ['ok'], 'docs/a.md': ['here'] });
    expect(checkDocLinks('docs/a.md', content, DEFAULTS, exists(['docs/b.md']), anchors)).toEqual(
      [],
    );
  });
});

describe('checkDocLinks — anchors', () => {
  it('passes a same-document anchor that matches a heading in this page', () => {
    const anchors = anchorsOf({ 'docs/a.md': ['a-section'] });
    expect(checkDocLinks('docs/a.md', '[x](#a-section)', ANCHORS_ON, exists([]), anchors)).toEqual(
      [],
    );
  });

  it('flags a same-document anchor with no matching heading', () => {
    const anchors = anchorsOf({ 'docs/a.md': ['real'] });
    const findings = checkDocLinks('docs/a.md', 'see [x](#ghost)', ANCHORS_ON, exists([]), anchors);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 'docs-links',
      path: 'docs/a.md',
      severity: 'error',
    });
    expect(findings[0]?.message).toContain('#ghost');
  });

  it('passes a cross-document anchor present in the target page', () => {
    const anchors = anchorsOf({ 'docs/b.md': ['setup', 'usage'] });
    const out = checkDocLinks(
      'docs/a.md',
      '[x](./b.md#usage)',
      ANCHORS_ON,
      exists(['docs/b.md']),
      anchors,
    );
    expect(out).toEqual([]);
  });

  it('flags a cross-document anchor missing from an existing target', () => {
    const anchors = anchorsOf({ 'docs/b.md': ['setup'] });
    const findings = checkDocLinks(
      'docs/a.md',
      '[x](./b.md#usage)',
      ANCHORS_ON,
      exists(['docs/b.md']),
      anchors,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('docs/b.md');
    expect(findings[0]?.message).toContain('#usage');
  });

  it('does not anchor-check a target file that is missing (file finding only)', () => {
    const anchors = anchorsOf({});
    const findings = checkDocLinks(
      'docs/a.md',
      '[x](./gone.md#sec)',
      ANCHORS_ON,
      exists([]),
      anchors,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('does not exist');
  });

  it('skips anchors into non-markdown / unreadable targets (resolver returns null)', () => {
    const anchors = anchorsOf({ 'src/x.ts': null });
    const out = checkDocLinks(
      'docs/a.md',
      '[x](../src/x.ts#L10)',
      ANCHORS_ON,
      exists(['src/x.ts']),
      anchors,
    );
    expect(out).toEqual([]);
  });

  it('skips source line anchors even on markdown targets', () => {
    const anchors = anchorsOf({ 'docs/b.md': ['heading'] });
    const out = checkDocLinks(
      'docs/a.md',
      '[x](./b.md#L10-L20)',
      ANCHORS_ON,
      exists(['docs/b.md']),
      anchors,
    );
    expect(out).toEqual([]);
  });

  it('honours anchorExempt for a resolved target#anchor', () => {
    const cfg = { ...ANCHORS_ON, anchorExempt: ['docs/b.md#dynamic'] };
    const anchors = anchorsOf({ 'docs/b.md': ['static'] });
    const out = checkDocLinks(
      'docs/a.md',
      '[x](./b.md#dynamic)',
      cfg,
      exists(['docs/b.md']),
      anchors,
    );
    expect(out).toEqual([]);
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

  it('validates same-doc and cross-doc anchors when enabled, reading real target pages', async () => {
    const entries = {
      'docs/a.md': '[ok](./b.md#setup)\n[bad](./b.md#ghost)\n[self](#top)',
      'docs/b.md': '# Setup\n\nbody',
    };
    for (const [p, c] of Object.entries(entries)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    const findings = await docsLinksCheck.run(ctx(filesOf(entries), { anchors: true }));
    const messages = findings.map((f) => f.message);
    expect(findings).toHaveLength(2);
    expect(messages.some((m) => m.includes('#ghost') && m.includes('docs/b.md'))).toBe(true);
    expect(messages.some((m) => m.includes('#top'))).toBe(true);
  });
});
