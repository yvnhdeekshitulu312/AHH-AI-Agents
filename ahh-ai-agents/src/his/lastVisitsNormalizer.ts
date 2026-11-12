import { compact, flagValue, isTruthyFlag, normalizeHisDate, str, visitType, type ValueFlag } from './normalizers.js';
import type { RawLastVisitsInfoResponse, RawLastVisitTestResult } from './types.js';

/**
 * Reduces the PatientLastVisitsInfo payload to what the visit summary shows and what the LLM reads.
 * This is the PHI filter for the summary: SSN, patient name, UHID, photo and staff names are never copied.
 * Every item gets a short id (v1, dx1, rx1, lab1, al1, ...) that the LLM's highlights must cite.
 *
 * Verified against a real response (2026-11-10): the API returns the patient's LATEST admission only,
 * which can be the admission open right now (long-stay inpatients), with every medicine and result row
 * of that admission (thousands of rows, mostly daily re-prescriptions and repeated labs). So:
 * - the open admission is kept and marked `isCurrent`;
 * - medicines are reduced to one row per drug (latest prescription), running ones first;
 * - results are reduced to the latest value per test, from the most recent window of results;
 * - repeated (copied) notes are collapsed.
 */

export const SUMMARY_LIMITS = {
  visits: 3,
  medications: 40,
  /** Results kept from this many days before the newest result in the data. */
  resultDays: 30,
  labResults: 40,
  /** Radiology / procedure reports (long text) kept. */
  reports: 5,
  notesPerVisit: 2,
  surgeries: 5,
  noteChars: 800,
  reportChars: 300,
} as const;

export interface SummaryVisit {
  id: string;
  /** The admission open in the case sheet right now. */
  isCurrent?: boolean;
  date?: string;
  dischargeDate?: string;
  visitType?: string;
  hospital?: string;
  doctor?: string;
  specialty?: string;
  admissionId?: string;
  disposition?: string;
  dischargeStatus?: string;
  remarks?: string;
}

export interface SummaryNote {
  id: string;
  visitId: string;
  date?: string;
  doctor?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  examination?: string;
  assessmentPlan?: string;
}

export interface SummaryDiagnosis {
  id: string;
  visitId: string;
  diagnosis: string;
  icdCode?: string;
  type?: string;
  status?: string;
  remarks?: string;
}

export interface SummaryMedication {
  id: string;
  visitId: string;
  name: string;
  dose?: string;
  strength?: string;
  route?: string;
  frequency?: string;
  startFrom?: string;
  endAt?: string;
  prescribedOn?: string;
  remarks?: string;
  /** End date is today or later (or not set). */
  active: boolean;
  onHold?: boolean;
  /** Shown as a warning; the row is kept so the doctor sees it was stopped. */
  discontinued?: boolean;
}

export interface SummaryResult {
  id: string;
  visitId: string;
  kind: 'lab' | 'radiology' | 'procedure';
  date?: string;
  test?: string;
  parameter?: string;
  value?: string;
  unit?: string;
  normalRange?: string;
  /** Numeric labs: computed from the HIS reference and panic limits. Absent for text results. */
  flag?: ValueFlag;
  /** From the HIS limits (numeric) or the HIS order flag (text results); never decided by the LLM. */
  panic: boolean;
  /** From the HIS limits (numeric) or the HIS order flag (text results); never decided by the LLM. */
  abnormal: boolean;
  /** The value before this one for the same test, when present. */
  previousValue?: string;
  previousDate?: string;
}

export interface SummarySurgery {
  id: string;
  date?: string;
  name?: string;
  code?: string;
  surgeon?: string;
  type?: string;
  hospital?: string;
}

export interface SummaryAllergy {
  id: string;
  type?: string;
  allergen: string;
}

export interface SummaryVitals {
  id: string;
  date?: string;
  bp?: string;
  pulse?: string;
  respiration?: string;
  spo2?: string;
  temperature?: string;
  consciousness?: string;
  o2FlowRate?: string;
}

