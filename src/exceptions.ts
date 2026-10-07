import { CONFIG_FILENAME } from './config.js';
import type { Check, CheckConfig } from './types.js';

/**
 * Exceptions to the recommended settings. Every check runs by default at its
 * recommended (best-practice) settings; a repo may loosen one, but only as a
 * written-down exception: a `reason` in the same config section. Tightening a
 * check never needs one.
 */

/** Every way `settings` loosens `check`, framework keys first. */
export function loosenings(check: Check, settings: CheckConfig): string[] {
  return [
    ...(settings.enabled === false ? ['enabled: false'] : []),
    ...(settings.severity === 'warn' ? ['severity: warn'] : []),
    ...(check.loosenings?.(settings) ?? []),
  ];
}

/** Throw unless every loosening of `check` in `settings` carries a `reason`. */
export function assertExceptionReason(check: Check, settings: CheckConfig): void {
  const found = loosenings(check, settings);
  if (found.length === 0 || settings.reason) return;
  throw new Error(
    `${CONFIG_FILENAME}: check "${check.name}" loosens its recommended settings ` +
      `(${found.join(', ')}) without a reason; add \`reason:\` to its section ` +
      'saying why this repo needs the exception',
  );
}

/** Whether `settings[key]` is a non-empty list (an exemption list in use). */
export const hasEntries = (settings: CheckConfig, key: string): boolean =>
  Array.isArray(settings[key]) && settings[key].length > 0;
