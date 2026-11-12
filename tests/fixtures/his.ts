import type {
  RawDepartmentResultsResponse,
  RawLabComponentsResponse,
  RawLabResultsResponse,
  RawLastVisitsInfoResponse,
  RawDiagnosesResponse,
  RawPatientProfileResponse,
  RawVisitsResponse,
  RawYearWiseVisitsResponse,
} from '../../src/his/types.js';

/** Synthetic data shaped like the ClinicalsAPI responses (see docs/HIS_API_RESPONSES.md). Not real patients. */

export const SENSITIVE = {
  ssn: '1098765432',
  mobile: '0550000000',
  insuranceNo: 'INS-99887766',
};

export const profileResponse: RawPatientProfileResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  Message2L: '',
  FetchPatientDataCCList: [
    {
      PatientID: '123456',
      RegCode: 'AHH.0001234',
      PatientName: 'TEST PATIENT',
      FullAge: '45Y 3M',
      Gender: 'Male',
      GenderType: 'Male',
      Nationality: 'Saudi',
      BloodGroup: 'O+',
      Height: '172',
      Weight: '80',
      IsAllergy: 1,
      IsPregnancy: 0,
      PregnancyContent: '',
      Lactation: '',
      ISVIP: '0',
      SSN: SENSITIVE.ssn,
      MobileNo: SENSITIVE.mobile,
      InsuranceNo: SENSITIVE.insuranceNo,
      DOB: '01-Jul-1981 00:00',
      GenderID: '1',
      AllergyData: "<table class='table'><tr><td>Penicillin</td></tr></table>",
      Discription: 'UHID is Blocked.</br>',
    },
  ],
};

export const visitsResponse: RawVisitsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  PatientVisitsDataList: [
    {
      PatientID: '123456',
      VisitDate: '03-Mar-2026 09:05:00',
      AdmissionID: '5001',
      HospitalName: 'AHH Olaya',
      DoctorName: 'Dr. A',
      SpecialisationName: 'Cardiology',
      PatientType: '1',
      PatientTypeName: 'OP',
      IsNewVisit: '0',
    },
    {
      PatientID: '123456',
      VisitDate: '12-Sep-2026 10:15:00',
      AdmissionID: '5002',
      HospitalName: 'AHH Olaya',
      DoctorName: 'Dr. B',
      SpecialisationName: 'Internal Medicine',
      PatientType: '3',
      PatientTypeName: 'ED',
      IsNewVisit: '1',
    },
  ],
};

export const yearWiseResponse: RawYearWiseVisitsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchyearWisePatientVisitsDataList: [
    { PatientType: '1', YearID: '2025', TotalPatients: '3' },
    { PatientType: '1', YearID: '2026', TotalPatients: '4' },
    { PatientType: '3', YearID: '2026', TotalPatients: '1' },
  ],
};

export const diagnosesResponse: RawDiagnosesResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  PatientDiseasesDataList: [
    {
      DiseaseName: 'Essential hypertension',
      Code: 'I10',
      DiagnosisType: 'Primary',
      DiagnosisStatus: 'Active',
      AdmissionID: '5001',
      CreateDate: '03-Mar-2026 09:30',
      Doctorname: 'Dr. A',
      HospitalName: 'AHH Olaya',
      PatientType: '1',
      Blocked: '0',
    },
    {
      DiseaseName: 'Acute bronchitis',
      Code: 'J20.9',
      DiagnosisType: 'Primary',
      DiagnosisStatus: 'Active',
      AdmissionID: '5002',
      CreateDate: '12-Sep-2026 10:40',
      Doctorname: 'Dr. B',
      HospitalName: 'AHH Olaya',
      PatientType: '3',
      Blocked: '0',
    },
    {
      DiseaseName: 'BLOCKED CONFIDENTIAL DIAGNOSIS',
      Code: 'F32.9',
      AdmissionID: '5002',
      CreateDate: '12-Sep-2026 11:00',
      Blocked: '1',
    },
  ],
};

export const failEnvelope = {
  Code: 404,
  Status: 'Fail',
  Message: 'System.Data.SqlClient.SqlException: Invalid column name ...',
};

