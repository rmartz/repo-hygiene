import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileSet } from '../../src/discovery.js';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const ok = (stdout: string) => ({ stdout, stderr: '', code: 0, timedOut: false });
const fail = (stderr = '') => ({ stdout: '', stderr, code: 128, timedOut: false });

const { upstreamOf, parseLsRemoteTags, resolveTag, actionPinTagsCheck } =
  await import('../../src/checks/action-pin-tags.js');
const { builtinChecks, createRegistry } = await import('../../src/registry.js');

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';
const TAG_OBJ = '1111111111111111111111111111111111111111';

const filesOf = (entries: Record<string, string>): FileSet => ({
  paths: Object.keys(entries),
  read: (p) => entries[p] ?? '',
});
const ctx = (files: FileSet, env: Record<string, string | undefined> = {}) => ({
  mode: '--check' as const,
  files,
  settings: {},
  env,
});
const workflow = (...uses: string[]) => ({
  '.github/workflows/ci.yml': uses.map((u) => `      - uses: ${u}`).join('\n') + '\n',
});

beforeEach(() => {
  boundedRun.mockReset();
});

describe('upstreamOf', () => {
  it('returns owner/repo for an action or reusable-workflow ref', () => {
    expect(upstreamOf(`actions/checkout@${SHA}`)).toBe('actions/checkout');
    expect(upstreamOf(`rmartz/repo-hygiene/.github/workflows/hygiene.yml@${SHA}`)).toBe(
      'rmartz/repo-hygiene',
    );
  });

  it('ignores refs action-pins owns: local, self-repo, docker, and non-SHA', () => {
    expect(upstreamOf('./.github/actions/setup')).toBeNull();
    expect(upstreamOf('$/.github/actions/setup')).toBeNull();
    expect(upstreamOf(`docker://alpine@sha256:${'a'.repeat(64)}`)).toBeNull();
    expect(upstreamOf('actions/checkout@v7')).toBeNull();
    expect(upstreamOf('actions/checkout')).toBeNull();
  });
});

describe('parseLsRemoteTags', () => {
  it('maps lightweight tags to their commit and prefers the peeled commit of an annotated tag', () => {
    const tags = parseLsRemoteTags(
      [
        `${SHA}\trefs/tags/v1.0.0`,
        `${TAG_OBJ}\trefs/tags/v2.0.0`,
        `${OTHER}\trefs/tags/v2.0.0^{}`,
        '',
      ].join('\n'),
    );
    expect(tags.get('v1.0.0')).toBe(SHA);
    expect(tags.get('v2.0.0')).toBe(OTHER);
  });
});

describe('resolveTag', () => {
  const tags = new Map([
    ['v1.0.0', SHA],
    ['2.0.0', OTHER],
  ]);

  it('resolves the comment verbatim', () => {
    expect(resolveTag(tags, 'v1.0.0')).toEqual({ tag: 'v1.0.0', sha: SHA });
  });

  it('tolerates a v-prefix mismatch between comment and tag', () => {
    expect(resolveTag(tags, '1.0.0')).toEqual({ tag: 'v1.0.0', sha: SHA });
    expect(resolveTag(tags, 'v2.0.0')).toEqual({ tag: '2.0.0', sha: OTHER });
  });

  it('returns undefined when no tag matches', () => {
    expect(resolveTag(tags, 'v1.0.1')).toBeUndefined();
  });
});

