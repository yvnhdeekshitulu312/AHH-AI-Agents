import { APICallError, generateText, RetryError, stepCountIs, streamText, type StepResult, type Tool, type ToolSet } from 'ai';
import type { FastifyBaseLogger } from 'fastify';
import type { HisApi } from '../his/client.js';
import type { ModelFactory } from '../llm/provider.js';
import { buildTools } from '../tools/index.js';
import { AgentTimeoutError, ClientAbortedError, LlmUnavailableError } from './errors.js';
import { RequestCache } from './requestCache.js';
import type { AgentDefinition, AgentRunResult, PatientContext } from './types.js';

export interface RunAgentParams {
  agent: AgentDefinition;
  question: string;
  ctx: PatientContext;
  his: HisApi;
  getModel: ModelFactory;
  logger: FastifyBaseLogger;
  now?: Date;
}

export interface StreamAgentParams extends RunAgentParams {
  /** Aborted when the client disconnects. */
  signal?: AbortSignal;
  /** Called when the model calls a tool (to show "checking lab results…"). */
  onToolCall?: (toolName: string) => void;
  /** Called for each piece of answer text as the model writes it. */
  onText?: (text: string) => void;
}

const HOSPITAL_TIMEZONE = 'Asia/Riyadh';

function todayInHospitalTz(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOSPITAL_TIMEZONE }).format(now);
}

/** Everything both modes share: prompt, tools, limits, and per-step timing (LLM vs. tools). */
function prepareRun(params: RunAgentParams) {
  const { agent, question, ctx, his, getModel, logger, now = new Date() } = params;

  const timing = { llmMs: 0, toolMs: 0 };
  let stepStart = Date.now();
  let toolWindow: { start: number; end: number } | null = null;
  const tools = timeTools(buildTools(agent.tools, { ctx, his, logger, cache: new RequestCache() }), (start, end) => {
    toolWindow = { start: Math.min(toolWindow?.start ?? start, start), end: Math.max(toolWindow?.end ?? end, end) };
  });

  const onStepFinish = (step: StepResult<ToolSet>) => {
    const stepMs = Date.now() - stepStart;
    const window = toolWindow as { start: number; end: number } | null;
    const toolMs = window ? window.end - window.start : 0;
    timing.toolMs += toolMs;
    timing.llmMs += stepMs - toolMs;
    logger.info(
      { requestId: ctx.requestId, agentId: agent.id, stepMs, llmMs: stepMs - toolMs, toolMs, tools: step.toolCalls.map((c) => c.toolName) },
      'agent step',
    );
    stepStart = Date.now();
    toolWindow = null;
  };

  return {
    timing,
    timeoutSignal: AbortSignal.timeout(agent.limits.timeoutMs),
    settings: {
      model: getModel(agent.model),
      system: `${agent.systemPrompt}\n\nToday's date: ${todayInHospitalTz(now)}.`,
      prompt: question,
      tools,
      stopWhen: stepCountIs(agent.limits.maxSteps),
      temperature: 0,
      onStepFinish,
    },
  };
}

/** Generic tool-calling loop shared by every agent: returns the whole answer at once. */
export async function runAgent(params: RunAgentParams): Promise<AgentRunResult> {
  const run = prepareRun(params);
  try {
    const result = await generateText({ ...run.settings, abortSignal: run.timeoutSignal });
    return {
      answer: result.text,
      toolsUsed: [...new Set(result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)))],
      steps: result.steps.length,
      usage: { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens },
      timing: run.timing,
    };
  } catch (err) {
    throw mapRunError(err, run.timeoutSignal);
  }
}

/** Same loop, streaming: reports tool calls and answer text as they happen, then returns the full result. */
export async function streamAgent(params: StreamAgentParams): Promise<AgentRunResult> {
  const run = prepareRun(params);
  const abortSignal = params.signal ? AbortSignal.any([run.timeoutSignal, params.signal]) : run.timeoutSignal;

  let answer = '';
  let steps = 0;
  const toolsUsed = new Set<string>();
  let usage: AgentRunResult['usage'] = {};

  try {
    const result = streamText({ ...run.settings, abortSignal });
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          answer += part.text;
          params.onText?.(part.text);
          break;
        case 'tool-call':
          toolsUsed.add(part.toolName);
          params.onToolCall?.(part.toolName);
          break;
        case 'finish-step':
          steps++;
          break;
        case 'finish':
          usage = { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens };
          break;
        case 'abort':
          throw abortError(run.timeoutSignal);
        case 'error':
          throw part.error;
      }
    }
    return { answer, toolsUsed: [...toolsUsed], steps, usage, timing: run.timing };
  } catch (err) {
    throw mapRunError(err, run.timeoutSignal);
  }
}

function abortError(timeoutSignal: AbortSignal): Error {
  return timeoutSignal.aborted ? new AgentTimeoutError() : new ClientAbortedError();
}

function mapRunError(err: unknown, timeoutSignal: AbortSignal): unknown {
  if (err instanceof AgentTimeoutError || err instanceof ClientAbortedError) return err;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return timeoutSignal.aborted ? new AgentTimeoutError({ cause: err }) : new ClientAbortedError({ cause: err });
  }
  if (APICallError.isInstance(err) || RetryError.isInstance(err)) return new LlmUnavailableError({ cause: err });
  return err;
}

/** Wraps each tool's execute to report when it ran (used to split step time into LLM vs tools). */
function timeTools(tools: Record<string, Tool>, report: (start: number, end: number) => void): Record<string, Tool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const execute = t.execute;
      if (!execute) return [name, t];
      return [
        name,
        {
          ...t,
          execute: async (input: unknown, options: unknown) => {
            const start = Date.now();
            try {
              return await (execute as (i: unknown, o: unknown) => unknown)(input, options);
            } finally {
              report(start, Date.now());
            }
          },
        } as Tool,
      ];
    }),
  );
}
