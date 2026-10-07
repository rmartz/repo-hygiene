/** True for a non-null, non-array object — e.g. a parsed YAML/JSON mapping. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
