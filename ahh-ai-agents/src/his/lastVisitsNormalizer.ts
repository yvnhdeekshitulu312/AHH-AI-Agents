import { compact, flagValue, isTruthyFlag, normalizeHisDate, str, visitType, type ValueFlag } from './normalizers.js';
import type { RawLastVisitsInfoResponse, RawLastVisitTestResult } from './types.js';

/**
 * Turns the PatientLastVisitsInfo payload into the visit summary data.
 *
 * Two steps, because the card and the LLM need different amounts of it:
 *
 * 1. `normalizeLastVisitsInfo` keeps EVERY clinical row the API returns, uncapped and in display order
 *    (newest first), so the card can show the whole record. It is still the PHI filter: SSN, patient name,
 *    UHID, photo and staff names are never copied, and rows the HIS marks `Blocked` (deleted or
 *    confidential) are left out. Every item gets a short id (v1, dx1, rx1, lab1, al1, ...).
 * 2. `reduceForModel` picks the subset that goes into the LLM prompt and KEEPS THE IDS of step 1, so a
 *    highlight citing `lab7` resolves against the full data the card holds. Without it the prompt would
 *    carry the whole payload (9.7 MB for a long-stay inpatient, verified 2026-11-10).
 *
 * What the API returns, verified against a real response (2026-11-10): the patient's LATEST admission only,
 * which can be the admission open right now (long-stay inpatients), with every medicine and result row of
 * that admission (thousands of rows, mostly daily re-prescriptions and repeated labs).
 */

/** Caps and windows for the LLM prompt only (`reduceForModel`); the returned data is never capped. */
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
  remarkChars: 200,
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
  /** The visit this row belongs to; absent when its admission is not in `visits`. */
  visitId?: string;
  date?: string;
  doctor?: string;
  specialty?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  examination?: string;
  assessmentPlan?: string;
}

export interface SummaryDiagnosis {
  id: string;
  visitId?: string;
  date?: string;
  diagnosis: string;
  icdCode?: string;
  type?: string;
  status?: string;
  doctor?: string;
  remarks?: string;
}

export interface SummaryMedication {
  id: string;
  visitId?: string;
  name: string;
  dose?: string;
  strength?: string;
  route?: string;
  frequency?: string;
  startFrom?: string;
  endAt?: string;
  prescribedOn?: string;
  doctor?: string;
  hospital?: string;
  /** Prescription or order ("Prescription", "Order", ...) as the HIS reports it. */
  orderType?: string;
  remarks?: string;
  /** End date is today or later (or not set). */
  active: boolean;
  onHold?: boolean;
  /** Shown as a warning; the row is kept so the doctor sees it was stopped. */
  discontinued?: boolean;
  discontinuedReason?: string;
}

export interface SummaryResult {
  id: string;
  /**
   * The visit this result belongs to, matched on the row's AdmissionID. Absent when that admission is not
   * among the visits the API returned (the result is still shown, never dropped over the join).
   */
  visitId?: string;
  kind: 'lab' | 'radiology' | 'procedure';
  date?: string;
  orderDate?: string;
  test?: string;
  department?: string;
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
  /** The value before this one for the same test (labs only), when present. */
  previousValue?: string;
  previousDate?: string;
  /** HIS order item the parameter belongs to; lets the card group the parameters of one order. */
  testOrderItemId?: string;
}

