import type { Check, Finding } from '../types.js';

/**
 * package.json full-pin conformance — ported from ai-tools' root
 * `scripts/check-pins.ts` (built for #63). Every registry dependency must be
 * pinned to a full `[major].[minor].[patch]` base, keeping the `^`/`~` range
 * operator (`^3.8.3`, `~1.2.0`). An abbreviated pin like `^3` or `^3.8` lets
 * Dependabot upgrade the dependency through a `pnpm-lock.yaml`-only change with
 * no `package.json` diff, hiding the bump from review. This is the npm analog of
 * `action-pins`' SHA rule — the second half of dependency-pin enforcement — and
 * shares its shape: pure logic exported for reuse, a thin check adapter.
 *
 * `isRegistryRange` / `checkPinRange` / `scanManifest` stay exported (and
 * unit-tested) so PR Shepherd and other callers can reuse the pure logic.
 */

const NAME = 'package-pins';

// A registry version range whose base is full semver, optionally prefixed by a
// single `^` or `~`. Rejects `^3`, `^3.8`, `*`, `latest`, `>=1.2.3`, `1.2.x`, …
const FULL_PIN = /^[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// The dependency fields whose ranges are pin-enforced.
const PINNED_FIELDS = ['dependencies', 'devDependencies'] as const;

/**
 * Whether `spec` is a plain registry range (subject to the pin rule). Non-registry
 * specifiers carry a protocol or path (`workspace:`, `catalog:`, `npm:`, `link:`,
 * `file:`, git/url, `owner/repo` shorthand) — never pinned here.
 */
export function isRegistryRange(spec: string): boolean {
  return !/[:/]/.test(spec);
}

/** The reason a version range violates the full-pin policy, or null if it conforms. */
export function checkPinRange(range: string): string | null {
  if (!isRegistryRange(range)) return null;
  if (FULL_PIN.test(range)) return null;
  return `"${range}" — pin a full [major].[minor].[patch] base (keep the ^/~ operator)`;
}

export interface ManifestPinError {
  file: string;
  /** `field.dependency` for a range violation; empty for a parse failure. */
  dep: string;
  reason: string;
}

/** Scan one package.json's text for non-conforming dependency ranges. */
export function scanManifest(file: string, text: string): ManifestPinError[] {
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
  } catch (err) {
    return [{ file, dep: '', reason: `could not parse JSON: ${(err as Error).message}` }];
  }
  const errors: ManifestPinError[] = [];
  for (const field of PINNED_FIELDS) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      const reason = checkPinRange(range);
      if (reason) errors.push({ file, dep: `${field}.${dep}`, reason });
    }
  }
  return errors;
}

const isManifest = (path: string): boolean =>
  path === 'package.json' || path.endsWith('/package.json');

export const packagePinsCheck: Check = {
  name: NAME,
  description: 'package.json dependencies pinned to a full [major].[minor].[patch] base.',
  async run(ctx) {
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      if (!isManifest(path)) continue;
      const text = await ctx.files.read(path);
      for (const { file, dep, reason } of scanManifest(path, text)) {
        const message = dep ? `${dep} = ${reason}` : reason;
        findings.push({ check: NAME, path: file, message, severity: 'error' });
      }
    }
    return findings;
  },
};
