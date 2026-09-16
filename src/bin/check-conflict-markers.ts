#!/usr/bin/env node
// Thin CLI wrapper over `checkConflictMarkers`. All logic lives in the library;
// the bin only selects a mode, prints the report, and sets the exit code.
//
// Modes (default `--staged`): scan staged blobs (pre-commit hook), `--check`
// (all tracked files — the CI backstop), `--check-diff` (files changed vs
// origin/main). `-C`/`--cwd <dir>` runs the git scan in that directory, so a
// caller that cannot pin its cwd never needs `cd <dir> && ai-check-conflict-markers`.
// Exit 0 when clean, 1 when markers are found, 2 on unknown mode.
import { checkConflictMarkers, formatReport } from '../check-conflict-markers.js';
import type { Mode } from '../discovery.js';

const MODES: Mode[] = ['--staged', '--check', '--check-diff'];

async function main(): Promise<number> {
  let mode: Mode = '--staged';
  let cwd: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') cwd = argv[++i];
    else if (a !== undefined && MODES.includes(a as Mode)) mode = a as Mode;
    else {
      console.error(`unknown argument: ${a}`);
      console.error('usage: ai-check-conflict-markers [--staged|--check|--check-diff] [-C <dir>]');
      return 2;
    }
  }
  const violations = await checkConflictMarkers(mode, { cwd });
  if (violations.length > 0) {
    console.error(formatReport(violations));
    return 1;
  }
  return 0;
}

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

void run();
