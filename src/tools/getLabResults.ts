import { tool } from 'ai';
import { z } from 'zod';
import { lastDaysRange } from '../his/dates.js';
import { normalizeOrderResults, RESULTED_CODE } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';
import { loadLabResults } from './shared.js';

export const DEFAULT_RESULT_DAYS = 30;

export const resultFilterSchema = z
  .enum(['all', 'panic', 'abnormal'])
  .default('all')
  .describe('"panic" = only results the HIS flagged as panic/critical; "abnormal" = only results the HIS flagged abnormal.');

export const daysSchema = z
  .number()
  .int()
  .min(1)
  .max(365)
  .default(DEFAULT_RESULT_DAYS)
  .describe(`How many days back to look, including today. Default ${DEFAULT_RESULT_DAYS}.`);

export const getLabResults = (deps: ToolDeps) =>
  tool({
    description:
      'List the current patient\'s resulted LAB tests (newest first) with the HIS panic and abnormal flags, ' +
      'status, preliminary flag and dates. Values are NOT included: call getLabValues with the result ids ' +
      'to see the actual values. Also returns counts of panic and abnormal results in the period.',
    inputSchema: z.object({
      filter: resultFilterSchema,
      days: daysSchema,
      testName: z.string().trim().max(60).optional().describe('Only tests whose name contains this text, e.g. "CBC".'),
      limit: z.number().int().min(1).max(100).default(40).describe('Maximum number of results to return.'),
    }),
    execute: ({ filter, days, testName, limit }) =>
      safeExecute('getLabResults', deps, async () => {
        const range = lastDaysRange(days);
        const all = normalizeOrderResults(
          (await loadLabResults(deps, range)).FetchLabOrderResultsDataaList,
          RESULTED_CODE.lab,
        );

        const name = testName?.toLowerCase();
        const matches = all.filter(
          (r) =>
            (!name || r.test?.toLowerCase().includes(name)) &&
            (filter === 'all' || (filter === 'panic' ? r.panic : r.abnormal)),
        );

        return {
          period: range,
          totalResulted: all.length,
          panicCount: all.filter((r) => r.panic).length,
          abnormalCount: all.filter((r) => r.abnormal).length,
          matching: matches.length,
          results: matches.slice(0, limit),
        };
      }),
  });
