#!/usr/bin/env node
// Thin CLI over the check framework. All logic lives in the library; the bin
// only parses args, loads config, dispatches, prints the report, and sets the
// exit code.
//
//   ai-repo-hygiene [<check>...] [--staged|--check|--check-diff] [--config <path>] [--format <fmt>]
//   ai-repo-hygiene --update-baseline [--check] [--config <path>]
//
// With no check name it runs every registered check (one aggregate status);
// naming one or more runs just those (independent per-check statuses). Mode
// defaults to `--staged`. `--format` is `text` (default; report on stderr) or
// `github` (workflow-command annotations on stdout); when omitted it
// auto-detects GitHub Actions. `--update-baseline` regenerates the file-caps
// grandfather baseline instead of running checks. Exit 0 when clean or
// warn-only, 1 on any error finding, 2 on a usage error or unknown check.
import { createRegistry } from '../registry.js';
import { loadConfig } from '../config.js';
import { runHygiene } from '../runner.js';
import { formatFindings, formatFindingsGithub, resolveFormat } from '../reporter.js';
import type { ReportFormat } from '../reporter.js';
import { updateFileCapsBaseline } from '../checks/file-caps.js';
import type { Mode } from '../discovery.js';

const MODES: readonly Mode[] = ['--staged', '--check', '--check-diff'];
const FORMATS: readonly ReportFormat[] = ['text', 'github'];
const USAGE =
  'usage: ai-repo-hygiene [<check>...] [--staged|--check|--check-diff] [--config <path>] [--format text|github] [--update-baseline]';

interface ParsedArgs {
  mode: Mode;
  only: string[];
  configPath?: string;
  format?: ReportFormat;
  updateBaseline: boolean;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let mode: Mode = '--staged';
  const only: string[] = [];
  let configPath: string | undefined;
  let format: ReportFormat | undefined;
  let updateBaseline = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if ((MODES as readonly string[]).includes(arg)) {
      mode = arg as Mode;
    } else if (arg === '--update-baseline') {
      updateBaseline = true;
    } else if (arg === '--config') {
      const next = argv[i + 1];
      if (next === undefined) return { error: 'missing value for --config' };
      configPath = next;
      i++;
    } else if (arg === '--format') {
      const next = argv[i + 1];
      if (next === undefined) return { error: 'missing value for --format' };
      if (!(FORMATS as readonly string[]).includes(next)) {
        return { error: `unknown format: ${next}` };
      }
      format = next as ReportFormat;
      i++;
    } else if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    } else {
      only.push(arg);
    }
  }
  return { mode, only, configPath, format, updateBaseline };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(USAGE);
    return 2;
  }
  const config = loadConfig({ path: parsed.configPath });
  if (parsed.updateBaseline) {
    const result = await updateFileCapsBaseline({
      mode: parsed.mode,
      settings: config.checks['file-caps'] ?? {},
    });
    console.log(`file-caps baseline ${result.action}: ${result.files} file(s) grandfathered`);
    return 0;
  }
  const result = await runHygiene(createRegistry(), {
    mode: parsed.mode,
    only: parsed.only,
    config,
  });
  if (result.findings.length > 0) {
    // github annotations go to stdout (GitHub parses workflow commands there);
    // the plain report stays on stderr, leaving stdout clean for local/CI logs.
    if (resolveFormat(parsed.format, process.env) === 'github') {
      console.log(formatFindingsGithub(result.findings));
    } else {
      console.error(formatFindings(result.findings));
    }
  }
  return result.exitCode;
}

async function run(): Promise<void> {
  try {
    process.exit(await main());
  } catch (err: unknown) {
    // Unknown check, malformed config, or an unexpected failure — usage-level.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

void run();
