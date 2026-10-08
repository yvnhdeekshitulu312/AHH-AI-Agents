import type { FastifyBaseLogger } from 'fastify';
import type {
  HisEnvelope,
  RawDepartmentResultsResponse,
  RawDiagnosesResponse,
  RawLabComponentsResponse,
  RawLabResultsResponse,
  RawPatientProfileResponse,
  RawVisitsResponse,
  RawYearWiseVisitsResponse,
} from './types.js';

export type ResultDepartment = 'radiology' | 'cardiology' | 'neurology' | 'dental';

const DEPARTMENT_ENDPOINTS: Record<ResultDepartment, string> = {
  radiology: 'FetchRadOrderResultsPF',
  cardiology: 'FetchCardOrderResultsPF',
  neurology: 'FetchNeurologyOrderResultsPF',
  dental: 'FetchDentalOrderResultsPF',
};

/** Date range in the HIS format "dd-MMM-yyyy". */
export interface HisDateRange {
  from: string;
  to: string;
}

/** Identifies one lab test result for FetchPrevLabTestComponents. All values come from the HIS, never from the LLM. */
export interface LabComponentsRequest {
  patientId: string;
  genderId: string;
  /** "dd-MMM-yyyy" */
  dob: string;
  /** "dd-MMM-yyyy HH:mm" */
  sampleCollectedAt: string;
  testId: string;
  testOrderId: string;
  testOrderItemId: string;
  sampleNo: string;
  patientType: string;
  hospitalId: string;
}

/** Thrown for any HIS failure. Never carries the upstream message (it can contain raw exception text). */
export class HisError extends Error {
  constructor(
    readonly endpoint: string,
    readonly kind: 'timeout' | 'network' | 'http' | 'envelope' | 'parse',
    readonly detail?: string | number,
  ) {
    super(`HIS ${endpoint} failed (${kind}${detail !== undefined ? `: ${detail}` : ''})`);
    this.name = 'HisError';
  }
}

/** The HIS operations tools depend on. Mock this interface in tests. */
export interface HisApi {
  fetchPatientProfile(patientId: string, hospitalId: string): Promise<RawPatientProfileResponse>;
  fetchVisits(uhid: string, hospitalId: string): Promise<RawVisitsResponse>;
  fetchVisitsByYear(uhid: string, hospitalId: string): Promise<RawYearWiseVisitsResponse>;
  fetchDiagnoses(uhid: string, hospitalId: string): Promise<RawDiagnosesResponse>;
  fetchLabResults(uhid: string, patientId: string, hospitalId: string, range: HisDateRange): Promise<RawLabResultsResponse>;
  fetchDepartmentResults(
    department: ResultDepartment,
    patientId: string,
    hospitalId: string,
    range: HisDateRange,
  ): Promise<RawDepartmentResultsResponse>;
  fetchLabComponents(req: LabComponentsRequest): Promise<RawLabComponentsResponse>;
}

export interface HisClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  logger: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

const SUCCESS_CODE = 200;

export class HisClient implements HisApi {
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HisClientOptions) {
    this.authHeader = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  fetchPatientProfile(patientId: string, hospitalId: string) {
    // Always pass PatientId: with PatientId=0 the API falls back to an SSN lookup
    // that can return a list of dependents instead of a single patient.
    return this.get<RawPatientProfileResponse>('FetchPatientDataC', {
      SSN: '0',
      MobileNO: '0',
      PatientId: patientId,
      UserId: '0',
      WorkStationID: '0',
      HospitalID: hospitalId,
    });
  }

  fetchVisits(uhid: string, hospitalId: string) {
    return this.get<RawVisitsResponse>('FetchPatientVisitsPFN', { UHID: uhid, HospitalID: hospitalId });
  }

  fetchVisitsByYear(uhid: string, hospitalId: string) {
    return this.get<RawYearWiseVisitsResponse>('FetchyearWisePatientVisits', {
      UHID: uhid,
      WorkStationID: '0',
      HospitalId: hospitalId,
    });
  }

  fetchDiagnoses(uhid: string, hospitalId: string) {
    return this.get<RawDiagnosesResponse>('FetchPatientSummaryDiagPFNUHID', {
      UHID: uhid,
      WorkStationID: '0',
      HospitalId: hospitalId,
    });
  }

  fetchLabResults(uhid: string, patientId: string, hospitalId: string, range: HisDateRange) {
    return this.get<RawLabResultsResponse>('FetchLabOrderResultsPFN', {
      fromDate: range.from,
      ToDate: range.to,
      UHID: uhid,
      PatientID: patientId,
      AdmissionID: '0',
      SearchID: '0',
      HospitalID: hospitalId,
    });
  }

  fetchDepartmentResults(department: ResultDepartment, patientId: string, hospitalId: string, range: HisDateRange) {
    return this.get<RawDepartmentResultsResponse>(DEPARTMENT_ENDPOINTS[department], {
      fromDate: range.from,
      ToDate: range.to,
      PatientID: patientId,
      AdmissionID: '0',
      SearchID: '0',
      HospitalID: hospitalId,
    });
  }

  /** Read-only: loads the test's parameters, values, previous values and reference / panic ranges. */
  fetchLabComponents(req: LabComponentsRequest) {
    return this.get<RawLabComponentsResponse>('FetchPrevLabTestComponents', {
      PatientID: req.patientId,
      GenderID: req.genderId,
      DOB: req.dob,
      SampleCollectedAtDt: req.sampleCollectedAt,
      TestID: req.testId,
      TestOrderID: req.testOrderId,
      TestOrderItemID: req.testOrderItemId,
      SampleNo: req.sampleNo,
      PatientType: req.patientType,
      UserID: '0',
      WorkStationID: '0',
      HospitalID: req.hospitalId,
    });
  }

  /** GET with Basic auth, timeout, one retry on network/5xx errors, and envelope validation. */
  private async get<T extends HisEnvelope>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = `${this.opts.baseUrl}/${endpoint}?${new URLSearchParams(params).toString()}`;
    const started = Date.now();

    let response: Response;
    try {
      response = await this.requestWithRetry(endpoint, url);
    } finally {
      this.opts.logger.debug({ his: endpoint, durationMs: Date.now() - started }, 'HIS call');
    }

    let body: T;
    try {
      body = (await response.json()) as T;
    } catch {
      throw new HisError(endpoint, 'parse');
    }

    if (body?.Code !== SUCCESS_CODE) {
      // The API returns HTTP 200 with Code=404 on exceptions; Message holds raw exception text, so don't propagate it.
      this.opts.logger.warn({ his: endpoint, hisCode: body?.Code }, 'HIS returned non-success envelope');
      throw new HisError(endpoint, 'envelope', body?.Code);
    }
    return body;
  }

  private async requestWithRetry(endpoint: string, url: string): Promise<Response> {
    const maxAttempts = 2;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: this.authHeader, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (response.ok) return response;
        if (response.status >= 500 && attempt < maxAttempts) continue;
        throw new HisError(endpoint, 'http', response.status);
      } catch (err) {
        if (err instanceof HisError) throw err;
        // Don't retry timeouts: a second attempt would likely blow the agent's overall time budget.
        if (err instanceof Error && err.name === 'TimeoutError') throw new HisError(endpoint, 'timeout');
        if (attempt < maxAttempts) continue;
        throw new HisError(endpoint, 'network');
      }
    }
  }
}
