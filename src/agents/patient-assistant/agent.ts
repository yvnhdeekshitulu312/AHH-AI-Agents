import type { AgentDefinition } from '../../core/types.js';
import { systemPrompt } from './prompt.js';

/** The AHH AI Chat agent: patient history + results in one conversation. */
export const patientAssistantAgent: AgentDefinition = {
  id: 'patient-assistant',
  description: "Answers questions about the open patient's profile, visits, diagnoses and results (lab, radiology, cardiology, neurology, dental).",
  systemPrompt,
  tools: [
    'getPatientProfile',
    'getVisits',
    'getVisitsByYear',
    'getDiagnoses',
    'getLabResults',
    'getLabValues',
    'getDepartmentResults',
  ],
  limits: { maxSteps: 8, timeoutMs: 45_000, maxOutputChars: 3000 },
};
