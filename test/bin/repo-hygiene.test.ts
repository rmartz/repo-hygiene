import { describe, it, expect } from 'vitest';
import { parseArgs, resolveOnly } from '../../src/bin/repo-hygiene.js';
import { createRegistry } from '../../src/registry.js';
import type { Check } from '../../src/types.js';

const fake = (name: string, defaultOn?: boolean): Check => ({
  name,
  description: name,
  ...(defaultOn ? { defaultOn } : {}),
  run: async () => [],
});

// a and c are default-on; b is opt-in.
const registry = createRegistry([fake('a', true), fake('b'), fake('c', true)]);

const parsed = (over: Partial<ReturnType<typeof baseParsed>> = {}) => ({
  ...baseParsed(),
  ...over,
});
const baseParsed = () => ({
  mode: '--check' as const,
  only: [] as string[],
  all: false,
  updateBaseline: false,
});

describe('parseArgs', () => {
  it('parses --all alongside a mode', () => {
    expect(parseArgs(['--all', '--check'])).toMatchObject({ all: true, only: [], mode: '--check' });
  });

  it('collects positional check names', () => {
    expect(parseArgs(['okf', 'docs-links'])).toMatchObject({
      only: ['okf', 'docs-links'],
      all: false,
    });
  });

  it('reports an unknown option', () => {
    expect(parseArgs(['--nope'])).toEqual({ error: 'unknown option: --nope' });
  });
});

describe('resolveOnly', () => {
  it('a bare run selects the registry default-on set', () => {
    expect(resolveOnly(registry, parsed())).toEqual(['a', 'c']);
  });

  it('--all selects every check (undefined → the runner runs all)', () => {
    expect(resolveOnly(registry, parsed({ all: true }))).toBeUndefined();
  });

  it('explicit names win over both the default and --all', () => {
    expect(resolveOnly(registry, parsed({ only: ['b'], all: true }))).toEqual(['b']);
  });
});