export interface SummarySurgery {
  id: string;
  visitId?: string;
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
  /** Every vitals row, newest first. */
  vitals: SummaryVitals[];
  /** `vitals[0]`, repeated for callers that only show the latest set. */
  latestVitals?: SummaryVitals;
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Plain text from an HTML note: tags removed, common entities decoded, whitespace collapsed, length capped. */
export function plainText(value: unknown, maxChars = Number.POSITIVE_INFINITY): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  const text = s
    .replace(/<(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
  return cap(text, maxChars);
}

/** Caps already-plain text, with an ellipsis when it was cut. */
function cap(text: string | undefined, maxChars: number): string | undefined {
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/** "1.00000" -> "1", "70.50000" -> "70.5"; anything that is not a plain decimal is returned trimmed. */
export function tidyNumber(value: unknown): string | undefined {
  const s = str(value);
  if (s === undefined || !/^-?\d+\.\d+$/.test(s)) return s;
  return String(Number(s));
}

/** "[mg/dL]" -> "mg/dL". */
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

/** Keys a result row by its test and parameter, for the per-test series. */
const testKey = (r: { test?: string; parameter?: string }) => `${r.test ?? ''}|${r.parameter ?? ''}`.toLowerCase();

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/**
 * Every clinical row the API returned, newest first, with no caps, windows or de-duplication.
 * Left out: `Blocked` rows (the HIS deleted or hid them), rows with no content at all, and every field
 * that is not whitelisted here (PHI).
 *
 * @param currentAdmissionId the admission open in the case sheet (marked `isCurrent`).
 * @param today "YYYY-MM-DD" in hospital time; decides which medicines are still active.
 */
export function normalizeLastVisitsInfo(
  raw: RawLastVisitsInfoResponse,
  currentAdmissionId: string | undefined,
  today: string,
): VisitSummaryData {
  // -- Visits: every episode, newest first (one row per admission: the API repeats it per hospital row) --
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
      remarks: plainText(v.EpisodeRemarks),
    }))
    .sort((a, b) => desc(a.date, b.date))
    .filter((v, i, all) => !v.admissionId || all.findIndex((o) => o.admissionId === v.admissionId) === i)
    .map((v, i) => compact({ id: `v${i + 1}`, ...v }));

  const visitIdByAdmission = new Map(visits.filter((v) => v.admissionId).map((v) => [v.admissionId!, v.id]));
  const visitIdFor = (admissionId: unknown) => visitIdByAdmission.get(str(admissionId) ?? '');

  // -- Notes: every examination row, newest first (the HIS copies a note forward; all copies are kept) --
  const notes: SummaryNote[] = (raw.PatientClinicalExaminationMetricsModelDataList ?? [])
    .filter((e) => !isTruthyFlag(e.Blocked))
    .map((e) => ({
      visitId: visitIdFor(e.Admissionid),
      date: normalizeHisDate(e.Createdate) ?? normalizeHisDate(e.VisitDate),
      doctor: str(e.DoctorName),
      specialty: str(e.Specialisation),
      chiefComplaint: plainText(e.ChiefComplaint),
      historyOfPresentIllness: plainText(e.HistoryofPresentIllness),
      examination: plainText(e.PhysicalExamination),
      assessmentPlan: plainText(e.AssessmentPlan),
    }))
    .filter((n) => n.chiefComplaint ?? n.historyOfPresentIllness ?? n.examination ?? n.assessmentPlan)
    .sort((a, b) => desc(a.date, b.date))
    .map((n, i) => compact({ id: `n${i + 1}`, ...n }));

  // -- Diagnoses: every row (blocked excluded), newest first --
  const diagnoses: SummaryDiagnosis[] = (raw.PatientDiagnosisMetricsModelDataList ?? [])
    .filter((d) => !isTruthyFlag(d.Blocked) && str(d.DiseaseName))
    .map((d) => ({
      visitId: visitIdFor(d.AdmissionID),
      date: normalizeHisDate(d.CreateDate),
      diagnosis: str(d.DiseaseName)!,
      icdCode: str(d.Code),
      // DiagonosisType holds the name ("Primary"); DiagnosisType is a numeric code.
      type: str(d.DiagonosisType) ?? str(d.DiagnosisType),
      status: str(d.DiagnosisStatus),
      doctor: str(d.DoctorName),
      remarks: plainText(d.Remarks),
    }))
    .sort((a, b) => desc(a.date, b.date))
    .map((d, i) => compact({ id: `dx${i + 1}`, ...d }));

