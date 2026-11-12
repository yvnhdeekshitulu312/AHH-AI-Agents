import type {
  RawDiagnosesResponse,
  RawLabComponentsResponse,
  RawOrderResult,
  RawPatientProfileResponse,
  RawVisitsResponse,
  RawYearWiseVisitsResponse,
} from './types.js';

/**
 * Normalizers turn large HIS payloads into compact, LLM-friendly objects.
 * They are also the PHI filter: only fields listed here ever reach the model.
 */

export interface PatientProfile {
  name?: string;
  age?: string;
  gender?: string;
  nationality?: string;
  bloodGroup?: string;
  height?: string;
  weight?: string;
  hasAllergies: boolean;
  pregnancy?: string;
  lactation?: boolean;
}

export interface Visit {
  date?: string;
  visitType?: string;
  hospital?: string;
  doctor?: string;
  specialty?: string;
  admissionId?: string;
  isNewVisit?: boolean;
}

export interface YearlyVisitCount {
  year: number;
  visitType?: string;
  count: number;
}

export interface Diagnosis {
  diagnosis?: string;
  icdCode?: string;
  type?: string;
  status?: string;
  date?: string;
  admissionId?: string;
  doctor?: string;
  hospital?: string;
  visitType?: string;
  remarks?: string;
}

const VISIT_TYPES: Record<string, string> = { '1': 'OP', '2': 'IP', '3': 'ED', '4': 'DC' };

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Trimmed string, or undefined when empty / missing. */
export function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

export function isTruthyFlag(value: unknown): boolean {
  const s = str(value)?.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * Converts HIS dates ("12-Sep-2026 10:15:00" or "12-Sep-2026 10:15") to "2026-09-12 10:15".
 * The output sorts correctly as a string. Unknown formats are returned unchanged.
 */
export function normalizeHisDate(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  // Serialized .NET DateTime: "2026-10-05T10:15:00" (optionally with fractions / offset).
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s);
  if (iso) return `${iso[1]} ${iso[2]}`;
  const m =/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(s);
  if (!m) return s;
  const [, day, mon, year, hh, mm] = m;
  const month = MONTHS[mon!.toLowerCase()];
  if (!month) return s;
  const date = `${year}-${month}-${day!.padStart(2, '0')}`;
  return hh ? `${date} ${hh.padStart(2, '0')}:${mm}` : date;
}

export function visitType(patientTypeName: unknown, patientType: unknown): string | undefined {
  return str(patientTypeName) ?? VISIT_TYPES[str(patientType) ?? ''] ?? str(patientType);
}

/** Removes undefined keys so the LLM sees fewer tokens. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function byDateDesc<T extends { date?: string }>(a: T, b: T): number {
  return (b.date ?? '').localeCompare(a.date ?? '');
}

export function normalizeProfile(raw: RawPatientProfileResponse): PatientProfile | null {
  const p = raw.FetchPatientDataCCList?.[0];
  if (!p) return null;
  const isPregnant = isTruthyFlag(p.IsPregnancy);
  return compact({
    name: str(p.PatientName),
    age: str(p.FullAge),
    gender: str(p.Gender),
    nationality: str(p.Nationality),
    bloodGroup: str(p.BloodGroup),
    height: str(p.Height),
    weight: str(p.Weight),
    hasAllergies: isTruthyFlag(p.IsAllergy),
    pregnancy: isPregnant ? (str(p.PregnancyContent) ?? 'Pregnant') : undefined,
    lactation: str(p.Lactation) ? true : undefined,
  });
}

export function normalizeVisits(raw: RawVisitsResponse): Visit[] {
  return (raw.PatientVisitsDataList ?? [])
    .map((v) =>
      compact({
        date: normalizeHisDate(v.VisitDate),
        visitType: visitType(v.PatientTypeName, v.PatientType),
        hospital: str(v.HospitalName),
        doctor: str(v.DoctorName),
        specialty: str(v.SpecialisationName),
        admissionId: str(v.AdmissionID),
        isNewVisit: str(v.IsNewVisit) !== undefined ? isTruthyFlag(v.IsNewVisit) : undefined,
      }),
    )
    .sort(byDateDesc);
}

export function normalizeVisitsByYear(raw: RawYearWiseVisitsResponse): YearlyVisitCount[] {
  return (raw.FetchyearWisePatientVisitsDataList ?? [])
    .map((r) =>
      compact({
        year: Number(str(r.YearID)),
        visitType: visitType(undefined, r.PatientType),
        count: Number(str(r.TotalPatients) ?? 0),
      }),
    )
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.count))
    .sort((a, b) => b.year - a.year);
}

/** Blocked diagnoses are excluded (policy decision, 2026-10-06). */
export function normalizeDiagnoses(raw: RawDiagnosesResponse): Diagnosis[] {
  return (raw.PatientDiseasesDataList ?? [])
    .filter((d) => !isTruthyFlag(d.Blocked))
    .map((d) =>
      compact({
        diagnosis: str(d.DiseaseName),
        icdCode: str(d.Code),
        type: str(d.DiagnosisType) ?? str(d.DiagonosisType),
        status: str(d.DiagnosisStatus),
        date: normalizeHisDate(d.CreateDate),
        admissionId: str(d.AdmissionID),
        doctor: str(d.Doctorname),
        hospital: str(d.HospitalName),
        visitType: visitType(undefined, d.PatientType),
        remarks: str(d.Remarks),
      }),
    )
    .filter((d) => d.diagnosis !== undefined)
    .sort(byDateDesc);
}

