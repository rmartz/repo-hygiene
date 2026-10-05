#!/usr/bin/env node
// Thin CLI over the check framework. All logic lives in the library; the bin
// only invokes it and maps the result onto the process exit code. See
// ../cli.ts for the usage summary and argument handling.
//
// This module deliberately has NO entrypoint guard. A guard comparing
// `import.meta.url` to `process.argv[1]` looks harmless but breaks whenever the
// CLI is launched through a `node_modules/.bin` symlink (npm's shim, or pnpm's
// via the .pnpm store): argv[1] is then the link while import.meta.url is the
// realpath, so the comparison fails and the process exits 0 without running a
// single check — silently vacuous CI (#67). Keeping the bin free of importable
// exports means nothing needs to import it, so nothing needs guarding.
import { main } from '../cli.js';
import { EXIT_INCONCLUSIVE, EXIT_USAGE, InconclusiveError } from '../outcome.js';

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    // An external transient error is inconclusive; anything else (unknown check,
    // malformed config, an unexpected failure) is usage-level.
    process.exit(err instanceof InconclusiveError ? EXIT_INCONCLUSIVE : EXIT_USAGE);
  }
}

void run();
