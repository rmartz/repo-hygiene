/** Resolve after `ms` milliseconds. Its own module so tests can mock the wait away. */
export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