export interface VisitSummaryData {
  /** Age and gender only (from the latest visit row); never name, UHID or ids. */
  patient?: { age?: string; gender?: string };
  visits: SummaryVisit[];
  notes: SummaryNote[];
  diagnoses: SummaryDiagnosis[];
  medications: SummaryMedication[];
  results: SummaryResult[];
  surgeries: SummarySurgery[];
  allergies: SummaryAllergy[];
  latestVitals?: SummaryVitals;
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Plain text from an HTML note: tags removed, common entities decoded, whitespace collapsed, length capped. */
export function plainText(value: unknown, maxChars: number): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  const text = s
    .replace(/<(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** "1.00000" → "1", "70.50000" → "70.5"; anything that is not a plain decimal is returned trimmed. */
export function tidyNumber(value: unknown): string | undefined {
  const s = str(value);
  if (s === undefined || !/^-?\d+\.\d+$/.test(s)) return s;
  return String(Number(s));
}

/** "[mg/dL]" → "mg/dL". */
function tidyUnit(value: unknown): string | undefined {
  return str(str(value)?.replace(/^\[(.*)\]$/, '$1'));
}

const desc = (a?: string, b?: string) => (b ?? '').localeCompare(a ?? '');

/** "2026-10-02 10:15" minus `days`, as "YYYY-MM-DD". */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function range(min: unknown, max: unknown): string | undefined {
  const lo = tidyNumber(min);
  const hi = tidyNumber(max);
  if (lo === undefined || hi === undefined || (lo === '0' && hi === '0')) return undefined;
  return `${lo} - ${hi}`;
}

function joinParts(...parts: (string | undefined)[]): string | undefined {
  return parts.filter(Boolean).join(' ') || undefined;
}

/**
 * @param currentAdmissionId the admission open in the case sheet (marked `isCurrent`).
 * @param today "YYYY-MM-DD" in hospital time; decides which medicines are still active.
 */
export function normalizeLastVisitsInfo(
  raw: RawLastVisitsInfoResponse,
  currentAdmissionId: string | undefined,
  today: string,
): VisitSummaryData {
  // ── Visits (newest first; the API currently returns only the latest one) ──
  const visits: SummaryVisit[] = (raw.PatientClinicalEpisodeMetricsModelDataList ?? [])
    .map((v) => ({
      isCurrent: currentAdmissionId !== undefined && str(v.AdmissionID) === currentAdmissionId ? true : undefined,
      date: normalizeHisDate(v.VisitDate),
      dischargeDate: normalizeHisDate(v.DischargeDate),
      visitType: visitType(undefined, v.PatientType),
      hospital: str(v.HospitalName),
      doctor: str(v.DoctorName),
      specialty: str(v.SpecialisationName),
      admissionId: str(v.AdmissionID),
      disposition: str(v.Disposition),
      dischargeStatus: str(v.DischargeStatus),
      remarks: plainText(v.EpisodeRemarks, SUMMARY_LIMITS.noteChars),
    }))
    .sort((a, b) => desc(a.date, b.date))
    // The same admission can appear once per hospital row; keep the first.
    .filter((v, i, all) => !v.admissionId || all.findIndex((o) => o.admissionId === v.admissionId) === i)
    .slice(0, SUMMARY_LIMITS.visits)
    .map((v, i) => compact({ id: `v${i + 1}`, ...v }));

  const visitIdByAdmission = new Map(visits.filter((v) => v.admissionId).map((v) => [v.admissionId!, v.id]));
  const visitIdFor = (admissionId: unknown) => visitIdByAdmission.get(str(admissionId) ?? '');

  // ── Notes: newest first, identical (copied) notes collapsed ──
  const notes: SummaryNote[] = [];
  const seenNotes = new Set<string>();
  const perVisit = new Map<string, number>();
  const examRows = [...(raw.PatientClinicalExaminationMetricsModelDataList ?? [])]
    .map((e) => ({ e, date: normalizeHisDate(e.Createdate) ?? normalizeHisDate(e.VisitDate) }))
    .sort((a, b) => desc(a.date, b.date));
  for (const { e, date } of examRows) {
    const visitId = visitIdFor(e.Admissionid);
    if (!visitId || isTruthyFlag(e.Blocked)) continue;
    if ((perVisit.get(visitId) ?? 0) >= SUMMARY_LIMITS.notesPerVisit) continue;
    const body = {
      chiefComplaint: plainText(e.ChiefComplaint, SUMMARY_LIMITS.noteChars),
      historyOfPresentIllness: plainText(e.HistoryofPresentIllness, SUMMARY_LIMITS.noteChars),
      examination: plainText(e.PhysicalExamination, SUMMARY_LIMITS.noteChars),
      assessmentPlan: plainText(e.AssessmentPlan, SUMMARY_LIMITS.noteChars),
    };
    if (!body.chiefComplaint && !body.historyOfPresentIllness && !body.examination && !body.assessmentPlan) continue;
    const key = `${visitId}|${JSON.stringify(body)}`;
    if (seenNotes.has(key)) continue;
    seenNotes.add(key);
    perVisit.set(visitId, (perVisit.get(visitId) ?? 0) + 1);
    notes.push(compact({ id: `n${notes.length + 1}`, visitId, date, doctor: str(e.DoctorName), ...body }));
  }

  // ── Diagnoses (blocked excluded, as in normalizeDiagnoses) ──
  const seenDx = new Set<string>();
  const diagnoses: SummaryDiagnosis[] = [];
  for (const d of raw.PatientDiagnosisMetricsModelDataList ?? []) {
    const visitId = visitIdFor(d.AdmissionID);
    const diagnosis = str(d.DiseaseName);
    if (!visitId || !diagnosis || isTruthyFlag(d.Blocked)) continue;
    const key = `${visitId}|${diagnosis.toLowerCase()}`;
    if (seenDx.has(key)) continue;
    seenDx.add(key);
    diagnoses.push(
      compact({
        id: `dx${diagnoses.length + 1}`,
        visitId,
        diagnosis,
        icdCode: str(d.Code),
        // DiagonosisType holds the name ("Primary"); DiagnosisType is a numeric code.
        type: str(d.DiagonosisType) ?? str(d.DiagnosisType),
        status: str(d.DiagnosisStatus),
        remarks: plainText(d.Remarks, 200),
      }),
    );
  }

  // ── Medicines: one row per drug (latest prescription), active first, blocked excluded ──
  const latestByDrug = new Map<string, { m: NonNullable<RawLastVisitsInfoResponse['MedicationPrescriptionHeaderMetricsModelDataList']>[number]; visitId: string; prescribedOn?: string }>();
  for (const m of raw.MedicationPrescriptionHeaderMetricsModelDataList ?? []) {
    const visitId = visitIdFor(m.Admissionid);
    const name = str(m.ItemName);
    if (!visitId || !name || isTruthyFlag(m.Blocked)) continue;
    const prescribedOn = normalizeHisDate(m.PrescriptionDate);
    const key = name.toLowerCase();
    const prev = latestByDrug.get(key);
    if (!prev || (prescribedOn ?? '') > (prev.prescribedOn ?? '')) latestByDrug.set(key, { m, visitId, prescribedOn });
  }
  const medications: SummaryMedication[] = [...latestByDrug.values()]
    .map(({ m, visitId, prescribedOn }) => {
      const endAt = normalizeHisDate(m.EndDateTime);
      const dose = joinParts(tidyNumber(m.Dose), str(m.DoseUoM));
      const strength = joinParts(tidyNumber(m.Strength), str(m.StrengthUOM));
      return {
        visitId,
        name: str(m.ItemName)!,
        dose,
        strength: strength !== dose ? strength : undefined,
        route: str(m.AdmRoute),
        frequency: str(m.Frequency),
        startFrom: normalizeHisDate(m.StartFrom),
        endAt,
        prescribedOn,
        remarks: plainText(m.Remarks, 200),
        active: !endAt || endAt.slice(0, 10) >= today,
        onHold: isTruthyFlag(m.HoldStatus) ? true : undefined,
        discontinued: str(m.DiscontinuingRemarks) ? true : undefined,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || desc(a.prescribedOn, b.prescribedOn))
    .slice(0, SUMMARY_LIMITS.medications)
    .map((m, i) => compact({ id: `rx${i + 1}`, ...m }));

  // ── Results: latest value per test in the recent window; panic, abnormal, then newest ──
  // IsPanic / IsAbnormal in this API are ORDER-level (every row of an order carries the same value;
  // verified 2026-11-10). So for numeric values the flag is computed from the HIS reference and panic
  // limits, exactly as getLabValues does; the order flag is used only for text results (cultures, reports).
  type Row = Omit<SummaryResult, 'id'>;
  const toRow = (kind: SummaryResult['kind'], maxChars: number) => (r: RawLastVisitTestResult): Row & { numeric: boolean; orderItem?: string } => {
    const value = kind === 'lab' ? tidyNumber(plainText(r.Value, maxChars)) : plainText(r.Value, maxChars);
    const flag = kind === 'lab' ? flagValue(value, { min: r.MinLimit, max: r.MaxLimit, panicMin: r.PanicMin, panicMax: r.PanicMax }) : undefined;
    const numeric = kind === 'lab' && value !== undefined && Number.isFinite(Number(value));
    return compact({
      kind,
      date: normalizeHisDate(r.ResultVerifiedAt) ?? normalizeHisDate(r.OrderDate),
      test: str(r.TestName),
      parameter: str(r.ParameterName),
      value,
      unit: tidyUnit(r.UOM),
      normalRange: range(r.MinLimit, r.MaxLimit),
      flag,
      panic: numeric ? flag?.startsWith('PANIC') === true : isTruthyFlag(r.IsPanic),
      abnormal: numeric ? flag !== undefined && flag !== 'NORMAL' : isTruthyFlag(r.IsAbnormal),
      numeric,
      orderItem: str(r.TestOrderItemID),
    });
  };

  /** Drops text rows inside numeric tests (REMARKS, SAMPLE, ...) and raw machine data (sensitivity XML). */
  const dropNoise = <T extends Row & { numeric: boolean; orderItem?: string }>(rows: T[]): Row[] => {
    const numericOrders = new Set(rows.filter((r) => r.numeric && r.orderItem).map((r) => r.orderItem!));
    return rows
      .filter((r) => r.numeric || !r.orderItem || !numericOrders.has(r.orderItem))
      .filter((r) => !/&lt;|<\w+>/.test(r.value ?? ''))
      .map(({ numeric: _n, orderItem: _o, ...row }) => row);
  };
  const rank = (r: Row) => (r.panic ? 0 : r.abnormal ? 1 : 2);

  /** Latest row per test (with the previous value), within `resultDays` of the newest row. */
  const latestPerTest = (rows: Row[]): Row[] => {
    const withValue = rows.filter((r) => r.value !== undefined && r.date);
    const newest = withValue.reduce((max, r) => (r.date! > max ? r.date! : max), '');
    if (!newest) return [];
    const cutoff = minusDays(newest, SUMMARY_LIMITS.resultDays);
    const byTest = new Map<string, Row[]>();
    for (const r of withValue) {
      const key = `${r.test ?? ''}|${r.parameter ?? ''}`.toLowerCase();
      byTest.set(key, [...(byTest.get(key) ?? []), r]);
    }
    const latest: Row[] = [];
    for (const group of byTest.values()) {
      group.sort((a, b) => desc(a.date, b.date));
      const [last, prev] = group;
      if (!last || last.date! < cutoff) continue;
      latest.push(prev ? { ...last, previousValue: prev.value, previousDate: prev.date } : last);
    }
    return latest.sort((a, b) => rank(a) - rank(b) || desc(a.date, b.date));
  };

  const labs = latestPerTest(dropNoise((raw.LabTestResultDetailMetricsModelDataList ?? []).map(toRow('lab', 100))));
  const labPanics = labs.filter((r) => r.panic).length;
  const reports = latestPerTest(
    dropNoise([
      ...(raw.RadiologyTestResultDetailMetricsModelDataList ?? []).map(toRow('radiology', SUMMARY_LIMITS.reportChars)),
      ...(raw.ProcedureTestResultDetailMetricsModelDataList ?? []).map(toRow('procedure', SUMMARY_LIMITS.reportChars)),
    ]),
  );
  const reportPanics = reports.filter((r) => r.panic).length;
  // Never cut a panic result to fit a limit.
  const results: SummaryResult[] = [
    ...labs.slice(0, Math.max(SUMMARY_LIMITS.labResults, labPanics)),
    ...reports.slice(0, Math.max(SUMMARY_LIMITS.reports, reportPanics)),
  ]
    .map((r) => (r.kind === 'lab' ? r : { ...r, previousValue: undefined, previousDate: undefined }))
    .map((r, i) => compact({ id: `lab${i + 1}`, ...r }));

  // ── Surgeries (the same surgery can appear twice) ──
  const surgeries: SummarySurgery[] = (raw.PatientSurgeryTrackingMetricsModelDataList ?? [])
    .map((s) => ({
      date: normalizeHisDate(s.SurgeryDate),
      name: str(s.SurgeryName),
      code: str(s.Code),
      surgeon: str(s.DoctorName),
      type: str(s.SurgeryType),
      hospital: str(s.HospitalName),
    }))
    .filter((s) => s.name)
    .filter((s, i, all) => all.findIndex((o) => o.name === s.name && o.date === s.date) === i)
    .sort((a, b) => desc(a.date, b.date))
    .slice(0, SUMMARY_LIMITS.surgeries)
    .map((s, i) => compact({ id: `sx${i + 1}`, ...s }));

  // ── Allergies: all of them, never capped ──
  const seenAllergy = new Set<string>();
  const allergies: SummaryAllergy[] = [];
  for (const a of raw.PatientAllergyDetailsModelDataList ?? []) {
    const allergen = str(a.AllergyName);
    if (!allergen || seenAllergy.has(allergen.toLowerCase())) continue;
    seenAllergy.add(allergen.toLowerCase());
    allergies.push(compact({ id: `al${allergies.length + 1}`, type: str(a.TypeOfallergy), allergen }));
  }

  // ── Latest vitals ──
  const v = [...(raw.PatientVitalsMetricsModelDataList ?? [])]
    .map((r) => ({ r, date: normalizeHisDate(r.VitalSignDate) }))
    .sort((a, b) => desc(a.date, b.date))[0];
  const bp = v && str(v.r.BPSystolic) && str(v.r.BPDiastolic) ? `${str(v.r.BPSystolic)}/${str(v.r.BPDiastolic)}` : undefined;
  const latestVitals = v
    ? compact({
        id: 'vt1',
        date: v.date,
        bp,
        pulse: tidyNumber(v.r.Pulse),
        respiration: tidyNumber(v.r.Respiration),
        spo2: tidyNumber(v.r.SPO2),
        temperature: tidyNumber(v.r.Temperature),
        consciousness: str(v.r.Consciousness),
        o2FlowRate: tidyNumber(v.r.O2FlowRate),
      })
    : undefined;

  const latestEpisode = [...(raw.PatientClinicalEpisodeMetricsModelDataList ?? [])].sort((a, b) =>
    desc(normalizeHisDate(a.VisitDate), normalizeHisDate(b.VisitDate)),
  )[0];
  const patientInfo = latestEpisode ? compact({ age: str(latestEpisode.FullAge), gender: str(latestEpisode.Gender) }) : undefined;
  const patient = patientInfo && Object.keys(patientInfo).length ? patientInfo : undefined;

  return compact({ patient, visits, notes, diagnoses, medications, results, surgeries, allergies, latestVitals });
}

/** Every id the LLM is allowed to cite. */
export function summaryIds(data: VisitSummaryData): Set<string> {
  const ids = [
    ...data.visits,
    ...data.notes,
    ...data.diagnoses,
    ...data.medications,
    ...data.results,
    ...data.surgeries,
    ...data.allergies,
    ...(data.latestVitals ? [data.latestVitals] : []),
  ].map((x) => x.id);
  return new Set(ids);
}
