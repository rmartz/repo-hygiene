import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BASELINE_FILENAME,
  buildBaseline,
  loadBaseline,
  ratchetBaseline,
  writeBaseline,
  type OverCap,
} from '../../src/checks/file-caps-baseline.js';

const over = (path: string, metric: 'lines' | 'bytes', value: number): OverCap => ({
  path,
  metric,
  value,
});

describe('buildBaseline', () => {
  it('grandfathers every over-cap observation at its current value, per metric', () => {
    const baseline = buildBaseline([over('a.ts', 'lines', 500), over('a.ts', 'bytes', 41000)]);
    expect(baseline).toEqual({ 'a.ts': { lines: 500, bytes: 41000 } });
  });
});

describe('ratchetBaseline', () => {
  const existing = { 'a.ts': { lines: 500, bytes: 41000 } };

  it('ratchets a shrunk-but-still-over-cap metric down to its current value', () => {
    expect(
      ratchetBaseline([over('a.ts', 'lines', 460), over('a.ts', 'bytes', 41000)], existing),
    ).toEqual({
      'a.ts': { lines: 460, bytes: 41000 },
    });
  });

  it('keeps the recorded ceiling when a metric grew (never raises it)', () => {
    expect(
      ratchetBaseline([over('a.ts', 'lines', 900), over('a.ts', 'bytes', 41000)], existing),
    ).toEqual({
      'a.ts': { lines: 500, bytes: 41000 },
    });
  });

  it('drops a metric that is no longer over cap, and one whose file is gone', () => {
    // Only bytes is still reported over cap; lines dropped under the cap.
    expect(ratchetBaseline([over('a.ts', 'bytes', 41000)], existing)).toEqual({
      'a.ts': { bytes: 41000 },
    });
    // Nothing reported over cap at all → everything drops.
    expect(ratchetBaseline([], existing)).toEqual({});
  });

  it('never adds a newly-over-cap file that was not already grandfathered', () => {
    expect(ratchetBaseline([over('new.ts', 'lines', 999)], existing)).toEqual({});
  });
});

describe('loadBaseline / writeBaseline', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'fc-base-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when the file is absent (adoption has not happened)', () => {
    expect(loadBaseline(dir)).toBeNull();
  });

  it('round-trips through the namespaced file-caps section', () => {
    writeBaseline(dir, { 'z.ts': { lines: 10 }, 'a.ts': { bytes: 20 } });
    const raw = JSON.parse(readFileSync(join(dir, BASELINE_FILENAME), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(raw)).toEqual(['file-caps']);
    expect(loadBaseline(dir)).toEqual({ 'a.ts': { bytes: 20 }, 'z.ts': { lines: 10 } });
  });
});
