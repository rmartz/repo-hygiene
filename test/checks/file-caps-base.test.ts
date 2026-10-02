import { describe, it, expect, vi, beforeEach } from 'vitest';

const boundedRun = vi.fn();
vi.mock('../../src/lib/bounded-subprocess.js', () => ({ boundedRun }));

const { assertBaseRef, readAtBase } = await import('../../src/checks/file-caps-base.js');
const { InconclusiveError } = await import('../../src/outcome.js');

const timedOut = { stdout: '', stderr: '', code: null, timedOut: true };

beforeEach(() => {
  boundedRun.mockReset();
});

describe('file-caps base-ref reads', () => {
  it('makes the run inconclusive when git times out', async () => {
    boundedRun.mockResolvedValue(timedOut);
    await expect(assertBaseRef('origin/main', 'ratchet', '.')).rejects.toBeInstanceOf(
      InconclusiveError,
    );
    await expect(readAtBase(['a.ts'], 'origin/main', '.')).rejects.toBeInstanceOf(
      InconclusiveError,
    );
  });

  it('keeps an unresolvable base ref a hard (config) error', async () => {
    boundedRun.mockResolvedValue({ stdout: '', stderr: '', code: 1, timedOut: false });
    const err = await assertBaseRef('origin/main', 'ratchet', '.').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(InconclusiveError);
  });
});
