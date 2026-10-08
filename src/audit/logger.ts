import { createHmac } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

export interface AuditEvent {
  requestId: string;
  agentId: string;
  userId: string;
  hospitalId: string;
  uhid: string;
  question: string;
  outcome: 'answered' | 'blocked' | 'error';
  toolsUsed?: string[];
  steps?: number;
  durationMs: number;
  reason?: string;
  inputTokens?: number;
  outputTokens?: number;
  llmMs?: number;
  toolMs?: number;
}

/**
 * Writes one structured audit record per request.
 * Patient identifiers are HMAC-hashed so logs can be correlated without exposing the UHID.
 * The answer itself is never logged.
 *
 * v1 writes to the application log (stdout). Route `audit: true` records to a protected store in production.
 */
export class AuditLogger {
  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly hashSecret: string,
  ) {}

  hashId(value: string): string {
    return createHmac('sha256', this.hashSecret).update(value).digest('hex').slice(0, 16);
  }

  record(event: AuditEvent): void {
    const { uhid, ...rest } = event;
    this.logger.info({ audit: true, ...rest, uhidHash: this.hashId(uhid) }, 'agent request');
  }
}
