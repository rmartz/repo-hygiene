import type { Check, Finding } from '../types.js';

/**
 * GitHub Actions SHA-pin conformance — ported from ai-tools'
 * `scripts/check-action-pins.ts`. Every external action referenced under
 * `.github/` must be pinned to a full 40-char commit SHA with a full-semver
 * version comment (`uses: owner/repo@<sha> # v7.0.0`), never a mutable tag: a
 * tag can be force-moved by a compromised upstream to run code with our token,
 * while a commit SHA is immutable. Local (`./…`) refs move with the repo commit
 * and are exempt. A security-flavored check.
 *
 * `parseUsesLine` / `checkActionRef` / `scanYaml` stay exported (and unit-tested)
 * so PR Shepherd and other callers can reuse the pure logic.
 */

const NAME = 'action-pins';

const SHA = /^[0-9a-fA-F]{40}$/;
// The pin comment must be a FULL major.minor.patch semver (optionally `v`-prefixed,
// with an optional pre-release/build suffix). Dependabot's github-actions ecosystem
// is unreliable at bumping pins whose comment is a partial version (`v7`, `v6.4`),
// so require all three components.
const FULL_SEMVER_COMMENT = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse the `uses:` value and any trailing `# comment` from one line. */
export function parseUsesLine(line: string): { uses: string; comment?: string } | null {
  const m = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/.exec(line);
  if (!m) return null;
  let rest = m[1] ?? '';
  let comment: string | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    comment = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
  }
  const uses = rest.replace(/^['"]|['"]$/g, '').trim();
  return uses ? { uses, comment } : null;
}

/** The reason a `uses:` ref violates the pin policy, or null if it conforms. */
export function checkActionRef(uses: string, comment?: string): string | null {
  // Local composite/action path — moves with the commit, not tag-attackable.
  if (uses.startsWith('./') || uses.startsWith('../')) return null;
  // Docker image reference — the immutable form is a @sha256 digest pin.
  if (uses.startsWith('docker://')) {
    return /@sha256:[0-9a-fA-F]{64}$/.test(uses)
      ? null
      : `${uses} — pin the docker image by @sha256 digest`;
  }
  const at = uses.lastIndexOf('@');
  if (at === -1) {
    return `${uses} — unpinned (no @ref); pin to a full 40-char commit SHA`;
  }
  const ref = uses.slice(at + 1);
  if (!SHA.test(ref)) {
    return `${uses} — not SHA-pinned; pin to a full 40-char commit SHA (a tag is mutable)`;
  }
  if (!comment || !FULL_SEMVER_COMMENT.test(comment)) {
    return `${uses} — SHA-pinned but the version comment must be a full major.minor.patch (e.g. "# v7.0.0"); Dependabot is unreliable with a partial version`;
  }
  return null;
}

export interface PinError {
  file: string;
  line: number;
  reason: string;
}

/** Scan one YAML file's text for non-conforming `uses:` references. */
export function scanYaml(file: string, text: string): PinError[] {
  const errors: PinError[] = [];
  text.split('\n').forEach((line, i) => {
    const parsed = parseUsesLine(line);
    if (!parsed) return;
    const reason = checkActionRef(parsed.uses, parsed.comment);
    if (reason) errors.push({ file, line: i + 1, reason });
  });
  return errors;
}

const isGithubYaml = (path: string): boolean =>
  path.startsWith('.github/') && /\.ya?ml$/.test(path);

export const actionPinsCheck: Check = {
  name: NAME,
  description: 'GitHub Actions pinned to a full commit SHA with a full-semver comment.',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      if (!isGithubYaml(path)) continue;
      const text = await ctx.files.read(path);
      for (const { file, line, reason } of scanYaml(path, text)) {
        findings.push({ check: NAME, path: file, line, message: reason, severity: 'error' });
      }
    }
    return findings;
  },
};
