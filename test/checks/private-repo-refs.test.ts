import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileSet } from '../../src/discovery.js';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const { parseSettings, parseGithubRemote, findRepoRefs, fetchVisibility, privateRepoRefsCheck } =
  await import('../../src/checks/private-repo-refs.js');
const { InconclusiveError } = await import('../../src/outcome.js');
const { builtinChecks, createRegistry } = await import('../../src/registry.js');

const fetchMock = vi.fn();

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (
  files: FileSet,
  settings: Record<string, unknown> = {},
  env: Record<string, string | undefined> = { GITHUB_REPOSITORY: 'acme/site' },
) => ({ mode: '--check' as const, files, settings, env });

const json = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

/** Route fetch by repo full name: 'public' | 'private' (404) | an HTTP status. */
function visibilities(map: Record<string, 'public' | 'private' | number>) {
  fetchMock.mockImplementation(async (url: string) => {
    const name = url.replace(/^.*\/repos\//, '');
    const v = map[name];
    if (v === 'public') return json(200, { private: false });
    if (v === 'private' || v === undefined) return json(404);
    return json(v);
  });
}

beforeEach(() => {
  boundedRun.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('runs only when the checked repo is public', () => {
  it('no-ops on a private repo without scanning or looking up references', async () => {
    visibilities({ 'acme/site': 'private' });
    const findings = await privateRepoRefsCheck.run(
      ctx(filesOf({ 'README.md': 'see acme/secret#4\n' })),
    );
    expect(findings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is inconclusive when the repo’s own visibility cannot be looked up', async () => {
    visibilities({ 'acme/site': 503 });
    await expect(privateRepoRefsCheck.run(ctx(filesOf({})))).rejects.toBeInstanceOf(
      InconclusiveError,
    );
  });

  it('resolves the repo from the origin remote when GITHUB_REPOSITORY is unset', async () => {
    boundedRun.mockResolvedValueOnce({
      stdout: 'git@github.com:acme/site.git\n',
      stderr: '',
      code: 0,
      timedOut: false,
    });
    visibilities({ 'acme/site': 'public' });
    await privateRepoRefsCheck.run(ctx(filesOf({}), {}, {}));
    expect(boundedRun.mock.calls[0]?.[1]).toEqual(['remote', 'get-url', 'origin']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/acme/site');
  });

  it('warns and skips when the repo cannot be determined', async () => {
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: 'no remote', code: 2, timedOut: false });
    const findings = await privateRepoRefsCheck.run(ctx(filesOf({}), {}, {}));
    expect(findings).toEqual([
      { check: 'private-repo-refs', message: expect.any(String), severity: 'warn' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the repository setting', async () => {
    visibilities({ 'acme/other': 'private' });
    await privateRepoRefsCheck.run(ctx(filesOf({}), { repository: 'acme/other' }));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/acme/other');
  });
});

describe('recognizes same-owner reference forms', () => {
  it('finds owner/repo#N, github.com URLs, and bare owner/repo', () => {
    const text = [
      'Fixed in acme/secret#12.',
      'See https://github.com/acme/infra/blob/main/x.md and github.com/acme/tools.git',
      'Depends on acme/lib.',
      '- uses: acme/action/.github/workflows/x.yml@abc',
    ].join('\n');
    expect(findRepoRefs(text, 'acme')).toEqual([
      { repo: 'secret', line: 1 },
      { repo: 'infra', line: 2 },
      { repo: 'tools', line: 2 },
      { repo: 'lib', line: 3 },
      { repo: 'action', line: 4 },
    ]);
  });

  it('matches the owner case-insensitively and lower-cases repo names', () => {
    expect(findRepoRefs('ACME/Secret', 'acme')).toEqual([{ repo: 'secret', line: 1 }]);
  });

  it('ignores other owners, npm scopes, path segments, and longer owner names', () => {
    const text = [
      'other/repo',
      'import { x } from "@acme/pkg";',
      '/home/acme/notes and docs/acme/page',
      'notacme/repo acme-bot/repo',
    ].join('\n');
    expect(findRepoRefs(text, 'acme')).toEqual([]);
  });

  it('reports a repo once per line', () => {
    expect(findRepoRefs('acme/x#1 and acme/x#2', 'acme')).toEqual([{ repo: 'x', line: 1 }]);
  });

  it('trims a very long run of trailing dots in linear time', () => {
    const dots = '.'.repeat(50_000);
    const start = performance.now();
    expect(findRepoRefs(`acme/x${dots}!`, 'acme')).toEqual([{ repo: 'x', line: 1 }]);
    expect(findRepoRefs(`acme/${dots}!`, 'acme')).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('parses https and ssh remotes', () => {
    expect(parseGithubRemote('https://github.com/acme/site.git')).toBe('acme/site');
    expect(parseGithubRemote('git@github.com:acme/site')).toBe('acme/site');
    expect(parseGithubRemote('https://gitlab.com/acme/site.git')).toBeNull();
  });
});

describe('looks up visibility, treating an unseeable repo as private', () => {
  it('reads the private flag and sends the token', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { private: false }));
    expect(await fetchVisibility('acme/x', { GITHUB_TOKEN: 't0k' })).toBe('public');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init.headers.Authorization).toBe('Bearer t0k');
  });

  it('treats 404 as private and other failures as transient', async () => {
    fetchMock.mockResolvedValueOnce(json(404));
    expect(await fetchVisibility('acme/x', {})).toBe('private');
    fetchMock.mockResolvedValueOnce(json(403));
    expect(await fetchVisibility('acme/x', {})).toEqual({ reason: expect.stringContaining('403') });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchVisibility('acme/x', {})).toEqual({ reason: 'offline' });
  });

  it('honors GITHUB_API_URL', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { private: true }));
    expect(await fetchVisibility('acme/x', { GITHUB_API_URL: 'https://ghe.example/api/v3/' })).toBe(
      'private',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ghe.example/api/v3/repos/acme/x');
  });
});

describe('reports file, line, and referenced repo for each violation', () => {
  it('flags private references, passes public and self references, and looks each repo up once', async () => {
    visibilities({ 'acme/site': 'public', 'acme/open': 'public' });
    const findings = await privateRepoRefsCheck.run(
      ctx(
        filesOf({
          'AGENTS.md': 'ok acme/open\nbad acme/secret#3\n',
          '.github/workflows/ci.yml': '# tracked in acme/secret\n# self acme/site\n',
        }),
      ),
    );
    expect(findings).toEqual([
      {
        check: 'private-repo-refs',
        path: 'AGENTS.md',
        line: 2,
        message: expect.stringContaining('acme/secret'),
        severity: 'error',
      },
      {
        check: 'private-repo-refs',
        path: '.github/workflows/ci.yml',
        line: 1,
        message: expect.stringContaining('acme/secret'),
        severity: 'error',
      },
    ]);
    // One lookup each: the repo itself, then the two distinct references.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/acme/site',
      'https://api.github.com/repos/acme/open',
      'https://api.github.com/repos/acme/secret',
    ]);
  });

  it('reports a transient lookup once as inconclusive', async () => {
    visibilities({ 'acme/site': 'public', 'acme/flaky': 502 });
    const findings = await privateRepoRefsCheck.run(
      ctx(filesOf({ 'a.md': 'acme/flaky\nacme/flaky#2\n' })),
    );
    expect(findings).toEqual([
      {
        check: 'private-repo-refs',
        path: 'a.md',
        line: 1,
        message: expect.stringContaining('acme/flaky'),
        severity: 'inconclusive',
      },
    ]);
  });

  it('skips binary files', async () => {
    visibilities({ 'acme/site': 'public' });
    expect(await privateRepoRefsCheck.run(ctx(filesOf({ 'x.png': 'acme/secret\0' })))).toEqual([]);
  });
});

