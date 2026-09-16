import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSet } from '../../src/discovery.js';
import { okfCheck, validateDoc } from '../../src/checks/okf.js';

const DEFAULTS = {
  types: ['Skill', 'Script', 'Library', 'Design'],
  roots: ['docs'],
  exempt: ['docs/index.md'],
  resourceExemptTypes: ['Design'],
};

const page = (front: Record<string, string>): string => {
  const body = Object.entries(front)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${body}\n---\n\n# Title\n`;
};

describe('validateDoc', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'okf-'));
    writeFileSync(join(dir, 'resource.ts'), 'export {};');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const valid = { type: 'Library', title: 'x', description: 'y', resource: 'resource.ts' };

  it('passes a well-formed page whose resource exists', () => {
    expect(
      validateDoc('docs/a.md', page(valid), DEFAULTS, (p) => existsSync(join(dir, p))),
    ).toEqual([]);
  });

  it('flags a type outside the vocabulary', () => {
    const findings = validateDoc('docs/a.md', page({ ...valid, type: 'Nope' }), DEFAULTS, (p) =>
      existsSync(join(dir, p)),
    );
    expect(findings.map((f) => f.message)).toContain(
      'type must be one of Skill|Script|Library|Design',
    );
  });

  it('flags missing title and description', () => {
    const findings = validateDoc(
      'docs/a.md',
      page({ type: 'Library', resource: 'resource.ts' }),
      DEFAULTS,
      (p) => existsSync(join(dir, p)),
    );
    expect(findings.map((f) => f.message)).toEqual(
      expect.arrayContaining(['missing title', 'missing description']),
    );
  });

  it('requires a resource for a non-exempt type', () => {
    const findings = validateDoc(
      'docs/a.md',
      page({ type: 'Library', title: 'x', description: 'y' }),
      DEFAULTS,
      (p) => existsSync(join(dir, p)),
    );
    expect(findings.map((f) => f.message)).toContain('Library page needs a resource');
  });

  it('flags a resource that does not exist', () => {
    const findings = validateDoc(
      'docs/a.md',
      page({ ...valid, resource: 'missing.ts' }),
      DEFAULTS,
      (p) => existsSync(join(dir, p)),
    );
    expect(findings.map((f) => f.message)).toContain('resource not found: missing.ts');
  });

  it('exempts a Design page from the resource requirement', () => {
    expect(
      validateDoc(
        'docs/a.md',
        page({ type: 'Design', title: 'x', description: 'y' }),
        DEFAULTS,
        (p) => existsSync(join(dir, p)),
      ),
    ).toEqual([]);
  });

  it('honours a custom type vocabulary from config', () => {
    const cfg = { ...DEFAULTS, types: ['Guide'] };
    expect(
      validateDoc(
        'docs/a.md',
        page({ type: 'Guide', title: 'x', description: 'y', resource: 'resource.ts' }),
        cfg,
        (p) => existsSync(join(dir, p)),
      ),
    ).toEqual([]);
  });
});

describe('okfCheck.run', () => {
  const filesOf = (entries: Record<string, string>): FileSet => ({
    paths: Object.keys(entries),
    read: (p) => entries[p] ?? '',
  });
  const ctx = (files: FileSet, settings = {}) => ({
    mode: '--check' as const,
    files,
    cwd: process.cwd(),
    settings,
    env: {},
  });

  it('validates only in-scope docs pages and skips the reserved index and non-docs files', async () => {
    const files = filesOf({
      'docs/index.md': page({ type: 'Nope' }), // reserved → skipped
      'src/x.ts': 'const x = 1;', // not a docs page → skipped
      'docs/bad.md': page({ title: 'x' }), // in scope, invalid
    });
    const findings = await okfCheck.run(ctx(files));
    expect(findings.every((f) => f.path === 'docs/bad.md')).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('respects custom roots and exempt lists from config', async () => {
    const files = filesOf({ 'guides/bad.md': page({ title: 'x' }) });
    const findings = await okfCheck.run(ctx(files, { roots: ['guides'], exempt: [] }));
    expect(findings.map((f) => f.path)).toContain('guides/bad.md');
  });
});