/** Lab list: panic potassium, abnormal CBC, normal TSH, and one not-yet-resulted order. */
export const labResultsResponse: RawLabResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabOrderResultsDataaList: [
    {
      TestOrderItemID: '9001', TestOrderId: '700', TestId: '41', TestName: 'Potassium', specialisation: 'Chemistry',
      OrderDate: '2026-10-05T08:10:00', SampleCollectedAt: '05-Oct-2026 08:30', ResultVerifiedAt: '05-Oct-2026 10:05',
      StatusName: 'Verified', IsPanic: 'True', IsAbnormal: 'True', IsPreliminary: 'False', IsResult: '4',
      PatientType: '2', SampleNumber: 'S-1', HospitalID: '3', HospitalName: 'AHH Olaya', ResultVerifiedByName: 'Lab Tech A',
    },
    {
      TestOrderItemID: '9002', TestOrderId: '701', TestId: '12', TestName: 'CBC', specialisation: 'Hematology',
      OrderDate: '2026-10-03T07:00:00', SampleCollectedAt: '03-Oct-2026 07:20', StatusName: 'Verified',
      IsPanic: 'False', IsAbnormal: 'True', IsPreliminary: 'True', IsResult: '4', PatientType: '2', HospitalID: '3',
    },
    {
      TestOrderItemID: '9003', TestOrderId: '702', TestId: '88', TestName: 'TSH', OrderDate: '2026-09-20T09:00:00',
      StatusName: 'Verified', IsPanic: 'False', IsAbnormal: 'False', IsResult: '4', PatientType: '1', HospitalID: '3',
    },
    {
      TestOrderItemID: '9004', TestOrderId: '703', TestId: '50', TestName: 'HbA1c', OrderDate: '2026-10-06T09:00:00',
      StatusName: 'Sample Collected', IsPanic: 'False', IsAbnormal: 'False', IsResult: '1', PatientType: '2', HospitalID: '3',
    },
  ],
};

export const potassiumComponentsResponse: RawLabComponentsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabTestComponentsListM: [
    {
      TestID: '41', ParameterName: 'Potassium', Seq: '1', TextValue: '6.8', PrevTextValue: '5.0', Unitname: 'mmol/L',
      MinLimit: '3.5', MaxLimit: '5.1', PanicMin: '2.8', PanicMax: '6.2', RRValue: '3.5 - 5.1 mmol/L',
    },
    { TestID: '41', ParameterName: 'Comment', Seq: '2', TextValue: '', Unitname: '' },
  ],
};

export const radiologyResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchRadOrderResultsDataaList: [
    {
      TestOrderItemID: '8001', TestName: 'CT Chest', OrderDate: '2026-10-04T12:00:00', StatusName: 'Verified',
      IsPanic: 'False', IsAbnormal: 'True', IsResult: '7', HospitalName: 'AHH Olaya',
    },
    { TestOrderItemID: '8002', TestName: 'Chest X-ray', OrderDate: '2026-10-06T12:00:00', StatusName: 'Ordered', IsResult: '1' },
  ],
};

/** Neurology uses the lab list name. */
export const neurologyResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabOrderResultsDataaList: [
    { TestOrderItemID: '8101', TestName: 'EEG', OrderDate: '2026-09-28T10:00:00', StatusName: 'Verified', IsPanic: 'False', IsAbnormal: 'False', IsResult: '7' },
  ],
};

export const emptyDepartmentResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: 'No Records Found',
  FetchRadOrderResultsDataaList: [],
};

/**
 * PatientLastVisitsInfo for a follow-up patient. Admission 9001 is the visit open now (kept, marked current).
 * Five visits (only the newest 3 are kept), SSN and patient name on rows (must never leak), a copied note,
 * a blocked diagnosis, repeated / blocked / ended / discontinued medicines, order-level lab flags with a
 * panic potassium, an abnormal HbA1c with a previous value, a culture, noise rows, an old result outside
 * the 30-day window, and a duplicated allergy.
 */
