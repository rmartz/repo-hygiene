import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Pure extraction of the shell a composite action runs: the `run:` steps of an
 * `action.yml` with `runs.using: composite`, each with the shellcheck dialect its
 * `shell:` maps to and the `action.yml` line every script line came from. Used by
 * the `composite-shellcheck` check, which actionlint's workflow-only scope leaves
 * to this module.
 */

const ACTION = /(?:^|\/)action\.ya?ml$/;

export type ShellDialect = 'bash' | 'sh';

/** One `run:` step of a composite action. */
export interface RunStep {
  /** How a finding names the step: its `name`, else its `id`, else `step <n>`. */
  label: string;
  /** The `shell:` value as written, or `undefined` when the step has none. */
  shell: string | undefined;
  /** The shellcheck dialect, or `undefined` for a non-shell step (`pwsh`, `python`, …). */
  dialect: ShellDialect | undefined;
  /** The script, with `${{ … }}` expressions masked (see {@link maskExpressions}). */
  script: string;
  /** The `action.yml` line of the `run:` value. */
  line: number;
  /**
   * Whether script line `k` sits at `action.yml` line `line + k`. True only for a
   * literal block (`run: |`); any other scalar style folds or joins lines, so a
   * finding in it is reported at {@link line}.
   */
  literal: boolean;
}

/** The result of reading one `action.yml`. */
export type ActionFile =
  | { kind: 'composite'; steps: RunStep[] }
  | { kind: 'other' }
  | { kind: 'invalid'; line: number | undefined; message: string };

/** Whether a repo-relative path is an action metadata file. */
export const isActionPath = (path: string): boolean => ACTION.test(path);

/**
 * Replace every `${{ … }}` expression with underscores of the same length (keeping
 * any newline inside it), as actionlint does, so expression syntax is never read
 * as shell and shellcheck's columns and lines still line up. A linear scan, not a
 * lazy regex, so an unclosed `${{` run can't make it quadratic.
 */
export function maskExpressions(script: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = script.indexOf('${{', from);
    if (start === -1) break;
    const end = script.indexOf('}}', start + 3);
    if (end === -1) break;
    out += script.slice(from, start) + script.slice(start, end + 2).replace(/[^\n]/g, '_');
    from = end + 2;
  }
  return out + script.slice(from);
}

/**
 * The shellcheck dialect for a `shell:` value: `bash` and `sh`, bare or as the
 * command of a custom shell (`bash -e {0}`, `/bin/sh {0}`). Anything else is not
 * a shell shellcheck reads.
 */
export function shellDialect(shell: string): ShellDialect | undefined {
  const command = shell.trim().split(/\s+/)[0] ?? '';
  const base = command.slice(command.lastIndexOf('/') + 1);
  return base === 'bash' || base === 'sh' ? base : undefined;
}

function stringAt(node: unknown, key: string): string | undefined {
  if (!isMap(node)) return undefined;
  const value: unknown = node.get(key);
  return typeof value === 'string' ? value : undefined;
}

/** Parse one `action.yml` and extract its composite `run:` steps. */
export function extractRunSteps(text: string): ActionFile {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const [error] = doc.errors;
  if (error) {
    return { kind: 'invalid', line: error.linePos?.[0].line, message: error.message };
  }
  const runs: unknown = doc.get('runs', true);
  if (stringAt(runs, 'using') !== 'composite' || !isMap(runs)) return { kind: 'other' };
  const steps: unknown = runs.get('steps', true);
  if (!isSeq(steps)) return { kind: 'composite', steps: [] };

  const out: RunStep[] = [];
  steps.items.forEach((step, i) => {
    if (!isMap(step)) return;
    const run: unknown = step.get('run', true);
    if (!isScalar(run) || typeof run.value !== 'string' || !run.range) return;
    const shell = stringAt(step, 'shell');
    out.push({
      label: stringAt(step, 'name') ?? stringAt(step, 'id') ?? `step ${i + 1}`,
      shell,
      dialect: shell === undefined ? undefined : shellDialect(shell),
      script: maskExpressions(run.value),
      line: lineCounter.linePos(run.range[0]).line,
      literal: run.type === 'BLOCK_LITERAL',
    });
  });
  return { kind: 'composite', steps: out };
}

/** The `action.yml` line a 1-based line of `step`'s script came from. */
export const actionLine = (step: RunStep, scriptLine: number): number =>
  step.literal ? step.line + scriptLine : step.line;
