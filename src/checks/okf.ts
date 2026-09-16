import matter from 'gray-matter';
import type { Check, CheckConfig, Finding } from '../types.js';
import { repoPathExists } from '../discovery.js';
import { validateOptionalFields } from './okf-fields.js';

/**
 * Open Knowledge Format frontmatter conformance for docs pages — ported from
 * ai-tools' `scripts/check-okf-frontmatter.ts` (itself a port of dotfiles'
 * `test_docs_okf_frontmatter.py`). Every docs page except the configured
 * reserved files must carry a valid `type` from the repo's vocabulary plus a
 * `title` and `description`; a non-exempt type must name a `resource` that
 * exists.
 *
 * The `type` vocabulary, the scanned roots, the reserved exemptions, and which
 * types skip the resource check all differ per repo, so they come from
 * `.repo-hygiene.yml` (with defaults matching ai-tools' own docs) rather than
 * being baked in as library constants.
 */

const NAME = 'okf';

const DEFAULT_TYPES = ['Skill', 'Script', 'Library', 'Design'];
const DEFAULT_ROOTS = ['docs'];
const DEFAULT_EXEMPT = ['docs/index.md'];
const DEFAULT_RESOURCE_EXEMPT_TYPES = ['Design'];

interface OkfConfig {
  types: string[];
  roots: string[];
  exempt: string[];
  resourceExemptTypes: string[];
}

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

function resolveConfig(settings: CheckConfig): OkfConfig {
  return {
    types: stringList(settings, 'types', DEFAULT_TYPES),
    roots: stringList(settings, 'roots', DEFAULT_ROOTS),
    exempt: stringList(settings, 'exempt', DEFAULT_EXEMPT),
    resourceExemptTypes: stringList(settings, 'resourceExemptTypes', DEFAULT_RESOURCE_EXEMPT_TYPES),
  };
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** A docs Markdown page under a scanned root and not on the exempt list. */
function inScope(path: string, cfg: OkfConfig): boolean {
  if (!path.endsWith('.md')) return false;
  if (cfg.exempt.includes(path)) return false;
  return cfg.roots.some((root) => isUnder(path, root));
}

/** Validate one page's frontmatter; returns a finding per problem found. */
export function validateDoc(
  path: string,
  text: string,
  cfg: OkfConfig,
  existsFn: (resource: string) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  const push = (message: string): void => {
    findings.push({ check: NAME, path, message, severity: 'error' });
  };
  const data = matter(text).data as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : undefined;

  if (type === undefined || !cfg.types.includes(type)) {
    push(`type must be one of ${cfg.types.join('|')}`);
  }
  if (!data.title) push('missing title');
  if (!data.description) push('missing description');

  // Run the resource check for every non-exempt type — including an invalid or
  // missing type, matching the ported script (a Design page skips it).
  if (type === undefined || !cfg.resourceExemptTypes.includes(type)) {
    const resource = data.resource;
    if (typeof resource !== 'string' || resource === '') {
      push(`${type ?? 'this'} page needs a resource`);
    } else if (!existsFn(resource)) {
      push(`resource not found: ${resource}`);
    }
  }

  // OKF v0.2 optional lifecycle / trust / provenance field families (validated
  // when present; unknown keys tolerated per the spec).
  for (const message of validateOptionalFields(data)) push(message);

  return findings;
}

export const okfCheck: Check = {
  name: NAME,
  description: 'Open Knowledge Format frontmatter conformance for docs pages.',
  async run(ctx) {
    const cfg = resolveConfig(ctx.settings);
    // In --staged mode ctx.files.read reads the git index; repoPathExists probes
    // the index for existence too, so a resource staged-for-deletion but still on
    // disk reads as absent (matching what the check scans).
    const resourceExists = await repoPathExists(ctx.mode, { cwd: ctx.cwd });
    const findings: Finding[] = [];
    for (const path of ctx.files.paths) {
      if (!inScope(path, cfg)) continue;
      const text = await ctx.files.read(path);
      findings.push(...validateDoc(path, text, cfg, resourceExists));
    }
    return findings;
  },
};
