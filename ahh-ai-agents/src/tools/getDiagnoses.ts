import { tool } from 'ai';
import { z } from 'zod';
import { normalizeDiagnoses } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';

export const getDiagnoses = (deps: ToolDeps) =>
  tool({
    description:
      'Get diagnoses recorded for the current patient, newest first: diagnosis, ICD code, type, status, date, ' +
      'admissionId, doctor and hospital. Pass admissionId to get the diagnoses of one specific visit ' +
      '(this is how to find out why the patient visited).',
    inputSchema: z.object({
      admissionId: z
        .string()
        .regex(/^\d{1,12}$/)
        .optional()
        .describe('Only return diagnoses for this admissionId (taken from getVisits).'),
      limit: z.number().int().min(1).max(50).default(20).describe('Maximum number of diagnoses to return.'),
    }),
    execute: ({ admissionId, limit }) =>
      safeExecute('getDiagnoses', deps, async () => {
        const { ctx, his } = deps;
        // The patient always comes from ctx; admissionId only filters within this patient's own records.
        let diagnoses = normalizeDiagnoses(await his.fetchDiagnoses(ctx.uhid, ctx.hospitalId));
        if (admissionId) diagnoses = diagnoses.filter((d) => d.admissionId === admissionId);
        return { totalDiagnoses: diagnoses.length, diagnoses: diagnoses.slice(0, limit) };
      }),
  });