  // -- Medicines: every prescription row (blocked excluded), newest prescription first --
  const medications: SummaryMedication[] = (raw.MedicationPrescriptionHeaderMetricsModelDataList ?? [])
    .filter((m) => !isTruthyFlag(m.Blocked) && str(m.ItemName))
    .map((m) => {
      const endAt = normalizeHisDate(m.EndDateTime);
      const dose = joinParts(tidyNumber(m.Dose), str(m.DoseUoM));
      const strength = joinParts(tidyNumber(m.Strength), str(m.StrengthUOM));
      return {
        visitId: visitIdFor(m.Admissionid),
        name: str(m.ItemName)!,
        dose,
        strength: strength !== dose ? strength : undefined,
        route: str(m.AdmRoute),
        frequency: str(m.Frequency),
        startFrom: normalizeHisDate(m.StartFrom),
        endAt,
        prescribedOn: normalizeHisDate(m.PrescriptionDate),
        doctor: str(m.Doctorname),
        hospital: str(m.HospitalName),
        orderType: str(m.Type),
        remarks: plainText(m.Remarks),
        active: !endAt || endAt.slice(0, 10) >= today,
        onHold: isTruthyFlag(m.HoldStatus) ? true : undefined,
        discontinued: str(m.DiscontinuingRemarks) ? true : undefined,
        discontinuedReason: plainText(m.DiscontinuingRemarks),
      };
    })
    .sort((a, b) => desc(a.prescribedOn, b.prescribedOn) || a.name.localeCompare(b.name))
    .map((m, i) => compact({ id: `rx${i + 1}`, ...m }));

  // -- Results: every lab, radiology and procedure row, newest first within each kind --
  // IsPanic / IsAbnormal in this API are ORDER-level (every row of an order carries the same value;
  // verified 2026-11-10). So for numeric values the flag is computed from the HIS reference and panic
  // limits, exactly as getLabValues does; the order flag is used only for text results (cultures, reports).
  type Row = Omit<SummaryResult, 'id'>;
  const toRow = (kind: SummaryResult['kind']) => (r: RawLastVisitTestResult): Row => {
    const value = kind === 'lab' ? tidyNumber(plainText(r.Value)) : plainText(r.Value);
    const flag =
      kind === 'lab' ? flagValue(value, { min: r.MinLimit, max: r.MaxLimit, panicMin: r.PanicMin, panicMax: r.PanicMax }) : undefined;
    const numeric = kind === 'lab' && value !== undefined && Number.isFinite(Number(value));
    return compact({
      visitId: visitIdFor(r.AdmissionID ?? r.Admissionid),
      kind,
      date: normalizeHisDate(r.ResultVerifiedAt) ?? normalizeHisDate(r.OrderDate),
      orderDate: normalizeHisDate(r.OrderDate),
      test: str(r.TestName),
      department: str(r.DepartmentName),
      parameter: str(r.ParameterName),
      value,
      unit: tidyUnit(r.UOM),
      normalRange: range(r.MinLimit, r.MaxLimit),
      flag,
      panic: numeric ? flag?.startsWith('PANIC') === true : isTruthyFlag(r.IsPanic),
      abnormal: numeric ? flag !== undefined && flag !== 'NORMAL' : isTruthyFlag(r.IsAbnormal),
      testOrderItemId: str(r.TestOrderItemID),
    });
  };

  const byDateDesc = (rows: Row[]) => rows.sort((a, b) => desc(a.date, b.date));
  const labRows = byDateDesc((raw.LabTestResultDetailMetricsModelDataList ?? []).map(toRow('lab')));
  // Each lab row carries the value before it for the same test, so a trend is visible without a second call.
  for (const group of groupBy(labRows, testKey).values()) {
    group.forEach((row, i) => {
      const previous = group.slice(i + 1).find((p) => p.value !== undefined);
      if (!previous) return;
      row.previousValue = previous.value;
      row.previousDate = previous.date;
    });
  }
  const results: SummaryResult[] = [
    ...labRows,
    ...byDateDesc((raw.RadiologyTestResultDetailMetricsModelDataList ?? []).map(toRow('radiology'))),
    ...byDateDesc((raw.ProcedureTestResultDetailMetricsModelDataList ?? []).map(toRow('procedure'))),
  ].map((r, i) => compact({ id: `lab${i + 1}`, ...r }));

  // -- Surgeries: every row, newest first --
  const surgeries: SummarySurgery[] = (raw.PatientSurgeryTrackingMetricsModelDataList ?? [])
    .filter((s) => str(s.SurgeryName))
    .map((s) => ({
      visitId: visitIdFor(s.AdmissionID),
      date: normalizeHisDate(s.SurgeryDate),
      name: str(s.SurgeryName),
      code: str(s.Code),
      surgeon: str(s.DoctorName),
      type: str(s.SurgeryType),
      hospital: str(s.HospitalName),
    }))
    .sort((a, b) => desc(a.date, b.date))
    .map((s, i) => compact({ id: `sx${i + 1}`, ...s }));

