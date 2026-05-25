/**
 * Wraps a promise with a timeout. Rejects with a descriptive error if the
 * promise does not resolve within `ms` milliseconds.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}