// ── Results ──────────────────────────────────────────────────────────────────

export interface OrderResult {
  /** TestOrderItemID: the id the LLM passes to getLabValues. */
  id?: string;
  test?: string;
  specialty?: string;
  orderedAt?: string;
  collectedAt?: string;
  verifiedAt?: string;
  status?: string;
  /** HIS flag, never decided by the LLM. */
  panic: boolean;
  /** HIS flag, never decided by the LLM. */
  abnormal: boolean;
  preliminary?: boolean;
  verifiedBy?: string;
  orderedBy?: string;
  hospital?: string;
}

/** `IsResult` value that marks a resulted row, as the portal's results screen filters them. */
export const RESULTED_CODE = { lab: '4', other: '7' } as const;

/** Resulted rows only, newest first, reduced to what the LLM needs. */
export function normalizeOrderResults(rows: RawOrderResult[] | undefined, resultedCode: string): OrderResult[] {
  return (rows ?? [])
    .filter((r) => str(r.IsResult) === resultedCode)
    .map((r) =>
      compact({
        id: str(r.TestOrderItemID),
        test: str(r.TestName),
        specialty: str(r.specialisation) ?? str(r.DepartmentName),
        orderedAt: normalizeHisDate(r.OrderDate),
        collectedAt: normalizeHisDate(r.SampleCollectedAt),
        verifiedAt: normalizeHisDate(r.ResultVerifiedAt),
        status: str(r.StatusName),
        panic: isTruthyFlag(r.IsPanic),
        abnormal: isTruthyFlag(r.IsAbnormal),
        preliminary: isTruthyFlag(r.IsPreliminary) ? true : undefined,
        verifiedBy: str(r.ResultVerifiedByName),
        orderedBy: str(r.DocName),
        hospital: str(r.HospitalName),
      }),
    )
    .sort((a, b) => (b.orderedAt ?? '').localeCompare(a.orderedAt ?? ''));
}

export type ValueFlag = 'PANIC LOW' | 'PANIC HIGH' | 'LOW' | 'HIGH' | 'NORMAL';

export interface LabValue {
  parameter?: string;
  value?: string;
  unit?: string;
  normalRange?: string;
  /** Computed in code from the HIS reference and panic limits; absent when the value is not numeric. */
  flag?: ValueFlag;
  previousValue?: string;
}

function num(value: unknown): number | undefined {
  const s = str(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Compares a numeric value with the HIS limits. Panic limits of 0 mean "not set"; a reference
 * range of 0–0 means "not set".
 */
export function flagValue(
  value: unknown,
  limits: { min?: unknown; max?: unknown; panicMin?: unknown; panicMax?: unknown },
): ValueFlag | undefined {
  const v = num(value);
  if (v === undefined) return undefined;

  const panicMin = num(limits.panicMin);
  const panicMax = num(limits.panicMax);
  let min = num(limits.min);
  let max = num(limits.max);
  if (min === 0 && max === 0) min = max = undefined;

  if (panicMin !== undefined && panicMin > 0 && v < panicMin) return 'PANIC LOW';
  if (panicMax !== undefined && panicMax > 0 && v > panicMax) return 'PANIC HIGH';
  if (min !== undefined && v < min) return 'LOW';
  if (max !== undefined && v > max) return 'HIGH';
  return min !== undefined || max !== undefined ? 'NORMAL' : undefined;
}

/** Parameters that have a value, in the lab's display order. */
export function normalizeLabComponents(raw: RawLabComponentsResponse): LabValue[] {
  return (raw.FetchLabTestComponentsListM ?? [])
    .filter((c) => str(c.TextValue) !== undefined)
    .sort((a, b) => (num(a.Seq) ?? 0) - (num(b.Seq) ?? 0))
    .map((c) => {
      const min = str(c.MinLimit);
      const max = str(c.MaxLimit);
      const rangeFromLimits = min !== undefined && max !== undefined && !(min === '0' && max === '0') ? `${min} - ${max}` : undefined;
      return compact({
        parameter: str(c.ParameterName),
        value: str(c.TextValue),
        unit: str(c.Unitname),
        normalRange: str(c.RRValue)?.replace(/\s*\n\s*/g, '; ') ?? rangeFromLimits,
        flag: flagValue(c.TextValue, { min: c.MinLimit, max: c.MaxLimit, panicMin: c.PanicMin, panicMax: c.PanicMax }),
        previousValue: str(c.PrevTextValue),
      });
    });
}
