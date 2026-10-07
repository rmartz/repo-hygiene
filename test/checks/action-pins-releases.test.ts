import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileSet } from '../../src/discovery.js';
import { checkActionRef, actionPinsCheck } from '../../src/checks/action-pins.js';
import {
  tagPinTarget,
  tagPinOwners,
  lookupRelease,
} from '../../src/checks/action-pins-releases.js';

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

const fetchMock = vi.fn();
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const workflow = (...uses: string[]) =>
  filesOf({
    '.github/workflows/ci.yml': uses.map((u) => `      - uses: ${u}`).join('\n') + '\n',
  });
const ctx = (
  files: FileSet,
  settings: Record<string, unknown> = {},
  env: Record<string, string | undefined> = { GITHUB_REPOSITORY_OWNER: 'octo' },
) => ({ mode: '--check' as const, files, settings, env });

describe('owner allowlist', () => {
  it('defaults to the repo owner from GITHUB_REPOSITORY_OWNER', () => {
    expect(tagPinOwners({}, { GITHUB_REPOSITORY_OWNER: 'octo' })).toEqual(['octo']);
  });

  it('falls back to the owner in GITHUB_REPOSITORY', () => {
    expect(tagPinOwners({}, { GITHUB_REPOSITORY: 'octo/repo-hygiene' })).toEqual(['octo']);
  });

  it('is empty with no config and no repository env', () => {
    expect(tagPinOwners({}, {})).toEqual([]);
  });

  it('uses the configured tagPinOwners list over the env default', () => {
    expect(
      tagPinOwners({ tagPinOwners: ['acme', 'octo'] }, { GITHUB_REPOSITORY_OWNER: 'x' }),
    ).toEqual(['acme', 'octo']);
  });

  it('rejects a non-list tagPinOwners', () => {
    expect(() => tagPinOwners({ tagPinOwners: 'octo' }, {})).toThrow(/list of strings/);
  });
});

describe('tagPinTarget', () => {
  it('returns repo and tag for an exact-tag first-party action or reusable workflow', () => {
    expect(tagPinTarget('octo/bot-automerge-action@v1.2.3', ['octo'])).toEqual({
      repo: 'octo/bot-automerge-action',
      tag: 'v1.2.3',
    });
    expect(tagPinTarget('octo/ci/.github/workflows/x.yml@v2.0.0', ['OCTO'])).toEqual({
      repo: 'octo/ci',
      tag: 'v2.0.0',
    });
  });

  it('returns null for a third-party owner, a floating tag, or a SHA pin', () => {
    expect(tagPinTarget('actions/checkout@v7.0.1', ['octo'])).toBeNull();
    expect(tagPinTarget('octo/x@v2', ['octo'])).toBeNull();
    expect(tagPinTarget(`octo/x@${SHA}`, ['octo'])).toBeNull();
  });
});

describe('checkActionRef with tag-pin owners', () => {
  const opts = { tagPinOwners: ['octo'] };

  it('accepts the shape of an exact vX.Y.Z tag on a first-party ref', () => {
    expect(checkActionRef('octo/x@v1.2.3', undefined, opts)).toBeNull();
  });

  it('rejects a floating tag on a first-party ref, naming the exact-tag rule', () => {
    expect(checkActionRef('octo/x@v2', undefined, opts)).toMatch(/exact vX\.Y\.Z/);
    expect(checkActionRef('octo/x@main', undefined, opts)).toMatch(/exact vX\.Y\.Z/);
  });

  it('rejects a tag pin on a third-party ref', () => {
    expect(checkActionRef('actions/checkout@v7.0.1', undefined, opts)).toMatch(/not SHA-pinned/);
  });

  it('still accepts a SHA pin on a first-party ref', () => {
    expect(checkActionRef(`octo/x@${SHA}`, 'v1.2.3', opts)).toBeNull();
  });

  it('rejects every tag pin when no owners are eligible (the offline default)', () => {
    expect(checkActionRef('octo/x@v1.2.3')).toMatch(/not SHA-pinned/);
  });
});

describe('lookupRelease', () => {
  it('queries the release-by-tag endpoint, authenticating with GITHUB_TOKEN', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: true }));
    expect(await lookupRelease('octo/x', 'v1.2.3', { GITHUB_TOKEN: 't0k' })).toEqual({
      kind: 'immutable',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/octo/x/releases/tags/v1.2.3');
    expect(init.headers.authorization).toBe('Bearer t0k');
  });

  it('reports a release without immutable: true as mutable', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: false }));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('mutable');
    fetchMock.mockResolvedValue(json(200, {}));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('mutable');
  });

  it('treats a 404 as a definitive missing release', async () => {
    fetchMock.mockResolvedValue(json(404));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('missing');
  });

  it('treats rate limits, 5xx and network errors as transient', async () => {
    fetchMock.mockResolvedValue(json(403));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('transient');
    fetchMock.mockResolvedValue(json(502));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('transient');
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect((await lookupRelease('octo/x', 'v1.2.3', {})).kind).toBe('transient');
  });
});

describe('actionPinsCheck.run tag pins', () => {
  it('accepts a first-party tag pin on an immutable release', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: true }));
    expect(await actionPinsCheck.run(ctx(workflow('octo/x@v1.2.3')))).toEqual([]);
  });

  it('rejects a floating tag without a network call', async () => {
    const findings = await actionPinsCheck.run(ctx(workflow('octo/x@v2')));
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringMatching(/exact vX\.Y\.Z/),
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a tag pin on a mutable (pre-immutability) release', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: false }));
    const findings = await actionPinsCheck.run(ctx(workflow('octo/x@v1.2.3')));
    expect(findings).toEqual([
      expect.objectContaining({
        path: '.github/workflows/ci.yml',
        line: 1,
        severity: 'error',
        message: expect.stringMatching(/not immutable/),
      }),
    ]);
  });

  it('rejects a third-party tag pin without a network call', async () => {
    const findings = await actionPinsCheck.run(ctx(workflow('actions/checkout@v7.0.1')));
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringMatching(/not SHA-pinned/),
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails a tag pin whose release does not exist', async () => {
    fetchMock.mockResolvedValue(json(404));
    const findings = await actionPinsCheck.run(ctx(workflow('octo/x@v1.2.3')));
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringMatching(/no release v1\.2\.3/),
      }),
    ]);
  });

  it('fails closed as inconclusive when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const findings = await actionPinsCheck.run(ctx(workflow('octo/x@v1.2.3')));
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'inconclusive',
        message: expect.stringMatching(/could not confirm.*GITHUB_TOKEN/),
      }),
    ]);
  });

  it('looks up each distinct release once', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: true }));
    await actionPinsCheck.run(ctx(workflow('octo/x@v1.2.3', 'octo/x/sub@v1.2.3')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honours a configured owner allowlist', async () => {
    fetchMock.mockResolvedValue(json(200, { immutable: true }));
    const files = workflow('acme/x@v1.2.3');
    expect(await actionPinsCheck.run(ctx(files, { tagPinOwners: ['acme'] }))).toEqual([]);
    expect(await actionPinsCheck.run(ctx(files))).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/not SHA-pinned/) }),
    ]);
  });
});
