import type { Finding, Severity } from './types.js';

/**
 * The reporters. The default is plain text — `severity [check] path:line:
 * message` lines serving the local husky gate and CI logs. Under GitHub Actions
 * the `github` reporter instead emits workflow-command annotations
 * (`::error`/`::warning file=…,line=…::message`) that GitHub renders inline on
 * the PR diff at the finding's file and line, coloured by severity. SARIF stays
 * a post-MVP follow-up.
 */

/** Which report format the CLI emits. */
export type ReportFormat = 'text' | 'github';

function locationOf(finding: Finding): string {
  if (!finding.path) return '';
  return finding.line ? `${finding.path}:${finding.line}: ` : `${finding.path}: `;
}

/** Render one finding as a single human-readable line. */
export function formatFinding(finding: Finding): string {
  return `${finding.severity} [${finding.check}] ${locationOf(finding)}${finding.message}`;
}

/** Render findings as newline-separated report lines; empty string for none. */
export function formatFindings(findings: Finding[]): string {
  return findings.map(formatFinding).join('\n');
}

/**
 * Resolve the effective report format: an explicit `--format` wins, otherwise
 * auto-detect GitHub Actions (`GITHUB_ACTIONS=true`), else fall back to `text`.
 */
export function resolveFormat(
  explicit: ReportFormat | undefined,
  env: Record<string, string | undefined>,
): ReportFormat {
  if (explicit) return explicit;
  return env.GITHUB_ACTIONS === 'true' ? 'github' : 'text';
}

// GitHub workflow-command escaping: message data escapes `%`, CR and LF; a
// property value additionally escapes `:` and `,` (the property delimiters).
// See docs.github.com/actions/reference/workflow-commands-for-github-actions.
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

const COMMAND_OF: Record<Severity, string> = { error: 'error', warn: 'warning' };

/**
 * Render one finding as a GitHub workflow-command annotation. `error` maps to
 * `::error`, `warn` to `::warning`; `file`/`line` are included when present so
 * the annotation lands on the PR diff, and the check name rides in `title`.
 */
export function formatFindingGithub(finding: Finding): string {
  const props: string[] = [];
  if (finding.path) props.push(`file=${escapeProperty(finding.path)}`);
  if (finding.line !== undefined) props.push(`line=${finding.line}`);
  props.push(`title=${escapeProperty(finding.check)}`);
  return `::${COMMAND_OF[finding.severity]} ${props.join(',')}::${escapeData(finding.message)}`;
}

/** Render findings as newline-separated annotations; empty string for none. */
export function formatFindingsGithub(findings: Finding[]): string {
  return findings.map(formatFindingGithub).join('\n');
}
