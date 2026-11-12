import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditEvent, AuditLogger } from '../audit/logger.js';
import { AppError, ClientAbortedError, GuardrailBlockedError } from '../core/errors.js';
import { getAgent, listAgents } from '../core/registry.js';
import { runAgent, streamAgent } from '../core/runAgent.js';
import type { AgentDefinition, AgentRunResult, PatientContext } from '../core/types.js';
import { checkInput } from '../guardrails/input.js';
import { checkOutput, DISCLAIMER } from '../guardrails/output.js';
import type { HisApi } from '../his/client.js';
import type { ModelFactory } from '../llm/provider.js';
import { toolStatusLabel } from '../tools/index.js';

export interface AgentRouteDeps {
  his: HisApi;
  getModel: ModelFactory;
  audit: AuditLogger;
}

/** Numeric id that may arrive as a number or string from the portal. */
const numericId = z.coerce.string().regex(/^\d{1,12}$/, 'must be numeric');

const askBodySchema = z.object({
  question: z.string().max(4000),
  uhid: z.string().trim().regex(/^[A-Za-z0-9.\-/]{1,30}$/, 'invalid UHID'),
  patientId: numericId,
  hospitalId: numericId,
  admissionId: numericId.optional(),
});

const paramsSchema = z.object({ agentId: z.string().max(64) });

type AuditBase = Omit<AuditEvent, 'outcome' | 'durationMs'>;

interface PreparedAsk {
  agent: AgentDefinition;
  ctx: PatientContext;
  question: string;
  auditBase: AuditBase;
  started: number;
}

export async function agentRoutes(app: FastifyInstance, deps: AgentRouteDeps) {
  app.get('/v1/agents', async () => ({ agents: listAgents() }));

  /** One JSON response with the whole answer. */
  app.post('/v1/agents/:agentId/ask', async (request, reply) => {
    const ask = prepareAsk(request, reply, deps);
    if (!ask) return reply;

    try {
      const result = await runAgent(runParams(ask, request, deps));
      return finish(ask, result, deps);
    } catch (err) {
      recordError(ask, err, deps);
      throw err;
    }
  });

  /**
   * Server-Sent Events: `status` (a tool is running), `delta` (answer text as it is written),
   * then `done` (final answer after the output guardrail) or `error`.
   * Validation and input-guardrail failures are returned as normal JSON errors before the stream starts.
   */
  app.post('/v1/agents/:agentId/ask/stream', async (request, reply) => {
    const ask = prepareAsk(request, reply, deps);
    if (!ask) return reply;

    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Stop the agent (and its Gemini / HIS calls) if the doctor closes the chat mid-answer.
    const clientGone = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) clientGone.abort();
    });

    // Never stream past the agent's output limit; the final `done` carries the trimmed answer.
    let streamed = 0;
    const limit = ask.agent.limits.maxOutputChars;

    try {
      const result = await streamAgent({
        ...runParams(ask, request, deps),
        signal: clientGone.signal,
        onToolCall: (tool) => send('status', { tool, label: toolStatusLabel(tool) }),
        onText: (text) => {
          if (!text || streamed >= limit) return;
          const piece = text.slice(0, limit - streamed);
          streamed += piece.length;
          send('delta', { text: piece });
        },
      });
      send('done', finish(ask, result, deps));
    } catch (err) {
      recordError(ask, err, deps);
      if (!(err instanceof ClientAbortedError)) {
        if (!(err instanceof AppError)) request.log.error({ err }, 'Streaming agent failed');
        send('error', toErrorPayload(err, ask.ctx.requestId));
      }
    } finally {
      reply.raw.end();
    }
  });
}

/** Validates the request and runs the input guardrail. Returns null when a response was already sent. */
function prepareAsk(request: FastifyRequest, reply: FastifyReply, deps: AgentRouteDeps): PreparedAsk | null {
  const started = Date.now();
  const { agentId } = paramsSchema.parse(request.params);

  const agent = getAgent(agentId);
  if (!agent) {
    reply.code(404).send({ error: 'AGENT_NOT_FOUND', message: `Unknown agent "${agentId}".` });
    return null;
  }

  const body = askBodySchema.safeParse(request.body);
  if (!body.success) {
    reply.code(400).send({
      error: 'INVALID_REQUEST',
      message: 'Invalid request body.',
      issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }

  // Patient identity comes only from the authenticated request, never from the LLM.
  const ctx: PatientContext = {
    requestId: request.id,
    userId: request.userId,
    hospitalId: body.data.hospitalId,
    uhid: body.data.uhid,
    patientId: body.data.patientId,
    admissionId: body.data.admissionId,
  };
  const auditBase: AuditBase = {
    requestId: ctx.requestId,
    agentId,
    userId: ctx.userId,
    hospitalId: ctx.hospitalId,
    uhid: ctx.uhid,
    question: body.data.question,
  };

  const input = checkInput(body.data.question);
  if (!input.ok) {
    deps.audit.record({ ...auditBase, outcome: 'blocked', reason: input.reason, durationMs: Date.now() - started });
    throw new GuardrailBlockedError(input.reason, input.userMessage);
  }

  return { agent, ctx, question: input.question, auditBase, started };
}

function runParams(ask: PreparedAsk, request: FastifyRequest, deps: AgentRouteDeps) {
  return { agent: ask.agent, question: ask.question, ctx: ask.ctx, his: deps.his, getModel: deps.getModel, logger: request.log };
}

/** Output guardrail + audit; returns the response body (JSON endpoint) / `done` event (stream). */
function finish(ask: PreparedAsk, result: AgentRunResult, deps: AgentRouteDeps) {
  const output = checkOutput(result.answer, ask.agent.limits.maxOutputChars);
  const durationMs = Date.now() - ask.started;

  deps.audit.record({
    ...ask.auditBase,
    outcome: 'answered',
    toolsUsed: result.toolsUsed,
    steps: result.steps,
    reason: output.reason,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    llmMs: result.timing.llmMs,
    toolMs: result.timing.toolMs,
    durationMs,
  });

  return {
    requestId: ask.ctx.requestId,
    agentId: ask.agent.id,
    answer: output.answer,
    disclaimer: DISCLAIMER,
    toolsUsed: result.toolsUsed,
    durationMs,
  };
}

function recordError(ask: PreparedAsk, err: unknown, deps: AgentRouteDeps) {
  deps.audit.record({
    ...ask.auditBase,
    outcome: 'error',
    reason: err instanceof Error ? err.name : 'unknown',
    durationMs: Date.now() - ask.started,
  });
}

function toErrorPayload(err: unknown, requestId: string) {
  return err instanceof AppError
    ? { error: err.code, message: err.userMessage, requestId }
    : { error: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId };
}
