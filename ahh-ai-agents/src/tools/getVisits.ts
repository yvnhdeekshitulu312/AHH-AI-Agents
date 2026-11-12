import { tool } from 'ai';
import { z } from 'zod';
import { normalizeVisits } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';

export const getVisits = (deps: ToolDeps) =>
  tool({
    description:
      'Get the current patient visit history, newest first. Each visit has date (YYYY-MM-DD HH:mm), ' +
      'visitType (OP=outpatient, IP=inpatient, ED=emergency, DC), hospital, doctor, specialty and admissionId. ' +
      'Visits do NOT include the reason for the visit; use getDiagnoses with the admissionId for that.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(20).default(5).describe('How many of the most recent visits to return.'),
    }),
    execute: ({ limit }) =>
      safeExecute('getVisits', deps, async () => {
        const { ctx, his } = deps;
        const visits = normalizeVisits(await his.fetchVisits(ctx.uhid, ctx.hospitalId));
        return { totalVisits: visits.length, visits: visits.slice(0, limit) };
      }),
  });
