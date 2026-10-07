import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const { ACTIONLINT_VERSION, ACTIONLINT_CHECKSUMS, releaseAsset } =
  await import('../../src/checks/actionlint-release.js');
const { installActionlint, sha256Hex } = await import('../../src/checks/actionlint-binary.js');
const { InconclusiveError } = await import('../../src/outcome.js');

describe('the pinned release', () => {
  it('matches the version Dependabot tracks in tools/actionlint/Dockerfile', () => {
    // A Dependabot bump of the Dockerfile lands here first: regenerate the table
    // with `node scripts/update-actionlint.mjs <version>` to turn this green.
    const dockerfile = readFileSync('tools/actionlint/Dockerfile', 'utf8');
    const tag = /^FROM rhysd\/actionlint:(\S+?)@sha256:[0-9a-f]{64}$/m.exec(dockerfile)?.[1];
    expect(tag).toBe(ACTIONLINT_VERSION);
  });

  it('pins a full SHA-256 for every platform', () => {
    expect(Object.keys(ACTIONLINT_CHECKSUMS)).toHaveLength(11);
    for (const digest of Object.values(ACTIONLINT_CHECKSUMS))
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('releaseAsset', () => {
  it('maps Node platform/arch to the upstream asset', () => {
    expect(releaseAsset('linux', 'x64')).toEqual({
      name: `actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
      url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
      sha256: ACTIONLINT_CHECKSUMS.linux_amd64,
      binary: 'actionlint',
    });
    expect(releaseAsset('win32', 'arm64')).toMatchObject({
      name: `actionlint_${ACTIONLINT_VERSION}_windows_arm64.zip`,
      binary: 'actionlint.exe',
    });
    expect(releaseAsset('darwin', 'arm64')?.sha256).toBe(ACTIONLINT_CHECKSUMS.darwin_arm64);
  });

  it('returns undefined for a platform upstream does not build', () => {
    expect(releaseAsset('aix', 'ppc64')).toBeUndefined();
    expect(releaseAsset('linux', 's390x')).toBeUndefined();
  });
});

describe('installActionlint', () => {
  const archive = new TextEncoder().encode('fake archive');
  const fetchMock = vi.fn();
  const respond = (status: number, body: Uint8Array = archive) =>
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

  beforeEach(() => {
    boundedRun.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const linux = releaseAsset('linux', 'x64')!;
  /** The linux/x64 asset, re-pinned to the digest of the fake archive. */
  const pinnedToFake = { ...linux, sha256: sha256Hex(archive) };

  it('downloads the pinned asset, verifies it, and unpacks only the binary', async () => {
    respond(200);
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0, timedOut: false });
    const binary = await installActionlint(pinnedToFake);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(linux.url);
    const [cmd, args] = boundedRun.mock.calls[0] ?? [];
    expect(cmd).toBe('tar');
    expect(args?.[0]).toBe('-xf');
    expect(args?.at(-1)).toBe('actionlint');
    expect(binary).toMatch(/repo-hygiene-actionlint-.+[/\\]actionlint$/);
    // The (mocked) unpack wrote nothing, and the archive is already removed.
    expect(existsSync(dirname(binary))).toBe(true);
    rmSync(dirname(binary), { recursive: true });
  });

  it('refuses an archive whose checksum does not match the pin', async () => {
    respond(200, new TextEncoder().encode('tampered'));
    await expect(installActionlint(linux)).rejects.toThrow(/checksum mismatch/);
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('makes a network failure, rate limit, or server error inconclusive', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(installActionlint(linux)).rejects.toBeInstanceOf(InconclusiveError);
    respond(429);
    await expect(installActionlint(linux)).rejects.toBeInstanceOf(InconclusiveError);
    respond(503);
    await expect(installActionlint(linux)).rejects.toBeInstanceOf(InconclusiveError);
  });

  it('treats a missing release as a real fault', async () => {
    respond(404);
    const err = await installActionlint(linux).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(InconclusiveError);
  });

  it('fails an unpack error loudly and removes its temp dir', async () => {
    respond(200);
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: 'tar: bad', code: 1, timedOut: false });
    await expect(installActionlint(pinnedToFake)).rejects.toThrow(/unpacking .* failed: tar: bad/);
    // Its temp dir is gone: tar's argv named the archive inside it.
    const archivePath = boundedRun.mock.calls[0]?.[1]?.[1] as string;
    expect(existsSync(dirname(archivePath))).toBe(false);
  });
});
