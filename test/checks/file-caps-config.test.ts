import { describe, it, expect } from 'vitest';
import { parseByteSize, parseFileCapsConfig } from '../../src/checks/file-caps-config.js';

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
