import { describe, it, expect } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import {
  isRegistryRange,
  checkPinRange,
  scanManifest,
  packagePinsCheck,
} from '../../src/checks/package-pins.js';

describe('isRegistryRange', () => {
  it('treats a plain semver range as a registry specifier', () => {
    expect(isRegistryRange('^3.8.3')).toBe(true);
    expect(isRegistryRange('1.2.3')).toBe(true);
  });

  it('treats protocol/path specifiers as non-registry', () => {
    expect(isRegistryRange('workspace:*')).toBe(false);
    expect(isRegistryRange('catalog:')).toBe(false);
    expect(isRegistryRange('npm:foo@1.2.3')).toBe(false);
    expect(isRegistryRange('link:../foo')).toBe(false);
    expect(isRegistryRange('file:./foo')).toBe(false);
    expect(isRegistryRange('git+https://example.com/foo.git')).toBe(false);
    expect(isRegistryRange('owner/repo')).toBe(false);
  });
});

describe('checkPinRange', () => {
  it('accepts a full base pin with a caret or tilde operator', () => {
    expect(checkPinRange('^3.8.3')).toBeNull();
    expect(checkPinRange('~1.2.0')).toBeNull();
  });

  it('accepts a bare full base pin and prerelease/build suffixes', () => {
    expect(checkPinRange('1.2.3')).toBeNull();
    expect(checkPinRange('^1.2.3-rc.1')).toBeNull();
    expect(checkPinRange('^1.2.3+build.5')).toBeNull();
  });

  it('rejects an abbreviated (non-full-base) pin', () => {
    expect(checkPinRange('^3')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
    expect(checkPinRange('^3.8')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
  });

  it('rejects a non-pin range', () => {
    expect(checkPinRange('*')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
    expect(checkPinRange('latest')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
    expect(checkPinRange('>=1.2.3')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
    expect(checkPinRange('1.2.x')).toMatch(/full \[major\]\.\[minor\]\.\[patch\]/);
  });

  it('exempts a non-registry specifier from the pin rule', () => {
    expect(checkPinRange('workspace:*')).toBeNull();
    expect(checkPinRange('catalog:')).toBeNull();
    expect(checkPinRange('link:../foo')).toBeNull();
  });
});

describe('scanManifest', () => {
  it('flags only the offending dependency, with its file and field.dep', () => {
    const text = JSON.stringify({
      dependencies: { good: '^3.8.3', bad: '^3' },
      devDependencies: { alsoGood: '~1.2.0' },
    });
    expect(scanManifest('packages/foo/package.json', text)).toEqual([
      {
        file: 'packages/foo/package.json',
        dep: 'dependencies.bad',
        reason: expect.stringMatching(/full \[major\]\.\[minor\]\.\[patch\]/),
      },
    ]);
  });

  it('scans devDependencies as well as dependencies', () => {
    const text = JSON.stringify({ devDependencies: { bad: '^3.8' } });
    const errors = scanManifest('package.json', text);
    expect(errors).toEqual([
      { file: 'package.json', dep: 'devDependencies.bad', reason: expect.any(String) },
    ]);
  });

  it('reports a parse failure as a single finding', () => {
    const errors = scanManifest('package.json', '{ not json');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.reason).toMatch(/could not parse/i);
  });
});

describe('packagePinsCheck.run', () => {
  const filesOf = (entries: Record<string, string>): FileSet => ({
    paths: Object.keys(entries),
    read: (p) => entries[p] ?? '',
  });
  const ctx = (files: FileSet) => ({
    mode: '--check' as const,
    files,
    settings: {},
    env: {},
  });

  it('flags a bad pin in a package.json and ignores non-manifest files', async () => {
    const files = filesOf({
      'packages/foo/package.json': JSON.stringify({ dependencies: { bad: '^3' } }),
      'src/package.json.ts': JSON.stringify({ dependencies: { bad: '^3' } }),
    });
    const findings = await packagePinsCheck.run(ctx(files));
    expect(findings).toEqual([
      {
        check: 'package-pins',
        path: 'packages/foo/package.json',
        message: expect.stringMatching(/dependencies\.bad = "\^3"/),
        severity: 'error',
      },
    ]);
  });

  it('produces no findings when every manifest is fully pinned', async () => {
    const files = filesOf({
      'package.json': JSON.stringify({
        dependencies: { a: '^3.8.3' },
        devDependencies: { b: 'workspace:*' },
      }),
    });
    expect(await packagePinsCheck.run(ctx(files))).toEqual([]);
  });
});
