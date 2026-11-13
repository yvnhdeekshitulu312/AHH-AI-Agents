import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { HisError } from '../src/his/client.js';
import { normalizeLastVisitsInfo, plainText, reduceForModel, summaryIds, SUMMARY_LIMITS, tidyNumber } from '../src/his/lastVisitsNormalizer.js';
import { checkCitations } from '../src/summaries/visitSummary.js';
import { lastVisitsInfoResponse, newPatientLastVisitsResponse, SENSITIVE } from './fixtures/his.js';
import { authHeaders, mockHis, testConfig, textStep } from './helpers.js';

const TODAY = '2026-11-10';
const body = { uhid: 'AHH.0001234', patientId: '123456', hospitalId: '3', admissionId: '9001' };

describe('normalizeLastVisitsInfo (everything the API returned)', () => {
  const data = normalizeLastVisitsInfo(lastVisitsInfoResponse, '9001', TODAY);

  it('keeps every visit, newest first, and marks the open one as current', () => {
    expect(data.visits.map((v) => [v.id, v.admissionId, v.isCurrent ?? false])).toEqual([
      ['v1', '9001', true],
      ['v2', '5002', false],
      ['v3', '5001', false],
      ['v4', '4000', false],
      ['v5', '3000', false],
    ]);
    expect(data.visits[1]).toMatchObject({ date: '2026-10-02 10:15', visitType: 'OP', doctor: 'Dr. A', disposition: 'Home' });
  });

  it('keeps every note, including the copies the HIS makes and notes of older visits', () => {
    expect(data.notes.map((n) => [n.id, n.visitId, n.date])).toEqual([
      ['n1', 'v2', '2026-10-03 09:00'],
      ['n2', 'v2', '2026-10-02 10:30'], // the same note, copied forward
      ['n3', 'v5', undefined], // an older visit's note
    ]);
    expect(data.notes[0]).toMatchObject({
      doctor: 'Dr. A',
      chiefComplaint: 'Follow-up for diabetes and fatigue',
      assessmentPlan: 'Continue metformin. Repeat HbA1c in 3 months.',
    });
  });

  it('keeps repeated diagnoses but never a blocked row, and uses the type name', () => {
    expect(data.diagnoses.map((d) => [d.id, d.visitId, d.diagnosis, d.type])).toEqual([
      ['dx1', 'v2', 'Type 2 diabetes mellitus', 'Primary'],
      ['dx2', 'v2', 'Type 2 diabetes mellitus', undefined], // the same disease, second row
      ['dx3', 'v3', 'Hypokalemia', undefined],
    ]);
    expect(JSON.stringify(data.diagnoses)).not.toContain('BLOCKED CONFIDENTIAL DIAGNOSIS');
  });

  it('keeps every prescription row (blocked excluded), newest first', () => {
    expect(data.medications.map((m) => [m.id, m.name, m.prescribedOn, m.active])).toEqual([
      ['rx1', 'Amoxicillin 500 mg capsule', '2026-10-02 10:45', false],
      ['rx2', 'Metformin 500 mg tablet', '2026-10-02 10:40', true],
      ['rx3', 'Metformin 500 mg tablet', '2026-10-01 08:00', true], // the earlier prescription of the same drug
      ['rx4', 'Potassium chloride', undefined, true],
    ]);
    // Numbers tidied, strength equal to dose hidden, discontinuation kept as a warning.
    expect(data.medications[1]).toMatchObject({ visitId: 'v2', dose: '1 tablet', frequency: 'Twice daily', route: 'Oral' });
    expect(data.medications[1]!.strength).toBeUndefined();
    expect(data.medications[3]).toMatchObject({ discontinued: true, discontinuedReason: 'Level normal' });
    expect(JSON.stringify(data.medications)).not.toContain('Old blocked item');
  });

  it('keeps every result row, noise and old ones included, with the previous value per test', () => {
    expect(data.results.map((r) => [r.id, r.kind, r.parameter ?? r.test, r.value])).toEqual([
      ['lab1', 'lab', 'Potassium', '2.4'],
      ['lab2', 'lab', 'Sodium', '139'],
      ['lab3', 'lab', 'REMARKS', 'Repeated'], // text row inside a numeric order
      ['lab4', 'lab', 'X', undefined], // ordered, no result yet
      ['lab5', 'lab', 'Result', 'Growth of Escherichia coli'],
      ['lab6', 'lab', 'Sencitivity', '<ZoneDiameter><Antibiotics>…'], // raw machine data
      ['lab7', 'lab', 'HbA1c', '8.9'],
      ['lab8', 'lab', 'HbA1c', '7.8'], // the June value, outside the 30-day window
      ['lab9', 'lab', 'TSH', '2.1'],
      ['lab10', 'radiology', 'Chest X-ray', 'No acute findings.'],
    ]);
    expect(data.results[6]).toMatchObject({ unit: '%', normalRange: '4 - 5.6', previousValue: '7.8', previousDate: '2026-06-15 08:00' });
    expect(data.results[7]!.previousValue).toBeUndefined(); // nothing before the oldest HbA1c
  });

  it('flags numeric labs from the HIS limits, not the order-level HIS flags', () => {
    expect(data.results.map((r) => [r.parameter ?? r.test, r.flag, r.panic, r.abnormal])).toEqual([
      ['Potassium', 'PANIC LOW', true, true],
      ['Sodium', 'NORMAL', false, false], // the order says panic + abnormal; the value is normal
      ['REMARKS', undefined, true, true], // text row: the HIS order flag is used
      ['X', undefined, false, false],
      ['Result', undefined, false, true], // culture: text, so the HIS order flag is used
      ['Sencitivity', undefined, false, true],
      ['HbA1c', 'HIGH', false, true],
      ['HbA1c', 'HIGH', false, true],
      ['TSH', undefined, false, false],
      ['Chest X-ray', undefined, false, false], // radiology report
    ]);
  });

  it('links each result to its visit by AdmissionID', () => {
    expect(data.results.map((r) => [r.id, r.visitId])).toEqual([
      ['lab1', 'v3'],
      ['lab2', 'v3'],
      ['lab3', 'v3'],
      ['lab4', 'v2'],
      ['lab5', 'v2'],
      ['lab6', 'v2'],
      ['lab7', 'v2'],
      ['lab8', 'v5'],
      ['lab9', 'v3'],
      ['lab10', 'v5'],
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

  it('keeps a result whose admission is not among the visits', () => {
    const orphan = normalizeLastVisitsInfo(
      {
        ...lastVisitsInfoResponse,
        RadiologyTestResultDetailMetricsModelDataList: [
          { AdmissionID: '99999', OrderDate: '02-Oct-2026 11:00', TestName: 'CT abdomen', Value: 'Normal.' },
        ],
      },
      '9001',
      TODAY,
    );
    const ct = orphan.results.find((r) => r.test === 'CT abdomen');
    expect(ct).toMatchObject({ value: 'Normal.' });
    expect(ct!.visitId).toBeUndefined();
  });

  it('keeps every allergy row and every vitals row, newest first', () => {
    expect(data.allergies).toEqual([
      { id: 'al1', type: 'Drug', allergen: 'Penicillin' },
      { id: 'al2', type: 'Drug', allergen: 'penicillin' }, // the HIS holds it twice
      { id: 'al3', type: 'Food', allergen: 'Peanuts' },
    ]);
    expect(data.vitals.map((v) => [v.id, v.date, v.bp])).toEqual([
      ['vt1', '2026-10-02 10:05', '135/85'],
      ['vt2', '2026-06-01 10:00', '150/95'],
    ]);
    expect(data.latestVitals).toEqual(data.vitals[0]);
    expect(data.surgeries).toEqual([expect.objectContaining({ id: 'sx1', name: 'Coronary angiography' })]);
  });

  it('does not cut long note text', () => {
    const longNote = 'A'.repeat(SUMMARY_LIMITS.noteChars + 50);
    const full = normalizeLastVisitsInfo(
      {
        ...lastVisitsInfoResponse,
        PatientClinicalExaminationMetricsModelDataList: [{ Admissionid: '5002', ChiefComplaint: longNote, Createdate: '02-Oct-2026 10:30' }],
      },
      '9001',
      TODAY,
    );
    expect(full.notes[0]!.chiefComplaint).toBe(longNote);
  });

  it('never copies PHI', () => {
    const json = JSON.stringify(data);
    expect(json).not.toContain(SENSITIVE.ssn);
    expect(json).not.toContain('Test Patient');
    expect(json).not.toContain('AHH.0001234');
  });

  it('tidies HIS numbers', () => {
    expect(tidyNumber('1.00000')).toBe('1');
    expect(tidyNumber('70.50000')).toBe('70.5');
    expect(tidyNumber('AT 0600H')).toBe('AT 0600H');
    expect(tidyNumber('')).toBeUndefined();
  });

  it('plainText strips tags and caps length', () => {
    expect(plainText('<b>a</b>&amp;<br>b', 100)).toBe('a& b');
    expect(plainText('abcdef', 3)).toBe('abc…');
    expect(plainText('abcdef')).toBe('abcdef'); // uncapped by default
    expect(plainText('<p> </p>', 10)).toBeUndefined();
  });
});

describe('reduceForModel (the subset sent to the LLM)', () => {
  const full = normalizeLastVisitsInfo(lastVisitsInfoResponse, '9001', TODAY);
  const data = reduceForModel(full);

  it('keeps the ids of the full data, so every citation resolves against it', () => {
    const fullIds = summaryIds(full);
    for (const id of summaryIds(data)) expect(fullIds).toContain(id);
  });

  it('keeps the newest 3 visits and only their notes, diagnoses and medicines', () => {
    expect(data.visits.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    // n2 is the copied note, n3 belongs to v5 which is not kept.
    expect(data.notes.map((n) => n.id)).toEqual(['n1']);
    // dx2 repeats dx1's disease for the same visit.
    expect(data.diagnoses.map((d) => d.id)).toEqual(['dx1', 'dx3']);
  });

  it('keeps one row per drug (the latest prescription), active first', () => {
    expect(data.medications.map((m) => [m.id, m.name, m.active, m.discontinued ?? false])).toEqual([
      ['rx2', 'Metformin 500 mg tablet', true, false],
      ['rx4', 'Potassium chloride', true, true],
      ['rx1', 'Amoxicillin 500 mg capsule', false, false],
    ]);
  });

  it('keeps the latest value per test, panic first, and drops noise and old rows', () => {
    expect(data.results.map((r) => [r.id, r.parameter ?? r.test, r.value])).toEqual([
      ['lab1', 'Potassium', '2.4'],
      ['lab5', 'Result', 'Growth of Escherichia coli'],
      ['lab7', 'HbA1c', '8.9'],
      ['lab2', 'Sodium', '139'],
      ['lab10', 'Chest X-ray', 'No acute findings.'],
    ]);
    const names = data.results.map((r) => r.parameter);
    expect(names).not.toContain('REMARKS'); // text row inside a numeric order
    expect(names).not.toContain('Sencitivity'); // raw sensitivity XML
    expect(names).not.toContain('TSH'); // outside the 30-day window
    expect(names).not.toContain('X'); // no value
    expect(data.results.find((r) => r.id === 'lab7')).toMatchObject({ previousValue: '7.8' });
  });

  it('keeps every allergy once and only the latest vitals', () => {
    expect(data.allergies.map((a) => a.allergen)).toEqual(['Penicillin', 'Peanuts']);
    expect(data.vitals.map((v) => v.id)).toEqual(['vt1']);
    expect(data.latestVitals).toEqual(full.vitals[0]);
  });

  it('cuts long note and report text', () => {
    const longNote = 'A'.repeat(SUMMARY_LIMITS.noteChars + 50);
    const longReport = 'B'.repeat(SUMMARY_LIMITS.reportChars + 50);
    const reduced = reduceForModel(
      normalizeLastVisitsInfo(
        {
          ...lastVisitsInfoResponse,
          PatientClinicalExaminationMetricsModelDataList: [{ Admissionid: '5002', ChiefComplaint: longNote, Createdate: '02-Oct-2026 10:30' }],
          RadiologyTestResultDetailMetricsModelDataList: [{ AdmissionID: '5002', OrderDate: '02-Oct-2026 11:00', TestName: 'CT', Value: longReport }],
        },
        '9001',
        TODAY,
      ),
    );
    expect(reduced.notes[0]!.chiefComplaint).toHaveLength(SUMMARY_LIMITS.noteChars + 1); // + the ellipsis
    expect(reduced.results.find((r) => r.test === 'CT')!.value).toHaveLength(SUMMARY_LIMITS.reportChars + 1);
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
    // Every row the HIS returned is in the response, including the duplicate allergy spelling.
    expect(json.allergies).toHaveLength(3);
    expect(json.medications).toHaveLength(4);
    expect(json.vitals).toHaveLength(2);
    expect(json.visits[0]).toMatchObject({ admissionId: '9001', isCurrent: true });
    expect(json.disclaimer).toMatch(/Verify in the HIS/);
    expect(JSON.stringify(json)).not.toContain(SENSITIVE.ssn);

    // The model sees the reduced data, not the raw payload and not every row of the response.
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).toContain('Metformin');
    expect(prompt).not.toContain(SENSITIVE.ssn);
    expect(prompt).not.toContain('Sencitivity'); // noise row: in the response, not in the prompt
    expect(prompt).not.toContain('rx3'); // the earlier prescription of the same drug
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
    expect(res.json().medications).toHaveLength(4);
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
