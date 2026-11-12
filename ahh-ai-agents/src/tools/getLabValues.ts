import { tool } from 'ai';
import { z } from 'zod';
import { HisError } from '../his/client.js';
import { hisDateOnly, lastDaysRange } from '../his/dates.js';
import { normalizeLabComponents, normalizeOrderResults, RESULTED_CODE } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';
import { loadLabResults, loadProfile, mapWithLimit } from './shared.js';

/** Results older than this cannot be looked up by id. */
const LOOKUP_DAYS = 365;
const MAX_TESTS = 10;
const PARALLEL_CALLS = 3;

export const getLabValues = (deps: ToolDeps) =>
  tool({
    description:
      'Get the actual values of specific lab results: each parameter with value, unit, normal range, previous ' +
      'value and a flag (PANIC LOW, PANIC HIGH, LOW, HIGH, NORMAL) computed from the HIS reference and panic ' +
      `limits. Pass result ids from getLabResults (max ${MAX_TESTS}).`,
    inputSchema: z.object({
      resultIds: z
        .array(z.string().regex(/^\d{1,12}$/))
        .min(1)
        .max(MAX_TESTS)
        .describe('The "id" values of results returned by getLabResults.'),
    }),
    execute: ({ resultIds }) =>
      safeExecute('getLabValues', deps, async () => {
        const { ctx, his, logger } = deps;

        // Everything needed to look up values comes from the HIS, never from the LLM: the result row
        // (test ids, sample, patient type) must belong to this patient's own lab list.
        const [labList, profileResponse] = await Promise.all([
          loadLabResults(deps, lastDaysRange(LOOKUP_DAYS)),
          loadProfile(deps),
        ]);
        const rows = (labList.FetchLabOrderResultsDataaList ?? []).filter((r) => String(r.IsResult ?? '') === RESULTED_CODE.lab);
        const profile = profileResponse.FetchPatientDataCCList?.[0];
        const genderId = profile?.GenderID?.toString().trim();
        const dob = hisDateOnly(profile?.DOB);
        if (!genderId || !dob) {
          return { error: 'Lab values cannot be loaded: the patient profile has no gender or date of birth.' };
        }

        const tests = await mapWithLimit([...new Set(resultIds)], PARALLEL_CALLS, async (id) => {
          const row = rows.find((r) => r.TestOrderItemID?.toString() === id);
          if (!row) return { id, error: `No resulted lab test with this id in the last ${LOOKUP_DAYS} days.` };

          const [summary] = normalizeOrderResults([row], RESULTED_CODE.lab);
          try {
            const values = normalizeLabComponents(
              await his.fetchLabComponents({
                patientId: ctx.patientId,
                genderId,
                dob,
                sampleCollectedAt: row.SampleCollectedAt ?? '',
                testId: row.TestId ?? '0',
                testOrderId: row.TestOrderId ?? '0',
                testOrderItemId: row.TestOrderItemID ?? '0',
                sampleNo: row.SampleNumber ?? '',
                patientType: row.PatientType ?? '0',
                hospitalId: row.HospitalID ?? ctx.hospitalId,
              }),
            );
            return { ...summary, values: values.length ? values : 'No values recorded for this test.' };
          } catch (err) {
            if (!(err instanceof HisError)) throw err;
            logger.warn({ tool: 'getLabValues', his: err.endpoint, kind: err.kind, requestId: ctx.requestId }, 'Lab values call failed');
            return { ...summary, error: 'The values for this test could not be retrieved from the hospital system.' };
          }
        });

        return { tests };
      }),
  });
