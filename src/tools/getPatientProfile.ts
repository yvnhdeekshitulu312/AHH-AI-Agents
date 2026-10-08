import { tool } from 'ai';
import { z } from 'zod';
import { normalizeProfile } from '../his/normalizers.js';
import type { ToolDeps } from '../core/types.js';
import { safeExecute } from './safeExecute.js';
import { loadProfile } from './shared.js';

export const getPatientProfile = (deps: ToolDeps) =>
  tool({
    description:
      'Get basic profile of the current patient: name, age, gender, nationality, blood group, height, weight, ' +
      'and flags for allergies, pregnancy and lactation.',
    inputSchema: z.object({}),
    execute: () =>
      safeExecute('getPatientProfile', deps, async () => {
        const profile = normalizeProfile(await loadProfile(deps));
        return profile ?? { error: 'No profile found for this patient.' };
      }),
  });
