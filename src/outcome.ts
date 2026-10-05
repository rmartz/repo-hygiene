/**
 * Run outcomes beyond pass/fail. A failure (`exit 1`) means the run detected an
 * issue in the change that needs fixing; an external transient error (a rate
 * limit, a timeout, an unreachable network) proves nothing about the change, so
 * it makes the run **inconclusive** (`exit 3`) instead. A CI wrapper maps that to
 * a cancelled or re-runnable result rather than a red one.
 */

export const EXIT_CLEAN = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_INCONCLUSIVE = 3;

/**
 * Thrown by a check that cannot reach any verdict because of an external
 * transient error. The runner records it as one repo-level `inconclusive`
 * finding and carries on with the remaining checks. A check that can still judge
 * part of its input emits per-item `inconclusive` findings instead of throwing,
 * so a real `error` elsewhere is not lost.
 */
export class InconclusiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InconclusiveError';
  }
}
