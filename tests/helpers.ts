import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider';
import { vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { HisApi } from '../src/his/client.js';
import {
  diagnosesResponse,
  emptyDepartmentResponse,
  labResultsResponse,
  lastVisitsInfoResponse,
  neurologyResponse,
  potassiumComponentsResponse,
  profileResponse,
  radiologyResponse,
  visitsResponse,
  yearWiseResponse,
} from './fixtures/his.js';

export const API_KEY = 'test-api-key-0123456789-abcdefghijklmnop';

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  API_KEY,
  CORS_ORIGIN: 'http://localhost:4200',
  HIS_BASE_URL: 'https://his.example.test/ClinicalsAPI/API/',
  HIS_USERNAME: 'user',
  HIS_PASSWORD: 'pass',
  GOOGLE_GENERATIVE_AI_API_KEY: 'unused-in-tests',
  AUDIT_HASH_SECRET: 'test-audit-secret-123',
  LOG_LEVEL: 'silent',
});

export function mockHis(): { [K in keyof HisApi]: ReturnType<typeof vi.fn<HisApi[K]>> } {
  return {
    fetchPatientProfile: vi.fn<HisApi['fetchPatientProfile']>().mockResolvedValue(profileResponse),
    fetchVisits: vi.fn<HisApi['fetchVisits']>().mockResolvedValue(visitsResponse),
    fetchVisitsByYear: vi.fn<HisApi['fetchVisitsByYear']>().mockResolvedValue(yearWiseResponse),
    fetchDiagnoses: vi.fn<HisApi['fetchDiagnoses']>().mockResolvedValue(diagnosesResponse),
    fetchLabResults: vi.fn<HisApi['fetchLabResults']>().mockResolvedValue(labResultsResponse),
    fetchDepartmentResults: vi
      .fn<HisApi['fetchDepartmentResults']>()
      .mockImplementation(async (dept) =>
        dept === 'radiology' ? radiologyResponse : dept === 'neurology' ? neurologyResponse : emptyDepartmentResponse,
      ),
    fetchLabComponents: vi.fn<HisApi['fetchLabComponents']>().mockResolvedValue(potassiumComponentsResponse),
    fetchLastVisitsInfo: vi.fn<HisApi['fetchLastVisitsInfo']>().mockResolvedValue(lastVisitsInfoResponse),
  };
}

/** Body for the patient-assistant agent (same patient as validBody). */
export const assistantUrl = '/v1/agents/patient-assistant/ask';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model step that calls one tool. */
export function toolCallStep(toolName: string, input: object, id = 'call-1'): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage,
    warnings: [],
  };
}

/** A final text step. */
export function textStep(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
  };
}

export const validBody = {
  question: 'When was the last visit?',
  uhid: 'AHH.0001234',
  patientId: '123456',
  hospitalId: '3',
};

export const authHeaders = { authorization: `Bearer ${API_KEY}`, 'x-user-id': 'doc-42' };
