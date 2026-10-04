import matter from 'gray-matter';
import type { Check, CheckConfig, Finding } from '../types.js';
import { repoPathExists } from '../discovery.js';
import { validateOptionalFields } from './okf-fields.js';

/**
 * Open Knowledge Format frontmatter conformance for docs pages. Every
 * docs page except the reserved files must carry a non-empty `type` plus a
 * `title` and `description`; a non-exempt type must name a `resource`, and any
 * `resource` a page names — exempt type or not — must exist.
 *
 * The OKF spec makes `type` the only always-required key and leaves its
 * vocabulary **open** to the producer, so `types` accepts either a closed list
 * (enforced as an enum) or `"*"` (any non-empty type — the spec's open
 * vocabulary). `resource` is optional in the spec, so `resourceExemptTypes`
 * likewise accepts `"*"` (no page needs a resource) for a hub that keeps no
 * per-page resources. The vocabulary, scanned roots, exemptions, and
 * resource-exempt types all differ per repo, so they come from `.repo-hygiene.yml`
 * (with code-documentation defaults) rather than being baked in as library
 * constants.
 */

const NAME = 'okf';

const DEFAULT_TYPES = ['Design', 'Library', 'Script', 'Skill', 'Subsystem'];
const DEFAULT_ROOTS = ['docs'];
const DEFAULT_EXEMPT: string[] = [];
// `Design` and `Subsystem` pages describe an area rather than a single file.
const DEFAULT_RESOURCE_EXEMPT_TYPES = ['Design', 'Subsystem'];
// OKF reserves these filenames for navigation (`index.md`) and update history
// (`log.md`); the spec forbids them as concept documents, so they never carry
// OKF frontmatter and are skipped wherever they appear.
const RESERVED_FILES = ['index.md', 'log.md'];

/** A closed vocabulary (enforced as an enum) or `'*'` for any non-empty value. */
type Vocabulary = string[] | '*';

interface OkfConfig {
  types: Vocabulary;
  roots: string[];
  exempt: string[];
  resourceExemptTypes: Vocabulary;
}

function stringList(settings: CheckConfig, key: string, fallback: string[]): string[] {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings`);
}

/** A list of strings or the open-vocabulary sentinel `"*"`. */
function listOrStar(settings: CheckConfig, key: string, fallback: Vocabulary): Vocabulary {
  const value = settings[key];
  if (value === undefined) return fallback;
  if (value === '*') return '*';
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw new Error(`${NAME}: "${key}" must be a list of strings or "*"`);
}

function resolveConfig(settings: CheckConfig): OkfConfig {
  return {
    types: listOrStar(settings, 'types', DEFAULT_TYPES),
    roots: stringList(settings, 'roots', DEFAULT_ROOTS),
    exempt: stringList(settings, 'exempt', DEFAULT_EXEMPT),
    resourceExemptTypes: listOrStar(settings, 'resourceExemptTypes', DEFAULT_RESOURCE_EXEMPT_TYPES),
  };
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

const baseOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
};

/** A docs Markdown page under a scanned root, not reserved, and not exempt. */
function inScope(path: string, cfg: OkfConfig): boolean {
  if (!path.endsWith('.md')) return false;
  if (RESERVED_FILES.includes(baseOf(path))) return false;
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
  const type = typeof data.type === 'string' && data.type !== '' ? data.type : undefined;

  // `type` is the OKF spec's only always-required key; an open (`"*"`) vocabulary
  // accepts any non-empty value, a closed list is enforced as an enum.
  if (type === undefined) {
    push('type is required and must be a non-empty string');
  } else if (cfg.types !== '*' && !cfg.types.includes(type)) {
    push(`type must be one of ${cfg.types.join('|')}`);
  }
  if (!data.title) push('missing title');
  if (!data.description) push('missing description');

  // `resource` is optional in the spec; this repo still requires one for every
  // non-exempt type (including a missing type), unless resources are waived
  // wholesale with `resourceExemptTypes: "*"`. Exemption only waives the
  // requirement: a resource that is set is always validated, since agents follow
  // it to the documented source whatever the page's type.
  const resourceExempt =
    cfg.resourceExemptTypes === '*' ||
    (type !== undefined && cfg.resourceExemptTypes.includes(type));
  const resource = data.resource;
  if (typeof resource !== 'string' || resource === '') {
    if (!resourceExempt) push(`${type ?? 'this'} page needs a resource`);
  } else if (!existsFn(resource)) {
    push(`resource not found: ${resource}`);
  }

  // OKF v0.2 optional lifecycle / trust / provenance field families (validated
  // when present; unknown keys tolerated per the spec).
  for (const message of validateOptionalFields(data)) push(message);

  return findings;
}

export const okfCheck: Check = {
  name: NAME,
  description: 'Open Knowledge Format frontmatter conformance for docs pages.',
  // Default-on at error: a repo whose docs/ has not adopted OKF relaxes it with
  // `severity: warn` or opts out with `enabled: false`.
  defaultOn: true,
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
