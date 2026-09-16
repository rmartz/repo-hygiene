import type { Check } from './types.js';
import { conflictMarkersCheck } from './checks/conflict-markers.js';
import { okfCheck } from './checks/okf.js';
import { okfIndexCheck } from './checks/okf-index.js';
import { docsLinksCheck } from './checks/docs-links.js';
import { actionPinsCheck } from './checks/action-pins.js';
import { packagePinsCheck } from './checks/package-pins.js';
import { mdPairingCheck } from './checks/md-pairing.js';
import { fileCapsCheck } from './checks/file-caps.js';

/**
 * The check registry: the lookup the CLI dispatches through. It is built from an
 * explicit list (not a mutable global) so tests can register fakes without
 * import-order side effects.
 */

/** Every check the package ships, in stable order. */
export function builtinChecks(): Check[] {
  return [
    conflictMarkersCheck,
    okfCheck,
    okfIndexCheck,
    docsLinksCheck,
    actionPinsCheck,
    packagePinsCheck,
    mdPairingCheck,
    fileCapsCheck,
  ];
}

export interface Registry {
  /** The check registered under `name`, or `undefined`. */
  get(name: string): Check | undefined;
  /** All registered checks, in registration order. */
  all(): Check[];
  /** All registered check names, in registration order. */
  names(): string[];
}

/** Build a registry from `checks` (defaults to the built-in checks). */
export function createRegistry(checks: Check[] = builtinChecks()): Registry {
  const byName = new Map(checks.map((c) => [c.name, c]));
  return {
    get: (name) => byName.get(name),
    all: () => [...byName.values()],
    names: () => [...byName.keys()],
  };
}
