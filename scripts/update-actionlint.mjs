#!/usr/bin/env node
// Re-pin the `actionlint` check to another actionlint release:
//
//   node scripts/update-actionlint.mjs <version>     # e.g. 1.7.13
//
// Rewrites ACTIONLINT_VERSION and the checksum table in
// src/checks/actionlint-release.ts from upstream's published
// actionlint_<version>_checksums.txt. Run it on a Dependabot PR that bumps
// tools/actionlint/Dockerfile (whose test goes red until the two agree), then
// review the new digests in the diff like any other pin change.
import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2]?.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/update-actionlint.mjs <major.minor.patch>');
  process.exit(2);
}

const url = `https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_checksums.txt`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`fetching ${url} failed: HTTP ${res.status}`);
  process.exit(1);
}

const entries = [];
for (const line of (await res.text()).split('\n')) {
  const m = /^([0-9a-f]{64})\s+actionlint_[^_]+_(\w+?)\.(?:tar\.gz|zip)$/.exec(line.trim());
  if (m) entries.push(`  ${m[2]}: '${m[1]}',`);
}
if (entries.length === 0) {
  console.error(`no archive checksums found in ${url}`);
  process.exit(1);
}

const file = new URL('../src/checks/actionlint-release.ts', import.meta.url);
const source = await readFile(file, 'utf8');
const updated = source
  .replace(/ACTIONLINT_VERSION = '[^']+'/, `ACTIONLINT_VERSION = '${version}'`)
  .replace(
    /(ACTIONLINT_CHECKSUMS: Record<string, string> = \{\n)[^}]*(\};)/,
    `$1${entries.sort().join('\n')}\n$2`,
  );
await writeFile(file, updated);
console.log(`pinned actionlint ${version} (${entries.length} archives)`);
