import type { FastifyBaseLogger } from 'fastify';
import type { HisApi } from '../his/client.js';
import type { ToolName } from '../tools/index.js';
import type { RequestCache } from './requestCache.js';

/**
 * Identity of the request. Built server-side from the authenticated request.
 * The LLM never sets or changes these values; tools read the patient only from here.
 */
export interface PatientContext {
  requestId: string;
  userId: string;
  hospitalId: string;
  uhid: string;
  patientId: string;
  admissionId?: string;
}

/** Everything a tool needs at runtime. */
export interface ToolDeps {
  ctx: PatientContext;
  his: HisApi;
  logger: FastifyBaseLogger;
  /** Shared by all tool calls of one agent run. */
  cache: RequestCache;
}

export interface AgentLimits {
  /** Max LLM steps (each tool round-trip is one step). */
  maxSteps: number;
  /** Hard timeout for the whole agent run. */
  timeoutMs: number;
  /** Answers longer than this are truncated by the output guardrail. */
  maxOutputChars: number;
}

/** An agent is configuration: prompt + allowed tools + limits. */
export interface AgentDefinition {
  id: string;
  description: string;
  systemPrompt: string;
  /** Allowlist: the agent can only call these tools. */
  tools: readonly ToolName[];
  limits: AgentLimits;
  /** Optional per-agent model override; defaults to config MODEL. */
  model?: string;
}

export interface AgentRunResult {
  answer: string;
  toolsUsed: string[];
  steps: number;
  usage: { inputTokens?: number; outputTokens?: number };
  /** Time spent waiting for the LLM vs. running tools (HIS calls). */
  timing: { llmMs: number; toolMs: number };
}
