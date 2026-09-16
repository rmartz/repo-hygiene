import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILENAME, emptyConfig, loadConfig, parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('parses per-check sections and passes check-specific keys through', () => {
    const config = parseConfig(
      ['checks:', '  file-caps:', '    severity: warn', '    max: 480', ''].join('\n'),
    );
    expect(config.checks['file-caps']).toEqual({ severity: 'warn', max: 480 });
  });

  it('treats empty YAML as the empty config', () => {
    expect(parseConfig('')).toEqual(emptyConfig());
  });

  it('treats a null-valued check section as an empty section', () => {
    expect(parseConfig('checks:\n  conflict-markers:\n')).toEqual({
      checks: { 'conflict-markers': {} },
    });
  });

  it('rejects an invalid severity', () => {
    expect(() => parseConfig('checks:\n  x:\n    severity: fatal\n')).toThrow(/invalid severity/);
  });

  it('rejects a non-mapping top level', () => {
    expect(() => parseConfig('- a\n- b\n')).toThrow(/top level must be a mapping/);
  });

  it('rejects a non-mapping "checks"', () => {
    expect(() => parseConfig('checks: 3\n')).toThrow(/"checks" must be a mapping/);
  });

  it('rejects a non-mapping check section', () => {
    expect(() => parseConfig('checks:\n  x: 3\n')).toThrow(/check "x" must be a mapping/);
  });

  it('prefixes YAML syntax errors with the config filename', () => {
    expect(() => parseConfig(': invalid: yaml: {')).toThrow(new RegExp(`^${CONFIG_FILENAME}: `));
  });
});

describe('loadConfig', () => {
  it('returns the empty config when the file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-cfg-'));
    try {
      expect(loadConfig({ cwd: dir })).toEqual(emptyConfig());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads .repo-hygiene.yml from cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-cfg-'));
    try {
      writeFileSync(
        join(dir, CONFIG_FILENAME),
        'checks:\n  conflict-markers:\n    severity: warn\n',
      );
      expect(loadConfig({ cwd: dir }).checks['conflict-markers']).toEqual({ severity: 'warn' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rethrows non-ENOENT read errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rh-cfg-'));
    try {
      const file = join(dir, CONFIG_FILENAME);
      // A directory where a file is expected triggers EISDIR, not ENOENT.
      mkdirSync(file);
      expect(() => loadConfig({ cwd: dir })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
