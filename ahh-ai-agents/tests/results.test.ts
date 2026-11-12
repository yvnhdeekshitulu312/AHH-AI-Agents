import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { RequestCache } from '../src/core/requestCache.js';
import { HisClient } from '../src/his/client.js';
import { hisDateOnly, lastDaysRange, toHisDate } from '../src/his/dates.js';
import {
  flagValue,
  normalizeHisDate,
  normalizeLabComponents,
  normalizeOrderResults,
  RESULTED_CODE,
} from '../src/his/normalizers.js';
import { labResultsResponse, potassiumComponentsResponse, radiologyResponse } from './fixtures/his.js';

describe('normalizeHisDate (ISO)', () => {
  it('converts serialized .NET DateTimes', () => {
    expect(normalizeHisDate('2026-10-05T08:10:00')).toBe('2026-10-05 08:10');
    expect(normalizeHisDate('2026-10-05T08:10:00.123+03:00')).toBe('2026-10-05 08:10');
  });
});

describe('normalizeOrderResults', () => {
  it('keeps only resulted lab rows, newest first, with HIS flags as booleans', () => {
    const results = normalizeOrderResults(labResultsResponse.FetchLabOrderResultsDataaList, RESULTED_CODE.lab);
    expect(results.map((r) => r.test)).toEqual(['Potassium', 'CBC', 'TSH']);
    expect(results[0]).toEqual({
      id: '9001',
      test: 'Potassium',
      specialty: 'Chemistry',
      orderedAt: '2026-10-05 08:10',
      collectedAt: '2026-10-05 08:30',
      verifiedAt: '2026-10-05 10:05',
      status: 'Verified',
      panic: true,
      abnormal: true,
      verifiedBy: 'Lab Tech A',
      hospital: 'AHH Olaya',
    });
    expect(results[1]).toMatchObject({ test: 'CBC', panic: false, abnormal: true, preliminary: true });
  });

  it('uses the department resulted code', () => {
    const results = normalizeOrderResults(radiologyResponse.FetchRadOrderResultsDataaList, RESULTED_CODE.other);
    expect(results.map((r) => r.test)).toEqual(['CT Chest']);
  });

  it('never exposes internal ids beyond the result id', () => {
    const json = JSON.stringify(normalizeOrderResults(labResultsResponse.FetchLabOrderResultsDataaList, RESULTED_CODE.lab));
    expect(json).not.toContain('SampleNumber');
    expect(json).not.toContain('S-1');
    expect(json).not.toContain('TestOrderId');
  });
});

describe('flagValue', () => {
  const limits = { min: '3.5', max: '5.1', panicMin: '2.8', panicMax: '6.2' };

  it.each([
    ['6.8', 'PANIC HIGH'],
    ['2.1', 'PANIC LOW'],
    ['5.6', 'HIGH'],
    ['3.0', 'LOW'],
    ['4.2', 'NORMAL'],
    ['5.1', 'NORMAL'],
  ])('%s → %s', (value, flag) => {
    expect(flagValue(value, limits)).toBe(flag);
  });

  it('ignores panic limits of 0 and a 0–0 reference range', () => {
    expect(flagValue('7', { min: '0', max: '0', panicMin: '0', panicMax: '0' })).toBeUndefined();
    expect(flagValue('7', { min: '0', max: '10', panicMin: '0', panicMax: '0' })).toBe('NORMAL');
  });

  it('does not flag non-numeric values', () => {
    expect(flagValue('Positive', limits)).toBeUndefined();
    expect(flagValue('', limits)).toBeUndefined();
  });
});

describe('normalizeLabComponents', () => {
  it('returns parameters that have a value, with computed flag and previous value', () => {
    expect(normalizeLabComponents(potassiumComponentsResponse)).toEqual([
      {
        parameter: 'Potassium',
        value: '6.8',
        unit: 'mmol/L',
        normalRange: '3.5 - 5.1 mmol/L',
        flag: 'PANIC HIGH',
        previousValue: '5.0',
      },
    ]);
  });
});

describe('dates', () => {
  it('formats dates in the hospital time zone (Riyadh, UTC+3)', () => {
    expect(toHisDate(new Date('2026-10-06T22:30:00Z'))).toBe('07-Oct-2026');
    expect(lastDaysRange(30, new Date('2026-10-07T09:00:00Z'))).toEqual({ from: '07-Sep-2026', to: '07-Oct-2026' });
  });

  it('strips the time from HIS dates', () => {
    expect(hisDateOnly('01-Jul-1981 00:00')).toBe('01-Jul-1981');
    expect(hisDateOnly(undefined)).toBeUndefined();
  });
});

describe('RequestCache', () => {
  it('runs a loader once per key', async () => {
    const cache = new RequestCache();
    const load = vi.fn().mockResolvedValue('x');
    await Promise.all([cache.memo('k', load), cache.memo('k', load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const cache = new RequestCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(cache.memo('k', load)).rejects.toThrow('boom');
    await expect(cache.memo('k', load)).resolves.toBe('ok');
  });
});

describe('HisClient results endpoints', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const make = (fetchImpl: typeof fetch) =>
    new HisClient({
      baseUrl: 'https://his.example.test/API',
      username: 'u',
      password: 'p',
      timeoutMs: 1000,
      logger: Fastify({ logger: false }).log,
      fetchImpl,
    });

  it('calls the department endpoint with the date range', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ Code: 200, FetchRadOrderResultsDataaList: [] }));
    await make(fetchImpl).fetchDepartmentResults('cardiology', '123456', '3', { from: '07-Sep-2026', to: '07-Oct-2026' });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe('/API/FetchCardOrderResultsPF');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      fromDate: '07-Sep-2026',
      ToDate: '07-Oct-2026',
      PatientID: '123456',
      HospitalID: '3',
    });
  });

  it('calls lab values with UserID 0 (no user is recorded as viewing)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ Code: 200, FetchLabTestComponentsListM: [] }));
    await make(fetchImpl).fetchLabComponents({
      patientId: '123456', genderId: '1', dob: '01-Jul-1981', sampleCollectedAt: '05-Oct-2026 08:30',
      testId: '41', testOrderId: '700', testOrderItemId: '9001', sampleNo: 'S-1', patientType: '2', hospitalId: '3',
    });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe('/API/FetchPrevLabTestComponents');
    expect(url.searchParams.get('UserID')).toBe('0');
    expect(url.searchParams.get('DOB')).toBe('01-Jul-1981');
  });
});
