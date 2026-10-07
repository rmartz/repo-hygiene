import type { Check, Finding } from '../types.js';
import {
  EXACT_TAG,
  isTagPinOwner,
  lookupRelease,
  releaseFinding,
  tagPinOwners,
  tagPinTarget,
  type ReleaseLookup,
} from './action-pins-releases.js';

/**
 * GitHub Actions SHA-pin conformance. Every external action referenced under
 * `.github/` must be pinned to a full 40-char commit SHA with a full-semver
 * version comment (`uses: owner/repo@<sha> # v7.0.0`), never a mutable tag: a
 * tag can be force-moved by a compromised upstream to run code with our token,
 * while a commit SHA is immutable. Local (`./…`) and self-repository (`$/…`) refs
 * move with the repo commit and are exempt. A security-flavored check.
 *
 * One exception (#76): an allowlisted first-party owner's ref may be pinned to an
 * exact `vX.Y.Z` tag instead, but only when that release is immutable. The shape
 * rule is pure (`checkActionRef` with `tagPinOwners`); the immutability lookup is
 * the check's one network call, made only for such tag pins (see
 * `action-pins-releases.ts`).
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
  // Pure string scan (no backtracking regex) so a `uses:` line with a long run
  // of whitespace is parsed in linear time. The former `^\s*(?:-\s*)?uses:\s*(.*)$`
  // form tripped CodeQL's polynomial-ReDoS check on the overlapping whitespace
  // quantifiers around the optional YAML sequence dash. Strip leading whitespace,
  // an optional `-` list marker and the whitespace after it, then require `uses:`.
  let rest = line.trimStart();
  if (rest.startsWith('-')) rest = rest.slice(1).trimStart();
  if (!rest.startsWith('uses:')) return null;
  rest = rest.slice('uses:'.length).trim();
  let comment: string | undefined;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    comment = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash).trim();
  }
  const uses = rest.replace(/^['"]|['"]$/g, '').trim();
  return uses ? { uses, comment } : null;
}

/** Options for {@link checkActionRef}. */
export interface ActionRefOptions {
  /**
   * Owners whose refs may be pinned to an exact `vX.Y.Z` tag. A ref this accepts
   * only conforms in *shape*: the caller must still confirm the release is
   * immutable (`lookupRelease`), as `actionPinsCheck` does.
   */
  tagPinOwners?: readonly string[];
}

/** The reason a `uses:` ref violates the pin policy, or null if it conforms. */
export function checkActionRef(
  uses: string,
  comment?: string,
  { tagPinOwners: owners = [] }: ActionRefOptions = {},
): string | null {
  // Local composite/action path — moves with the commit, not tag-attackable.
  if (uses.startsWith('./') || uses.startsWith('../')) return null;
  // Self-repository ref (`$/<path>`) — GitHub resolves it to THIS repository at the
  // exact commit already running, with no checkout. That is immutable by
  // construction, so it is exempt for the same reason `./` is, and strictly
  // stronger: a `./` ref depends on whatever the checkout put on disk, while `$/`
  // is resolved by the runner itself. Notably it also resolves correctly inside a
  // reusable workflow called from another repository (where `./` would wrongly
  // resolve against the CALLER's workspace), which is what makes a wrapper
  // workflow able to reference its own repo's action without a second pin to keep
  // in sync. See https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/
  if (uses.startsWith('$/')) return null;
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
  if (!SHA.test(ref) && isTagPinOwner(uses, owners)) {
    return EXACT_TAG.test(ref)
      ? null
      : `${uses} — a first-party tag pin must be an exact vX.Y.Z tag on an immutable release (a floating tag or branch is mutable); otherwise pin to a full 40-char commit SHA`;
  }
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
export function scanYaml(file: string, text: string, opts: ActionRefOptions = {}): PinError[] {
  const errors: PinError[] = [];
  text.split('\n').forEach((line, i) => {
    const parsed = parseUsesLine(line);
    if (!parsed) return;
    const reason = checkActionRef(parsed.uses, parsed.comment, opts);
    if (reason) errors.push({ file, line: i + 1, reason });
  });
  return errors;
}

const isGithubYaml = (path: string): boolean =>
  path.startsWith('.github/') && /\.ya?ml$/.test(path);

export const actionPinsCheck: Check = {
  name: NAME,
  description:
    'GitHub Actions pinned to a full commit SHA with a full-semver comment (or, first-party, an immutable release tag).',
  // Default-on: SHA-pinning is the security floor the hygiene suite exists to
  // spread, needs no config, and only inspects `.github/**` workflow YAML — so it
  // is safe to run on any consumer. (`package-pins`, its npm analog, is *not*
  // default-on: promoting it would break consumers using abbreviated ranges.)
  // The immutable-release lookup is the one network call, and it is made only for
  // an exact-tag pin by an allowlisted owner — a repo that SHA-pins everything
  // stays fully offline.
  defaultOn: true,
  async run(ctx) {
    const owners = tagPinOwners(ctx.settings, ctx.env);
    const findings: Finding[] = [];
    const tagPins: { path: string; line: number; uses: string; key: string }[] = [];
    const lookups = new Map<string, Promise<ReleaseLookup>>();
    for (const path of ctx.files.paths) {
      if (!isGithubYaml(path)) continue;
      const text = await ctx.files.read(path);
      for (const { file, line, reason } of scanYaml(path, text, { tagPinOwners: owners })) {
        findings.push({ check: NAME, path: file, line, message: reason, severity: 'error' });
      }
      text.split('\n').forEach((lineText, i) => {
        const uses = parseUsesLine(lineText)?.uses;
        const target = uses && tagPinTarget(uses, owners);
        if (!target) return;
        // Start each distinct release's lookup up front so they run concurrently.
        const key = `${target.repo}@${target.tag}`;
        if (!lookups.has(key)) lookups.set(key, lookupRelease(target.repo, target.tag, ctx.env));
        tagPins.push({ path, line: i + 1, uses, key });
      });
    }
    for (const pin of tagPins) {
      const target = tagPinTarget(pin.uses, owners)!;
      const result = releaseFinding(pin.uses, target, await lookups.get(pin.key)!);
      if (result) findings.push({ check: NAME, path: pin.path, line: pin.line, ...result });
    }
    return findings;
  },
};
