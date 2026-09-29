import { describe, it, expect } from 'vitest';
import { computeMetrics, evaluateFileCaps, type FileMetrics } from '../../src/checks/file-caps.js';
import type { OverrideEntry } from '../../src/checks/file-caps-config.js';

const metric = (path: string, lines: number, bytes = 0): FileMetrics => ({ path, lines, bytes });

describe('computeMetrics', () => {
  it('counts lines without an extra for a trailing newline, and UTF-8 bytes', () => {
    expect(computeMetrics('a.ts', 'a\nb\n')).toEqual({ path: 'a.ts', lines: 2, bytes: 4 });
    expect(computeMetrics('a.ts', 'a\nb')).toEqual({ path: 'a.ts', lines: 2, bytes: 3 });
    expect(computeMetrics('a.ts', '')).toEqual({ path: 'a.ts', lines: 0, bytes: 0 });
  });

  it('measures bytes, not characters, for multibyte content', () => {
    expect(computeMetrics('a.ts', '€').bytes).toBe(3);
  });
});

describe('evaluateFileCaps', () => {
  const overrides: OverrideEntry[] = [
    { glob: '**/*.test.ts', lines: { error: 720 } }, // most-specific first
    { glob: '**/*.ts', lines: { warn: 240, error: 480 } },
  ];

  it('applies the first matching glob only (no merge with later entries)', () => {
    // 600-line test file: under the test cap (720), so no finding — even though
    // the later **/*.ts entry would error at 480.
    expect(evaluateFileCaps([metric('a.test.ts', 600)], overrides, {})).toEqual([]);
  });

  it('errors over the hard cap and warns over the soft threshold', () => {
    const findings = evaluateFileCaps([metric('a.ts', 500), metric('b.ts', 300)], overrides, {});
    expect(findings).toEqual([
      {
        check: 'file-caps',
        path: 'a.ts',
        message: '500 lines exceeds the 480-lines cap',
        severity: 'error',
      },
      {
        check: 'file-caps',
        path: 'b.ts',
        message: '300 lines exceeds the 240-lines warn threshold',
        severity: 'warn',
      },
    ]);
  });

  it('evaluates lines and bytes independently — a file can warn on one and error on the other', () => {
    const entries: OverrideEntry[] = [
      { glob: '**/*', lines: { warn: 100 }, bytes: { error: 1000 } },
    ];
    const findings = evaluateFileCaps([metric('a.md', 150, 2000)], entries, {});
    expect(findings.map((f) => [f.severity, f.message])).toEqual([
      ['warn', '150 lines exceeds the 100-lines warn threshold'],
      ['error', '2000 B exceeds the 1000-bytes cap'],
    ]);
  });

  it('downgrades a grandfathered over-cap file to a warn', () => {
    const findings = evaluateFileCaps([metric('a.ts', 500)], overrides, { 'a.ts': { lines: 500 } });
    expect(findings).toEqual([
      {
        check: 'file-caps',
        path: 'a.ts',
        message: '500 lines over the 480-lines cap (baselined at 500)',
        severity: 'warn',
      },
    ]);
  });

  it('re-errors when a grandfathered file grows past its recorded ceiling', () => {
    const findings = evaluateFileCaps([metric('a.ts', 520)], overrides, { 'a.ts': { lines: 500 } });
    expect(findings[0]?.severity).toBe('error');
  });

  it('errors on a new over-cap file that is not in the baseline', () => {
    const findings = evaluateFileCaps([metric('new.ts', 500)], overrides, {
      'other.ts': { lines: 999 },
    });
    expect(findings[0]?.severity).toBe('error');
  });

  it('leaves an unmatched file uncapped', () => {
    expect(evaluateFileCaps([metric('README.txt', 9999)], overrides, {})).toEqual([]);
  });

  it('exempts a metric over cap on the base ref, with no ceiling', () => {
    const grandfathered = {
      mode: 'grandfather',
      base: 'origin/main',
      overCap: { 'a.ts': { lines: 500 } },
    } as const;
    const findings = evaluateFileCaps([metric('a.ts', 900)], overrides, {}, grandfathered);
    expect(findings).toEqual([
      {
        check: 'file-caps',
        path: 'a.ts',
        message: '900 lines over the 480-lines cap (grandfathered: 500 on origin/main)',
        severity: 'warn',
      },
    ]);
  });

  it('enforces a metric the base ref did not have over cap', () => {
    const entries: OverrideEntry[] = [
      { glob: '**/*', lines: { error: 100 }, bytes: { error: 1000 } },
    ];
    const grandfathered = {
      mode: 'grandfather',
      base: 'origin/main',
      overCap: { 'a.md': { lines: 150 } },
    } as const;
    const findings = evaluateFileCaps([metric('a.md', 150, 2000)], entries, {}, grandfathered);
    expect(findings.map((f) => f.severity)).toEqual(['warn', 'error']);
  });

  describe('ratchet from the base ref', () => {
    const ratchet = {
      mode: 'ratchet',
      base: 'origin/main',
      overCap: { 'a.ts': { lines: 500 } },
    } as const;

    it('warns while a metric is at or under its size on the base ref', () => {
      expect(evaluateFileCaps([metric('a.ts', 500)], overrides, {}, ratchet)).toEqual([
        {
          check: 'file-caps',
          path: 'a.ts',
          message: '500 lines over the 480-lines cap (ratchet: 500 on origin/main)',
          severity: 'warn',
        },
      ]);
    });

    it('errors when a metric grows past its size on the base ref', () => {
      expect(evaluateFileCaps([metric('a.ts', 501)], overrides, {}, ratchet)).toEqual([
        {
          check: 'file-caps',
          path: 'a.ts',
          message: '501 lines exceeds the 480-lines cap and its 500 on origin/main',
          severity: 'error',
        },
      ]);
    });

    it('enforces a file or metric the base ref did not have over cap', () => {
      const entries: OverrideEntry[] = [
        { glob: '**/*', lines: { error: 100 }, bytes: { error: 1000 } },
      ];
      const atBase = { mode: 'ratchet', base: 'b', overCap: { 'a.md': { lines: 150 } } } as const;
      const findings = evaluateFileCaps(
        [metric('a.md', 150, 2000), metric('new.md', 150)],
        entries,
        {},
        atBase,
      );
      expect(findings.map((f) => [f.path, f.severity])).toEqual([
        ['a.md', 'warn'],
        ['a.md', 'error'],
        ['new.md', 'error'],
      ]);
    });
  });
});
