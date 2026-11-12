import { APICallError, generateText, NoObjectGeneratedError, Output, RetryError } from 'ai';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { PatientContext } from '../core/types.js';
import type { HisApi } from '../his/client.js';
import { normalizeLastVisitsInfo, summaryIds, type VisitSummaryData } from '../his/lastVisitsNormalizer.js';
import type { ModelFactory } from '../llm/provider.js';
import { visitSummaryPrompt } from './prompt.js';

const HOSPITAL_TIMEZONE = 'Asia/Riyadh';
const LLM_TIMEOUT_MS = 25_000;
/** Overridable for comparison runs; "low" keeps flash at a few seconds. */
const THINKING_LEVEL = (process.env.SUMMARY_THINKING_LEVEL ?? 'low') as 'minimal' | 'low' | 'medium' | 'high';
const MAX_HIGHLIGHTS = 5;
const MAX_SUMMARY_SENTENCES = 5;
const MAX_SENTENCE_CHARS = 300;

const citedSentence = z.object({
  text: z.string().describe('One plain sentence.'),
  sourceIds: z.array(z.string()).describe('Ids of the data items this sentence is based on.'),
});

const outputSchema = z.object({
  summary: z.array(citedSentence).describe('Clinical handover: 3 to 5 sentences, each at most 30 words.'),
  highlights: z.array(citedSentence).describe('At most 5 points to check, each at most 20 words; empty when nothing stands out.'),
});

export interface Highlight {
  text: string;
  sourceIds: string[];
}

/** ok = AI text written; none = no history or nothing to say; unavailable = LLM failed (data is still returned). */
export type HighlightsStatus = 'ok' | 'none' | 'unavailable';

export interface VisitSummaryResult {
  isFollowUp: boolean;
  data: VisitSummaryData;
  /** AI clinical handover, one cited sentence per entry. */
  summary: Highlight[];
  highlights: Highlight[];
  highlightsStatus: HighlightsStatus;
  /** Highlights removed because they cited ids that are not in the data. */
  droppedHighlights: number;
  usage: { inputTokens?: number; outputTokens?: number };
  timing: { hisMs: number; llmMs: number };
}

export interface VisitSummaryParams {
  ctx: PatientContext;
  his: HisApi;
  getModel: ModelFactory;
  /** Model id for the summary (config SUMMARY_MODEL); the factory default when omitted. */
  model?: string;
  logger: FastifyBaseLogger;
  signal?: AbortSignal;
  now?: Date;
}

/**
 * One HIS call, then one LLM call that only writes the highlights.
 * Allergies, medicines, diagnoses and result flags are returned straight from the data.
 * HIS errors propagate (nothing to show); LLM errors are absorbed (the data is still useful).
 */
export async function buildVisitSummary(params: VisitSummaryParams): Promise<VisitSummaryResult> {
  const { ctx, his, getModel, model, logger, signal, now = new Date() } = params;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: HOSPITAL_TIMEZONE }).format(now);

  const hisStart = Date.now();
  const raw = await his.fetchLastVisitsInfo(ctx.patientId, ctx.hospitalId);
  const data = normalizeLastVisitsInfo(raw, ctx.admissionId, today);
  const hisMs = Date.now() - hisStart;

  const base = { data, droppedHighlights: 0, usage: {}, timing: { hisMs, llmMs: 0 } };
  // The API returns the latest admission, which may be the one open now (long-stay inpatient).
  const isFollowUp = data.visits.some((v) => !v.isCurrent);
  const hasHistory =
    isFollowUp || data.notes.length > 0 || data.diagnoses.length > 0 || data.medications.length > 0 || data.results.length > 0;
  if (!hasHistory) return { ...base, isFollowUp, summary: [], highlights: [], highlightsStatus: 'none' };

  const llmStart = Date.now();
  try {
    const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
    const result = await generateText({
      model: getModel(model),
      system: `${visitSummaryPrompt}\n\nToday's date: ${today}.`,
      prompt: `Patient data:\n${JSON.stringify(data)}`,
      output: Output.object({ schema: outputSchema }),
      temperature: 0,
      // The task is summarising given data, not reasoning. Default thinking took ~15 s on gemini-3.5-flash.
      providerOptions: { google: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } } },
      abortSignal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });

    const allowed = summaryIds(data);
    const summary = checkCitations(result.output.summary, allowed, MAX_SUMMARY_SENTENCES);
    const highlights = checkCitations(result.output.highlights, allowed, MAX_HIGHLIGHTS);
    const dropped = summary.dropped + highlights.dropped;
    if (dropped) logger.warn({ requestId: ctx.requestId, dropped }, 'visit summary: dropped sentences with unknown ids');

    return {
      ...base,
      isFollowUp,
      summary: summary.highlights,
      highlights: highlights.highlights,
      highlightsStatus: summary.highlights.length || highlights.highlights.length ? 'ok' : 'none',
      droppedHighlights: dropped,
      usage: { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens },
      timing: { hisMs, llmMs: Date.now() - llmStart },
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    const known = APICallError.isInstance(err) || RetryError.isInstance(err) || NoObjectGeneratedError.isInstance(err);
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (!known && !timedOut) logger.error({ err, requestId: ctx.requestId }, 'visit summary: unexpected LLM error');
    else logger.warn({ requestId: ctx.requestId, reason: err instanceof Error ? err.name : 'unknown' }, 'visit summary: LLM unavailable');
    return { ...base, isFollowUp, summary: [], highlights: [], highlightsStatus: 'unavailable', timing: { hisMs, llmMs: Date.now() - llmStart } };
  }
}

/** Keeps sentences whose every cited id exists in the data; trims text and count. */
export function checkCitations(
  raw: Highlight[],
  allowed: Set<string>,
  max = MAX_HIGHLIGHTS,
): { highlights: Highlight[]; dropped: number } {
  const highlights: Highlight[] = [];
  let dropped = 0;
  for (const h of raw) {
    const text = h.text.trim();
    const sourceIds = [...new Set(h.sourceIds.map((id) => id.trim()))];
    if (!text) continue;
    if (sourceIds.length === 0 || sourceIds.some((id) => !allowed.has(id))) {
      dropped++;
      continue;
    }
    highlights.push({ text: text.length > MAX_SENTENCE_CHARS ? `${text.slice(0, MAX_SENTENCE_CHARS)}…` : text, sourceIds });
  }
  return { highlights: highlights.slice(0, max), dropped };
}
