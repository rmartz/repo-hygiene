import { trackedFileModes, worktreeContent } from '../discovery.js';
import type { Check, CheckConfig, Finding } from '../types.js';

/**
 * `CLAUDE.md` / `AGENTS.md` pairing. The two agent-directive files must travel
 * together: a directory that carries one must carry the other, and each must be
 * a **regular file**, never a symlink — a symlinked directive file (git index
 * mode `120000`) is a violation, not a link to follow. Keeping both as real
 * files means every tool that reads only one of the two names sees the same
 * content regardless of which it opens.
 *
 * Optionally (config-gated by `wrapper`), it also enforces the **bare-wrapper**
 * convention: directives live in `AGENTS.md`, and each `CLAUDE.md` is a bare
 * wrapper whose only meaningful line is the import line (e.g. `@AGENTS.md`).
 *
 * Pairing is a whole-tree structural invariant (seeing only a changed subset
 * can't tell whether a pair is complete), so the check reads the full tracked
 * set and its git modes directly rather than the mode-scoped file set.
 */

const NAME = 'md-pairing';
const SYMLINK_MODE = '120000';
const REGULAR_MODES = new Set(['100644', '100755']);
const PAIR = { 'CLAUDE.md': 'AGENTS.md', 'AGENTS.md': 'CLAUDE.md' } as const;

type DirectiveName = keyof typeof PAIR;
const isDirective = (name: string): name is DirectiveName => Object.hasOwn(PAIR, name);

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};
const baseOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
};
const joinDir = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

const meaningfulLines = (content: string): string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export interface PairingOptions {
  /**
   * When set, require each `CLAUDE.md` to be a bare wrapper whose only
   * meaningful (non-blank) line is this import string, e.g. `@AGENTS.md`.
   */
  wrapper?: string;
  /** `CLAUDE.md` path → worktree content, consulted only for the wrapper rule. */
  contents?: Map<string, string>;
}

/** Evaluate pairing (and, if `opts.wrapper` is set, the bare-wrapper rule). */
export function evaluatePairing(modes: Map<string, string>, opts: PairingOptions = {}): Finding[] {
  // Which directive files (by name) each directory contains.
  const byDir = new Map<string, Map<DirectiveName, string>>();
  for (const [path, mode] of modes) {
    const name = baseOf(path);
    if (!isDirective(name)) continue;
    const dir = dirOf(path);
    const inDir = byDir.get(dir) ?? new Map<DirectiveName, string>();
    inDir.set(name, mode);
    byDir.set(dir, inDir);
  }

  const findings: Finding[] = [];
  const push = (path: string, message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };
  for (const [dir, present] of byDir) {
    for (const [name, mode] of present) {
      if (!REGULAR_MODES.has(mode)) {
        const msg =
          mode === SYMLINK_MODE
            ? `${name} is a symlink; directive files must be regular files`
            : `${name} is not a regular file (mode ${mode}); directive files must be regular files`;
        push(joinDir(dir, name), msg);
      }
      const counterpart = PAIR[name];
      if (!present.has(counterpart)) {
        push(joinDir(dir, name), `${name} has no paired ${counterpart} in the same directory`);
      }
      // Bare-wrapper rule: only for a regular CLAUDE.md, when configured.
      if (opts.wrapper !== undefined && name === 'CLAUDE.md' && REGULAR_MODES.has(mode)) {
        const lines = meaningfulLines(opts.contents?.get(joinDir(dir, name)) ?? '');
        if (!(lines.length === 1 && lines[0] === opts.wrapper)) {
          push(
            joinDir(dir, name),
            `CLAUDE.md must contain only the bare import line \`${opts.wrapper}\`, but found: ${JSON.stringify(lines)}`,
          );
        }
      }
    }
  }
  return findings;
}

/** Resolve the `wrapper` config: a string import line, `true` → `@AGENTS.md`, else off. */
function resolveWrapper(settings: CheckConfig): string | undefined {
  const wrapper = settings.wrapper;
  if (wrapper === undefined || wrapper === false) return undefined;
  if (wrapper === true) return '@AGENTS.md';
  if (typeof wrapper === 'string') return wrapper;
  throw new Error(`${NAME}: "wrapper" must be a string or boolean`);
}

export const mdPairingCheck: Check = {
  name: NAME,
  description:
    'CLAUDE.md / AGENTS.md must be paired regular files in every directory that has one; optionally each CLAUDE.md must be a bare @AGENTS.md wrapper.',
  async run(ctx) {
    const wrapper = resolveWrapper(ctx.settings);
    const modes = await trackedFileModes({ cwd: ctx.cwd });
    if (wrapper === undefined) return evaluatePairing(modes);
    // Read CLAUDE.md contents (regular files only) for the wrapper rule.
    const contents = new Map<string, string>();
    for (const [path, mode] of modes) {
      if (baseOf(path) === 'CLAUDE.md' && REGULAR_MODES.has(mode)) {
        contents.set(path, worktreeContent(path, { cwd: ctx.cwd }));
      }
    }
    return evaluatePairing(modes, { wrapper, contents });
  },
};
