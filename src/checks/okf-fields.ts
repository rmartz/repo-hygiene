/**
 * OKF v0.2 optional field-family validation for the `okf` check. The core
 * fields (`type` / `title` / `description` / `resource`) are validated in
 * `okf.ts`; this module validates the optional lifecycle / trust / provenance
 * families **when present** and tolerates unknown keys (the spec requires
 * consumers not to reject unrecognized fields). Ported from
 * firebase-nextjs-template's `validate-docs.mjs` (`validateContentFields` and
 * its `checkTimestamp` / `checkActor` / `checkGenerated` / `checkVerified` /
 * `checkSources` / `checkResourceObject` helpers).
 */

const STATUSES = ['draft', 'stable', 'deprecated'];
// ISO-8601 datetime with an explicit offset, e.g. 2026-06-30T14:00:00Z.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// Actor convention: <producer>/<version>, human:<id>, or process:<id>.
const ACTOR = /^(?:human:\S.*|process:\S.*|[^\s:/]+\/\S+)$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkTimestamp(errors: string[], label: string, value: unknown): void {
  if (value !== undefined && !(typeof value === 'string' && ISO_8601.test(value))) {
    errors.push(`${label} must be an ISO-8601 datetime with offset (e.g. 2026-06-30T14:00:00Z)`);
  }
}

function checkActor(errors: string[], label: string, value: unknown): void {
  if (value !== undefined && !(typeof value === 'string' && ACTOR.test(value))) {
    errors.push(
      `${label} must use actor format (<producer>/<version>, human:<id>, or process:<id>)`,
    );
  }
}

function checkGenerated(errors: string[], generated: unknown): void {
  if (generated === undefined) return;
  if (!isPlainObject(generated)) {
    errors.push('generated must be a mapping with a required `by`');
    return;
  }
  if (generated.by === undefined) errors.push('generated.by is required');
  else checkActor(errors, 'generated.by', generated.by);
  checkTimestamp(errors, 'generated.at', generated.at);
}

function checkVerified(errors: string[], verified: unknown): void {
  if (verified === undefined) return;
  const list = Array.isArray(verified) ? verified : [verified];
  for (const [i, entry] of list.entries()) {
    const label = Array.isArray(verified) ? `verified[${i}]` : 'verified';
    if (!isPlainObject(entry)) {
      errors.push(`${label} must be a { by, at } mapping`);
      continue;
    }
    checkActor(errors, `${label}.by`, entry.by);
    checkTimestamp(errors, `${label}.at`, entry.at);
  }
}

function checkSources(errors: string[], sources: unknown): void {
  if (sources === undefined) return;
  if (!Array.isArray(sources)) {
    errors.push('sources must be a list of objects');
    return;
  }
  for (const [i, source] of sources.entries()) {
    if (!isPlainObject(source)) {
      errors.push(`sources[${i}] must be an object with a required \`resource\``);
      continue;
    }
    if (source.resource === undefined) errors.push(`sources[${i}].resource is required`);
    checkActor(errors, `sources[${i}].author`, source.author);
    checkTimestamp(errors, `sources[${i}].last_modified`, source.last_modified);
  }
}

function checkResourceObject(errors: string[], label: string, value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value) || value.resource === undefined) {
    errors.push(`${label} must be an object with a required \`resource\``);
  }
}

/** Validate the OKF v0.2 optional field families present in `data`. */
export function validateOptionalFields(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  const { status, tags, stale_after: staleAfter, usage_window: usageWindow } = data;

  if (status !== undefined && !(typeof status === 'string' && STATUSES.includes(status))) {
    errors.push(`status must be one of ${STATUSES.join(', ')}`);
  }
  if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === 'string'))) {
    errors.push('tags must be a list of strings');
  }

  checkTimestamp(errors, 'stale_after', staleAfter);
  checkGenerated(errors, data.generated);
  checkVerified(errors, data.verified);
  checkSources(errors, data.sources);
  checkResourceObject(errors, 'executor', data.executor);
  checkResourceObject(errors, 'attester', data.attester);

  if (usageWindow !== undefined) {
    if (!isPlainObject(usageWindow)) errors.push('usage_window must be a { from, to } mapping');
    else {
      checkTimestamp(errors, 'usage_window.from', usageWindow.from);
      checkTimestamp(errors, 'usage_window.to', usageWindow.to);
    }
  }
  return errors;
}
