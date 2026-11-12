import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { HisError } from '../src/his/client.js';
import { normalizeLastVisitsInfo, plainText, tidyNumber } from '../src/his/lastVisitsNormalizer.js';
import { checkCitations } from '../src/summaries/visitSummary.js';
import { lastVisitsInfoResponse, newPatientLastVisitsResponse, SENSITIVE } from './fixtures/his.js';
import { authHeaders, mockHis, testConfig, textStep } from './helpers.js';

const TODAY = '2026-11-10';
const body = { uhid: 'AHH.0001234', patientId: '123456', hospitalId: '3', admissionId: '9001' };

describe('normalizeLastVisitsInfo', () => {
  const data = normalizeLastVisitsInfo(lastVisitsInfoResponse, '9001', TODAY);

  it('keeps the newest 3 visits and marks the open one as current', () => {
    expect(data.visits.map((v) => [v.id, v.admissionId, v.isCurrent ?? false])).toEqual([
      ['v1', '9001', true],
      ['v2', '5002', false],
      ['v3', '5001', false],
    ]);
    expect(data.visits[1]).toMatchObject({ date: '2026-10-02 10:15', visitType: 'OP', doctor: 'Dr. A', disposition: 'Home' });
  });

  it('keeps notes only for kept visits, as plain text, with copied notes collapsed', () => {
    expect(data.notes).toEqual([
      {
        id: 'n1',
        visitId: 'v2',
        date: '2026-10-03 09:00',
        doctor: 'Dr. A',
        chiefComplaint: 'Follow-up for diabetes and fatigue',
        assessmentPlan: 'Continue metformin. Repeat HbA1c in 3 months.',
      },
    ]);
  });

  it('excludes blocked diagnoses and duplicates, and uses the type name', () => {
    expect(data.diagnoses.map((d) => [d.visitId, d.diagnosis, d.type])).toEqual([
      ['v2', 'Type 2 diabetes mellitus', 'Primary'],
      ['v3', 'Hypokalemia', undefined],
    ]);
  });

  it('keeps one row per drug (latest prescription), active first, blocked excluded', () => {
    expect(data.medications.map((m) => [m.id, m.name, m.active, m.discontinued ?? false])).toEqual([
      ['rx1', 'Metformin 500 mg tablet', true, false],
      ['rx2', 'Potassium chloride', true, true],
      ['rx3', 'Amoxicillin 500 mg capsule', false, false],
    ]);
    // Latest Metformin prescription, numbers tidied, strength equal to dose hidden.
    expect(data.medications[0]).toMatchObject({ visitId: 'v2', dose: '1 tablet', frequency: 'Twice daily', route: 'Oral' });
    expect(data.medications[0]!.strength).toBeUndefined();
  });

  it('flags numeric labs from the HIS limits, not the order-level HIS flags', () => {
    expect(data.results.map((r) => [r.parameter ?? r.test, r.flag, r.panic, r.abnormal])).toEqual([
      ['Potassium', 'PANIC LOW', true, true],
      ['Result', undefined, false, true], // culture: text, so the HIS order flag is used
      ['HbA1c', 'HIGH', false, true],
      ['Sodium', 'NORMAL', false, false], // the order says panic + abnormal; the value is normal
      ['Chest X-ray', undefined, false, false], // radiology report
    ]);
  });

  it('links each result to its visit by AdmissionID, and keeps results of visits that were dropped', () => {
    expect(data.results.map((r) => [r.id, r.parameter ?? r.test, r.visitId])).toEqual([
      ['lab1', 'Potassium', 'v3'],
      ['lab2', 'Result', 'v2'],
      ['lab3', 'HbA1c', 'v2'],
      ['lab4', 'Sodium', 'v3'],
      // Admission 3000 is older than the 3 kept visits: the report is still shown, without a visitId.
      ['lab5', 'Chest X-ray', undefined],
    ]);
  });

  it('also reads the lowercase Admissionid spelling the HIS uses in some lists', () => {
    const lowercase = normalizeLastVisitsInfo(
      {
        ...lastVisitsInfoResponse,
        RadiologyTestResultDetailMetricsModelDataList: [
          { Admissionid: '5002', OrderDate: '02-Oct-2026 11:00', TestName: 'Chest X-ray', Value: 'No acute findings.' },
        ],
      },
      '9001',
      TODAY,
    );
    expect(lowercase.results.at(-1)).toMatchObject({ test: 'Chest X-ray', visitId: 'v2' });
  });

  it('keeps the latest value per test with the previous one, and drops noise and old rows', () => {
    const hba1c = data.results.find((r) => r.test === 'HbA1c')!;
    expect(hba1c).toMatchObject({ value: '8.9', unit: '%', normalRange: '4 - 5.6', previousValue: '7.8', date: '2026-09-20 10:00' });
    const names = data.results.map((r) => r.parameter);
    expect(names).not.toContain('REMARKS'); // text row inside a numeric order
    expect(names).not.toContain('Sencitivity'); // raw sensitivity XML
    expect(names).not.toContain('TSH'); // outside the 30-day window
    expect(names).not.toContain('X'); // no value
    expect(data.results.at(-1)).toMatchObject({ kind: 'radiology', test: 'Chest X-ray', value: 'No acute findings.' });
    expect(data.results.map((r) => r.id)).toEqual(['lab1', 'lab2', 'lab3', 'lab4', 'lab5']);
  });

  it('tidies HIS numbers', () => {
    expect(tidyNumber('1.00000')).toBe('1');
    expect(tidyNumber('70.50000')).toBe('70.5');
    expect(tidyNumber('AT 0600H')).toBe('AT 0600H');
    expect(tidyNumber('')).toBeUndefined();
  });

  it('keeps every allergy once, and the latest vitals', () => {
    expect(data.allergies).toEqual([
      { id: 'al1', type: 'Drug', allergen: 'Penicillin' },
      { id: 'al2', type: 'Food', allergen: 'Peanuts' },
    ]);
    expect(data.latestVitals).toMatchObject({ id: 'vt1', date: '2026-10-02 10:05', bp: '135/85', spo2: '98' });
    expect(data.surgeries).toEqual([expect.objectContaining({ id: 'sx1', name: 'Coronary angiography' })]);
  });

  it('never copies PHI', () => {
    const json = JSON.stringify(data);
    expect(json).not.toContain(SENSITIVE.ssn);
    expect(json).not.toContain('Test Patient');
    expect(json).not.toContain('AHH.0001234');
  });

  it('plainText strips tags and caps length', () => {
    expect(plainText('<b>a</b>&amp;<br>b', 100)).toBe('a& b');
    expect(plainText('abcdef', 3)).toBe('abc…');
    expect(plainText('<p> </p>', 10)).toBeUndefined();
  });
});

