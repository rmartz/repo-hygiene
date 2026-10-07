import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedRun } from '../lib/bounded-subprocess.js';
import { InconclusiveError } from '../outcome.js';
import { ACTIONLINT_VERSION, releaseAsset } from './actionlint-release.js';
import type { ReleaseAsset } from './actionlint-release.js';

/**
 * Fetch the pinned actionlint release for this platform into a fresh temp dir,
 * verify the archive against the pinned SHA-256, unpack it, and return the
 * binary's path. Every run downloads afresh (the archive is ~2 MB), so there is no
 * cache to poison and no check-then-use gap between verifying and running.
 */

const DOWNLOAD_TIMEOUT_MS = 60_000;
const EXTRACT_TIMEOUT_MS = 30_000;

/** Lowercase hex SHA-256 of `data`. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function download(url: string): Promise<Uint8Array> {
  const inconclusive = (err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    return new InconclusiveError(`could not download actionlint (${reason}) — re-run`);
  };
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw inconclusive(err);
  }
  // A rate limit or server error says nothing about the change; anything else
  // (a 404 on a pinned release) is a real fault that a re-run will not fix.
  if (res.status === 429 || res.status >= 500) {
    throw new InconclusiveError(`could not download actionlint (HTTP ${res.status}) — re-run`);
  }
  if (!res.ok) throw new Error(`actionlint: downloading ${url} failed with HTTP ${res.status}`);
  // The timeout signal also covers the body, so a dropped or stalled connection
  // after the headers arrive rejects here rather than in `fetch`.
  try {
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    throw inconclusive(err);
  }
}

/**
 * Install the pinned actionlint release `asset` (this platform's, by default) and
 * return the path to its executable.
 */
export async function installActionlint(
  asset: ReleaseAsset | undefined = releaseAsset(process.platform, process.arch),
): Promise<string> {
  if (!asset) {
    throw new Error(
      `actionlint: no actionlint ${ACTIONLINT_VERSION} release binary for ${process.platform}/${process.arch}`,
    );
  }
  const archive = await download(asset.url);
  const digest = sha256Hex(archive);
  if (digest !== asset.sha256) {
    throw new Error(
      `actionlint: checksum mismatch for ${asset.name} (expected ${asset.sha256}, got ${digest}); refusing to run it`,
    );
  }
  // The caller deletes this dir (the binary's parent) once actionlint has run.
  const dir = await mkdtemp(join(tmpdir(), 'repo-hygiene-actionlint-'));
  try {
    const archivePath = join(dir, asset.name);
    await writeFile(archivePath, archive);
    // bsdtar (macOS, Windows) reads both formats from `-xf`; GNU tar autodetects gzip.
    const res = await boundedRun('tar', ['-xf', archivePath, '-C', dir, asset.binary], {
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });
    if (res.code !== 0) {
      throw new Error(`actionlint: unpacking ${asset.name} failed: ${res.stderr.trim()}`);
    }
    await rm(archivePath);
    return join(dir, asset.binary);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
