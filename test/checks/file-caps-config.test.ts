import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OVERRIDES,
  parseByteSize,
  parseFileCapsConfig,
  resolveFileCapsOverrides,
} from '../../src/checks/file-caps-config.js';

describe('parseByteSize', () => {
  it('passes a raw non-negative integer through as bytes', () => {
    expect(parseByteSize(1024)).toBe(1024);
  });

  it('parses a bare numeric string as bytes', () => {
    expect(parseByteSize('4096')).toBe(4096);
  });

  it('parses KB / MB / GB as binary multiples', () => {
    expect(parseByteSize('40KB')).toBe(40 * 1024);
    expect(parseByteSize('1.5MB')).toBe(Math.round(1.5 * 1024 * 1024));
    expect(parseByteSize('2 GB')).toBe(2 * 1024 ** 3);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(parseByteSize('  10kb ')).toBe(10 * 1024);
  });

  it('rejects a negative or non-integer raw number', () => {
    expect(() => parseByteSize(-1)).toThrow(/non-negative integer/);
    expect(() => parseByteSize(1.5)).toThrow(/non-negative integer/);
  });

  it('rejects an unknown unit and unparseable text', () => {
    expect(() => parseByteSize('5 furlongs')).toThrow(/unknown byte unit/);
    expect(() => parseByteSize('big')).toThrow(/invalid byte size/);
  });
});

describe('parseFileCapsConfig', () => {
  it('returns [] when no overrides are configured', () => {
    expect(parseFileCapsConfig({})).toEqual([]);
  });

  it('parses an ordered list with independent line and byte tiers', () => {
    const entries = parseFileCapsConfig({
      overrides: [
        { glob: '**/AGENTS.md', lines: { warn: 200 }, bytes: { error: '40KB' } },
        { glob: '**/*', lines: { warn: 240, error: 480 } },
      ],
    });
    expect(entries).toEqual([
      { glob: '**/AGENTS.md', lines: { warn: 200 }, bytes: { error: 40 * 1024 } },
      { glob: '**/*', lines: { warn: 240, error: 480 } },
    ]);
  });

  it('rejects a non-list overrides value', () => {
    expect(() => parseFileCapsConfig({ overrides: {} })).toThrow(/"overrides" must be a list/);
  });

  it('rejects an entry without a string glob', () => {
    expect(() => parseFileCapsConfig({ overrides: [{ lines: { error: 1 } }] })).toThrow(
      /needs a string "glob"/,
    );
  });

  it('rejects a non-integer line threshold', () => {
    expect(() =>
      parseFileCapsConfig({ overrides: [{ glob: '*', lines: { error: '480' } }] }),
    ).toThrow(/line threshold/);
  });
});

describe('resolveFileCapsOverrides', () => {
  it('applies the shared defaults when a repo configures nothing', () => {
    const entries = resolveFileCapsOverrides({});
    expect(entries).toEqual(DEFAULT_OVERRIDES);
  });

  it('ships two-tier defaults — every glob hard-gates with warn below error', () => {
    for (const entry of DEFAULT_OVERRIDES) {
      expect(entry.lines?.error).toBeGreaterThan(0);
      expect(entry.lines?.warn).toBeLessThan(entry.lines?.error ?? 0);
      expect(entry.bytes?.error).toBeGreaterThan(0);
      expect(entry.bytes?.warn).toBeLessThan(entry.bytes?.error ?? 0);
    }
  });

  it("puts a repo's overrides ahead of the shared defaults (first-match-wins)", () => {
    const entries = resolveFileCapsOverrides({
      overrides: [{ glob: 'src/**/*.ts', lines: { error: 500 } }],
    });
    expect(entries[0]).toEqual({ glob: 'src/**/*.ts', lines: { error: 500 } });
    expect(entries.slice(1)).toEqual(DEFAULT_OVERRIDES);
  });

  it('caps every agent directive file tighter than plain Markdown (error 200 lines / 32 KB)', () => {
    const directiveGlobs = [
      '**/{AGENTS,CLAUDE}.md',
      '**/.cursorrules',
      '**/.cursor/rules/**/*.mdc',
    ];
    for (const glob of directiveGlobs) {
      const entry = DEFAULT_OVERRIDES.find((e) => e.glob === glob);
      expect(entry).toEqual({
        glob,
        lines: { warn: 140, error: 200 },
        bytes: { warn: 24 * 1024, error: 32 * 1024 },
      });
    }
  });

  it('gives every test-file default the widest cap (error 1200 lines / 128 KB)', () => {
    const testGlobs = DEFAULT_OVERRIDES.filter((e) => /test|spec/.test(e.glob));
    expect(testGlobs.length).toBeGreaterThan(0);
    for (const entry of testGlobs) {
      expect(entry.lines).toEqual({ warn: 800, error: 1200 });
      expect(entry.bytes).toEqual({ warn: 96 * 1024, error: 128 * 1024 });
    }
  });

  it('orders the narrower globs before the generic code/Markdown globs (first-match-wins)', () => {
    const globs = DEFAULT_OVERRIDES.map((e) => e.glob);
    const agentsIdx = globs.indexOf('**/{AGENTS,CLAUDE}.md');
    const mdIdx = globs.findIndex((g) => g === '**/*.md');
    const codeIdx = globs.findIndex((g) => g.startsWith('**/*.{ts,'));
    const lastTestIdx = globs.map((g) => /test|spec/.test(g)).lastIndexOf(true);
    expect(agentsIdx).toBeLessThan(mdIdx); // AGENTS/CLAUDE match before plain **/*.md
    expect(lastTestIdx).toBeLessThan(codeIdx); // test globs match before **/*.{code}
  });
});
