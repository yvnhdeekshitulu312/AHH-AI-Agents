import type { AgentDefinition } from '../../core/types.js';
import { systemPrompt } from './prompt.js';

export const patientHistoryAgent: AgentDefinition = {
  id: 'patient-history',
  description: "Answers questions about the selected patient's visits, diagnoses and basic profile.",
  systemPrompt,
  tools: ['getPatientProfile', 'getVisits', 'getVisitsByYear', 'getDiagnoses'],
  limits: { maxSteps: 5, timeoutMs: 30_000, maxOutputChars: 2000 },
};
