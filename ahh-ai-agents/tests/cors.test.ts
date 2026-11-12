import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { mockHis, testConfig } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('CORS', () => {
  it('answers the browser preflight for the portal origin without requiring auth', async () => {
    app = await buildApp({ config: testConfig, his: mockHis(), getModel: () => { throw new Error('unused'); }, logger: false });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/agents/patient-history/ask',
      headers: {
        origin: 'http://localhost:4200',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-user-id',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  });

  it('does not allow other origins', async () => {
    app = await buildApp({ config: testConfig, his: mockHis(), getModel: () => { throw new Error('unused'); }, logger: false });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/agents/patient-history/ask',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