export const lastVisitsInfoResponse: RawLastVisitsInfoResponse = {
  Code: 200,
  Status: 'Success',
  PatientClinicalEpisodeMetricsModelDataList: [
    { AdmissionID: '9001', VisitDate: '10-Nov-2026 09:00', PatientType: '1', FullAge: '72 Y', Gender: 'Male', DoctorName: 'Dr. Now', SpecialisationName: 'Internal Medicine', HospitalName: 'AHH Olaya', ...{ PatientName: 'Test Patient', RegCode: 'AHH.0001234' } },
    { AdmissionID: '5002', VisitDate: '02-Oct-2026 10:15', PatientType: '1', DoctorName: 'Dr. A', SpecialisationName: 'Internal Medicine', HospitalName: 'AHH Olaya', Disposition: 'Home' },
    { AdmissionID: '5001', VisitDate: '10-Jun-2026 11:00', PatientType: '3', DoctorName: 'Dr. B', SpecialisationName: 'Emergency', HospitalName: 'AHH Nuzha' },
    { AdmissionID: '4000', VisitDate: '05-Jan-2026 08:30', DischargeDate: '08-Jan-2026 12:00', PatientType: '2', DoctorName: 'Dr. C', SpecialisationName: 'Cardiology', HospitalName: 'AHH Olaya' },
    { AdmissionID: '3000', VisitDate: '01-Mar-2025 08:30', PatientType: '1', DoctorName: 'Dr. D', SpecialisationName: 'ENT', HospitalName: 'AHH Olaya' },
  ],
  PatientClinicalExaminationMetricsModelDataList: [
    {
      Admissionid: '5002',
      DoctorName: 'Dr. A',
      ChiefComplaint: '<p>Follow-up for diabetes&nbsp;and fatigue</p>',
      AssessmentPlan: '<div>Continue metformin.<br/>Repeat HbA1c in 3 months.</div>',
      Blocked: '0',
      Createdate: '02-Oct-2026 10:30',
      ...{ SSN: SENSITIVE.ssn, PatientName: 'Test Patient' },
    },
    // The same note copied forward the next day (the real API repeats notes like this).
    {
      Admissionid: '5002',
      DoctorName: 'Dr. A',
      ChiefComplaint: '<p>Follow-up for diabetes&nbsp;and fatigue</p>',
      AssessmentPlan: '<div>Continue metformin.<br/>Repeat HbA1c in 3 months.</div>',
      Blocked: '0',
      Createdate: '03-Oct-2026 09:00',
    },
    { Admissionid: '3000', ChiefComplaint: 'Too old, visit not kept', Blocked: '0' },
  ],
  PatientDiagnosisMetricsModelDataList: [
    { AdmissionID: '5002', DiseaseName: 'Type 2 diabetes mellitus', Code: 'E11.9', DiagnosisType: '2', DiagonosisType: 'Primary', Blocked: '0', ...{ SSN: SENSITIVE.ssn } },
    { AdmissionID: '5002', DiseaseName: 'Type 2 diabetes mellitus', Code: 'E11.9', Blocked: '0' },
    { AdmissionID: '5002', DiseaseName: 'BLOCKED CONFIDENTIAL DIAGNOSIS', Code: 'F32.9', Blocked: '1' },
    { AdmissionID: '5001', DiseaseName: 'Hypokalemia', Code: 'E87.6', Blocked: '0' },
  ],
  MedicationPrescriptionHeaderMetricsModelDataList: [
    { Admissionid: '5002', ItemName: 'Amoxicillin 500 mg capsule', Dose: '1.00000', DoseUoM: 'capsule', Frequency: 'Every 8 hours', PrescriptionDate: '02-Oct-2026 10:45', EndDateTime: '09-Oct-2026 10:45', Blocked: '0' },
    { Admissionid: '5002', ItemName: 'Metformin 500 mg tablet', Dose: '1.00000', DoseUoM: 'tablet', Strength: '1.00000', StrengthUOM: 'tablet', Frequency: 'Twice daily', AdmRoute: 'Oral   ', PrescriptionDate: '02-Oct-2026 10:40', Blocked: '0' },
    // Same drug prescribed again earlier: only the latest prescription is kept.
    { Admissionid: '5002', ItemName: 'Metformin 500 mg tablet', Dose: '2', DoseUoM: 'tablet', Frequency: 'Once daily', PrescriptionDate: '01-Oct-2026 08:00', Blocked: '0' },
    { Admissionid: '5002', ItemName: 'Old blocked item', Blocked: '1' },
    { Admissionid: '5001', ItemName: 'Potassium chloride', Frequency: 'Once daily', DiscontinuingRemarks: 'Level normal', Blocked: '0' },
  ],
  LabTestResultDetailMetricsModelDataList: [
    // Flags are order-level, as in the real API: every row of an order carries the same IsPanic / IsAbnormal.
    { TestOrderItemID: 'L0', OrderDate: '15-Jun-2026 08:00', TestName: 'HbA1c', ParameterName: 'HbA1c', Value: '7.80000', UOM: '[%]', MinLimit: '4.00000', MaxLimit: '5.60000', IsPanic: 'False', IsAbnormal: 'True' },
    { TestOrderItemID: 'L1', OrderDate: '20-Sep-2026 08:00', ResultVerifiedAt: '20-Sep-2026 10:00', TestName: 'HbA1c', ParameterName: 'HbA1c', Value: '8.9', UOM: '[%]', MinLimit: '4.00000', MaxLimit: '5.60000', IsPanic: 'False', IsAbnormal: 'True' },
    { TestOrderItemID: 'L2', OrderDate: '01-Oct-2026 08:00', TestName: 'Electrolytes', ParameterName: 'Potassium', Value: '2.4', UOM: 'mmol/L', MinLimit: '3.5', MaxLimit: '5.1', PanicMin: '2.5', PanicMax: '6.5', IsPanic: 'True', IsAbnormal: 'True' },
    { TestOrderItemID: 'L2', OrderDate: '01-Oct-2026 08:00', TestName: 'Electrolytes', ParameterName: 'Sodium', Value: '139', UOM: 'mmol/L', MinLimit: '135', MaxLimit: '145', PanicMin: '120', PanicMax: '160', IsPanic: 'True', IsAbnormal: 'True' },
    { TestOrderItemID: 'L2', OrderDate: '01-Oct-2026 08:00', TestName: 'Electrolytes', ParameterName: 'REMARKS', Value: 'Repeated', IsPanic: 'True', IsAbnormal: 'True' },
    { TestOrderItemID: 'L4', OrderDate: '01-Jan-2026 08:00', TestName: 'TSH', ParameterName: 'TSH', Value: '2.1', IsPanic: 'False', IsAbnormal: 'False' },
    { TestOrderItemID: 'L5', OrderDate: '01-Oct-2026 08:00', TestName: 'Pending test', ParameterName: 'X', Value: '' },
    { TestOrderItemID: 'L6', OrderDate: '28-Sep-2026 08:00', TestName: 'URINE CULTURE', ParameterName: 'Result', Value: 'Growth of Escherichia coli', IsPanic: 'False', IsAbnormal: 'True' },
    { TestOrderItemID: 'L6', OrderDate: '28-Sep-2026 08:00', TestName: 'URINE CULTURE', ParameterName: 'Sencitivity', Value: '&lt;ZoneDiameter&gt;&lt;Antibiotics&gt;…', IsPanic: 'False', IsAbnormal: 'True' },
  ],
  RadiologyTestResultDetailMetricsModelDataList: [
    { TestOrderItemID: 'R1', OrderDate: '02-Oct-2026 11:00', TestName: 'Chest X-ray', Value: '<p>No acute findings.</p>', IsPanic: '0', IsAbnormal: '0' },
  ],
  ProcedureTestResultDetailMetricsModelDataList: [],
  PatientSurgeryTrackingMetricsModelDataList: [
    { AdmissionID: '4000', SurgeryDate: '06-Jan-2026 09:00', SurgeryName: 'Coronary angiography', DoctorName: 'Dr. C', ...{ UHID: 'AHH.0001234' } },
  ],
  PatientAllergyDetailsModelDataList: [
    { TypeOfallergy: 'Drug', AllergyName: 'Penicillin' },
    { TypeOfallergy: 'Drug', AllergyName: 'penicillin' },
    { TypeOfallergy: 'Food', AllergyName: 'Peanuts' },
  ],
  PatientVitalsMetricsModelDataList: [
    { VitalSignDate: '01-Jun-2026 10:00', BPSystolic: '150', BPDiastolic: '95', Pulse: '90' },
    { VitalSignDate: '02-Oct-2026 10:05', BPSystolic: '135', BPDiastolic: '85', Pulse: '78', SPO2: '98', Temperature: '36.8' },
  ],
};

/** A patient with no visit except the one open now. */
export const newPatientLastVisitsResponse: RawLastVisitsInfoResponse = {
  Code: 200,
  Status: 'Success',
  PatientClinicalEpisodeMetricsModelDataList: [{ AdmissionID: '9001', VisitDate: '10-Nov-2026 09:00', PatientType: '1' }],
  PatientAllergyDetailsModelDataList: [{ TypeOfallergy: 'Drug', AllergyName: 'Penicillin' }],
};