describe('excludes CHANGELOG.md by default, with configurable exclusions', () => {
  it('skips CHANGELOG.md at any depth', async () => {
    visibilities({ 'acme/site': 'public' });
    const files = filesOf({
      'CHANGELOG.md': 'acme/secret#1\n',
      'pkg/CHANGELOG.md': 'acme/secret\n',
    });
    expect(await privateRepoRefsCheck.run(ctx(files))).toEqual([]);
  });

  it('adds configured exclude globs to the default', async () => {
    visibilities({ 'acme/site': 'public' });
    const files = filesOf({ 'notes/a.md': 'acme/secret\n', 'CHANGELOG.md': 'acme/secret\n' });
    expect(await privateRepoRefsCheck.run(ctx(files, { exclude: ['notes/**'] }))).toEqual([]);
  });

  it('rejects malformed settings', () => {
    expect(() => parseSettings({ exclude: 'notes/**' })).toThrow(/exclude/);
    expect(() => parseSettings({ repository: 'nope' })).toThrow(/repository/);
    expect(parseSettings({}).exclude).toEqual(['**/CHANGELOG.md']);
  });
});

describe('registration', () => {
  it('is registered and opt-in', () => {
    const registry = createRegistry(builtinChecks());
    expect(registry.get('private-repo-refs')).toBe(privateRepoRefsCheck);
    expect(registry.defaultNames()).not.toContain('private-repo-refs');
  });
});
