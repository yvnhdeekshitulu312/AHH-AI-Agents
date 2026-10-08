import { tool } from 'ai';
import { z } from 'zod';
import { HisError, type ResultDepartment } from '../his/client.js';
import { lastDaysRange } from '../his/dates.js';
import { normalizeOrderResults, RESULTED_CODE } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { daysSchema, resultFilterSchema } from './getLabResults.js';
import { safeExecute } from './safeExecute.js';

const DEPARTMENTS: ResultDepartment[] = ['radiology', 'cardiology', 'neurology', 'dental'];

export const getDepartmentResults = (deps: ToolDeps) =>
  tool({
    description:
      'List the current patient\'s resulted RADIOLOGY, CARDIOLOGY (ECG, echo, ...), NEUROLOGY or DENTAL ' +
      'investigations (newest first) with status, dates and the HIS panic and abnormal flags. ' +
      'The report findings are NOT available here: they are only in the HIS report.',
    inputSchema: z.object({
      department: z.enum(['all', ...DEPARTMENTS]).default('all'),
      filter: resultFilterSchema,
      days: daysSchema,
      limit: z.number().int().min(1).max(100).default(30).describe('Maximum number of results to return.'),
    }),
    execute: ({ department, filter, days, limit }) =>
      safeExecute('getDepartmentResults', deps, async () => {
        const { ctx, his, cache, logger } = deps;
        const range = lastDaysRange(days);
        const departments = department === 'all' ? DEPARTMENTS : [department];
        const unavailable: string[] = [];

        const perDepartment = await Promise.all(
          departments.map(async (dept) => {
            try {
              const res = await cache.memo(`dept:${dept}:${range.from}:${range.to}`, () =>
                his.fetchDepartmentResults(dept, ctx.patientId, ctx.hospitalId, range),
              );
              const rows = res.FetchRadOrderResultsDataaList ?? res.FetchLabOrderResultsDataaList;
              return normalizeOrderResults(rows, RESULTED_CODE.other).map((r) => ({ department: dept, ...r }));
            } catch (err) {
              if (!(err instanceof HisError)) throw err;
              logger.warn({ tool: 'getDepartmentResults', his: err.endpoint, kind: err.kind, requestId: ctx.requestId }, 'Department results call failed');
              unavailable.push(dept);
              return [];
            }
          }),
        );

        const all = perDepartment.flat().sort((a, b) => (b.orderedAt ?? '').localeCompare(a.orderedAt ?? ''));
        const matches = all.filter((r) => filter === 'all' || (filter === 'panic' ? r.panic : r.abnormal));

        return {
          period: range,
          totalResulted: all.length,
          panicCount: all.filter((r) => r.panic).length,
          abnormalCount: all.filter((r) => r.abnormal).length,
          matching: matches.length,
          results: matches.slice(0, limit),
          ...(unavailable.length ? { couldNotRetrieve: unavailable } : {}),
        };
      }),
  });
