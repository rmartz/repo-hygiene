import { describe, it, expect } from 'vitest';
import { boundedRun } from '../../src/lib/bounded-subprocess.js';

describe('boundedRun', () => {
  it('captures stdout and a zero exit code for a fast command', async () => {
    const result = await boundedRun('node', ['-e', 'process.stdout.write("hi")'], {
      timeoutMs: 5000,
    });
    expect(result.stdout).toBe('hi');
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('flags timedOut and kills a command that overruns its budget', async () => {
    const result = await boundedRun('node', ['-e', 'setTimeout(() => {}, 10000)'], {
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
  });
});
