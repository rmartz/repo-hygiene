import { describe, it, expect } from 'vitest';
import {
  actionLine,
  extractRunSteps,
  isActionPath,
  maskExpressions,
  shellDialect,
} from '../../src/checks/composite-steps.js';

const composite = (steps: string) => `name: x\nruns:\n  using: composite\n  steps:\n${steps}`;

describe('selecting action files', () => {
  it('matches action.yml / action.yaml at any depth', () => {
    expect(isActionPath('action.yml')).toBe(true);
    expect(isActionPath('.github/actions/setup/action.yaml')).toBe(true);
    expect(isActionPath('.github/workflows/ci.yml')).toBe(false);
    expect(isActionPath('docs/my-action.yml')).toBe(false);
  });
});

describe('shellDialect', () => {
  it.each([
    ['bash', 'bash'],
    ['sh', 'sh'],
    ['bash -e {0}', 'bash'],
    ['/bin/sh {0}', 'sh'],
  ])('maps %j to %j', (shell, dialect) => {
    expect(shellDialect(shell)).toBe(dialect);
  });

  it.each(['pwsh', 'python', 'cmd', 'powershell', 'node {0}'])('skips non-shell %j', (shell) => {
    expect(shellDialect(shell)).toBeUndefined();
  });
});

describe('maskExpressions', () => {
  it('replaces each expression with same-length underscores', () => {
    expect(maskExpressions('echo "${{ inputs.a }}" ${{github.sha}}')).toBe(
      `echo "${'_'.repeat(15)}" ${'_'.repeat(15)}`,
    );
  });

  it('keeps newlines inside a multi-line expression', () => {
    expect(maskExpressions('a ${{ x\n }} b')).toBe('a _____\n___ b');
  });

  it('leaves an unclosed expression as written', () => {
    expect(maskExpressions('echo ${{ a }} ${{ b')).toBe(`echo ${'_'.repeat(8)} \${{ b`);
  });

  it('stays linear on a long unclosed ${{ run', () => {
    const script = '${{'.repeat(200_000);
    const started = performance.now();
    expect(maskExpressions(script)).toBe(script);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('extractRunSteps', () => {
  it('extracts each run: step with its label, shell, dialect and line', () => {
    const action = extractRunSteps(
      composite(
        [
          '    - name: Install',
          '      run: |',
          '        echo "${{ inputs.v }}"',
          '      shell: bash',
          '    - id: probe',
          '      run: echo hi',
          '      shell: pwsh',
          '    - uses: actions/checkout@abc',
          '    - run: >-',
          '        echo a',
          '      shell: sh',
          '',
        ].join('\n'),
      ),
    );
    expect(action).toEqual({
      kind: 'composite',
      steps: [
        {
          label: 'Install',
          shell: 'bash',
          dialect: 'bash',
          script: `echo "${'_'.repeat(15)}"\n`,
          line: 6,
          literal: true,
        },
        {
          label: 'probe',
          shell: 'pwsh',
          dialect: undefined,
          script: 'echo hi',
          line: 10,
          literal: false,
        },
        { label: 'step 4', shell: 'sh', dialect: 'sh', script: 'echo a', line: 13, literal: false },
      ],
    });
  });

  it('records a step with no shell', () => {
    const action = extractRunSteps(composite('    - run: echo hi\n'));
    expect(action).toMatchObject({ kind: 'composite', steps: [{ shell: undefined, line: 5 }] });
  });

  it('ignores non-composite actions', () => {
    expect(extractRunSteps('runs:\n  using: node20\n  main: index.js\n')).toEqual({
      kind: 'other',
    });
    expect(extractRunSteps('name: x\n')).toEqual({ kind: 'other' });
  });

  it('reports invalid YAML with its line', () => {
    expect(extractRunSteps('runs:\n  using: composite\n  steps: [\n')).toMatchObject({
      kind: 'invalid',
      line: expect.any(Number),
      message: expect.any(String),
    });
  });
});

describe('actionLine', () => {
  const step = { label: 's', shell: 'bash', dialect: 'bash' as const, script: '', line: 6 };

  it('offsets a literal block by the script line', () => {
    expect(actionLine({ ...step, literal: true }, 3)).toBe(9);
  });

  it('pins any other scalar style to the run: line', () => {
    expect(actionLine({ ...step, literal: false }, 3)).toBe(6);
  });
});