describe('action-pin-tags check', () => {
  it('is opt-in, registered, and never default-on', () => {
    expect(actionPinTagsCheck.defaultOn).toBeFalsy();
    expect(builtinChecks()).toContain(actionPinTagsCheck);
    expect(createRegistry().defaultNames()).not.toContain('action-pin-tags');
  });

  it('passes a pin whose comment names a tag at the pinned SHA', async () => {
    boundedRun.mockResolvedValueOnce(ok(`${SHA}\trefs/tags/v7.0.0\n`));
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`actions/checkout@${SHA} # v7.0.0`))),
    );
    expect(findings).toEqual([]);
  });

  it('flags a well-formed comment that names no upstream tag (the #66 case)', async () => {
    boundedRun.mockResolvedValueOnce(ok(`${SHA}\trefs/tags/repo-hygiene-v1.0.1\n`));
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`rmartz/repo-hygiene/.github/workflows/hygiene.yml@${SHA} # v1.0.1`))),
    );
    expect(findings).toEqual([
      {
        check: 'action-pin-tags',
        path: '.github/workflows/ci.yml',
        line: 1,
        message: expect.stringContaining('names no tag in rmartz/repo-hygiene'),
        severity: 'error',
      },
    ]);
  });

  it('flags a comment whose tag points at a different commit', async () => {
    boundedRun.mockResolvedValueOnce(ok(`${OTHER}\trefs/tags/v7.0.0\n`));
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`actions/checkout@${SHA} # v7.0.0`))),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', line: 1 });
    expect(findings[0]?.message).toContain(`points at ${OTHER.slice(0, 12)}`);
  });

  it('lists each upstream once, however many pins reference it', async () => {
    boundedRun.mockResolvedValue(ok(`${SHA}\trefs/tags/v7.0.0\n`));
    await actionPinTagsCheck.run(
      ctx(
        filesOf({
          ...workflow(`actions/checkout@${SHA} # v7.0.0`),
          '.github/workflows/b.yml': `  - uses: actions/checkout@${SHA} # v7.0.0\n`,
        }),
      ),
    );
    expect(boundedRun).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = boundedRun.mock.calls[0] ?? [];
    expect(cmd).toBe('git');
    expect(args).toEqual(['ls-remote', '--tags', 'https://github.com/actions/checkout.git']);
    expect(opts).toMatchObject({ env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }) });
  });

  it('starts every distinct upstream lookup before any result is consumed', async () => {
    const releases: Array<() => void> = [];
    boundedRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve(ok(`${SHA}\trefs/tags/v1.0.0\n`)));
        }),
    );
    const run = actionPinTagsCheck.run(
      ctx(filesOf(workflow(`a/one@${SHA} # v1.0.0`, `b/two@${SHA} # v1.0.0`))),
    );
    await vi.waitFor(() => expect(boundedRun).toHaveBeenCalledTimes(2));
    releases.forEach((release) => release());
    expect(await run).toEqual([]);
  });

  it('skips pins with no comment and refs that are not SHA-pinned (action-pins owns those)', async () => {
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`actions/checkout@${SHA}`, 'actions/setup-node@v4', './local'))),
    );
    expect(findings).toEqual([]);
    expect(boundedRun).not.toHaveBeenCalled();
  });

  it('warns and skips, never fails, when an upstream cannot be listed', async () => {
    boundedRun.mockResolvedValueOnce(fail('fatal: could not read Username'));
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`private/action@${SHA} # v1.0.0`))),
    );
    expect(findings).toEqual([
      {
        check: 'action-pin-tags',
        path: '.github/workflows/ci.yml',
        line: 1,
        message: expect.stringContaining('could not list tags for private/action'),
        severity: 'warn',
      },
    ]);
  });

  it('warns and skips when the lookup times out or git is missing', async () => {
    boundedRun.mockResolvedValueOnce({ stdout: '', stderr: '', code: null, timedOut: true });
    boundedRun.mockRejectedValueOnce(new Error('spawn git ENOENT'));
    const findings = await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`a/one@${SHA} # v1.0.0`, `b/two@${SHA} # v1.0.0`))),
    );
    expect(findings.map((f) => f.severity)).toEqual(['warn', 'warn']);
  });

  it('authenticates via an env-injected header when a token is present, never in argv', async () => {
    boundedRun.mockResolvedValueOnce(ok(`${SHA}\trefs/tags/v1.0.0\n`));
    await actionPinTagsCheck.run(
      ctx(filesOf(workflow(`private/action@${SHA} # v1.0.0`)), { GITHUB_TOKEN: 'tkn' }),
    );
    const [, args, opts] = boundedRun.mock.calls[0] ?? [];
    expect((args as string[]).join(' ')).not.toContain('tkn');
    const basic = Buffer.from('x-access-token:tkn').toString('base64');
    expect(opts).toMatchObject({
      env: expect.objectContaining({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
      }),
    });
  });
});
