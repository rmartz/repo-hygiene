import { describe, it, expect } from 'vitest';
import { evaluatePairing } from '../../src/checks/md-pairing.js';

const REG = '100644';
const LINK = '120000';
const modes = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries));

describe('evaluatePairing', () => {
  it('passes a directory with both directive files as regular files', () => {
    expect(evaluatePairing(modes({ 'CLAUDE.md': REG, 'AGENTS.md': REG, 'src/x.ts': REG }))).toEqual(
      [],
    );
  });

  it('flags a CLAUDE.md with no paired AGENTS.md', () => {
    const findings = evaluatePairing(modes({ 'CLAUDE.md': REG }));
    expect(findings).toEqual([
      {
        check: 'md-pairing',
        path: 'CLAUDE.md',
        message: 'CLAUDE.md has no paired AGENTS.md in the same directory',
        severity: 'error',
      },
    ]);
  });

  it('flags an AGENTS.md with no paired CLAUDE.md', () => {
    const findings = evaluatePairing(modes({ 'docs/AGENTS.md': REG }));
    expect(findings.map((f) => f.path)).toEqual(['docs/AGENTS.md']);
    expect(findings[0]?.message).toContain('no paired CLAUDE.md');
  });

  it('flags a symlinked directive file even when the pair is complete', () => {
    const findings = evaluatePairing(modes({ 'CLAUDE.md': REG, 'AGENTS.md': LINK }));
    expect(findings).toEqual([
      {
        check: 'md-pairing',
        path: 'AGENTS.md',
        message: 'AGENTS.md is a symlink; directive files must be regular files',
        severity: 'error',
      },
    ]);
  });

  it('evaluates each directory independently', () => {
    const findings = evaluatePairing(
      modes({
        'CLAUDE.md': REG, // root: unpaired
        'docs/CLAUDE.md': REG, // docs: complete
        'docs/AGENTS.md': REG,
      }),
    );
    expect(findings.map((f) => f.path)).toEqual(['CLAUDE.md']);
  });
});

describe('evaluatePairing — bare-wrapper rule', () => {
  const paired = modes({ 'CLAUDE.md': REG, 'AGENTS.md': REG });
  const wrapper = '@AGENTS.md';

  it('accepts a CLAUDE.md whose only meaningful line is the import (blank lines ignored)', () => {
    const contents = new Map([['CLAUDE.md', '\n@AGENTS.md\n\n']]);
    expect(evaluatePairing(paired, { wrapper, contents })).toEqual([]);
  });

  it('flags a CLAUDE.md that carries content beyond the import line', () => {
    const contents = new Map([['CLAUDE.md', '@AGENTS.md\n\n# Extra directives\n']]);
    const findings = evaluatePairing(paired, { wrapper, contents });
    expect(findings).toEqual([
      {
        check: 'md-pairing',
        path: 'CLAUDE.md',
        message:
          'CLAUDE.md must contain only the bare import line `@AGENTS.md`, but found: ["@AGENTS.md","# Extra directives"]',
        severity: 'error',
      },
    ]);
  });

  it('does not apply the wrapper rule when no wrapper is configured', () => {
    const contents = new Map([['CLAUDE.md', '# Not a wrapper\n']]);
    expect(evaluatePairing(paired, { contents })).toEqual([]);
  });

  it('does not apply the wrapper rule to AGENTS.md', () => {
    // AGENTS.md holds directives; only CLAUDE.md must be the bare wrapper.
    const contents = new Map([['CLAUDE.md', '@AGENTS.md\n']]);
    expect(evaluatePairing(paired, { wrapper, contents })).toEqual([]);
  });
});
