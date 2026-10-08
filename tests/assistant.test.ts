import { MockLanguageModelV3 } from 'ai/test';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { HisError } from '../src/his/client.js';
import { SENSITIVE } from './fixtures/his.js';
import { assistantUrl, authHeaders, mockHis, testConfig, textStep, toolCallStep, validBody } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function run(steps: ReturnType<typeof toolCallStep>[], his = mockHis()) {
  const model = new MockLanguageModelV3({ doGenerate: [...steps, textStep('done')] });
  app = await buildApp({ config: testConfig, his, getModel: () => model, logger: false });
  const res = await app.inject({ method: 'POST', url: assistantUrl, headers: authHeaders, payload: validBody });
  /** What each tool returned to the model, by tool name. */
  const toolResults = (name: string) =>
    model.doGenerateCalls
      .at(-1)!
      .prompt.flatMap((m) => (m.role === 'tool' ? m.content : []))
      .filter((p) => p.type === 'tool-result' && p.toolName === name)
      .map((p) => (p.type === 'tool-result' && p.output.type === 'json' ? (p.output.value as any) : undefined));
  return { res, his, model, toolResults };
}

describe('patient-assistant agent', () => {
  it('is listed and exposes history + results tools', async () => {
    const { res, model } = await run([]);
    expect(res.statusCode).toBe(200);
    const names = (model.doGenerateCalls[0]!.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      'getDepartmentResults', 'getDiagnoses', 'getLabResults', 'getLabValues',
      'getPatientProfile', 'getVisits', 'getVisitsByYear',
    ]);
  });

  it('getLabResults: last 30 days by default, panic filter from HIS flags, counts', async () => {
    const { his, toolResults } = await run([toolCallStep('getLabResults', { filter: 'panic' })]);
    const [range] = his.fetchLabResults.mock.calls[0]!.slice(3) as [{ from: string; to: string }];
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 864e5;
    expect(days).toBe(30);
    expect(his.fetchLabResults.mock.calls[0]!.slice(0, 3)).toEqual(['AHH.0001234', '123456', '3']);

    const [out] = toolResults('getLabResults');
    expect(out).toMatchObject({ totalResulted: 3, panicCount: 1, abnormalCount: 2, matching: 1 });
    expect(out.results.map((r: any) => r.test)).toEqual(['Potassium']);
  });

  it('getLabResults: abnormal filter and test name filter', async () => {
    const { toolResults } = await run([
      toolCallStep('getLabResults', { filter: 'abnormal' }, 'c1'),
      toolCallStep('getLabResults', { testName: 'tsh' }, 'c2'),
    ]);
    const [abnormal, tsh] = toolResults('getLabResults');
    expect(abnormal.results.map((r: any) => r.test)).toEqual(['Potassium', 'CBC']);
    expect(tsh.results.map((r: any) => r.test)).toEqual(['TSH']);
  });

  it('getLabValues: uses the HIS row and profile, never LLM-supplied test details', async () => {
    const { his, toolResults } = await run([toolCallStep('getLabValues', { resultIds: ['9001'], testId: '999' })]);

    expect(his.fetchLabComponents).toHaveBeenCalledWith({
      patientId: '123456', genderId: '1', dob: '01-Jul-1981', sampleCollectedAt: '05-Oct-2026 08:30',
      testId: '41', testOrderId: '700', testOrderItemId: '9001', sampleNo: 'S-1', patientType: '2', hospitalId: '3',
    });
    const [out] = toolResults('getLabValues');
    expect(out.tests[0]).toMatchObject({
      id: '9001', test: 'Potassium', panic: true,
      values: [{ parameter: 'Potassium', value: '6.8', flag: 'PANIC HIGH', previousValue: '5.0' }],
    });
  });

  it('getLabValues: rejects ids that are not this patient\'s resulted tests', async () => {
    const { his, toolResults } = await run([toolCallStep('getLabValues', { resultIds: ['5555', '9004'] })]);
    expect(his.fetchLabComponents).not.toHaveBeenCalled();
    const [out] = toolResults('getLabValues');
    expect(out.tests.map((t: any) => t.error)).toEqual([
      expect.stringContaining('No resulted lab test'),
      expect.stringContaining('No resulted lab test'),
    ]);
  });

  it('getLabValues: one failing test does not hide the others', async () => {
    const his = mockHis();
    his.fetchLabComponents.mockRejectedValueOnce(new HisError('FetchPrevLabTestComponents', 'timeout'));
    const { toolResults } = await run([toolCallStep('getLabValues', { resultIds: ['9001', '9002'] })], his);
    const [out] = toolResults('getLabValues');
    expect(out.tests[0]).toMatchObject({ id: '9001', error: expect.stringContaining('could not be retrieved') });
    expect(out.tests[1]).toMatchObject({ id: '9002', values: expect.any(Array) });
  });

  it('fetches the profile once per question even when two tools need it', async () => {
    const { his } = await run([
      toolCallStep('getPatientProfile', {}, 'c1'),
      toolCallStep('getLabValues', { resultIds: ['9001'] }, 'c2'),
    ]);
    expect(his.fetchPatientProfile).toHaveBeenCalledTimes(1);
  });

  it('getDepartmentResults: all departments, resulted only, report text not claimed', async () => {
    const { his, toolResults } = await run([toolCallStep('getDepartmentResults', {})]);
    expect(his.fetchDepartmentResults.mock.calls.map((c) => c[0]).sort()).toEqual([
      'cardiology', 'dental', 'neurology', 'radiology',
    ]);
    const [out] = toolResults('getDepartmentResults');
    expect(out.results.map((r: any) => `${r.department}:${r.test}`)).toEqual(['radiology:CT Chest', 'neurology:EEG']);
    expect(out).toMatchObject({ abnormalCount: 1, panicCount: 0 });
  });

  it('getDepartmentResults: reports a department that could not be retrieved', async () => {
    const his = mockHis();
    his.fetchDepartmentResults.mockImplementation(async (dept) => {
      if (dept === 'cardiology') throw new HisError('FetchCardOrderResultsPF', 'timeout');
      return { Code: 200, FetchRadOrderResultsDataaList: [] };
    });
    const { toolResults } = await run([toolCallStep('getDepartmentResults', {})], his);
    expect(toolResults('getDepartmentResults')[0].couldNotRetrieve).toEqual(['cardiology']);
  });

  it('never sends PHI to the model across results tools', async () => {
    const { model } = await run([
      toolCallStep('getLabResults', {}, 'c1'),
      toolCallStep('getLabValues', { resultIds: ['9001'] }, 'c2'),
      toolCallStep('getPatientProfile', {}, 'c3'),
    ]);
    const prompts = JSON.stringify(model.doGenerateCalls.map((c) => c.prompt));
    for (const value of Object.values(SENSITIVE)) expect(prompts).not.toContain(value);
    expect(prompts).not.toContain('01-Jul-1981');
    expect(prompts).not.toContain('S-1');
  });
});
