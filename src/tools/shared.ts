import type { ToolDeps } from '../core/types.js';
import type { HisDateRange } from '../his/client.js';

/** Patient profile, fetched at most once per agent run (used by getPatientProfile and getLabValues). */
export function loadProfile(deps: ToolDeps) {
  const { ctx, his, cache } = deps;
  return cache.memo('profile', () => his.fetchPatientProfile(ctx.patientId, ctx.hospitalId));
}

/** Lab results list for a date range, fetched at most once per range per agent run. */
export function loadLabResults(deps: ToolDeps, range: HisDateRange) {
  const { ctx, his, cache } = deps;
  return cache.memo(`lab:${range.from}:${range.to}`, () =>
    his.fetchLabResults(ctx.uhid, ctx.patientId, ctx.hospitalId, range),
  );
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping the input order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
