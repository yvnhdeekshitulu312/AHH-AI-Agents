import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { HisClient, HisError } from '../src/his/client.js';
import { failEnvelope, visitsResponse } from './fixtures/his.js';

const logger = Fastify({ logger: false }).log;

function client(fetchImpl: typeof fetch) {
  return new HisClient({
    baseUrl: 'https://his.example.test/ClinicalsAPI/API',
    username: 'user',
    password: 'pass',
    timeoutMs: 1000,
    logger,
    fetchImpl,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HisClient', () => {
  it('calls the endpoint with Basic auth and query params', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(visitsResponse));
    const result = await client(fetchImpl).fetchVisits('AHH.0001234', '3');

    expect(result).toEqual(visitsResponse);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://his.example.test/ClinicalsAPI/API/FetchPatientVisitsPFN?UHID=AHH.0001234&HospitalID=3');
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'Basic ' + Buffer.from('user:pass').toString('base64'),
    );
  });

  it('always sends PatientId (not SSN) for the profile call', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ Code: 200, FetchPatientDataCCList: [] }));
    await client(fetchImpl).fetchPatientProfile('123456', '3');
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get('PatientId')).toBe('123456');
    expect(url.searchParams.get('SSN')).toBe('0');
  });

  it('throws HisError on a Fail envelope without leaking the upstream message', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(failEnvelope));
    const err = await client(fetchImpl).fetchVisits('AHH.0001234', '3').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HisError);
    expect((err as HisError).kind).toBe('envelope');
    expect((err as HisError).message).not.toContain('SqlException');
  });

  it('retries once on a 5xx response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(json(visitsResponse));
    await expect(client(fetchImpl).fetchVisits('AHH.0001234', '3')).resolves.toEqual(visitsResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 401 }));
    await expect(client(fetchImpl).fetchVisits('AHH.0001234', '3')).rejects.toMatchObject({ kind: 'http', detail: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries once on network errors, then fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client(fetchImpl).fetchVisits('AHH.0001234', '3')).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry timeouts', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(timeout);
    await expect(client(fetchImpl).fetchVisits('AHH.0001234', '3')).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