  // -- Allergies: every row, in the order the HIS returns them --
  const allergies: SummaryAllergy[] = (raw.PatientAllergyDetailsModelDataList ?? [])
    .filter((a) => str(a.AllergyName))
    .map((a, i) => compact({ id: `al${i + 1}`, type: str(a.TypeOfallergy), allergen: str(a.AllergyName)! }));

  // -- Vitals: every row, newest first (vt1 is the latest set) --
  const vitals: SummaryVitals[] = (raw.PatientVitalsMetricsModelDataList ?? [])
    .map((r) => ({
      date: normalizeHisDate(r.VitalSignDate),
      bp: str(r.BPSystolic) && str(r.BPDiastolic) ? `${str(r.BPSystolic)}/${str(r.BPDiastolic)}` : undefined,
      pulse: tidyNumber(r.Pulse),
      respiration: tidyNumber(r.Respiration),
      spo2: tidyNumber(r.SPO2),
      temperature: tidyNumber(r.Temperature),
      consciousness: str(r.Consciousness),
      o2FlowRate: tidyNumber(r.O2FlowRate),
    }))
    .sort((a, b) => desc(a.date, b.date))
    .map((v, i) => compact({ id: `vt${i + 1}`, ...v }));

  const latestEpisode = [...(raw.PatientClinicalEpisodeMetricsModelDataList ?? [])].sort((a, b) =>
    desc(normalizeHisDate(a.VisitDate), normalizeHisDate(b.VisitDate)),
  )[0];
  const patientInfo = latestEpisode ? compact({ age: str(latestEpisode.FullAge), gender: str(latestEpisode.Gender) }) : undefined;
  const patient = patientInfo && Object.keys(patientInfo).length ? patientInfo : undefined;

  return compact({ patient, visits, notes, diagnoses, medications, results, surgeries, allergies, vitals, latestVitals: vitals[0] });
}

/**
 * The subset of `normalizeLastVisitsInfo` that goes into the LLM prompt, with the ids unchanged, so every
 * cited id also exists in the full data. Long text is cut here, not in the data the card shows.
 *
 * - the newest `SUMMARY_LIMITS.visits` visits, and only the notes, diagnoses, medicines of those;
 * - notes: at most 2 per visit, copied (identical) notes collapsed;
 * - medicines: one row per drug (the latest prescription), running ones first;
 * - results: the latest value per test from the most recent `resultDays`, noise rows dropped, panic first;
 * - vitals: the latest set only.
 */
