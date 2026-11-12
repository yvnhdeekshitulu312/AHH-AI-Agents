import { tool } from 'ai';
import { z } from 'zod';
import { normalizeVisitsByYear } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';

export const getVisitsByYear = (deps: ToolDeps) =>
  tool({
    description:
      'Get the number of visits of the current patient per year and visit type (OP, IP, ED, DC). ' +
      'Use this for "how many visits" questions.',
    inputSchema: z.object({}),
    execute: () =>
      safeExecute('getVisitsByYear', deps, async () => {
        const { ctx, his } = deps;
        return { years: normalizeVisitsByYear(await his.fetchVisitsByYear(ctx.uhid, ctx.hospitalId)) };
      }),
  });