describe('checkCitations', () => {
  it('drops highlights that cite unknown ids or none', () => {
    const allowed = new Set(['lab1', 'rx1']);
    const { highlights, dropped } = checkCitations(
      [
        { text: 'Potassium 2.4 (panic).', sourceIds: ['lab1'] },
        { text: 'Invented.', sourceIds: ['lab99'] },
        { text: 'No source.', sourceIds: [] },
      ],
      allowed,
    );
    expect(highlights).toEqual([{ text: 'Potassium 2.4 (panic).', sourceIds: ['lab1'] }]);
    expect(dropped).toBe(2);
  });
});

describe('POST /v1/summaries/visit', () => {
  let app: FastifyInstance | undefined;
  let modelIds: (string | undefined)[] = [];
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup(model: MockLanguageModelV3, his = mockHis()) {
    app = await buildApp({ config: testConfig, his, getModel: (id) => { modelIds.push(id); return model; }, logger: false });
    return { app, his, model };
  }
  const post = (a: FastifyInstance, payload: object = body, headers = authHeaders) =>
    a.inject({ method: 'POST', url: '/v1/summaries/visit', headers, payload });

  const highlightsJson = (h: unknown[], summary: unknown[] = []) => textStep(JSON.stringify({ summary, highlights: h }));

  it('returns the data sections and a verified summary and highlights, using the summary model', async () => {
    modelIds = [];
    const model = new MockLanguageModelV3({
      doGenerate: [
        highlightsJson(
          [
            { text: 'Potassium 2.4 mmol/L (panic) on 01-Oct-2026.', sourceIds: ['lab1'] },
            { text: 'Made-up item.', sourceIds: ['rx77'] },
          ],
          [
            { text: '72 Y male, OP Internal Medicine.', sourceIds: ['v1'] },
            { text: 'Invented sentence.', sourceIds: ['dx99'] },
            { text: 'Type 2 diabetes on metformin.', sourceIds: ['dx1', 'rx1'] },
          ],
        ),
      ],
    });
    const { app, his } = await setup(model);
    const res = await post(app);

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(his.fetchLastVisitsInfo).toHaveBeenCalledWith('123456', '3');
    expect(modelIds).toContain(testConfig.SUMMARY_MODEL);
    expect(json.isFollowUp).toBe(true);
    expect(json.highlightsStatus).toBe('ok');
    expect(json.patient).toEqual({ age: '72 Y', gender: 'Male' });
    expect(json.summary).toEqual([
      { text: '72 Y male, OP Internal Medicine.', sourceIds: ['v1'] },
      { text: 'Type 2 diabetes on metformin.', sourceIds: ['dx1', 'rx1'] },
    ]);
    expect(json.highlights).toEqual([{ text: 'Potassium 2.4 mmol/L (panic) on 01-Oct-2026.', sourceIds: ['lab1'] }]);
    expect(json.allergies).toHaveLength(2);
    expect(json.visits[0]).toMatchObject({ admissionId: '9001', isCurrent: true });
    expect(json.disclaimer).toMatch(/Verify in the HIS/);
    expect(JSON.stringify(json)).not.toContain(SENSITIVE.ssn);

    // The model sees the normalized data, not the raw payload.
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain('Metformin');
    expect(prompt).not.toContain(SENSITIVE.ssn);
  });

  it('still returns the data when the LLM fails', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new APICallError({ message: 'down', url: 'x', requestBodyValues: {}, statusCode: 400, isRetryable: false });
      },
    });
    const { app } = await setup(model);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ highlightsStatus: 'unavailable', highlights: [] });
    expect(res.json().medications).toHaveLength(3);
  });

  it('summarises a long-stay inpatient whose only visit is the open admission', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [highlightsJson([{ text: 'Potassium panic low.', sourceIds: ['lab1'] }])] });
    const his = mockHis();
    his.fetchLastVisitsInfo.mockResolvedValue({
      ...lastVisitsInfoResponse,
      PatientClinicalEpisodeMetricsModelDataList: [{ AdmissionID: '9001', VisitDate: '01-Jan-2025 15:40', PatientType: '2' }],
      MedicationPrescriptionHeaderMetricsModelDataList: [{ Admissionid: '9001', ItemName: 'Aspirin 100 mg', Blocked: '0' }],
    });
    const { app } = await setup(model, his);
    const res = await post(app);
    expect(res.json()).toMatchObject({ isFollowUp: false, highlightsStatus: 'ok', visits: [{ isCurrent: true }] });
    expect(res.json().medications).toEqual([expect.objectContaining({ name: 'Aspirin 100 mg', active: true })]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('does not call the LLM for a patient without previous visits', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [highlightsJson([])] });
    const his = mockHis();
    his.fetchLastVisitsInfo.mockResolvedValue(newPatientLastVisitsResponse);
    const { app } = await setup(model, his);
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isFollowUp: false, highlightsStatus: 'none', visits: [{ isCurrent: true }] });
    expect(res.json().allergies).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns 502 when the HIS fails', async () => {
    const his = mockHis();
    his.fetchLastVisitsInfo.mockRejectedValue(new HisError('PatientLastVisitsInfo', 'envelope', 404));
    const { app } = await setup(new MockLanguageModelV3({ doGenerate: [highlightsJson([])] }), his);
    const res = await post(app);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('HIS_UNAVAILABLE');
  });

  it('validates the body and requires the API key', async () => {
    const { app } = await setup(new MockLanguageModelV3({ doGenerate: [highlightsJson([])] }));
    expect((await post(app, { ...body, patientId: 'abc' })).statusCode).toBe(400);
    expect((await post(app, body, { authorization: 'Bearer wrong' } as never)).statusCode).toBe(401);
  });
});
