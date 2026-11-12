import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditLogger } from '../audit/logger.js';
import { ClientAbortedError, HisUnavailableError } from '../core/errors.js';
import type { PatientContext } from '../core/types.js';
import { DISCLAIMER } from '../guardrails/output.js';
import { HisError, type HisApi } from '../his/client.js';
import type { ModelFactory } from '../llm/provider.js';
import { buildVisitSummary } from '../summaries/visitSummary.js';

export interface SummaryRouteDeps {
  his: HisApi;
  getModel: ModelFactory;
  audit: AuditLogger;
  /** Model id for the visit summary (config SUMMARY_MODEL). */
  model?: string;
}

const numericId = z.coerce.string().regex(/^\d{1,12}$/, 'must be numeric');

const bodySchema = z.object({
  uhid: z.string().trim().regex(/^[A-Za-z0-9.\-/]{1,30}$/, 'invalid UHID'),
  patientId: numericId,
  hospitalId: numericId,
  /** The visit open in the case sheet; excluded from "previous visits". */
  admissionId: numericId.optional(),
});

const AUDIT_ID = 'visit-summary';

export async function summaryRoutes(app: FastifyInstance, deps: SummaryRouteDeps) {
  /** Visit summary for a follow-up patient: deterministic sections from the HIS plus AI highlights. */
  app.post('/v1/summaries/visit', async (request, reply) => {
    const started = Date.now();
    const body = bodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'INVALID_REQUEST',
        message: 'Invalid request body.',
        issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    // Patient identity comes only from the request, never from the LLM.
    const ctx: PatientContext = { requestId: request.id, userId: request.userId, ...body.data };
    const auditBase = {
      requestId: ctx.requestId,
      agentId: AUDIT_ID,
      userId: ctx.userId,
      hospitalId: ctx.hospitalId,
      uhid: ctx.uhid,
      question: '(visit summary)',
    };

    // Stop the Gemini call if the doctor closes the popup.
    const clientGone = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) clientGone.abort();
    });

    try {
      const result = await buildVisitSummary({
        ctx,
        his: deps.his,
        getModel: deps.getModel,
        model: deps.model,
        logger: request.log,
        signal: clientGone.signal,
      });
      const durationMs = Date.now() - started;
      deps.audit.record({
        ...auditBase,
        outcome: 'answered',
        toolsUsed: ['fetchLastVisitsInfo'],
        reason: result.highlightsStatus === 'ok' ? undefined : `highlights:${result.highlightsStatus}`,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        llmMs: result.timing.llmMs,
        toolMs: result.timing.hisMs,
        durationMs,
      });

      return {
        requestId: ctx.requestId,
        isFollowUp: result.isFollowUp,
        ...result.data,
        summary: result.summary,
        highlights: result.highlights,
        highlightsStatus: result.highlightsStatus,
        disclaimer: DISCLAIMER,
        durationMs,
      };
    } catch (err) {
      deps.audit.record({
        ...auditBase,
        outcome: 'error',
        reason: err instanceof Error ? err.name : 'unknown',
        durationMs: Date.now() - started,
      });
      if (err instanceof HisError) throw new HisUnavailableError({ cause: err });
      if (clientGone.signal.aborted) throw new ClientAbortedError({ cause: err });
      throw err;
    }
  });
}
