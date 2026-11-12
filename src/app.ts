import { randomUUID, timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuditLogger } from './audit/logger.js';
import type { Config } from './config.js';
import { AppError } from './core/errors.js';
import { HisClient, type HisApi } from './his/client.js';
import { createModelFactory, type ModelFactory } from './llm/provider.js';
import { agentRoutes } from './routes/agents.js';
import { summaryRoutes } from './routes/summaries.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Doctor user id from the portal (X-User-Id). Trusted from the portal in v1; comes from the JWT later. */
    userId: string;
  }
}

export interface BuildAppOptions {
  config: Config;
  /** Overrides for tests. */
  his?: HisApi;
  getModel?: ModelFactory;
  logger?: boolean | object;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = opts;

  const app = Fastify({
    logger: opts.logger ?? {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization'],
    },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    },
    bodyLimit: 32 * 1024,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-User-Id'],
  });

  app.decorateRequest('userId', '');

  // Auth for everything under /v1. v1 uses a shared API key; replace with portal JWT validation later.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (!request.url.startsWith('/v1/')) return;

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, config.API_KEY)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid credentials.' });
    }
    const userId = request.headers['x-user-id'];
    request.userId = typeof userId === 'string' && userId.length <= 64 ? userId : 'unknown';
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) request.log.error({ err, cause: err.cause }, err.code);
      return reply.code(err.statusCode).send({ error: err.code, message: err.userMessage, requestId: request.id });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      // Fastify client errors (bad JSON, body too large, ...)
      return reply.code(statusCode).send({ error: 'BAD_REQUEST', message: 'Invalid request.', requestId: request.id });
    }
    request.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong.', requestId: request.id });
  });

  const his =
    opts.his ??
    new HisClient({
      baseUrl: config.HIS_BASE_URL,
      username: config.HIS_USERNAME,
      password: config.HIS_PASSWORD,
      timeoutMs: config.HIS_TIMEOUT_MS,
      logger: app.log,
    });
  const getModel = opts.getModel ?? createModelFactory(config);
  const audit = new AuditLogger(app.log, config.AUDIT_HASH_SECRET);

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(agentRoutes, { his, getModel, audit });
  await app.register(summaryRoutes, { his, getModel, audit, model: config.SUMMARY_MODEL });

  return app;
}
