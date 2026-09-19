#!/usr/bin/env node
// Rewrite the @rmartz/repo-hygiene version the reusable workflow installs, so a
// pinned `hygiene.yml@<sha>` installs the matching CLI version. Run by
// semantic-release's @semantic-release/exec `prepareCmd` with the next version;
// @semantic-release/git then commits the change so the release tag carries it.
//
//   node scripts/set-hygiene-version.mjs 3.0.1
//
// It replaces the version on the `version:` input's `default:` line, identified
// by the trailing `# x-release-version` marker (so the other `default:` lines —
// node-version, pr — are left untouched).
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`set-hygiene-version: expected a semver argument, got: ${version ?? '(none)'}`);
  process.exit(1);
}

const path = '.github/workflows/hygiene.yml';
const src = readFileSync(path, 'utf8');
const re = /(default:\s*)\d+\.\d+\.\d+(\s*# x-release-version)/;

if (!re.test(src)) {
  console.error(`set-hygiene-version: "# x-release-version" marker not found in ${path}`);
  process.exit(1);
}

writeFileSync(path, src.replace(re, `$1${version}$2`));
console.log(`set-hygiene-version: ${path} install version → ${version}`);