export function reduceForModel(data: VisitSummaryData): VisitSummaryData {
  const visits = data.visits.slice(0, SUMMARY_LIMITS.visits);
  const keptVisit = new Set(visits.map((v) => v.id));
  const ofKeptVisit = <T extends { visitId?: string }>(row: T) => row.visitId !== undefined && keptVisit.has(row.visitId);

  // Notes: at most 2 per visit; the HIS copies a note forward unchanged, so identical bodies count once.
  const notes: SummaryNote[] = [];
  const seenNote = new Set<string>();
  const perVisit = new Map<string, number>();
  for (const n of data.notes.filter(ofKeptVisit)) {
    const body = {
      chiefComplaint: cap(n.chiefComplaint, SUMMARY_LIMITS.noteChars),
      historyOfPresentIllness: cap(n.historyOfPresentIllness, SUMMARY_LIMITS.noteChars),
      examination: cap(n.examination, SUMMARY_LIMITS.noteChars),
      assessmentPlan: cap(n.assessmentPlan, SUMMARY_LIMITS.noteChars),
    };
    const visitId = n.visitId!;
    const key = `${visitId}|${JSON.stringify(body)}`;
    if (seenNote.has(key) || (perVisit.get(visitId) ?? 0) >= SUMMARY_LIMITS.notesPerVisit) continue;
    seenNote.add(key);
    perVisit.set(visitId, (perVisit.get(visitId) ?? 0) + 1);
    notes.push(compact({ id: n.id, visitId, date: n.date, doctor: n.doctor, ...body }));
  }

  // Diagnoses: once per visit and disease.
  const seenDx = new Set<string>();
  const diagnoses = data.diagnoses.filter(ofKeptVisit).filter((d) => {
    const key = `${d.visitId}|${d.diagnosis.toLowerCase()}`;
    if (seenDx.has(key)) return false;
    seenDx.add(key);
    return true;
  });

  // Medicines: the latest prescription per drug, running ones first.
  const latestByDrug = new Map<string, SummaryMedication>();
  for (const m of data.medications.filter(ofKeptVisit)) {
    const key = m.name.toLowerCase();
    const previous = latestByDrug.get(key);
    if (!previous || (m.prescribedOn ?? '') > (previous.prescribedOn ?? '')) latestByDrug.set(key, m);
  }
  const medications = [...latestByDrug.values()]
    .sort((a, b) => Number(b.active) - Number(a.active) || desc(a.prescribedOn, b.prescribedOn))
    .slice(0, SUMMARY_LIMITS.medications);

  /** Drops text rows inside numeric tests (REMARKS, SAMPLE, ...) and raw machine data (sensitivity XML). */
  const isNumeric = (r: SummaryResult) => r.kind === 'lab' && r.value !== undefined && Number.isFinite(Number(r.value));
  const dropNoise = (rows: SummaryResult[]): SummaryResult[] => {
    const numericOrders = new Set(rows.filter((r) => isNumeric(r) && r.testOrderItemId).map((r) => r.testOrderItemId!));
    return rows
      .filter((r) => isNumeric(r) || !r.testOrderItemId || !numericOrders.has(r.testOrderItemId))
      .filter((r) => !/&lt;|<\w+>/.test(r.value ?? ''));
  };
  const rank = (r: SummaryResult) => (r.panic ? 0 : r.abnormal ? 1 : 2);

  /** Latest row per test, within `resultDays` of the newest row. */
  const latestPerTest = (rows: SummaryResult[]): SummaryResult[] => {
    const withValue = rows.filter((r) => r.value !== undefined && r.date);
    const newest = withValue.reduce((max, r) => (r.date! > max ? r.date! : max), '');
    if (!newest) return [];
    const cutoff = minusDays(newest, SUMMARY_LIMITS.resultDays);
    const latest: SummaryResult[] = [];
    for (const group of groupBy(withValue, testKey).values()) {
      const [last] = [...group].sort((a, b) => desc(a.date, b.date));
      if (!last || last.date! < cutoff) continue;
      latest.push(last);
    }
    return latest.sort((a, b) => rank(a) - rank(b) || desc(a.date, b.date));
  };

  const labs = latestPerTest(dropNoise(data.results.filter((r) => r.kind === 'lab')));
  const reports = latestPerTest(dropNoise(data.results.filter((r) => r.kind !== 'lab'))).map((r) =>
    compact({ ...r, value: cap(r.value, SUMMARY_LIMITS.reportChars), previousValue: undefined, previousDate: undefined }),
  );
  // Never cut a panic result to fit a limit.
  const results = [
    ...labs.slice(0, Math.max(SUMMARY_LIMITS.labResults, labs.filter((r) => r.panic).length)),
    ...reports.slice(0, Math.max(SUMMARY_LIMITS.reports, reports.filter((r) => r.panic).length)),
  ];

  // Surgeries: once per surgery and date.
  const seenSurgery = new Set<string>();
  const surgeries = data.surgeries
    .filter((s) => {
      const key = `${s.name?.toLowerCase()}|${s.date}`;
      if (seenSurgery.has(key)) return false;
      seenSurgery.add(key);
      return true;
    })
    .slice(0, SUMMARY_LIMITS.surgeries);

  // Allergies: every one, never capped; the same allergen listed twice counts once.
  const seenAllergy = new Set<string>();
  const allergies = data.allergies.filter((a) => {
    const key = a.allergen.toLowerCase();
    if (seenAllergy.has(key)) return false;
    seenAllergy.add(key);
    return true;
  });

  const vitals = data.vitals.slice(0, 1);
  return compact({
    patient: data.patient,
    visits,
    notes,
    diagnoses: diagnoses.map((d) => compact({ ...d, remarks: cap(d.remarks, SUMMARY_LIMITS.remarkChars) })),
    medications: medications.map((m) => compact({ ...m, remarks: cap(m.remarks, SUMMARY_LIMITS.remarkChars) })),
    results,
    surgeries,
    allergies,
    vitals,
    latestVitals: vitals[0],
  });
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
    ...data.vitals,
  ].map((x) => x.id);
  return new Set(ids);
}
